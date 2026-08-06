import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { PassThrough } from 'stream';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { getPackagedOcrScriptPath, runOcrProcess, stopOcrProcesses } from '../src/lib/ocr';

class MockOcrProcess extends EventEmitter {
  stderr = new PassThrough();
  kill = jest.fn(() => true);
}

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('OCR process contract', () => {
  afterEach(() => {
    stopOcrProcesses();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('resolves the exact packaged PowerShell resource path', () => {
    const resourcesPath = path.join('C:', 'Program Files', 'Ctrl2Phone', 'resources');

    expect(getPackagedOcrScriptPath(resourcesPath)).toBe(
      path.join(resourcesPath, 'src', 'ocr.ps1')
    );
  });

  it('kills on timeout and waits for process close before cleanup', async () => {
    jest.useFakeTimers();
    const process = new MockOcrProcess();
    mockSpawn.mockReturnValue(process as unknown as ChildProcess);

    const operation = runOcrProcess('powershell.exe', [], 'ocr.ps1', 1_000);
    const rejection = expect(operation).rejects.toThrow('ocr.ps1 1 saniye içinde tamamlanmadı');

    jest.advanceTimersByTime(1_000);
    expect(process.kill).toHaveBeenCalledTimes(1);

    process.emit('close', null);
    await rejection;

    stopOcrProcesses();
    expect(process.kill).toHaveBeenCalledTimes(1);
  });
});
