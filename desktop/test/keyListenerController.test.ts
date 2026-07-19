import { PassThrough } from 'stream';
import {
  createKeyListenerController,
  type KeyListenerControllerPorts,
  type KeyListenerController,
} from '../src/main/keyListenerController';

class MockChildProcess {
  stdin = {
    destroyed: false,
    writable: true,
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
  };
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  listeners: Record<string, ((...args: any[]) => void)[]> = {};

  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  trigger(event: string, ...args: any[]) {
    this.listeners[event]?.forEach(cb => cb(...args));
  }

  kill() {
    this.killed = true;
    this.trigger('exit', 0, null);
  }
}

describe('KeyListenerController', () => {
  let mockProcess: MockChildProcess | null = null;
  let activeSettings = { hotkeyVk: 0xa2, doublePressMs: 400 };
  let eventsReceived: string[] = [];
  let failuresReceived: string[] = [];
  let pathError = false;

  const ports: KeyListenerControllerPorts<MockChildProcess> = {
    spawn: () => {
      mockProcess = new MockChildProcess();
      return mockProcess;
    },
    getKeyListenerPath: () => {
      if (pathError) throw new Error('key_listener.exe not found');
      return 'C:/mock/key_listener.exe';
    },
    attachStdinErrorGuard: () => {},
    bindLineReader: (stream, callback) => {
      stream.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        lines.forEach(l => {
          if (l.trim()) callback(l.trim());
        });
      });
    },
    writeStdin: (proc, cmd) => {
      proc.stdin.write(cmd);
    },
    kill: (proc) => {
      proc.kill();
    },
    onKeyEvent: (event) => {
      eventsReceived.push(event);
    },
    onFailed: (msg) => {
      failuresReceived.push(msg);
    },
    getSettings: () => activeSettings,
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeEach(() => {
    mockProcess = null;
    activeSettings = { hotkeyVk: 0xa2, doublePressMs: 400 };
    eventsReceived = [];
    failuresReceived = [];
    pathError = false;
  });

  it('resolves path, spawns process, sends hotkey vk config, and forwards events', () => {
    const controller = createKeyListenerController(ports);
    controller.start();

    expect(mockProcess).not.toBeNull();
    
    // Config should be sent immediately
    expect(mockProcess!.stdin.write).toHaveBeenCalledWith('CONFIG:162:400\n');

    // Simulate stdout event
    mockProcess!.stdout.write('READY\n');
    expect(eventsReceived).toContain('READY');

    mockProcess!.stdout.write('DOUBLE_CTRL\n');
    expect(eventsReceived).toContain('DOUBLE_CTRL');
  });

  it('notifies onFailed if path resolution throws', () => {
    pathError = true;
    const controller = createKeyListenerController(ports);
    controller.start();

    expect(mockProcess).toBeNull();
    expect(failuresReceived).toContain('Klavye dinleyici başlatılamadı');
  });

  it('handles HOOK_FAILED event', () => {
    const controller = createKeyListenerController(ports);
    controller.start();

    mockProcess!.stdout.write('HOOK_FAILED\n');
    expect(eventsReceived).toContain('HOOK_FAILED');
  });

  it('manages duplicate start by killing the old process', () => {
    const controller = createKeyListenerController(ports);
    controller.start();
    const p1 = mockProcess;

    controller.start();
    const p2 = mockProcess;

    expect(p1!.killed).toBe(true);
    expect(p2).not.toBe(p1);
  });

  it('distinguishes intentional stop from unexpected exit', () => {
    const controller = createKeyListenerController(ports);
    controller.start();

    // Unexpected exit
    mockProcess!.trigger('exit', 1, null);
    expect(failuresReceived).toContain('Klavye dinleyici kapandı — kısayollar çalışmıyor');

    // Start again and do intentional stop
    failuresReceived = [];
    controller.start();
    controller.stop();
    expect(failuresReceived).toHaveLength(0); // No error for intentional stop
  });
});
