import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

type CallKind = 'invoke' | 'send' | 'on';
type ChannelCall = {
  readonly kind: CallKind;
  readonly channel: string;
};

const ROOT = path.resolve(__dirname, '..');

const API_KEYS = {
  main: [
    'ready',
    'saveSettings',
    'generateQr',
    'captureNow',
    'openGemini',
    'focusGemini',
    'getStorageUsage',
    'purgeStorage',
    'setupRls',
    'sendClipboard',
    'panelToggle',
    'panelInteractStart',
    'panelDragBy',
    'panelDismiss',
    'quitApp',
    'savePanelPinned',
    'panelResizeCompact',
    'onPanelMode',
    'onHudCapturing',
    'onPillDragState',
    'onPillResized',
    'onStatus',
    'onResponse',
    'onActionTaskUpdated',
    'onOverlayMessage',
    'uploadFileToPhone',
    'startDragDownloadedFile',
    'deleteDownloadedFile',
    'sendActionToPhone',
    'logUserAction',
    'onPhoneDownloadsUpdated',
  ],
  overlay: [
    'notifyOverlayReady',
    'notifyOverlayRendered',
    'setSelection',
    'cancelSelection',
    'setAnnotated',
    'startSelectionDrag',
    'onSelectionDragState',
    'copySelection',
    'onOverlayState',
    'onOverlayMessage',
    'confirmSelectionGemini',
    'confirmSelectionAction',
    'confirmSelectionPhone',
    'confirmSelectionOcr',
  ],
  notification: ['onNotification', 'onDismissNotification'],
} as const;

const CHANNELS = {
  main: [
    ['invoke', 'app-ready'],
    ['invoke', 'save-settings'],
    ['invoke', 'generate-qr'],
    ['invoke', 'capture-now'],
    ['invoke', 'open-gemini'],
    ['invoke', 'focus-gemini'],
    ['invoke', 'get-storage-usage'],
    ['invoke', 'purge-storage'],
    ['invoke', 'setup-rls'],
    ['invoke', 'send-clipboard'],
    ['invoke', 'panel-toggle'],
    ['invoke', 'panel-interact-start'],
    ['invoke', 'panel-drag-by'],
    ['invoke', 'panel-dismiss'],
    ['invoke', 'panel-send-action-to-phone'],
    ['invoke', 'app-quit'],
    ['invoke', 'panel-save-pinned'],
    ['invoke', 'panel-resize-compact'],
    ['on', 'panel-mode'],
    ['on', 'hud-capturing'],
    ['on', 'pill-drag-state'],
    ['on', 'pill-resized'],
    ['on', 'status'],
    ['on', 'response'],
    ['on', 'action-task-updated'],
    ['on', 'overlay-message'],
    ['invoke', 'upload-file-to-phone'],
    ['send', 'start-drag-downloaded-file'],
    ['invoke', 'delete-downloaded-file'],
    ['send', 'diagnostics-user-action'],
    ['on', 'phone-downloads-updated'],
  ],
  overlay: [
    ['invoke', 'overlay-renderer-ready'],
    ['invoke', 'overlay-rendered'],
    ['invoke', 'set-selection'],
    ['invoke', 'cancel-selection'],
    ['invoke', 'set-annotated'],
    ['send', 'start-selection-drag'],
    ['on', 'selection-drag-state'],
    ['invoke', 'copy-selection'],
    ['on', 'overlay-state'],
    ['on', 'overlay-message'],
    ['invoke', 'confirm-selection-gemini'],
    ['invoke', 'confirm-selection-action'],
    ['invoke', 'confirm-selection-phone'],
    ['invoke', 'confirm-selection-ocr'],
  ],
  notification: [
    ['on', 'notification-data'],
    ['on', 'notification-dismiss'],
  ],
} as const;

