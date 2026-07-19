import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AppSettings } from '../types';

export interface SettingsPersistence {
  readonly resolvePath: () => string;
  readonly exists: (filePath: string) => boolean;
  readonly readText: (filePath: string) => string;
  readonly writeText: (filePath: string, content: string) => void;
}

export interface SettingsEncryption {
  readonly isAvailable: () => boolean;
  readonly encrypt: (value: string) => string;
  readonly decrypt: (value: string) => string;
}

export interface SettingsLogger {
  readonly info: (message: string, detail?: string) => void;
  readonly warn: (message: string, error: Error) => void;
  readonly error: (message: string, error: Error) => void;
}

export interface SettingsStorePorts {
  readonly persistence: SettingsPersistence;
  readonly encryption: SettingsEncryption;
  readonly logger: SettingsLogger;
}

export interface SettingsUpdateResult {
  readonly supabaseChanged: boolean;
  readonly pillVisibilityChanged: boolean;
}

export interface SettingsStore {
  readonly settings: AppSettings;
  readonly load: () => void;
  readonly save: () => void;
  readonly update: (next: Partial<AppSettings>) => SettingsUpdateResult;
}

export function createDefaultSettings(): AppSettings {
  return {
    prompt: 'Bu ekran görüntüsünü analiz et ve kısa bir özet ver.',
    supabaseUrl: '',
    supabaseKey: '',
    supabaseBucket: 'screenshots',
    autoCopyFromPhone: true,
    hotkeyVk: 0xa2,
    doublePressMs: 400,
    aiProvider: 'web',
    aiApiKey: '',
    aiModel: '',
    aiBaseUrl: '',
    language: 'system',
    panelPinned: false,
    pillVisibility: 'background',
  };
}

export function createSettingsStore(
  settings: AppSettings,
  ports: SettingsStorePorts
): SettingsStore {
  const load = (): void => {
    try {
      const settingsPath = ports.persistence.resolvePath();
      if (!ports.persistence.exists(settingsPath)) {
        ports.logger.info('Ayarlar dosyası bulunamadı, varsayılanlar kullanılacak.');
        return;
      }

      const parsed: unknown = JSON.parse(ports.persistence.readText(settingsPath));
      if (!isRecord(parsed)) {
        throw new Error('Ayarlar dosyasının kök değeri bir nesne olmalıdır.');
      }
      applyPersistedSettings(settings, parsed);
      decryptSecret(settings, 'supabaseKey', 'Supabase', ports);
      decryptSecret(settings, 'aiApiKey', 'AI', ports);
      ports.logger.info('Ayarlar dosyadan yüklendi:', settingsPath);
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.logger.error('Ayarlar yüklenirken hata oluştu:', error);
    }
  };

  const save = (): void => {
    try {
      const persisted: AppSettings = { ...settings };
      if (ports.encryption.isAvailable()) {
        if (settings.supabaseKey) {
          persisted.supabaseKey = ports.encryption.encrypt(settings.supabaseKey);
        }
        if (settings.aiApiKey) {
          persisted.aiApiKey = ports.encryption.encrypt(settings.aiApiKey);
        }
      }
      const settingsPath = ports.persistence.resolvePath();
      ports.persistence.writeText(settingsPath, JSON.stringify(persisted, null, 2));
      ports.logger.info('Ayarlar dosyaya kaydedildi:', settingsPath);
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.logger.error('Ayarlar kaydedilirken hata oluştu:', error);
    }
  };

  const update = (next: Partial<AppSettings>): SettingsUpdateResult => {
    const previousSupabase = supabaseSignature(settings);
    const previousPillVisibility = settings.pillVisibility;
    applyRendererSettings(settings, next);
    return {
      supabaseChanged: previousSupabase !== supabaseSignature(settings),
      pillVisibilityChanged: previousPillVisibility !== settings.pillVisibility,
    };
  };

  return { settings, load, save, update };
}

