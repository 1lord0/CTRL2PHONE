"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultSettings = createDefaultSettings;
exports.createSettingsStore = createSettingsStore;
exports.createElectronSettingsStore = createElectronSettingsStore;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function createDefaultSettings() {
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
function createSettingsStore(settings, ports) {
    const load = () => {
        try {
            const settingsPath = ports.persistence.resolvePath();
            if (!ports.persistence.exists(settingsPath)) {
                ports.logger.info('Ayarlar dosyası bulunamadı, varsayılanlar kullanılacak.');
                return;
            }
            const parsed = JSON.parse(ports.persistence.readText(settingsPath));
            if (!isRecord(parsed)) {
                throw new Error('Ayarlar dosyasının kök değeri bir nesne olmalıdır.');
            }
            applyPersistedSettings(settings, parsed);
            decryptSecret(settings, 'supabaseKey', 'Supabase', ports);
            decryptSecret(settings, 'aiApiKey', 'AI', ports);
            ports.logger.info('Ayarlar dosyadan yüklendi:', settingsPath);
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            ports.logger.error('Ayarlar yüklenirken hata oluştu:', error);
        }
    };
    const save = () => {
        try {
            const persisted = { ...settings };
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
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            ports.logger.error('Ayarlar kaydedilirken hata oluştu:', error);
        }
    };
    const update = (next) => {
        const previousSupabase = supabaseSignature(settings);
        const previousPillVisibility = settings.pillVisibility;
        applyRendererSettings(settings, next);
        return {
            supabaseChanged: previousSupabase !== supabaseSignature(settings),
            pillVisibilityChanged: previousPillVisibility !== settings.pillVisibility,
        };
    };
    const migrateLegacyPillVisibility = () => {
        if (settings.pillVisibility !== 'always')
            return false;
        settings.pillVisibility = 'background';
        save();
        return true;
    };
    return { settings, load, save, update, migrateLegacyPillVisibility };
}
function createElectronSettingsStore(settings) {
    return createSettingsStore(settings, {
        persistence: {
            resolvePath: () => path.join(electron_1.app.getPath('userData'), 'settings.json'),
            exists: filePath => fs.existsSync(filePath),
            readText: filePath => fs.readFileSync(filePath, 'utf8'),
            writeText: (filePath, content) => fs.writeFileSync(filePath, content, 'utf8'),
        },
        encryption: {
            isAvailable: () => electron_1.safeStorage.isEncryptionAvailable(),
            encrypt: value => electron_1.safeStorage.encryptString(value).toString('base64'),
            decrypt: value => electron_1.safeStorage.decryptString(Buffer.from(value, 'base64')),
        },
        logger: {
            info: (message, detail) => console.log(message, detail ?? ''),
            warn: (message, error) => console.warn(message, error),
            error: (message, error) => console.error(message, error),
        },
    });
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isAiProvider(value) {
    return (value === 'web' ||
        value === 'gemini' ||
        value === 'claude' ||
        value === 'openai' ||
        value === 'custom');
}
function isLanguage(value) {
    return value === 'system' || value === 'en' || value === 'tr';
}
function isPillVisibility(value) {
    return value === 'always' || value === 'background' || value === 'capture-only';
}
function assignString(target, key, value) {
    if (typeof value === 'string')
        target[key] = value;
}
function applySharedSettings(target, source) {
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
    if (isAiProvider(source.aiProvider))
        target.aiProvider = source.aiProvider;
    if (isLanguage(source.language))
        target.language = source.language;
    if (isPillVisibility(source.pillVisibility))
        target.pillVisibility = source.pillVisibility;
}
function applyPersistedSettings(target, source) {
    applySharedSettings(target, source);
    if (typeof source.panelX === 'number' && Number.isFinite(source.panelX)) {
        target.panelX = source.panelX;
    }
    if (typeof source.panelY === 'number' && Number.isFinite(source.panelY)) {
        target.panelY = source.panelY;
    }
    if (typeof source.panelPinned === 'boolean')
        target.panelPinned = source.panelPinned;
}
function applyRendererSettings(target, source) {
    applySharedSettings(target, source);
}
function decryptSecret(settings, key, label, ports) {
    if (!settings[key] || !ports.encryption.isAvailable())
        return;
    try {
        settings[key] = ports.encryption.decrypt(settings[key]);
    }
    catch (error) {
        if (!(error instanceof Error))
            throw error;
        ports.logger.warn(`${label} key decryption failed, treating as plain text (backward compat):`, error);
    }
}
function supabaseSignature(settings) {
    return JSON.stringify([
        settings.supabaseUrl,
        settings.supabaseKey,
        settings.supabaseBucket,
        settings.autoCopyFromPhone,
    ]);
}