function compilePreloads(): string {
  const buildDir = fs.mkdtempSync(path.join(ROOT, 'ctrl2phone-preloads-'));
  for (const entrypoint of Object.keys(API_KEYS) as Array<keyof typeof API_KEYS>) {
    const source = fs.readFileSync(path.join(ROOT, 'src', `preload-${entrypoint}.ts`), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: `preload-${entrypoint}.ts`,
    });
    fs.writeFileSync(path.join(buildDir, `preload-${entrypoint}.js`), compiled.outputText, 'utf8');
  }
  return buildDir;
}

function loadBuiltBridge(
  entrypoint: keyof typeof API_KEYS,
  buildDir: string
): {
  readonly bridge: Record<string, unknown>;
  readonly calls: readonly ChannelCall[];
} {
  const calls: ChannelCall[] = [];
  let exposedBridge: Record<string, unknown> | undefined;
  jest.resetModules();
  jest.isolateModules(() => {
    jest.doMock('electron', () => {
      const ipcRenderer = {
        invoke: (channel: string): Promise<{ readonly ok: boolean }> => {
          calls.push({ kind: 'invoke', channel });
          return Promise.resolve({ ok: true });
        },
        send: (channel: string): void => {
          calls.push({ kind: 'send', channel });
        },
        on: (channel: string): void => {
          calls.push({ kind: 'on', channel });
        },
      };
      return {
        contextBridge: {
          exposeInMainWorld: (_name: string, bridge: Record<string, unknown>): void => {
            exposedBridge = bridge;
          },
        },
        ipcRenderer,
      };
    });
    // The build emits CommonJS preloads; loading them through the mocked Electron
    // boundary is the same surface Electron uses for an isolated renderer.
    require(path.join(buildDir, `preload-${entrypoint}.js`));
  });
  jest.dontMock('electron');
  if (!exposedBridge) {
    throw new Error(`preload-${entrypoint} did not expose bridge`);
  }
  return { bridge: exposedBridge, calls };
}

describe('per-window preload contracts', () => {
  let buildDir: string;

  beforeAll(() => {
    buildDir = compilePreloads();
  });

  afterAll(() => {
    fs.rmSync(buildDir, { recursive: true, force: true });
  });

  it('removes the legacy broad preload source and compiled output', () => {
    expect(fs.existsSync(path.join(ROOT, 'src', 'preload.ts'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'dist', 'js', 'preload.js'))).toBe(false);
  });

  it.each(Object.keys(API_KEYS) as Array<keyof typeof API_KEYS>)(
    'exposes only the %s bridge capabilities and channels',
    (entrypoint) => {
      const { bridge, calls } = loadBuiltBridge(entrypoint, buildDir);
      expect(Object.keys(bridge).sort()).toEqual([...API_KEYS[entrypoint]].sort());

      for (const method of Object.values(bridge)) {
        if (typeof method === 'function') {
          method();
        }
      }

      expect(calls).toEqual(CHANNELS[entrypoint].map(([kind, channel]) => ({ kind, channel })));
    }
  );

  it('uses named exact bridge interfaces instead of Partial<BridgeAPI>', () => {
    const source = ['main', 'overlay', 'notification']
      .map((entrypoint) =>
        fs.readFileSync(path.join(ROOT, 'src', `preload-${entrypoint}.ts`), 'utf8')
      )
      .join('\n');
    const types = fs.readFileSync(path.join(ROOT, 'src', 'types.ts'), 'utf8');

    expect(source).not.toContain('Partial<BridgeAPI>');
    expect(source).toContain('const bridge: MainBridgeAPI');
    expect(source).toContain('const bridge: OverlayBridgeAPI');
    expect(source).toContain('const bridge: NotificationBridgeAPI');
    expect(types).toContain(
      'export type BridgeAPI = MainBridgeAPI | OverlayBridgeAPI | NotificationBridgeAPI;'
    );
    expect(types).not.toMatch(/interface BridgeAPI\s*\{/);
  });
});
