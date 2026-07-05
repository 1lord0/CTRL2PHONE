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
exports.extractTextFromImage = extractTextFromImage;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const aiProviders_1 = require("./aiProviders");
const OCR_PROMPT = 'Bu görseldeki TÜM metni olduğu gibi çıkar. Satır düzenini koru. Yorum veya açıklama ekleme; sadece ham metin döndür.';
function loadEmbeddedOcrScript() {
    const bundled = path.join(__dirname, '..', 'ocr.ps1');
    if (fs.existsSync(bundled)) {
        return fs.readFileSync(bundled, 'utf8');
    }
    return fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ocr.ps1'), 'utf8');
}
function helperCandidates(name) {
    const resourcesPath = process.resourcesPath;
    const candidates = [
        resourcesPath ? path.join(resourcesPath, 'src', name) : '',
        resourcesPath ? path.join(resourcesPath, name) : '',
        path.join(__dirname, '..', name),
        path.join(__dirname, '..', '..', 'src', name),
    ];
    try {
        if (electron_1.app?.getAppPath) {
            candidates.push(path.join(electron_1.app.getAppPath(), 'src', name));
        }
    }
    catch {
        // app may not be ready in unit tests
    }
    return [...new Set(candidates.filter(Boolean))];
}
function getOcrHelperPath() {
    for (const p of helperCandidates('ocr_helper.exe')) {
        if (fs.existsSync(p))
            return p;
    }
    return null;
}
let cachedScriptPath = null;
function resolveOcrScriptPath() {
    if (cachedScriptPath && fs.existsSync(cachedScriptPath)) {
        return cachedScriptPath;
    }
    for (const p of helperCandidates('ocr.ps1')) {
        if (fs.existsSync(p)) {
            cachedScriptPath = p;
            return p;
        }
    }
    const tempScript = path.join(os.tmpdir(), 'ctrl2phone-ocr.ps1');
    fs.writeFileSync(tempScript, loadEmbeddedOcrScript(), 'utf8');
    cachedScriptPath = tempScript;
    return tempScript;
}
function runProcess(command, args, label) {
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(command, args, { windowsHide: true });
        let stderr = '';
        proc.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `${label} çıkış kodu ${code}`));
                return;
            }
            resolve();
        });
    });
}
async function runWindowsOcr(pngBuffer) {
    const stamp = Date.now();
    const tempPath = path.join(os.tmpdir(), `ctrl2phone-ocr-${stamp}.png`);
    const outputPath = path.join(os.tmpdir(), `ctrl2phone-ocr-out-${stamp}.txt`);
    fs.writeFileSync(tempPath, pngBuffer);
    try {
        const helperPath = getOcrHelperPath();
        if (helperPath) {
            await runProcess(helperPath, [tempPath, outputPath], 'ocr_helper');
        }
        else {
            const scriptPath = resolveOcrScriptPath();
            await runProcess('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                scriptPath,
                '-ImagePath',
                tempPath,
                '-OutputPath',
                outputPath,
            ], 'ocr.ps1');
        }
        if (!fs.existsSync(outputPath)) {
            return '';
        }
        return fs.readFileSync(outputPath, 'utf8').trim();
    }
    finally {
        for (const p of [tempPath, outputPath]) {
            try {
                fs.unlinkSync(p);
            }
            catch {
                // ignore cleanup failure
            }
        }
    }
}
function isAiOcrAvailable(cfg) {
    if (!cfg)
        return false;
    if (cfg.provider === 'custom') {
        return Boolean(cfg.baseUrl?.trim());
    }
    return Boolean(cfg.apiKey?.trim());
}
/** Extract text from a cropped screenshot. Tries Windows OCR first, then optional AI fallback. */
async function extractTextFromImage(pngBuffer, options = {}) {
    try {
        const windowsText = await runWindowsOcr(pngBuffer);
        if (windowsText) {
            return { text: windowsText, source: 'windows' };
        }
    }
    catch (err) {
        console.warn('Windows OCR failed, trying AI fallback:', err);
    }
    if (isAiOcrAvailable(options.aiConfig)) {
        const pngBase64 = pngBuffer.toString('base64');
        const text = await (0, aiProviders_1.analyzeImage)(options.aiConfig, pngBase64, OCR_PROMPT);
        if (text.trim()) {
            return { text: text.trim(), source: 'ai' };
        }
    }
    throw new Error('Metin bulunamadı. Windows dil paketini kontrol edin veya Ayarlar’dan bir AI sağlayıcısı tanımlayın.');
}
