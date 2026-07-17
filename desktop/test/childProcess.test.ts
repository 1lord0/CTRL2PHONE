import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { bindLineReader, safeWriteStdin } from '../src/lib/childProcess';

describe('child process stream guards', () => {
  test('reassembles protocol lines split across stdout chunks', async () => {
    const stdout = new PassThrough();
    const lines: string[] = [];
    bindLineReader(stdout, (line) => lines.push(line));

    const ended = new Promise<void>((resolve) => stdout.once('end', resolve));
    stdout.write('PILL_RE');
    stdout.write('ADY\nFIRST\r');
    stdout.write('\nTAIL');
    stdout.end();
    await ended;

    expect(lines).toEqual(['PILL_READY', 'FIRST', 'TAIL']);
  });

  test('stops delivering lines after the reader is disposed', () => {
    const stdout = new PassThrough();
    const lines: string[] = [];
    const dispose = bindLineReader(stdout, (line) => lines.push(line));

    stdout.write('FIRST\n');
    dispose();
    stdout.write('SECOND\n');

    expect(lines).toEqual(['FIRST']);
    stdout.destroy();
  });

  test('does not write to an unavailable child stdin', () => {
    const write = jest.fn();
    const stdin = Object.assign(new EventEmitter(), {
      destroyed: false,
      writable: true,
      write,
    });
    const child = { killed: true, stdin } as unknown as ChildProcess;

    expect(safeWriteStdin(child, 'PING\n', 'test-child')).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  test('turns a synchronous stdin write failure into a false result', () => {
    const stdin = Object.assign(new EventEmitter(), {
      destroyed: false,
      writable: true,
      write: jest.fn(() => {
        throw new Error('EPIPE');
      }),
    });
    const child = { killed: false, stdin } as unknown as ChildProcess;
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(safeWriteStdin(child, 'PING\n', 'test-child')).toBe(false);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
