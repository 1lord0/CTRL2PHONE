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

export interface OcrOptions {
  /** When set, used as fallback if Windows OCR fails or returns empty text. */
  aiConfig?: AiConfig | null;
}

export function getPackagedOcrScriptPath(resourcesPath: string): string {
  return path.join(resourcesPath, 'src', 'ocr.ps1');
}

let cachedScriptPath: string | null = null;

function resolveOcrScriptPath(): string {
  if (cachedScriptPath && fs.existsSync(cachedScriptPath)) {
    return cachedScriptPath;
  }

  const candidates = [
    getPackagedOcrScriptPath(process.resourcesPath),
    path.join(__dirname, '..', 'ocr.ps1'),
    path.join(__dirname, '..', '..', 'src', 'ocr.ps1'),
    path.join(__dirname, '..', '..', '..', 'src', 'ocr.ps1'),
  ];
  for (const p of [...new Set(candidates)]) {
    if (fs.existsSync(p)) {
      cachedScriptPath = p;
      return p;
    }
  }

  throw new Error(`Paketlenmiş OCR betiği bulunamadı: ${candidates[0]}`);
}

export function runOcrProcess(
  command: string,
  args: string[],
  label: string,
  timeoutMs = OCR_PROCESS_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    activeOcrProcesses.add(proc);
    let stderr = '';
    let settled = false;
    let timeoutError: Error | null = null;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      activeOcrProcesses.delete(proc);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      timeoutError = new Error(`${label} ${timeoutMs / 1000} saniye içinde tamamlanmadı`);
      try {
        proc.kill();
      } catch (error) {
        finish(error instanceof Error ? error : timeoutError);
      }
      // Wait for `close` before rejecting. The caller owns temporary files and
      // must not remove them while PowerShell may still be using them.
    }, timeoutMs);

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (error) => finish(error));
    proc.on('close', (code) => {
      if (timeoutError) {
        finish(timeoutError);
        return;
      }
      if (code !== 0) {
        finish(new Error(stderr.trim() || `${label} çıkış kodu ${code}`));
        return;
      }
      finish();
    });
  });
}

async function runWindowsOcr(pngBuffer: Buffer): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl2phone-ocr-'));
  const tempPath = path.join(tempDir, 'input.png');
  const outputPath = path.join(tempDir, 'output.txt');
  fs.writeFileSync(tempPath, pngBuffer);

  try {
    const scriptPath = resolveOcrScriptPath();
    await runOcrProcess(
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

    if (!fs.existsSync(outputPath)) {
      return '';
    }
    return fs.readFileSync(outputPath, 'utf8').trim();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
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
