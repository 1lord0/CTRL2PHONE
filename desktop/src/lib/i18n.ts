// Tiny i18n layer for the desktop renderer. The dictionaries live in the main
// process (pure + unit-testable); main resolves the active language and ships the
// already-resolved string map to the renderer via the app-ready IPC, so the
// renderer never has to import this module (it runs without Node `require`).

export type Lang = 'en' | 'tr';
export type LanguageSetting = 'system' | Lang;

export type Strings = Record<string, string>;

const en: Strings = {
  'meta.lang': 'en',
  'app.title': 'Ctrl2Phone — Screen Capture',
  'hero.eyebrow': 'Windows screen tool',
  'hero.h1': 'Select with double Ctrl, send with X (AI) or M (Phone)',
  'hero.lede':
    'Double-tap Left Ctrl to open the selection overlay. After drawing a region: X or Enter sends it to your AI provider, M sends it to your phone. Press Esc to cancel, Q to quit.\n📋 Ctrl+Shift+V → Send clipboard text/link to phone instantly.',
  'label.prompt': 'Prompt for the AI',
  'ph.prompt': 'Optionally write a short note to send along with the image.',
  'label.supabaseUrl': 'Supabase URL',
  'label.supabaseKey': 'Supabase Anon Key',
  'ph.supabaseKey': 'Supabase Anon Key (do not use the Service Key)',
  'label.supabaseBucket': 'Supabase Bucket Name',
  'label.autoCopy': 'Auto-copy images received from the phone to the clipboard',
  'label.hotkeySettingsHeader': 'Advanced Hotkey Settings',
  'label.aiSettingsHeader': 'AI and Language Settings',
  'label.hotkey': 'Trigger key (double tap)',
  'opt.leftCtrl': 'Left Ctrl',
  'opt.rightCtrl': 'Right Ctrl',
  'opt.leftAlt': 'Left Alt',
  'opt.rightAlt': 'Right Alt',
  'opt.leftShift': 'Left Shift',
  'opt.rightShift': 'Right Shift',
  'label.doublePressMs': 'Double-press window (ms)',
  'label.aiProvider': 'AI provider',
  'opt.aiWeb': 'Gemini (web — no key needed)',
  'opt.aiGemini': 'Gemini API',
  'opt.aiClaude': 'Claude API (Anthropic)',
  'opt.aiOpenai': 'OpenAI API',
  'opt.aiCustom': 'Custom (OpenAI-compatible / local)',
  'label.aiApiKey': 'API key (stored encrypted on this device)',
  'ph.aiApiKey': 'sk-... / AIza...',
  'label.aiModel': 'Model (blank = default)',
  'ph.aiModel': 'e.g. claude-opus-4-8',
  'label.aiBaseUrl': 'Custom server address (base URL)',
  'ph.aiBaseUrl': 'http://localhost:11434/v1',
  'hint.aiProvider':
    'In "Web" mode the image is pasted into gemini.google.com. Pick an API provider and enter a key, and the selected region is sent to the API with the reply shown right here.',
  'label.storage': 'Supabase Cloud Storage',
  'label.qr': 'To pair via QR from the phone Settings:',
  'btn.save': 'Save settings',
  'btn.sendClipboard': '📋 Send Clipboard',
  'btn.purge': 'Purge Cloud',
  'btn.setupRls': '🔒 Secure Setup: copy the RLS SQL & open Supabase',
  'hint.setupRls':
    'One-time: press the button → the SQL is copied to your clipboard and the Supabase SQL Editor opens → paste it and press Run. It makes the bucket private and scopes the anon key to this bucket only.',
  'label.status': 'Status',
  'status.ready': 'Ready',
  'status.selectionActive': 'Selection mode active',
  'response.placeholder': 'The AI reply will appear here.',
  'status.settingsSaved': 'Settings saved',
  'status.purging': 'Purging…',
  'status.purgeDone': 'Purge complete ({n} files deleted)',
  'status.purgeError': 'Purge error: ',
  'status.rlsCopying': 'Copying RLS SQL to clipboard…',
  'status.rlsCopied': 'RLS SQL copied. Paste it into the opened Supabase SQL Editor and press Run.',
  'status.rlsError': 'RLS setup error: ',
  'status.genericError': 'Error: ',
  'status.unknownError': 'Unknown error',
  'status.sendingClipboard': 'Sending clipboard to phone...',
  'status.sendClipboardError': 'Clipboard send error: ',
  'response.rlsPrefix':
    'The SQL below was copied — paste it into the Supabase SQL Editor and press Run:\n\n',
  'confirm.purge':
    'All images in the Supabase bucket (including to_pc) will be PERMANENTLY deleted. Are you sure?',
  'label.uiLanguage': 'Interface language',
  'opt.langSystem': 'System',
  'opt.langEn': 'English',
  'opt.langTr': 'Türkçe',
};

