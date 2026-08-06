import type { App, BrowserWindow } from 'electron';
import * as fs from 'fs';
import type { MainWindowController } from './mainWindowController';

interface PackagedSmokeDeps {
  app: App;
  mainWindowController: MainWindowController<BrowserWindow>;
  reportPath: string;
}

interface SmokeReport {
  ok: boolean;
  pid: number;
  windowTitle?: string;
  windowVisibleAfterBlur?: boolean;
  panelModeAfterBlur?: string;
  settingsRoundTrip?: {
    url: boolean;
    key: boolean;
    bucket: boolean;
  };
  settingsLoadedOnStartup?: {
    url: boolean;
    key: boolean;
    bucket: boolean;
  };
  clickDiagnostics?: Record<string, unknown>;
  directIpcDiagnostics?: Record<string, unknown>;
  rendererDiagnostics?: Record<string, unknown>;
  rendererConsole?: Array<Record<string, unknown>>;
  loadFailures?: Array<Record<string, unknown>>;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(read: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  let value = await read();
  while (!accept(value)) {
    if (Date.now() >= deadline) throw new Error('Packaged smoke test timed out.');
    await delay(100);
    value = await read();
  }
  return value;
}

function writeReport(reportPath: string, report: SmokeReport): void {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

export async function runPackagedSmoke(deps: PackagedSmokeDeps): Promise<void> {
  const report: SmokeReport = { ok: false, pid: process.pid };
  try {
    await deps.app.whenReady();
    const win = await waitFor(
      () => deps.mainWindowController.getWindow(),
      (candidate) => Boolean(candidate && !candidate.isDestroyed())
    );
    if (!win) throw new Error('Main window was not created.');

    const rendererConsole: Array<Record<string, unknown>> = [];
    const loadFailures: Array<Record<string, unknown>> = [];
    (win.webContents as any).on(
      'console-message',
      (_event: unknown, level: number, message: string, line: number, sourceId: string) => {
        rendererConsole.push({ level, message, line, sourceId });
      }
    );
    (win.webContents as any).on(
      'did-fail-load',
      (
        _event: unknown,
        errorCode: number,
        errorDescription: string,
        validatedUrl: string,
        isMainFrame: boolean
      ) => {
        loadFailures.push({ errorCode, errorDescription, validatedUrl, isMainFrame });
      }
    );

    deps.mainWindowController.presentSpotlight();
    try {
      await waitFor(async () => {
        if (win.isDestroyed()) return false;
        return win.webContents.executeJavaScript(
          "document.readyState === 'complete' && document.body.dataset.rendererReady === 'true' && document.getElementById('saveSettings')?.dataset.handlerBound === 'true'"
        );
      }, Boolean);
    } catch (error) {
      if (!win.isDestroyed()) {
        report.rendererDiagnostics = await win.webContents.executeJavaScript(`({
          readyState: document.readyState,
          checkpoint: document.body?.dataset.rendererCheckpoint ?? null,
          rendererReady: document.body?.dataset.rendererReady ?? null,
          handlerBound: document.getElementById('saveSettings')?.dataset.handlerBound ?? null,
          bridgeMethods: window.bridge ? Object.keys(window.bridge).sort() : [],
          pageUrl: location.href,
          rendererScript: document.querySelector('script[src*="renderer.js"]')?.outerHTML ?? null,
          resourceUrls: performance.getEntriesByType('resource').map((entry) => entry.name)
        })`);
      }
      report.rendererConsole = rendererConsole;
      report.loadFailures = loadFailures;
      throw error;
    }

    const startupState = await win.webContents.executeJavaScript('window.bridge.ready()');
    report.settingsLoadedOnStartup = {
      url: startupState.supabaseUrl === 'http://127.0.0.1:9',
      key: startupState.supabaseKey === 'packaged-smoke-anon-key',
      bucket: startupState.supabaseBucket === 'smoke-bucket',
    };

    const beforeSave = await win.webContents.executeJavaScript(`(() => {
      const setValue = (id, value) => {
        const element = document.getElementById(id);
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue('supabaseUrl', 'http://127.0.0.1:9');
      setValue('supabaseKey', 'packaged-smoke-anon-key');
      setValue('supabaseBucket', 'smoke-bucket');
      const autoCopy = document.getElementById('autoCopyFromPhone');
      autoCopy.checked = false;
      autoCopy.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('saveSettings').click();
      return {
        urlLength: document.getElementById('supabaseUrl').value.length,
        keyLength: document.getElementById('supabaseKey').value.length,
        handlerBound: document.getElementById('saveSettings').dataset.handlerBound,
        rendererReady: document.body.dataset.rendererReady
      };
    })()`);
    if (
      beforeSave.urlLength === 0 ||
      beforeSave.keyLength === 0 ||
      beforeSave.handlerBound !== 'true' ||
      beforeSave.rendererReady !== 'true'
    ) {
      throw new Error('Filled renderer inputs were empty before IPC save.');
    }

    const clickDiagnostics = await waitFor(
      () =>
        win.webContents.executeJavaScript(`Promise.all([
        window.bridge.ready(),
        Promise.resolve(document.getElementById('status').textContent)
      ]).then(([state, status]) => ({
      url: state.supabaseUrl,
      keyLength: state.supabaseKey.length,
      bucket: state.supabaseBucket,
      status,
      inputUrl: document.getElementById('supabaseUrl').value,
      inputKeyLength: document.getElementById('supabaseKey').value.length,
      saveDisabled: document.getElementById('saveSettings').disabled
    }))`),
      (state: any) =>
        state.url === 'http://127.0.0.1:9' &&
        state.keyLength === 'packaged-smoke-anon-key'.length &&
        state.bucket === 'smoke-bucket' &&
        state.saveDisabled === false
    );
    report.clickDiagnostics = clickDiagnostics;

    let savedState = clickDiagnostics;
    if (
      clickDiagnostics.url !== 'http://127.0.0.1:9' ||
      clickDiagnostics.keyLength !== 'packaged-smoke-anon-key'.length ||
      clickDiagnostics.bucket !== 'smoke-bucket'
    ) {
      const directIpcDiagnostics = await win.webContents
        .executeJavaScript(`window.bridge.saveSettings({
        supabaseUrl: 'http://127.0.0.1:9',
        supabaseKey: 'packaged-smoke-anon-key',
        supabaseBucket: 'smoke-bucket',
        autoCopyFromPhone: false
      }).then(async (result) => {
        const state = await window.bridge.ready();
        return {
          result,
          url: state.supabaseUrl,
          keyLength: state.supabaseKey.length,
          bucket: state.supabaseBucket
        };
      })`);
      report.directIpcDiagnostics = directIpcDiagnostics;
      throw new Error('The real Save button did not persist the filled settings.');
    }
    report.settingsRoundTrip = {
      url: savedState.url === 'http://127.0.0.1:9',
      key: savedState.keyLength === 'packaged-smoke-anon-key'.length,
      bucket: savedState.bucket === 'smoke-bucket',
    };

    win.blur();
    await delay(500);
    report.windowVisibleAfterBlur = win.isVisible();
    report.panelModeAfterBlur = deps.mainWindowController.getPanelMode();
    report.windowTitle = win.getTitle();
    if (!report.windowVisibleAfterBlur || report.panelModeAfterBlur !== 'presented') {
      throw new Error('Presented window closed or collapsed after losing focus.');
    }

    report.ok = true;
    writeReport(deps.reportPath, report);
    await delay(3_000);
    await win.webContents.executeJavaScript(
      "document.getElementById('dismissPanel').click()",
      true
    );
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    writeReport(deps.reportPath, report);
    deps.app.exit(1);
  }
}
