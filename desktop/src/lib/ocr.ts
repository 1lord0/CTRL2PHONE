import { app } from 'electron';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeImage, AiConfig } from './aiProviders';

const OCR_PROMPT =
  'Bu görseldeki TÜM metni olduğu gibi çıkar. Satır düzenini koru. Yorum veya açıklama ekleme; sadece ham metin döndür.';
const OCR_PROCESS_TIMEOUT_MS = 45_000;
const activeOcrProcesses = new Set<ChildProcess>();

export function stopOcrProcesses(): void {
  for (const process of activeOcrProcesses) {
    try {
      process.kill();
    } catch {
      // Process may already have exited.
    }
  }
  activeOcrProcesses.clear();
}

function loadEmbeddedOcrScript(): string {
  const bundled = path.join(__dirname, '..', 'ocr.ps1');
  if (fs.existsSync(bundled)) {
    return fs.readFileSync(bundled, 'utf8');
  }
  return fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ocr.ps1'), 'utf8');
}

export interface OcrOptions {
  /** When set, used as fallback if Windows OCR fails or returns empty text. */
  aiConfig?: AiConfig | null;
}

function helperCandidates(name: string): string[] {
  const resourcesPath = process.resourcesPath;
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'src', name) : '',
    resourcesPath ? path.join(resourcesPath, name) : '',
    path.join(__dirname, '..', name),
    path.join(__dirname, '..', '..', 'src', name),
  ];
  try {
    if (app?.getAppPath) {
      candidates.push(path.join(app.getAppPath(), 'src', name));
    }
  } catch {
    // app may not be ready in unit tests
  }
  return [...new Set(candidates.filter(Boolean))];
}

function getOcrHelperPath(): string | null {
  for (const p of helperCandidates('ocr_helper.exe')) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let cachedScriptPath: string | null = null;

function resolveOcrScriptPath(): string {
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

function runProcess(command: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    activeOcrProcesses.add(proc);
    let stderr = '';
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      activeOcrProcesses.delete(proc);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Ignore a concurrent natural exit.
      }
      finish(new Error(`${label} ${OCR_PROCESS_TIMEOUT_MS / 1000} saniye içinde tamamlanmadı`));
    }, OCR_PROCESS_TIMEOUT_MS);

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (error) => finish(error));
    proc.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(stderr.trim() || `${label} çıkış kodu ${code}`));
        return;
      }
      finish();
    });
  });
}

async function runWindowsOcr(pngBuffer: Buffer): Promise<string> {
  const stamp = Date.now();
  const tempPath = path.join(os.tmpdir(), `ctrl2phone-ocr-${stamp}.png`);
  const outputPath = path.join(os.tmpdir(), `ctrl2phone-ocr-out-${stamp}.txt`);
  fs.writeFileSync(tempPath, pngBuffer);

  try {
    const helperPath = getOcrHelperPath();
    if (helperPath) {
      await runProcess(helperPath, [tempPath, outputPath], 'ocr_helper');
    } else {
      const scriptPath = resolveOcrScriptPath();
      await runProcess(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-ImagePath',
          tempPath,
          '-OutputPath',
          outputPath,
        ],
        'ocr.ps1'
      );
    }

    if (!fs.existsSync(outputPath)) {
      return '';
    }
    return fs.readFileSync(outputPath, 'utf8').trim();
  } finally {
    for (const p of [tempPath, outputPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

function isAiOcrAvailable(cfg?: AiConfig | null): cfg is AiConfig {
  if (!cfg) return false;
  if (cfg.provider === 'custom') {
    return Boolean(cfg.baseUrl?.trim());
  }
  return Boolean(cfg.apiKey?.trim());
}

/** Extract text from a cropped screenshot. Tries Windows OCR first, then optional AI fallback. */
export async function extractTextFromImage(
  pngBuffer: Buffer,
  options: OcrOptions = {}
): Promise<{ text: string; source: 'windows' | 'ai' }> {
  try {
    const windowsText = await runWindowsOcr(pngBuffer);
    if (windowsText) {
      return { text: windowsText, source: 'windows' };
    }
  } catch (err) {
    console.warn('Windows OCR failed, trying AI fallback:', err);
  }

  if (isAiOcrAvailable(options.aiConfig)) {
    const pngBase64 = pngBuffer.toString('base64');
    const text = await analyzeImage(options.aiConfig, pngBase64, OCR_PROMPT);
    if (text.trim()) {
      return { text: text.trim(), source: 'ai' };
    }
  }

  throw new Error(
    'Metin bulunamadı. Windows dil paketini kontrol edin veya Ayarlar’dan bir AI sağlayıcısı tanımlayın.'
  );
}
