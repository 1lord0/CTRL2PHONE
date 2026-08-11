import { analyzeGeminiStructured } from './aiProviders';

export const ACTION_INTENT_TYPES = [
  'profile_research',
  'recipe_extraction',
  'general_visual_analysis',
] as const;

export type ActionIntentType = (typeof ACTION_INTENT_TYPES)[number];

export interface ActionIntentAnalysis {
  intentType: ActionIntentType;
  confidence: number;
  title: string;
  rationale: string;
  searchQueries: string[];
  visibleText: string[];
}

export const ACTION_INTENT_RESPONSE_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  properties: {
    intentType: {
      type: 'string',
      enum: ACTION_INTENT_TYPES,
      description: 'The single best workflow route for the screenshot.',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    title: { type: 'string', description: 'A short Turkish task title.' },
    rationale: { type: 'string', description: 'A short reason for the selected route.' },
    searchQueries: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string' },
      description: 'Queries based only on visible names, handles, brands, dishes, or text.',
    },
    visibleText: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string' },
      description: 'Important text visibly present in the screenshot.',
    },
  },
  required: ['intentType', 'confidence', 'title', 'rationale', 'searchQueries', 'visibleText'],
});

export const ACTION_INTENT_PROMPT = `Bu ekran görüntüsünü yalnızca hangi Ctrl2Phone iş akışının çalışacağını belirlemek için incele.

Rotalar:
- profile_research: Görüntüde profil sayfası, kişi/marka adı veya açık kullanıcı adı var ve kullanıcı kamuya açık hesap/mesleki profil araştırması isteyebilir.
- recipe_extraction: Yemek, tarif, malzeme, pişirme videosu veya tarif metni var.
- general_visual_analysis: Diğer tüm görsel açıklama, belge, ürün, hata veya genel araştırma işleri.

Güvenlik kuralları:
- Yüzden kimlik tahmini yapma ve bilinmeyen kişiyi teşhis etmeye çalışma.
- Arama sorgularını yalnız görüntüde açıkça görülen ad, kullanıcı adı, marka, yemek veya metinden üret.
- Hassas kişisel veri, gizli hesap, adres, telefon veya e-posta çıkarmaya çalışma.
- Görüntü belirsizse general_visual_analysis seç ve confidence değerini düşür.
- Kısa, doğrulanabilir ve Türkçe bir başlık/rationale üret.`;

function boundedString(value: unknown, _name: string, maxLength: number, fallback: string = 'Ekran İnceleme'): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  if (normalized.length > maxLength) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
}

function boundedStrings(value: unknown, _name: string, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string' && value.trim()) {
      return [value.trim().slice(0, 240)];
    }
    return [];
  }
  const items: string[] = [];
  for (const item of value) {
    let strVal = '';
    if (typeof item === 'string') {
      strVal = item.trim();
    } else if (item && typeof item === 'object') {
      const candidate = (item as any).text || (item as any).value || (item as any).name || JSON.stringify(item);
      if (typeof candidate === 'string') strVal = candidate.trim();
    } else if (item !== null && item !== undefined) {
      strVal = String(item).trim();
    }
    if (strVal) {
      items.push(strVal.slice(0, 240));
    }
    if (items.length >= maxItems) break;
  }
  return items;
}

export function parseActionIntentAnalysis(value: unknown): ActionIntentAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('action_intent_response_invalid');
  }
  const input = value as Record<string, unknown>;
  const rawIntentType = String(input.intentType ?? '');
  const intentType: ActionIntentType = ACTION_INTENT_TYPES.includes(rawIntentType as ActionIntentType)
    ? (rawIntentType as ActionIntentType)
    : 'general_visual_analysis';

  const rawConfidence =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? Math.min(Math.max(input.confidence, 0), 1)
      : 0.8;

  return {
    intentType,
    confidence: rawConfidence,
    title: boundedString(input.title, 'title', 160, 'Ekran İnceleme'),
    rationale: boundedString(input.rationale, 'rationale', 1000, 'Görsel içerik analiz edildi.'),
    searchQueries: boundedStrings(input.searchQueries, 'search_queries', 5),
    visibleText: boundedStrings(input.visibleText, 'visible_text', 10),
  };
}

export async function analyzeActionIntent(
  pngBuffer: Buffer,
  config: { apiKey: string; model?: string },
  analyze: typeof analyzeGeminiStructured = analyzeGeminiStructured
): Promise<ActionIntentAnalysis> {
  if (!config.apiKey.trim()) throw new Error('action_gemini_api_key_missing');
  const raw = await analyze(
    config,
    pngBuffer.toString('base64'),
    ACTION_INTENT_PROMPT,
    ACTION_INTENT_RESPONSE_SCHEMA
  );
  console.log('[INTENT_RAW_DEBUG] Raw response from Gemini:', JSON.stringify(raw, null, 2));
  return parseActionIntentAnalysis(raw);
}
