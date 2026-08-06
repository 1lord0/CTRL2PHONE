import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  createPhoneDownloadAssetStore,
  validateAndResolveAssetPath,
} from '../src/main/phoneDownloadAsset';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return { ...actual, randomUUID: jest.fn(actual.randomUUID) };
});

describe('phone download asset validation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-test-asset-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('allows valid image names and produces unique paths inside the temp dir', () => {
    const validNames = ['image.png', 'photo.jpg', 'snapshot.JPEG', 'pic.webp', 'anim.gif', 'draw.bmp'];
    for (const name of validNames) {
      const result = validateAndResolveAssetPath(name, tempDir);
      expect(result.ok).toBe(true);
      expect(result.localPath).toBeDefined();
      expect(result.localPath!.startsWith(tempDir)).toBe(true);
      
      // The path should not contain the original name (or at least generate a safe unique name)
      const basename = path.basename(result.localPath!);
      expect(basename).not.toBe(name.toLowerCase());
      
      // Extension should match
      const ext = path.extname(name).toLowerCase();
      expect(path.extname(result.localPath!)).toBe(ext);
    }
  });

  it('rejects empty name', () => {
    const result = validateAndResolveAssetPath('', tempDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects absolute paths', () => {
    const result = validateAndResolveAssetPath('C:\\windows\\system32\\cmd.exe', tempDir);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects names with directory separators', () => {
    const result1 = validateAndResolveAssetPath('subdir/image.png', tempDir);
    expect(result1.ok).toBe(false);
    
    const result2 = validateAndResolveAssetPath('..\\image.png', tempDir);
    expect(result2.ok).toBe(false);
  });

  it('rejects names with directory traversal (..)', () => {
    const result = validateAndResolveAssetPath('../image.png', tempDir);
    expect(result.ok).toBe(false);
  });

  it('rejects names with control characters', () => {
    const nameWithControl = 'image\u0000.png';
    const result = validateAndResolveAssetPath(nameWithControl, tempDir);
    expect(result.ok).toBe(false);
  });

  it('rejects names exceeding length limits', () => {
    const longName = 'a'.repeat(300) + '.png';
    const result = validateAndResolveAssetPath(longName, tempDir);
    expect(result.ok).toBe(false);
  });

  it('rejects unsupported extensions', () => {
    const unsupported = ['file.txt', 'script.sh', 'app.exe', 'index.html', 'style.css'];
    for (const name of unsupported) {
      const result = validateAndResolveAssetPath(name, tempDir);
      expect(result.ok).toBe(false);
    }
  });

  it('verifies path containment using path.relative', () => {
    // A trick where the name has no slashes but when resolved tries to escape
    // Though without slashes this is hard, we want to make sure the helper resolves and verifies containment
    const result = validateAndResolveAssetPath('escaped.png', tempDir);
    expect(result.ok).toBe(true);
    const rel = path.relative(tempDir, result.localPath!);
    expect(rel.startsWith('..')).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
  });

  it('rejects a pre-created directory link before an ordinary write can escape', async () => {
    // Given a predictable download root redirected to a directory outside its parent
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-parent-'));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-target-'));
    const linkedRoot = path.join(parent, 'ctrl2phone');
    await fs.symlink(target, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');

    try {
      // When the current download boundary resolves and writes an image
      const result = validateAndResolveAssetPath('escape.png', linkedRoot);
      if (result.ok && result.localPath) {
        await fs.writeFile(result.localPath, Buffer.from('escaped'));
      }

      // Then the linked target is unchanged and the unsafe root is rejected
      expect(result.ok).toBe(false);
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.unlink(linkedRoot);
      await fs.rm(parent, { recursive: true, force: true });
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it('creates an exclusive asset in an owned randomized root and cleans only that root', async () => {
    // Given a caller-owned temporary parent containing an unrelated sentinel
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-store-parent-'));
    const sentinelPath = path.join(parent, 'caller-owned.txt');
    await fs.writeFile(sentinelPath, 'keep');

    try {
      // When a private store writes and then cleans up an image asset
      const storeResult = await createPhoneDownloadAssetStore(parent);
      if (!storeResult.ok) throw new Error(`Store creation failed: ${storeResult.reason}`);
      const writeResult = await storeResult.store.write('camera.PNG', Buffer.from('image-bytes'));
      if (!writeResult.ok) throw new Error(`Asset write failed: ${writeResult.reason}`);

      expect(path.dirname(writeResult.localPath)).toBe(storeResult.store.rootPath);
      expect(path.basename(storeResult.store.rootPath)).toMatch(/^ctrl2phone-/);
      expect(path.basename(writeResult.localPath)).toMatch(/^phone_[0-9a-f-]+\.png$/);
      expect(await fs.readFile(writeResult.localPath, 'utf8')).toBe('image-bytes');

      const cleanupResult = await storeResult.store.cleanup();
      expect(cleanupResult).toEqual({ ok: true });
      await expect(fs.lstat(storeResult.store.rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(sentinelPath, 'utf8')).resolves.toBe('keep');
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  it('uses exclusive create so a generated-name collision cannot overwrite bytes', async () => {
    // Given an owned store whose secure name generator repeats the same UUID
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-exclusive-'));
    const uuid = '00000000-0000-4000-8000-000000000000';
    const uuidMock = jest.mocked(randomUUID);
    uuidMock.mockReturnValue(uuid);

    try {
      const storeResult = await createPhoneDownloadAssetStore(parent);
      if (!storeResult.ok) throw new Error(`Store creation failed: ${storeResult.reason}`);

      // When two assets resolve to the same generated local name
      const first = await storeResult.store.write('first.png', Buffer.from('first'));
      const second = await storeResult.store.write('second.png', Buffer.from('second'));

      // Then the second create is rejected and the first bytes remain intact
      expect(first.ok).toBe(true);
      expect(second).toEqual({ ok: false, reason: 'asset_exists' });
      if (first.ok) await expect(fs.readFile(first.localPath, 'utf8')).resolves.toBe('first');
      await storeResult.store.cleanup();
    } finally {
      uuidMock.mockImplementation(jest.requireActual<typeof import('crypto')>('crypto').randomUUID);
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  it('rejects a linked temp parent before creating an owned root', async () => {
    // Given an externally redirected temporary parent
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-link-parent-'));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-link-target-'));
    const linkedParent = path.join(parent, 'temp-link');
    await fs.symlink(target, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');

    try {
      // When store creation validates the filesystem boundary
      const result = await createPhoneDownloadAssetStore(linkedParent);

      // Then it rejects the reparse root without changing the target
      expect(result).toEqual({ ok: false, reason: 'unsafe_temp_parent' });
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.unlink(linkedParent);
      await fs.rm(parent, { recursive: true, force: true });
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it('ignores an old predictable junction and keeps the asset final path in its private root', async () => {
    // Given the legacy predictable root redirected outside the temporary parent
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-manual-parent-'));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-manual-target-'));
    const legacyRoot = path.join(parent, 'ctrl2phone');
    await fs.symlink(target, legacyRoot, process.platform === 'win32' ? 'junction' : 'dir');

    try {
      // When the secure boundary creates and writes an asset through real fs
      const storeResult = await createPhoneDownloadAssetStore(parent);
      if (!storeResult.ok) throw new Error(`Store creation failed: ${storeResult.reason}`);
      const writeResult = await storeResult.store.write('phone.jpg', Buffer.from('photo'));
      if (!writeResult.ok) throw new Error(`Asset write failed: ${writeResult.reason}`);
      const rootRealPath = await fs.realpath(storeResult.store.rootPath);
      const assetRealPath = await fs.realpath(writeResult.localPath);
      const relative = path.relative(rootRealPath, assetRealPath);

      // Then the external target is unchanged and final realpath remains contained
      expect(await fs.readdir(target)).toEqual([]);
      expect(relative.startsWith('..')).toBe(false);
      expect(path.isAbsolute(relative)).toBe(false);
      expect(storeResult.store.rootPath).not.toBe(legacyRoot);
      await storeResult.store.cleanup();
    } finally {
      await fs.unlink(legacyRoot);
      await fs.rm(parent, { recursive: true, force: true });
      await fs.rm(target, { recursive: true, force: true });
    }
  });
});
