import * as fs from 'fs';
import * as path from 'path';
import { IPC_HANDLE_CHANNELS, IPC_ON_CHANNELS } from '../src/main/ipcChannels';

const mainSourcePath = path.join(__dirname, '..', 'src', 'main.ts');

function registeredChannels(source: string, method: 'handle' | 'on'): readonly string[] {
  const pattern = new RegExp(`ipcMain\\.${method}\\('([^']+)'`, 'g');
  return Array.from(source.matchAll(pattern), match => match[1]);
}

function occurrenceCount(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

describe('main process source contract', () => {
  it('keeps the public IPC channel manifest unchanged during extraction', () => {
    // Given the current Electron main-process source
    const source = fs.readFileSync(mainSourcePath, 'utf8');

    // When its invoke and send registrations are collected
    const handles = registeredChannels(source, 'handle');
    const listeners = registeredChannels(source, 'on');

    // Then every existing channel remains registered exactly once
    expect(handles).toEqual(IPC_HANDLE_CHANNELS);
    expect(listeners).toEqual(IPC_ON_CHANNELS);
  });

  it('keeps lifecycle and diagnostic registration multiplicity unchanged', () => {
    // Given the current Electron main-process source
    const source = fs.readFileSync(mainSourcePath, 'utf8');

    // When lifecycle and diagnostic registrations are counted
    const updaterCheckingCount = occurrenceCount(source, /autoUpdater\.on\('checking-for-update'/g);
    const rejectionCount = occurrenceCount(source, /process\.on\('unhandledRejection'/g);

    // Then the refactor preserves today's observable registration contract
    expect(updaterCheckingCount).toBe(2);
    expect(rejectionCount).toBe(2);
    expect(source).toContain("app.on('second-instance'");
    expect(source).toContain("app.on('before-quit'");
    expect(source).toContain("app.on('will-quit'");
    expect(source).toContain("app.on('window-all-closed'");
  });
});
