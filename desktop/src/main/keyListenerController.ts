export interface KeyListenerControllerPorts<ProcessType> {
  spawn(binaryPath: string): ProcessType;
  getKeyListenerPath(): string;
  attachStdinErrorGuard(proc: ProcessType, name: string): void;
  bindLineReader(stream: any, callback: (line: string) => void): void;
  writeStdin(proc: ProcessType, command: string): void;
  kill(proc: ProcessType): void;

  onKeyEvent(event: string): void;
  onFailed(message: string): void;

  getSettings(): {
    hotkeyVk?: number;
    doublePressMs?: number;
  };
  log(message: string): void;
  warn(message: string, error?: any): void;
  error(message: string, error?: any): void;
}

export interface KeyListenerController<ProcessType> {
  start(): void;
  stop(): void;
  sendConfig(): void;
  setSelectionActive(active: boolean): void;
  getProcess(): ProcessType | null;
}

export function createKeyListenerController<
  ProcessType extends {
    stdout: any;
    stderr: any;
    on(event: string, callback: (...args: any[]) => void): void;
  },
>(ports: KeyListenerControllerPorts<ProcessType>): KeyListenerController<ProcessType> {
  let keyListenerProcess: ProcessType | null = null;
  let isStoppedIntentionally = false;

  const self: KeyListenerController<ProcessType> = {
    start() {
      try {
        self.stop();
        isStoppedIntentionally = false;

        const binaryPath = ports.getKeyListenerPath();
        const proc = ports.spawn(binaryPath);
        keyListenerProcess = proc;

        ports.attachStdinErrorGuard(proc, 'key_listener');
        ports.bindLineReader(proc.stdout, (line) => {
          if (keyListenerProcess !== proc) return;
          if (line.startsWith('DEBUG_KEY:') || line.startsWith('HOOK_ALIVE:')) {
            console.log(`[KEY_DEBUG] ${line}`);
            return;
          }
          ports.onKeyEvent(line);
        });

        proc.stderr?.on('data', (data: Buffer) => {
          ports.error('[key_listener stderr] ' + data.toString().trim());
        });

        proc.on('error', (err: any) => {
          ports.error('Key listener process error:', err);
          if (keyListenerProcess === proc) {
            ports.onFailed('Klavye dinleyici başlatılamadı');
          }
        });

        proc.on('exit', (code: any, signal: any) => {
          ports.error(`key_listener exited with code ${code}, signal ${signal}`);
          if (keyListenerProcess === proc) {
            keyListenerProcess = null;
            if (code !== 0 && code !== null && !isStoppedIntentionally) {
              ports.onFailed('Klavye dinleyici kapandı — kısayollar çalışmıyor');
            }
          }
        });

        // Push initial config
        self.sendConfig();
      } catch (err) {
        ports.error('Failed to spawn key listener:', err);
        ports.onFailed('Klavye dinleyici başlatılamadı');
      }
    },

    stop() {
      const proc = keyListenerProcess;
      if (!proc) return;

      isStoppedIntentionally = true;
      keyListenerProcess = null;

      try {
        ports.kill(proc);
      } catch {
        // ignore
      }
    },

    sendConfig() {
      if (!keyListenerProcess) return;
      const settings = ports.getSettings();
      const vk = settings.hotkeyVk || 0xa2;
      const ms = settings.doublePressMs || 400;
      ports.writeStdin(keyListenerProcess, `CONFIG:${vk}:${ms}\n`);
    },

    setSelectionActive(active) {
      if (!keyListenerProcess) return;
      ports.writeStdin(keyListenerProcess, active ? 'ACTIVE\n' : 'INACTIVE\n');
    },

    getProcess() {
      return keyListenerProcess;
    },
  };

  return self;
}