const tr: Strings = {
  'meta.lang': 'tr',
  'app.title': 'Ctrl2Phone — Ekran Yakalama',
  'hero.eyebrow': 'Windows ekran aracı',
  'hero.h1': 'Çift Ctrl ile seç, X (Yapay Zekâ) veya M (Telefon) ile gönder',
  'hero.lede':
    "İki kere üst üste sol Ctrl'e basınca seçim katmanı açılır. Fareyle alanı çizdikten sonra: X veya Enter ile yapay zekâ sağlayıcına, M ile Telefona gönderirsiniz. İptal etmek için Esc tuşuna basın. Q ile çık.\n📋 Ctrl+Shift+V → Panodaki metni/linki anında telefona gönderir.",
  'label.prompt': 'Yapay zekâ için kısa not',
  'ph.prompt': 'İstersen görüntüyle birlikte kullanılacak kısa bir not yaz.',
  'label.supabaseUrl': 'Supabase URL',
  'label.supabaseKey': 'Supabase Anon Key',
  'ph.supabaseKey': 'Supabase Anon Key (Service Key kullanmayın)',
  'label.supabaseBucket': 'Supabase Bucket Name',
  'label.autoCopy': 'Telefondan gelen görselleri otomatik panoya kopyala',
  'label.hotkeySettingsHeader': 'Gelişmiş Kısayol Ayarları',
  'label.aiSettingsHeader': 'Yapay Zekâ ve Dil Ayarları',
  'label.hotkey': 'Kısayol tuşu (çift bas)',
  'opt.leftCtrl': 'Sol Ctrl',
  'opt.rightCtrl': 'Sağ Ctrl',
  'opt.leftAlt': 'Sol Alt',
  'opt.rightAlt': 'Sağ Alt',
  'opt.leftShift': 'Sol Shift',
  'opt.rightShift': 'Sağ Shift',
  'label.doublePressMs': 'Çift basış süresi (ms)',
  'label.aiProvider': 'Yapay zekâ sağlayıcı',
  'opt.aiWeb': 'Gemini (web — anahtar gerekmez)',
  'opt.aiGemini': 'Gemini API',
  'opt.aiClaude': 'Claude API (Anthropic)',
  'opt.aiOpenai': 'OpenAI API',
  'opt.aiCustom': 'Özel (OpenAI uyumlu / yerel)',
  'label.aiApiKey': 'API anahtarı (cihazda şifreli saklanır)',
  'ph.aiApiKey': 'sk-... / AIza...',
  'label.aiModel': 'Model (boş = varsayılan)',
  'ph.aiModel': 'örn. claude-opus-4-8',
  'label.aiBaseUrl': 'Özel sunucu adresi (base URL)',
  'ph.aiBaseUrl': 'http://localhost:11434/v1',
  'hint.aiProvider':
    '"Web" modunda görsel gemini.google.com\'a yapıştırılır. Bir API sağlayıcı seçip anahtar girersen, seçtiğin alan API\'ye gönderilir ve yanıt doğrudan burada gösterilir.',
  'label.storage': 'Supabase Bulut Depolama',
  'label.qr': 'Telefonda Ayarlardan QR ile Eşitlemek İçin:',
  'btn.save': 'Ayarları kaydet',
  'btn.sendClipboard': '📋 Telefona Gönder',
  'btn.purge': 'Bulutu Temizle',
  'btn.setupRls': "🔒 Güvenli Kurulum: RLS SQL'ini kopyala & Supabase'i aç",
  'hint.setupRls':
    "Tek seferlik: butona bas → SQL panoya kopyalanır ve Supabase SQL Editör açılır → yapıştırıp Run de. Bucket'ı gizli yapar, anon anahtarını yalnızca bu bucket ile sınırlar.",
  'label.status': 'Durum',
  'status.ready': 'Hazır',
  'status.selectionActive': 'Seçim modu açık',
  'response.placeholder': 'Yapay zekâ yanıtı burada görünecek.',
  'status.settingsSaved': 'Ayarlar kaydedildi',
  'status.purging': 'Temizleniyor...',
  'status.purgeDone': 'Temizlik başarılı ({n} dosya silindi)',
  'status.purgeError': 'Temizlik hatası: ',
  'status.rlsCopying': 'RLS SQL panoya kopyalanıyor...',
  'status.rlsCopied':
    "RLS SQL panoya kopyalandı. Açılan Supabase SQL Editör'e yapıştırıp Run deyin.",
  'status.rlsError': 'RLS kurulum hatası: ',
  'status.genericError': 'Hata: ',
  'status.unknownError': 'Bilinmeyen hata',
  'status.sendingClipboard': 'Metin telefona gönderiliyor...',
  'status.sendClipboardError': 'Gönderim hatası: ',
  'response.rlsPrefix':
    "Aşağıdaki SQL panoya kopyalandı — Supabase SQL Editör'e yapıştırıp Run deyin:\n\n",
  'confirm.purge':
    'Supabase storage bucket içerisindeki tüm görseller (to_pc dahil) KALICI OLARAK silinecektir. Emin misiniz?',
  'label.uiLanguage': 'Arayüz dili',
  'opt.langSystem': 'Sistem',
  'opt.langEn': 'English',
  'opt.langTr': 'Türkçe',
};

const DICTS: Record<Lang, Strings> = { en, tr };

/** Map a 'system' | 'en' | 'tr' setting + the OS locale to a concrete language. */
export function resolveLang(setting: LanguageSetting, systemLocale: string): Lang {
  if (setting === 'en' || setting === 'tr') {
    return setting;
  }
  // 'system': Turkish locales (tr, tr-TR) → Turkish; everything else → English.
  return typeof systemLocale === 'string' && systemLocale.toLowerCase().startsWith('tr')
    ? 'tr'
    : 'en';
}

/** The full string map for a language (a copy, so callers can't mutate the source). */
export function getStrings(lang: Lang): Strings {
  return { ...DICTS[lang] };
}
