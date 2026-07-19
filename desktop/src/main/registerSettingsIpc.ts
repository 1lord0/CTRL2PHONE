import QRCode from 'qrcode';
import { buildRlsSetupSql } from '../lib/supabaseSetup';
import { resolveLang, getStrings } from '../lib/i18n';
import * as path from 'path';
import { IpcMain } from 'electron';

export interface SettingsIpcDeps {
  isShutdownStarted(): boolean;
  isMainSender(sender: any): boolean;
  settingsStore: {
    update(nextSettings: any): { pillVisibilityChanged?: boolean; supabaseChanged?: boolean };
    save(): void;
  };
  mainWindowController: {
    applyCompactPillVisibility(): void;
    getWindow(): any;
    getPanelMode(): string;
  };
  supabaseRuntime: {
    invalidate(): void;
  };
  sendKeyListenerConfig(): void;
  setupPhoneSyncPolling(): void;
  setupClipboardPolling(): void;
  settings: any;
  getPillMaxWidth(): number;
  downloadedPhoneFiles: string[];
  writeTextToClipboardReliable(text: string): Promise<boolean>;
  shellOpenExternal(url: string): Promise<void>;
  getLocale?(): string;
  selectionSession: {
    active: boolean;
  };
}

export function registerSettingsIpc(ipc: IpcMain, deps: SettingsIpcDeps): () => void {
  ipc.handle('save-settings', (event: any, nextSettings: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    const result = deps.settingsStore.update(nextSettings);

    if (result.pillVisibilityChanged) {
      deps.mainWindowController.applyCompactPillVisibility();
    }
    if (result.supabaseChanged) {
      deps.supabaseRuntime.invalidate();
    }

    deps.sendKeyListenerConfig();
    deps.settingsStore.save();
    deps.setupPhoneSyncPolling();
    deps.setupClipboardPolling();

    const mainWindow = deps.mainWindowController.getWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-changed', deps.settings);
    }
    return { ok: true };
  });

  ipc.handle('app-ready', (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const locale = deps.getLocale ? deps.getLocale() : 'tr-TR';
    const i18nStrings = getStrings(resolveLang(deps.settings.language, locale));

    if (deps.isShutdownStarted()) {
      return {
        prompt: deps.settings.prompt,
        supabaseUrl: deps.settings.supabaseUrl,
        supabaseKey: deps.settings.supabaseKey,
        supabaseBucket: deps.settings.supabaseBucket,
        autoCopyFromPhone: deps.settings.autoCopyFromPhone,
        hotkeyVk: deps.settings.hotkeyVk,
        doublePressMs: deps.settings.doublePressMs,
        aiProvider: deps.settings.aiProvider,
        aiApiKey: deps.settings.aiApiKey,
        aiModel: deps.settings.aiModel,
        aiBaseUrl: deps.settings.aiBaseUrl,
        language: deps.settings.language,
        panelPinned: deps.settings.panelPinned ?? false,
        panelMode: deps.mainWindowController.getPanelMode(),
        pillMaxWidth: deps.getPillMaxWidth(),
        i18n: i18nStrings,
        selectionActive: false,
      };
    }
    return {
      prompt: deps.settings.prompt,
      supabaseUrl: deps.settings.supabaseUrl,
      supabaseKey: deps.settings.supabaseKey,
      supabaseBucket: deps.settings.supabaseBucket,
      autoCopyFromPhone: deps.settings.autoCopyFromPhone,
      hotkeyVk: deps.settings.hotkeyVk,
      doublePressMs: deps.settings.doublePressMs,
      aiProvider: deps.settings.aiProvider,
      aiApiKey: deps.settings.aiApiKey,
      aiModel: deps.settings.aiModel,
      aiBaseUrl: deps.settings.aiBaseUrl,
      language: deps.settings.language,
      panelPinned: deps.settings.panelPinned ?? false,
      panelMode: deps.mainWindowController.getPanelMode(),
      pillMaxWidth: deps.getPillMaxWidth(),
      i18n: i18nStrings,
      selectionActive: deps.selectionSession.active,
      pillVisibility: deps.settings.pillVisibility,
      phoneDownloads: deps.downloadedPhoneFiles.map((filePath: string) => {
        const name = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext);
        return {
          path: filePath,
          name,
          isImage,
        };
      }),
    };
  });

  ipc.handle('generate-qr', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    try {
      if (!deps.settings.supabaseUrl || !deps.settings.supabaseKey) {
        return { ok: false, error: 'Supabase ayarları eksik' };
      }
      const data = JSON.stringify({
        url: deps.settings.supabaseUrl,
        key: deps.settings.supabaseKey,
        bucket: deps.settings.supabaseBucket || 'screenshots',
      });
      const dataUrl = await QRCode.toDataURL(data);
      return { ok: true, dataUrl };
    } catch (error: any) {
      console.error('QR Kod oluşturma hatası:', error);
      return { ok: false, error: error.message };
    }
  });

  ipc.handle('setup-rls', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    try {
      const bucket = deps.settings.supabaseBucket || 'screenshots';
      const sql = buildRlsSetupSql(bucket);
      await deps.writeTextToClipboardReliable(sql);

      let projectRef = '_';
      if (deps.settings.supabaseUrl) {
        const match = deps.settings.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/i);
        if (match) {
          projectRef = match[1];
        }
      }

      await deps.shellOpenExternal(`https://supabase.com/dashboard/project/${projectRef}/sql/new`);
      return { ok: true, sql };
    } catch (error: any) {
      console.error('RLS kurulum hatası:', error);
      return { ok: false, error: error.message };
    }
  });

  return () => {
    ipc.removeHandler('save-settings');
    ipc.removeHandler('app-ready');
    ipc.removeHandler('generate-qr');
    ipc.removeHandler('setup-rls');
  };
}
