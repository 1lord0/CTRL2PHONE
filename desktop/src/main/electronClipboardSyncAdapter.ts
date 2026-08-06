import type { SupabaseClient } from '@supabase/supabase-js';
import { ClipboardSyncPorts, parseMobileClipboardRow } from './clipboardSyncController';
import type { SupabaseRuntime, SupabaseRuntimeContext } from './supabaseRuntime';

export type ElectronClipboardSyncContext = SupabaseRuntimeContext<SupabaseClient>;

export interface ElectronClipboardSyncAdapterDeps {
  readonly runtime: Pick<SupabaseRuntime<SupabaseClient>, 'getContext' | 'isCurrent'>;
  readonly readClipboard: () => string;
  readonly writeClipboard: (value: string) => void;
  readonly isClipboardGuarded: () => boolean;
  readonly setStatus: (value: string) => void;
  readonly setResponse: (value: string) => void;
  readonly showNotification: (title: string, body: string) => void;
  readonly log: (message: string) => void;
  readonly warn: (message: string, detail?: string) => void;
  readonly error: (message: string, error: Error) => void;
}

export function createElectronClipboardSyncAdapter(
  deps: ElectronClipboardSyncAdapterDeps
): ClipboardSyncPorts<ElectronClipboardSyncContext> {
  return {
    readClipboard: deps.readClipboard,
    writeClipboard: deps.writeClipboard,
    isClipboardGuarded: deps.isClipboardGuarded,
    getContext: deps.runtime.getContext,
    isContextCurrent: deps.runtime.isCurrent,
    insertDesktopText: async (context, text) => {
      const { error } = await context.client.from('clipboard_sync').insert({
        content: text,
        source: 'desktop',
      });
      return error?.message ?? null;
    },
    fetchOldestMobileText: async (context) => {
      const { data, error } = await context.client
        .from('clipboard_sync')
        .select('*')
        .eq('source', 'mobile')
        .order('created_at', { ascending: true })
        .limit(1);
      return {
        row: parseMobileClipboardRow(data?.[0]),
        error: error?.message ?? null,
      };
    },
    deleteMobileText: async (context, id) => {
      const { error } = await context.client.from('clipboard_sync').delete().eq('id', id);
      return error?.message ?? null;
    },
    setStatus: deps.setStatus,
    setResponse: deps.setResponse,
    showNotification: deps.showNotification,
    log: deps.log,
    warn: deps.warn,
    error: deps.error,
  };
}
