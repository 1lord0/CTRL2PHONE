import { BrowserWindow } from 'electron';

export interface GeminiCloseEvent {
  readonly preventDefault: () => void;
}

export interface GeminiWindow {
  readonly webContents: {
    readonly getURL: () => string;
    readonly executeJavaScript: (script: string) => Promise<unknown>;
    readonly sendInputEvent: (event: {
      readonly type: 'keyDown' | 'keyUp';
      readonly keyCode: string;
      readonly modifiers: readonly 'ctrl'[];
    }) => void;
  };
  readonly isDestroyed: () => boolean;
  readonly loadURL: (url: string) => Promise<void>;
  readonly show: () => void;
  readonly hide: () => void;
  readonly focus: () => void;
  readonly onClose: (listener: (event: GeminiCloseEvent) => void) => void;
  readonly onClosed: (listener: () => void) => void;
}

export interface GeminiWindowControllerPorts<Window extends GeminiWindow> {
  readonly url: string;
  readonly isShutdown: () => boolean;
  readonly createWindow: () => Window;
}

export interface GeminiWindowController<Window extends GeminiWindow> {
  readonly ensureLoaded: () => Promise<Window>;
  readonly open: () => Promise<Window>;
  readonly focusComposer: (window: Window, promptText: string) => Promise<boolean>;
  readonly sendPasteShortcut: (window: Window) => void;
}

export function createGeminiWindowController<Window extends GeminiWindow>(
  ports: GeminiWindowControllerPorts<Window>
): GeminiWindowController<Window> {
  let window: Window | null = null;

  const getOrCreate = (): Window => {
    if (window && !window.isDestroyed()) return window;
    const created = ports.createWindow();
    window = created;
    created.onClose((event: GeminiCloseEvent) => {
      if (ports.isShutdown()) return;
      event.preventDefault();
      created.hide();
    });
    created.onClosed(() => {
      if (window === created) window = null;
    });
    return created;
  };

  const ensureLoaded = async (): Promise<Window> => {
    const current = getOrCreate();
    const url = current.webContents.getURL();
    if (!url || url === 'about:blank') await current.loadURL(ports.url);
    return current;
  };

  const open = async (): Promise<Window> => {
    const current = await ensureLoaded();
    current.show();
    current.focus();
    return current;
  };

  const focusComposer = async (current: Window, promptText: string): Promise<boolean> => {
    const safePrompt = JSON.stringify(promptText);
    const focused = await current.webContents.executeJavaScript(`
      (() => {
        const selectors = ['div[contenteditable="true"]', 'div[role="textbox"]', 'textarea', 'input[type="text"]'];
        const element = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
        if (element) {
          element.focus();
          element.click();
          const prompt = ${safePrompt};
          if (prompt) {
            if (element.tagName === 'DIV' || element.getAttribute('contenteditable') === 'true') {
              element.innerText = prompt;
            } else {
              element.value = prompt;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        }
        return false;
      })();
    `);
    return Boolean(focused);
  };

  const sendPasteShortcut = (current: Window): void => {
    current.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['ctrl'] });
    current.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['ctrl'] });
  };

  return { ensureLoaded, open, focusComposer, sendPasteShortcut };
}

export function createElectronGeminiWindowController(
  isShutdown: () => boolean
): GeminiWindowController<GeminiWindow> {
  return createGeminiWindowController({
    url: 'https://gemini.google.com/app',
    isShutdown,
    createWindow: () => wrapElectronWindow(createElectronWindow()),
  });
}

function createElectronWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    backgroundColor: '#0b0f14',
    title: 'Gemini Web',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:gemini',
    },
  });
}

function wrapElectronWindow(window: BrowserWindow): GeminiWindow {
  return {
    webContents: {
      getURL: () => window.webContents.getURL(),
      executeJavaScript: script => window.webContents.executeJavaScript(script),
      sendInputEvent: event => window.webContents.sendInputEvent({ ...event, modifiers: [...event.modifiers] }),
    },
    isDestroyed: () => window.isDestroyed(),
    loadURL: async url => {
      await window.loadURL(url);
    },
    show: () => window.show(),
    hide: () => window.hide(),
    focus: () => window.focus(),
    onClose: listener =>
      window.on('close', event => listener({ preventDefault: () => event.preventDefault() })),
    onClosed: listener => window.on('closed', listener),
  };
}
