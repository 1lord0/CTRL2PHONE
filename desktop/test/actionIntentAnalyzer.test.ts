import {
  ACTION_INTENT_PROMPT,
  ACTION_INTENT_RESPONSE_SCHEMA,
  analyzeActionIntent,
  parseActionIntentAnalysis,
} from '../src/lib/actionIntentAnalyzer';

const VALID = {
  intentType: 'profile_research',
  confidence: 0.92,
  title: 'Profil araştırması',
  rationale: 'Görünen bir profil ve kullanıcı adı var.',
  searchQueries: ['görünen_kullanici_adi'],
  visibleText: ['@görünen_kullanici_adi'],
} as const;

describe('action intent analyzer', () => {
  it('uses the configured Gemini key through the structured adapter', async () => {
    const analyze = jest.fn(async () => VALID);
    const result = await analyzeActionIntent(Buffer.from('png'), { apiKey: 'gemini-key' }, analyze);

    expect(result).toEqual(VALID);
    expect(analyze).toHaveBeenCalledWith(
      { apiKey: 'gemini-key' },
      Buffer.from('png').toString('base64'),
      ACTION_INTENT_PROMPT,
      ACTION_INTENT_RESPONSE_SCHEMA
    );
  });

  it('refuses to run without the desktop Gemini API key', async () => {
    await expect(analyzeActionIntent(Buffer.from('png'), { apiKey: '   ' })).rejects.toThrow(
      'action_gemini_api_key_missing'
    );
  });

  it('safely sanitizes routes, confidence and bounded evidence arrays', () => {
    expect(parseActionIntentAnalysis(VALID)).toEqual(VALID);
    expect(parseActionIntentAnalysis({ ...VALID, intentType: 'face_lookup' }).intentType).toBe(
      'general_visual_analysis'
    );
    expect(parseActionIntentAnalysis({ ...VALID, confidence: 2 }).confidence).toBe(1);
    expect(
      parseActionIntentAnalysis({ ...VALID, searchQueries: new Array(6).fill('query') }).searchQueries
        .length
    ).toBe(5);
  });

  it('explicitly prohibits face identification and sensitive-data extraction', () => {
    expect(ACTION_INTENT_PROMPT).toContain('Yüzden kimlik tahmini yapma');
    expect(ACTION_INTENT_PROMPT).toContain('Hassas kişisel veri');
  });
});
