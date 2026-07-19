const PILL_HUD_READY_TIMEOUT_MS = 8_000;

export interface NativePillHudControllerPorts<
  ProcessType,
  TimerType = ReturnType<typeof setTimeout>,
> {
  spawn(binaryPath: string): ProcessType;
  getPillHudPath(): string;
  attachStdinErrorGuard(proc: ProcessType, name: string): void;
  bindLineReader(stream: NodeJS.ReadableStream, callback: (line: string) => void): void;
  writeStdin(proc: ProcessType, command: string): void;
  kill(proc: ProcessType): void;

  // Timer functions
  setTimeout(callback: () => void, ms: number): TimerType;
  clearTimeout(timer: TimerType): void;

  // callbacks for events
  onReady(): void;
  onToggle(): void;
  onMoved(x: number, y: number): void;
  onResized(width: number, height: number): void;
  onInteract?(): void;
  onFailed(error?: unknown): void;

  // HUD details needed
  getPillMaxWidth(): number;
  getSavedPillBounds(): { x: number; y: number; width: number; height: number };
  setSavedPillBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  getLanguage(): string;
  getLocale(): string;
  getStrings(key: string): string;

  // fallback trigger
  activateElectronPillFallback(): void;

  // logging
  log(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

export interface NativePillHudController<ProcessType> {
  start(): void;
  stop(): void;
  sync(visible: boolean, message?: string): void;
  sendCommand(command: string): void;
  useNative(): boolean;
  isDisabledForRun(): boolean;
  getProcess(): ProcessType | null;
}

export function createNativePillHudController<
  ProcessType extends {
    readonly stdout: NodeJS.ReadableStream;
    readonly stderr: NodeJS.ReadableStream | null;
    on(event: 'error', callback: (error: Error) => void): unknown;
    on(
      event: 'exit',
      callback: (code: number | null, signal: NodeJS.Signals | null) => void
    ): unknown;
  },
  TimerType,
>(
  ports: NativePillHudControllerPorts<ProcessType, TimerType>
): NativePillHudController<ProcessType> {
  let pillHudProcess: ProcessType | null = null;
  let useNativePillHud = true;
  let nativeHudDisabledForRun = false;
  let pillHudReadyTimer: TimerType | null = null;
  const intentionallyStoppedPillHuds = new WeakSet<ProcessType>();

  function clearPillHudReadyTimer() {
    if (pillHudReadyTimer !== null) {
      ports.clearTimeout(pillHudReadyTimer);
      pillHudReadyTimer = null;
    }
  }

  function activateElectronPillFallback() {
    if (nativeHudDisabledForRun) return;
    ports.warn(
      'Native pill HUD failed to respond/start. Falling back to Electron compact pill HUD...'
    );
    nativeHudDisabledForRun = true;
    useNativePillHud = false;
    self.stop();
    ports.activateElectronPillFallback();
  }

  function handlePillHudEvent(line: string) {
    if (line === 'PILL_READY') {
      clearPillHudReadyTimer();
      ports.onReady();
      return;
    }
    if (line === 'PILL_TOGGLE') {
      ports.onToggle();
      return;
    }
    if (line.startsWith('PILL_MOVED:')) {
      const parts = line.split(':');
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      ports.onMoved(Math.round(x), Math.round(y));
      return;
    }
    if (line.startsWith('PILL_RESIZED:')) {
      const parts = line.split(':');
      const width = Number(parts[1]);
      const height = Number(parts[2]);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        ports.onResized(width, height);
      }
    }
  }

  const self: NativePillHudController<ProcessType> = {
    start() {
      if (!useNativePillHud) return;
      self.stop();
      clearPillHudReadyTimer();

      try {
        const binaryPath = ports.getPillHudPath();
        const proc = ports.spawn(binaryPath);
        pillHudProcess = proc;

        ports.attachStdinErrorGuard(proc, 'pill_hud');
        ports.bindLineReader(proc.stdout, (line) => {
          if (pillHudProcess === proc) handlePillHudEvent(line);
        });

        proc.stderr?.on('data', (chunk: Buffer) => {
          ports.warn('[pill_hud stderr]: ' + chunk.toString('utf8').trim());
        });

        proc.on('error', (err: Error) => {
          ports.error('Native pill HUD process failed:', err);
          if (pillHudProcess === proc) {
            clearPillHudReadyTimer();
            activateElectronPillFallback();
          }
        });

        proc.on('exit', (code, signal) => {
          ports.log(`Native pill HUD exited with code ${code}, signal ${signal}`);
          if (pillHudProcess === proc) {
            clearPillHudReadyTimer();
            pillHudProcess = null;
            if (!intentionallyStoppedPillHuds.has(proc)) {
              activateElectronPillFallback();
            }
          }
        });

        const readyTimer = ports.setTimeout(() => {
          // Check both timer ID and process ID to prevent old timer from affecting new process
          if (pillHudReadyTimer !== readyTimer || pillHudProcess !== proc) return;
          pillHudReadyTimer = null;
          ports.warn(`Native pill HUD did not signal PILL_READY in ${PILL_HUD_READY_TIMEOUT_MS}ms`);
          activateElectronPillFallback();
        }, PILL_HUD_READY_TIMEOUT_MS);
        pillHudReadyTimer = readyTimer;
      } catch (err) {
        ports.error('Native pill HUD başlatılamadı:', err);
        activateElectronPillFallback();
      }
    },

    stop() {
      const proc = pillHudProcess;
      if (!proc) return;

      clearPillHudReadyTimer();
      intentionallyStoppedPillHuds.add(proc);
      pillHudProcess = null;

      try {
        ports.kill(proc);
      } catch {
        // ignore
      }
    },

    sync(visible, message) {
      if (!useNativePillHud) return;
      const bounds = ports.getSavedPillBounds();
      self.sendCommand(`MAXW:${ports.getPillMaxWidth()}`);
      self.sendCommand(`POS:${bounds.x}:${bounds.y}`);
      self.sendCommand(`SIZE:${bounds.width}:${bounds.height}`);
      if (message) {
        self.sendCommand(`STATUS:&status=${encodeURIComponent(message)}`);
      }
      self.sendCommand(visible ? 'SHOW' : 'HIDE');
    },

    sendCommand(command) {
      if (pillHudProcess) {
        ports.writeStdin(pillHudProcess, command + '\n');
      }
    },

    useNative() {
      return useNativePillHud;
    },

    isDisabledForRun() {
      return nativeHudDisabledForRun;
    },

    getProcess() {
      return pillHudProcess;
    },
  };

  return self;
}
