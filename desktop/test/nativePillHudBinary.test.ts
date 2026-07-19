import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const runOnWindows = process.platform === 'win32' ? describe : describe.skip;

runOnWindows('native pill HUD binary protocol', () => {
  let tempDir = '';
  let binaryPath = '';

  beforeAll(() => {
    // Create unique temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl2phone-test-'));
    binaryPath = path.join(tempDir, 'pill_hud.exe');
    
    // Path to the source file
    const sourcePath = path.join(__dirname, '..', 'src', 'pill_hud.cs');
    expect(fs.existsSync(sourcePath)).toBe(true);
    
    // Compile using csc.exe
    const cscPath = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    if (!fs.existsSync(cscPath)) {
      throw new Error(`csc.exe not found at ${cscPath}`);
    }
    
    const compileCmd = `"${cscPath}" /nologo /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /target:winexe /out:"${binaryPath}" "${sourcePath}"`;
    execSync(compileCmd, { stdio: 'ignore' });
    expect(fs.existsSync(binaryPath)).toBe(true);
  });

  afterAll(() => {
    // Clean up temporary files
    try {
      if (fs.existsSync(binaryPath)) {
        fs.unlinkSync(binaryPath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch (e) {
      console.warn('Failed to clean up temp files:', e);
    }
  });

  it('emits PILL_READY through redirected stdout', async () => {
    const child = spawn(binaryPath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    try {
      const readyLine = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`PILL_READY timeout; stderr=${stderr}`));
        }, 10000);

        child.once('error', reject);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          const line = chunk
            .split(/\r?\n/)
            .map(value => value.trim())
            .find(Boolean);
          if (!line) return;
          clearTimeout(timer);
          resolve(line);
        });
      });

      expect(readyLine).toBe('PILL_READY');
    } finally {
      child.stdin.write('QUIT\n');
      child.stdin.end();
      await new Promise<void>(resolve => {
        const forceStop = setTimeout(() => {
          child.kill();
          resolve();
        }, 2000);
        child.once('exit', () => {
          clearTimeout(forceStop);
          resolve();
        });
      });
    }
  }, 15000);
});
