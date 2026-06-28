"use strict";
// Provider-agnostic image+prompt analysis. Each adapter targets a provider's
// REST endpoint; the request builder and response parser are pure so they can be
// unit-tested without network access. The actual fetch runs in the Electron main
// process (Node), so no CORS / CSP applies.
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultModelFor = defaultModelFor;
exports.buildAiRequest = buildAiRequest;
exports.parseAiResponse = parseAiResponse;
exports.analyzeImage = analyzeImage;
const MAX_OUTPUT_TOKENS = 4096;
function defaultModelFor(provider) {
    switch (provider) {
        case 'gemini':
            return 'gemini-2.0-flash';
        case 'claude':
            return 'claude-opus-4-8';
        case 'openai':
            return 'gpt-4o';
        default:
            return '';
    }
}
/** Build the HTTP request for a provider. Pure — no network, unit-testable. */
function buildAiRequest(cfg, pngBase64, prompt) {
    const model = cfg.model && cfg.model.trim() ? cfg.model.trim() : defaultModelFor(cfg.provider);
    if (cfg.provider === 'gemini') {
        return {
            url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
            headers: { 'Content-Type': 'application/json' },
            body: {
                contents: [
                    {
                        parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: pngBase64 } }],
                    },
                ],
                generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
            },
        };
    }
    if (cfg.provider === 'claude') {
        return {
            url: 'https://api.anthropic.com/v1/messages',
            headers: {
                'content-type': 'application/json',
                'x-api-key': cfg.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: {
                model,
                max_tokens: MAX_OUTPUT_TOKENS,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image',
                                source: { type: 'base64', media_type: 'image/png', data: pngBase64 },
                            },
                        ],
                    },
                ],
            },
        };
    }
    // openai + custom share the OpenAI Chat Completions shape.
    const base = (cfg.provider === 'custom' && cfg.baseUrl ? cfg.baseUrl : 'https://api.openai.com/v1')
        .trim()
        .replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) {
        headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    }
    return {
        url: `${base}/chat/completions`,
        headers,
        body: {
            model,
            max_tokens: MAX_OUTPUT_TOKENS,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${pngBase64}` } },
                    ],
                },
            ],
        },
    };
}
/** Extract the assistant text from a provider's JSON response. Pure. */
function parseAiResponse(provider, json) {
    if (provider === 'gemini') {
        const parts = json?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
            return parts
                .map((p) => p?.text)
                .filter((t) => typeof t === 'string')
                .join('')
                .trim();
        }
        return '';
    }
    if (provider === 'claude') {
        const blocks = json?.content;
        if (Array.isArray(blocks)) {
            const textBlock = blocks.find((b) => b?.type === 'text');
            return typeof textBlock?.text === 'string' ? textBlock.text.trim() : '';
        }
        return '';
    }
    // openai + custom
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
}
/** Send the image + prompt to the configured provider and return the reply text. */
async function analyzeImage(cfg, pngBase64, prompt) {
    const { url, headers, body } = buildAiRequest(cfg, pngBase64, prompt);
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 400);
        }
        catch {
            // ignore body-read failure
        }
        throw new Error(`${cfg.provider} ${res.status}: ${detail}`);
    }
    const json = await res.json();
    const text = parseAiResponse(cfg.provider, json);
    if (!text) {
        throw new Error('Boş veya beklenmeyen yanıt formatı');
    }
    return text;
}
