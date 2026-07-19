import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

export interface PathResolutionResult {
  readonly ok: boolean;
  readonly localPath?: string;
  readonly error?: string;
}

/**
 * Validates that a path is not a Windows junction/reparse point
 * which could be used to bypass directory containment checks
 */
function isSafeDirectory(dirPath: string): boolean {
  try {
    const stats = fs.lstatSync(dirPath);
    // Check if it's a symbolic link or reparse point (junction on Windows)
    if (stats.isSymbolicLink()) {
      return false;
    }
    // On Windows, check for reparse point flag
    if (
      process.platform === 'win32' &&
      (stats as any).isReparsePoint &&
      (stats as any).isReparsePoint()
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function validateAndResolveAssetPath(
  remoteName: string,
  tempDir?: string
): PathResolutionResult {
  if (!remoteName || remoteName.trim() === '') {
    return { ok: false, error: 'Remote name is empty' };
  }

  // Reject directory separators
  if (remoteName.includes('/') || remoteName.includes('\\')) {
    return { ok: false, error: 'Remote name contains directory separators' };
  }

  // Reject directory traversal
  if (remoteName.includes('..')) {
    return { ok: false, error: 'Remote name contains directory traversal (..)' };
  }

  // Reject absolute paths (like C: or similar, although without separators it's hard, but check Windows drive letters just in case)
  if (/^[a-zA-Z]:/.test(remoteName)) {
    return { ok: false, error: 'Remote name looks like an absolute path' };
  }

  // Reject control characters
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(remoteName)) {
    return { ok: false, error: 'Remote name contains control characters' };
  }

  // Reject extremely long names
  if (remoteName.length > 255) {
    return { ok: false, error: 'Remote name exceeds length limit' };
  }

  // Extract and validate extension
  const ext = path.extname(remoteName).toLowerCase();
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
  if (!allowedExtensions.includes(ext)) {
    return { ok: false, error: `Unsupported extension: ${ext}` };
  }

  // Use system temp directory if no tempDir provided, or validate the provided tempDir
  const resolvedTempDir = tempDir ? path.resolve(tempDir) : path.resolve(tmpdir());

  // Verify the temp directory itself is safe (not a junction/reparse point)
  if (!isSafeDirectory(resolvedTempDir)) {
    return { ok: false, error: 'Temp directory is not safe (junction or reparse point detected)' };
  }

  // Generate a safe, unique local filename using random UUID to avoid conflicts and keep it secure
  const safeLocalName = `phone_${randomUUID()}${ext}`;
  const targetPath = path.resolve(resolvedTempDir, safeLocalName);

  // Path containment check using path.relative
  const relative = path.relative(resolvedTempDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, error: 'Path containment check failed' };
  }

  // Additional real filesystem check: verify the parent directory of target is the temp directory
  const parentDir = path.dirname(targetPath);
  const resolvedParent = path.resolve(parentDir);
  if (resolvedParent !== resolvedTempDir) {
    return { ok: false, error: 'Parent directory mismatch' };
  }

  return { ok: true, localPath: targetPath };
}

export interface PhoneDownloadAssetStore {
  rootPath: string;
  write(
    remoteName: string,
    buffer: Buffer
  ): Promise<{ ok: true; localPath: string } | { ok: false; reason: string }>;
  cleanup(): Promise<{ ok: true; error?: string }>;
}

export interface StoreCreationResult {
  ok: boolean;
  reason?: string;
  store?: PhoneDownloadAssetStore;
}

export async function createPhoneDownloadAssetStore(
  parentDir: string
): Promise<StoreCreationResult> {
  if (!isSafeDirectory(parentDir)) {
    return { ok: false, reason: 'unsafe_temp_parent' };
  }

  try {
    const uniqueSubdirName = `ctrl2phone-${randomUUID()}`;
    const rootPath = path.join(parentDir, uniqueSubdirName);
    await fs.promises.mkdir(rootPath, { recursive: true });

    const store: PhoneDownloadAssetStore = {
      rootPath,
      async write(remoteName: string, buffer: Buffer) {
        const resolveResult = validateAndResolveAssetPath(remoteName, rootPath);
        if (!resolveResult.ok || !resolveResult.localPath) {
          return { ok: false, reason: resolveResult.error || 'invalid_name' };
        }

        const localPath = resolveResult.localPath;

        try {
          await fs.promises.writeFile(localPath, buffer, { flag: 'wx' });
          return { ok: true, localPath };
        } catch (err: any) {
          if (err.code === 'EEXIST') {
            return { ok: false, reason: 'asset_exists' };
          }
          return { ok: false, reason: err.message };
        }
      },
      async cleanup() {
        try {
          await fs.promises.rm(rootPath, { recursive: true, force: true });
          return { ok: true };
        } catch (err: any) {
          return { ok: true, error: err.message };
        }
      },
    };

    return { ok: true, store };
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
}
