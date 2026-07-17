"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGeminiWindowController = createGeminiWindowController;
exports.createElectronGeminiWindowController = createElectronGeminiWindowController;
const electron_1 = require("electron");
function createGeminiWindowController(ports) {
    let window = null;
    const getOrCreate = () => {
        if (window && !window.isDestroyed())
            return window;
        const created = ports.createWindow();
        window = created;
        created.onClose((event) => {
            if (ports.isShutdown())
                return;
            event.preventDefault();
            created.hide();
        });
        created.onClosed(() => {
            if (window === created)
                window = null;
        });
        return created;
    };
    const ensureLoaded = async () => {
        const current = getOrCreate();
        const url = current.webContents.getURL();
        if (!url || url === 'about:blank')
            await current.loadURL(ports.url);
        return current;
    };
    const open = async () => {
        const current = await ensureLoaded();
        current.show();
        current.focus();
        return current;
    };
    const focusComposer = async (current, promptText) => {
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
    const sendPasteShortcut = (current) => {
        current.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['ctrl'] });
        current.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['ctrl'] });
    };
    return { ensureLoaded, open, focusComposer, sendPasteShortcut };
}
function createElectronGeminiWindowController(isShutdown) {
    return createGeminiWindowController({
        url: 'https://gemini.google.com/app',
        isShutdown,
        createWindow: () => wrapElectronWindow(createElectronWindow()),
    });
}
function createElectronWindow() {
    return new electron_1.BrowserWindow({
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
function wrapElectronWindow(window) {
    return {
        webContents: {
            getURL: () => window.webContents.getURL(),
            executeJavaScript: script => window.webContents.executeJavaScript(script),
            sendInputEvent: event => window.webContents.sendInputEvent({ ...event, modifiers: [...event.modifiers] }),
        },
        isDestroyed: () => window.isDestroyed(),
        loadURL: async (url) => {
            await window.loadURL(url);
        },
        show: () => window.show(),
        hide: () => window.hide(),
        focus: () => window.focus(),
        onClose: listener => window.on('close', event => listener({ preventDefault: () => event.preventDefault() })),
        onClosed: listener => window.on('closed', listener),
    };
}