export function createElectronSettingsStore(settings: AppSettings): SettingsStore {
  return createSettingsStore(settings, {
    persistence: {
      resolvePath: () => path.join(app.getPath('userData'), 'settings.json'),
      exists: (filePath) => fs.existsSync(filePath),
      readText: (filePath) => fs.readFileSync(filePath, 'utf8'),
      writeText: (filePath, content) => fs.writeFileSync(filePath, content, 'utf8'),
    },
    encryption: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
    },
    logger: {
      info: (message, detail) => console.log(message, detail ?? ''),
      warn: (message, error) => console.warn(message, error),
      error: (message, error) => console.error(message, error),
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAiProvider(value: unknown): value is AppSettings['aiProvider'] {
  return (
    value === 'web' ||
    value === 'gemini' ||
    value === 'claude' ||
    value === 'openai' ||
    value === 'custom'
  );
}

function isLanguage(value: unknown): value is AppSettings['language'] {
  return value === 'system' || value === 'en' || value === 'tr';
}

function isPillVisibility(value: unknown): value is NonNullable<AppSettings['pillVisibility']> {
  return value === 'always' || value === 'background' || value === 'capture-only';
}

function assignString(
  target: AppSettings,
  key: keyof Pick<
    AppSettings,
    | 'prompt'
    | 'supabaseUrl'
    | 'supabaseKey'
    | 'supabaseBucket'
    | 'aiApiKey'
    | 'aiModel'
    | 'aiBaseUrl'
  >,
  value: unknown
): void {
  if (typeof value === 'string') target[key] = value;
}

function applySharedSettings(target: AppSettings, source: Record<string, unknown>): void {
  assignString(target, 'prompt', source.prompt);
  assignString(target, 'supabaseUrl', source.supabaseUrl);
  assignString(target, 'supabaseKey', source.supabaseKey);
  assignString(target, 'supabaseBucket', source.supabaseBucket);
  assignString(target, 'aiApiKey', source.aiApiKey);
  assignString(target, 'aiModel', source.aiModel);
  assignString(target, 'aiBaseUrl', source.aiBaseUrl);
  if (typeof source.autoCopyFromPhone === 'boolean') {
    target.autoCopyFromPhone = source.autoCopyFromPhone;
  }
  if (typeof source.hotkeyVk === 'number' && Number.isFinite(source.hotkeyVk)) {
    target.hotkeyVk = source.hotkeyVk;
  }
  if (typeof source.doublePressMs === 'number' && Number.isFinite(source.doublePressMs)) {
    target.doublePressMs = source.doublePressMs;
  }
  if (isAiProvider(source.aiProvider)) target.aiProvider = source.aiProvider;
  if (isLanguage(source.language)) target.language = source.language;
  if (isPillVisibility(source.pillVisibility)) target.pillVisibility = source.pillVisibility;
}

function applyPersistedSettings(target: AppSettings, source: Record<string, unknown>): void {
  applySharedSettings(target, source);
  if (typeof source.panelX === 'number' && Number.isFinite(source.panelX)) {
    target.panelX = source.panelX;
  }
  if (typeof source.panelY === 'number' && Number.isFinite(source.panelY)) {
    target.panelY = source.panelY;
  }
  if (typeof source.panelPinned === 'boolean') target.panelPinned = source.panelPinned;
}

function applyRendererSettings(target: AppSettings, source: Partial<AppSettings>): void {
  applySharedSettings(target, source);
}

function decryptSecret(
  settings: AppSettings,
  key: 'supabaseKey' | 'aiApiKey',
  label: string,
  ports: SettingsStorePorts
): void {
  if (!settings[key] || !ports.encryption.isAvailable()) return;
  try {
    settings[key] = ports.encryption.decrypt(settings[key]);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    ports.logger.warn(
      `${label} key decryption failed, treating as plain text (backward compat):`,
      error
    );
  }
}

function supabaseSignature(settings: AppSettings): string {
  return JSON.stringify([
    settings.supabaseUrl,
    settings.supabaseKey,
    settings.supabaseBucket,
    settings.autoCopyFromPhone,
  ]);
}
