import { PassThrough } from 'stream';
import {
  createNativePillHudController,
  type NativePillHudControllerPorts,
  type NativePillHudController,
} from '../src/main/nativePillHudController';

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

type ControlledTimerHandle = {
  readonly id: number;
};

class ControlledTimers {
  readonly scheduledMs: number[] = [];
  readonly clearedIds: number[] = [];
  private readonly callbacks = new Map<number, () => void>();
  private nextId = 1;

  readonly setTimeout = (callback: () => void, ms: number): ControlledTimerHandle => {
    const handle = { id: this.nextId };
    this.nextId += 1;
    this.callbacks.set(handle.id, callback);
    this.scheduledMs.push(ms);
    return handle;
  };

  readonly clearTimeout = (handle: ControlledTimerHandle): void => {
    this.clearedIds.push(handle.id);
  };

  fire(id: number): void {
    this.callbacks.get(id)?.();
  }
}

describe('NativePillHudController', () => {
  let mockProcess: MockChildProcess | null = null;
  let fallbackActivated = false;
  let fallbackActivationCount = 0;
  let activePillBounds = { x: 100, y: 100, width: 320, height: 52 };
  let syncMessages: string[] = [];
  let useNative = true;
  let readyEventCalled = false;
  let toggleEventCalled = false;
  let movedCoords: [number, number] | null = null;
  let resizedSize: [number, number] | null = null;
  let readyTimerCallback: (() => void) | null = null;
  let readyTimerMs = 0;

  const ports: NativePillHudControllerPorts<MockChildProcess, number> = {
    spawn: () => {
      mockProcess = new MockChildProcess();
      return mockProcess;
    },
    getPillHudPath: () => 'C:/mock/pill_hud.exe',
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
    setTimeout: (callback, ms) => {
      readyTimerCallback = callback;
      readyTimerMs = ms;
      return 123;
    },
    clearTimeout: () => {
      readyTimerCallback = null;
    },
    onReady: () => {
      readyEventCalled = true;
    },
    onToggle: () => {
      toggleEventCalled = true;
    },
    onMoved: (x, y) => {
      movedCoords = [x, y];
    },
    onResized: (w, h) => {
      resizedSize = [w, h];
    },
    onFailed: () => {
      fallbackActivated = true;
    },
    getPillMaxWidth: () => 720,
    getSavedPillBounds: () => activePillBounds,
    setSavedPillBounds: (bounds) => {
      activePillBounds = bounds;
    },
    getLanguage: () => 'tr',
    getLocale: () => 'tr-TR',
    getStrings: () => 'Hazır',
    activateElectronPillFallback: () => {
      useNative = false;
      fallbackActivated = true;
      fallbackActivationCount += 1;
    },
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeEach(() => {
    mockProcess = null;
    fallbackActivated = false;
    fallbackActivationCount = 0;
    activePillBounds = { x: 100, y: 100, width: 320, height: 52 };
    syncMessages = [];
    useNative = true;
    readyEventCalled = false;
    toggleEventCalled = false;
    movedCoords = null;
    resizedSize = null;
    readyTimerCallback = null;
    readyTimerMs = 0;
  });

  it('starts the native process, schedules ready timeout, and handles normal READY event', () => {
    const controller = createNativePillHudController(ports);
    controller.start();

    expect(mockProcess).not.toBeNull();
    expect(readyTimerCallback).not.toBeNull();
    expect(readyTimerMs).toBe(8000);

    // Simulate stdout READY message
    mockProcess!.stdout.write('PILL_READY\n');

    expect(readyEventCalled).toBe(true);
    expect(readyTimerCallback).toBeNull(); // Timer is cleared
  });

  it('triggers Electron fallback on READY handshake timeout', () => {
    const controller = createNativePillHudController(ports);
    controller.start();

    expect(readyTimerCallback).not.toBeNull();
    
    // Fire the timeout callback
    readyTimerCallback!();

    expect(fallbackActivated).toBe(true);
    expect(useNative).toBe(false);
  });

  it('sends POS, SIZE, MAXW, and STATUS/SHOW commands when syncing HUD state', () => {
    const controller = createNativePillHudController(ports);
    controller.start();
    mockProcess!.stdout.write('PILL_READY\n');

    controller.sync(true, 'Test message');

    const writeCalls = mockProcess!.stdin.write.mock.calls.map(c => c[0]);
    expect(writeCalls).toContain('MAXW:720\n');
    expect(writeCalls).toContain('POS:100:100\n');
    expect(writeCalls).toContain('SIZE:320:52\n');
    expect(writeCalls).toContain('STATUS:&status=Test%20message\n');
    expect(writeCalls).toContain('SHOW\n');
  });

  it('handles incoming stdout events: PILL_TOGGLE, PILL_MOVED, PILL_RESIZED', () => {
    const controller = createNativePillHudController(ports);
    controller.start();
    mockProcess!.stdout.write('PILL_READY\n');

    // Simulate toggle
    mockProcess!.stdout.write('PILL_TOGGLE\n');
    expect(toggleEventCalled).toBe(true);

    // Simulate moved
    mockProcess!.stdout.write('PILL_MOVED:150:180\n');
    expect(movedCoords).toEqual([150, 180]);

    // Simulate resized
    mockProcess!.stdout.write('PILL_RESIZED:400:60\n');
    expect(resizedSize).toEqual([400, 60]);
  });

  it('handles intentional stop vs unexpected exit fallback', () => {
    const controller = createNativePillHudController(ports);
    controller.start();
    mockProcess!.stdout.write('PILL_READY\n');

    // Unexpected exit
    mockProcess!.trigger('exit', 1, null);
    expect(fallbackActivated).toBe(true);
    expect(useNative).toBe(false);

    // Start again and do intentional stop
    fallbackActivated = false;
    useNative = true;
    controller.start();
    controller.stop();
    expect(fallbackActivated).toBe(false); // Stop is intentional, so no fallback trigger
  });

  it('avoids starting multiple processes simultaneously (duplicate start check)', () => {
    const controller = createNativePillHudController(ports);
    controller.start();
    const firstProc = mockProcess;

    controller.start();
    const secondProc = mockProcess;

    expect(firstProc!.killed).toBe(true); // First process is killed/stopped
    expect(secondProc).not.toBe(firstProc);
  });

  it('restarts with a fresh 8000ms READY timer and clears the previous run timer', () => {
    // Given: a controller with deterministic, independently addressable timers
    const timers = new ControlledTimers();
    const controlledPorts = {
      ...ports,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    };
    const controller = createNativePillHudController(controlledPorts);
    controller.start();
    const firstProcess = mockProcess;

    // When: the native HUD is restarted before the first READY timeout
    controller.start();

    // Then: the first run is stopped and only its timer is cleared
    expect(firstProcess?.killed).toBe(true);
    expect(controller.getProcess()).toBe(mockProcess);
    expect(timers.scheduledMs).toEqual([8000, 8000]);
    expect(timers.clearedIds).toEqual([1]);
  });

  it('keeps the restarted run timer active when an old queued timeout callback fires', () => {
    // Given: an old timeout is already queued when a new native HUD run starts
    const timers = new ControlledTimers();
    const controlledPorts = {
      ...ports,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    };
    const controller = createNativePillHudController(controlledPorts);
    controller.start();
    controller.start();
    const restartedProcess = controller.getProcess();

    // When: the stale callback runs, then the new process becomes READY
    timers.fire(1);
    restartedProcess?.stdout.write('PILL_READY\n');
    timers.fire(2);

    // Then: only READY clears the new timer and no stale callback can trigger fallback
    expect(timers.clearedIds).toEqual([1, 2]);
    expect(fallbackActivationCount).toBe(0);
    expect(controller.getProcess()).toBe(restartedProcess);
  });
});
