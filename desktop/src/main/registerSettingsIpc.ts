import QRCode from 'qrcode';
import { buildRlsSetupSql } from '../lib/supabaseSetup';
import { resolveLang, getStrings } from '../lib/i18n';
import * as path from 'path';
import { IpcMain } from 'electron';
import type { AppSettings } from '../types';
import type { ActionPairingInvite } from './actionWorkflowRuntime';
import type { DiagnosticsLogger } from './diagnosticsLogger';

export type NormalizedSettingsUpdate =
  | { ok: true; settings: Partial<AppSettings> }
  | { ok: false; error: string };

export function normalizeSettingsUpdate(
  current: AppSettings,
  next: Partial<AppSettings>
): NormalizedSettingsUpdate {
  const settings: Partial<AppSettings> = { ...next };
  const connectionFieldsPresent =
    Object.prototype.hasOwnProperty.call(next, 'supabaseUrl') ||
    Object.prototype.hasOwnProperty.call(next, 'supabaseKey') ||
    Object.prototype.hasOwnProperty.call(next, 'supabaseBucket') ||
    Object.prototype.hasOwnProperty.call(next, 'autoCopyFromPhone');

  if (!connectionFieldsPresent) return { ok: true, settings };

  const supabaseUrl =
    typeof next.supabaseUrl === 'string' ? next.supabaseUrl.trim() : current.supabaseUrl.trim();
  const supabaseKey =
    typeof next.supabaseKey === 'string' ? next.supabaseKey.trim() : current.supabaseKey.trim();
  const supabaseBucket =
    typeof next.supabaseBucket === 'string'
      ? next.supabaseBucket.trim() || 'screenshots'
      : current.supabaseBucket.trim() || 'screenshots';
  const autoCopyFromPhone = next.autoCopyFromPhone ?? current.autoCopyFromPhone;
  const credentialsRequired = autoCopyFromPhone || Boolean(supabaseUrl || supabaseKey);

  if (credentialsRequired && (!supabaseUrl || !supabaseKey)) {
    return {
      ok: false,
      error: 'Supabase URL ve Anon Key alanları birlikte doldurulmalıdır.',
    };
  }

  settings.supabaseUrl = supabaseUrl;
  settings.supabaseKey = supabaseKey;
  settings.supabaseBucket = supabaseBucket;
  settings.autoCopyFromPhone = autoCopyFromPhone;
  return { ok: true, settings };
}

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
  stopActionTaskMonitor(): Promise<void>;
  createActionPairingInvite(): Promise<ActionPairingInvite>;
  sendKeyListenerConfig(): void;
  setupPhoneSyncPolling(): Promise<void> | void;
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
  diagnostics?: Pick<DiagnosticsLogger, 'action' | 'info' | 'error'>;
}

export function registerSettingsIpc(ipc: IpcMain, deps: SettingsIpcDeps): () => void {
  ipc.handle('save-settings', async (event: any, nextSettings: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    const settingsSummary = {
      fields: Object.keys(nextSettings ?? {}).sort(),
      supabaseUrlPresent: Boolean(nextSettings?.supabaseUrl),
      supabaseKeyPresent: Boolean(nextSettings?.supabaseKey),
      supabaseBucketPresent: Boolean(nextSettings?.supabaseBucket),
      autoCopyFromPhone: nextSettings?.autoCopyFromPhone,
    };
    deps.diagnostics?.action('settings.save_requested', settingsSummary);
    const normalized = normalizeSettingsUpdate(deps.settings, nextSettings ?? {});
    if (!normalized.ok) {
      deps.diagnostics?.error(
        'settings',
        'settings_validation_failed',
        new Error(normalized.error),
        settingsSummary,
        'validation'
      );
      return normalized;
    }
    try {
      const result = deps.settingsStore.update(normalized.settings);

      if (result.pillVisibilityChanged) {
        deps.mainWindowController.applyCompactPillVisibility();
      }
      if (result.supabaseChanged) {
        await deps.stopActionTaskMonitor();
        deps.supabaseRuntime.invalidate();
      }

      deps.sendKeyListenerConfig();
      deps.settingsStore.save();
      await deps.setupPhoneSyncPolling();
      if (deps.isShutdownStarted()) return { ok: false };
      deps.setupClipboardPolling();

      const mainWindow = deps.mainWindowController.getWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('settings-changed', deps.settings);
      }
      deps.diagnostics?.info('settings', 'settings_saved', {
        fields: Object.keys(normalized.settings).sort(),
        supabaseChanged: Boolean(result.supabaseChanged),
      });
      return { ok: true };
    } catch (error) {
      deps.diagnostics?.error('settings', 'settings_save_failed', error, settingsSummary);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Ayarlar kaydedilemedi.',
      };
    }
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
        actionWebhookUrl: deps.settings.actionWebhookUrl,
        actionWebhookSecret: deps.settings.actionWebhookSecret,
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
      actionWebhookUrl: deps.settings.actionWebhookUrl,
      actionWebhookSecret: deps.settings.actionWebhookSecret,
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
      let actionPairing: ActionPairingInvite | null = null;
      let warning: string | undefined;
      try {
        actionPairing = await deps.createActionPairingInvite();
      } catch (error) {
        warning = error instanceof Error ? error.message.slice(0, 300) : 'action_pairing_failed';
        deps.diagnostics?.error('action_pairing', 'qr_pairing_invite_failed', error);
      }
      const data = JSON.stringify({
        schemaVersion: 2,
        url: deps.settings.supabaseUrl,
        key: deps.settings.supabaseKey,
        bucket: deps.settings.supabaseBucket || 'screenshots',
        actionPairing: actionPairing
          ? {
              version: 1,
              channelId: actionPairing.channelId,
              inviteToken: actionPairing.inviteToken,
              inviteExpiresAt: actionPairing.inviteExpiresAt,
            }
          : undefined,
      });
      const dataUrl = await QRCode.toDataURL(data);
      return {
        ok: true,
        dataUrl,
        actionPairingIncluded: Boolean(actionPairing),
        warning,
      };
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
