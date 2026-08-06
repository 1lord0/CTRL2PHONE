import * as fs from 'fs';
import * as path from 'path';

const mainSourcePath = path.join(__dirname, '..', 'src', 'main.ts');

function occurrenceCount(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

describe('main process source contract', () => {
  it('does not contain direct ipcMain.handle or ipcMain.on registrations', () => {
    const source = fs.readFileSync(mainSourcePath, 'utf8');
    
    // All ipcMain handler/listener registers should be delegated to registrar functions
    const handleCount = occurrenceCount(source, /ipcMain\.handle\(/g);
    const onCount = occurrenceCount(source, /ipcMain\.on\(/g);
    
    expect(handleCount).toBe(0);
    expect(onCount).toBe(0);
  });

  it('contains composition root modules and appLifecycle start call', () => {
    const source = fs.readFileSync(mainSourcePath, 'utf8');
    
    expect(source).toContain('createElectronLifecycleComposition');
    expect(source).toContain('registerSettingsIpc');
    expect(source).toContain('appLifecycle.start()');
  });
});
