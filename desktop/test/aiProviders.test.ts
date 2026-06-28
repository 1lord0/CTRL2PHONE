import {
  buildAiRequest,
  parseAiResponse,
  defaultModelFor,
  AiConfig,
} from '../src/lib/aiProviders';

const PNG = 'aGVsbG8='; // "hello" base64
const PROMPT = 'Bu ekranı açıkla';

describe('defaultModelFor', () => {
  it('returns sensible per-provider defaults', () => {
    expect(defaultModelFor('gemini')).toBe('gemini-2.0-flash');
    expect(defaultModelFor('claude')).toBe('claude-opus-4-8');
    expect(defaultModelFor('openai')).toBe('gpt-4o');
    expect(defaultModelFor('custom')).toBe('');
  });
});

describe('buildAiRequest — gemini', () => {
  const cfg: AiConfig = { provider: 'gemini', apiKey: 'KEY123' };

  it('targets the generateContent endpoint with the key in the query string', () => {
    const req = buildAiRequest(cfg, PNG, PROMPT);
    expect(req.url).toContain('models/gemini-2.0-flash:generateContent');
    expect(req.url).toContain('key=KEY123');
  });

  it('puts the prompt text and inline png image in the parts array', () => {
    const body = buildAiRequest(cfg, PNG, PROMPT).body as any;
    const parts = body.contents[0].parts;
    expect(parts[0].text).toBe(PROMPT);
    expect(parts[1].inline_data.mime_type).toBe('image/png');
    expect(parts[1].inline_data.data).toBe(PNG);
  });

  it('honors an explicit model override', () => {
    const req = buildAiRequest({ ...cfg, model: 'gemini-1.5-pro' }, PNG, PROMPT);
    expect(req.url).toContain('models/gemini-1.5-pro:generateContent');
  });
});

describe('buildAiRequest — claude', () => {
  const cfg: AiConfig = { provider: 'claude', apiKey: 'sk-ant-xxx' };

  it('targets the Anthropic messages endpoint with the required headers', () => {
    const req = buildAiRequest(cfg, PNG, PROMPT);
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-ant-xxx');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('defaults to claude-opus-4-8 and sends a base64 image content block', () => {
    const body = buildAiRequest(cfg, PNG, PROMPT).body as any;
    expect(body.model).toBe('claude-opus-4-8');
    const content = body.messages[0].content;
    expect(content[0]).toEqual({ type: 'text', text: PROMPT });
    expect(content[1].type).toBe('image');
    expect(content[1].source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: PNG,
    });
  });
});

describe('buildAiRequest — openai & custom', () => {
  it('openai targets api.openai.com with a Bearer token and image_url data URI', () => {
    const req = buildAiRequest({ provider: 'openai', apiKey: 'sk-oai' }, PNG, PROMPT);
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.headers['Authorization']).toBe('Bearer sk-oai');
    const body = req.body as any;
    expect(body.model).toBe('gpt-4o');
    expect(body.messages[0].content[1].image_url.url).toBe(`data:image/png;base64,${PNG}`);
  });

  it('custom uses the supplied baseUrl (trailing slash trimmed) and model', () => {
    const req = buildAiRequest(
      { provider: 'custom', apiKey: '', baseUrl: 'http://localhost:11434/v1/', model: 'llava' },
      PNG,
      PROMPT
    );
    expect(req.url).toBe('http://localhost:11434/v1/chat/completions');
    expect((req.body as any).model).toBe('llava');
  });

  it('custom omits the Authorization header when no key is given', () => {
    const req = buildAiRequest(
      { provider: 'custom', apiKey: '', baseUrl: 'http://localhost:11434/v1' },
      PNG,
      PROMPT
    );
    expect(req.headers['Authorization']).toBeUndefined();
  });
});

describe('parseAiResponse', () => {
  it('reads gemini candidates → content → parts text', () => {
    const json = { candidates: [{ content: { parts: [{ text: 'Merhaba ' }, { text: 'dünya' }] } }] };
    expect(parseAiResponse('gemini', json)).toBe('Merhaba dünya');
  });

  it('reads the first claude text block, skipping non-text blocks', () => {
    const json = {
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'Cevap' },
      ],
    };
    expect(parseAiResponse('claude', json)).toBe('Cevap');
  });

  it('reads openai/custom choices → message → content', () => {
    const json = { choices: [{ message: { content: 'OpenAI cevabı' } }] };
    expect(parseAiResponse('openai', json)).toBe('OpenAI cevabı');
    expect(parseAiResponse('custom', json)).toBe('OpenAI cevabı');
  });

  it('returns an empty string on malformed responses (never throws)', () => {
    expect(parseAiResponse('gemini', {})).toBe('');
    expect(parseAiResponse('claude', { content: 'oops' })).toBe('');
    expect(parseAiResponse('openai', { choices: [] })).toBe('');
  });
});
