import type { AppSettings } from '../types';

export interface SupabaseRuntimeContext<Client> {
  readonly client: Client;
  readonly url: string;
  readonly bucket: string;
  readonly generation: number;
}

export interface SupabaseRuntimePorts<Client> {
  readonly createClient: (url: string, key: string) => Client;
  readonly onInvalidate: () => void;
}

export interface SupabaseRuntime<Client> {
  readonly getContext: () => SupabaseRuntimeContext<Client> | null;
  readonly isCurrent: (context: SupabaseRuntimeContext<Client>) => boolean;
  readonly currentClient: () => Client | null;
  readonly invalidate: () => void;
}

export function createSupabaseRuntime<Client>(
  settings: AppSettings,
  ports: SupabaseRuntimePorts<Client>
): SupabaseRuntime<Client> {
  let client: Client | null = null;
  let clientUrl = '';
  let clientKey = '';
  let generation = 0;

  const ensureClient = (): Client | null => {
    if (!settings.supabaseUrl || !settings.supabaseKey) return null;
    if (
      client === null ||
      clientUrl !== settings.supabaseUrl ||
      clientKey !== settings.supabaseKey
    ) {
      client = ports.createClient(settings.supabaseUrl, settings.supabaseKey);
      clientUrl = settings.supabaseUrl;
      clientKey = settings.supabaseKey;
    }
    return client;
  };

  const getContext = (): SupabaseRuntimeContext<Client> | null => {
    const currentClient = ensureClient();
    if (currentClient === null) return null;
    return {
      client: currentClient,
      url: settings.supabaseUrl,
      bucket: settings.supabaseBucket || 'screenshots',
      generation,
    };
  };

  const isCurrent = (context: SupabaseRuntimeContext<Client>): boolean => {
    return (
      context.generation === generation &&
      context.client === client &&
      context.bucket === (settings.supabaseBucket || 'screenshots')
    );
  };

  const invalidate = (): void => {
    ports.onInvalidate();
    generation += 1;
    client = null;
    clientUrl = '';
    clientKey = '';
  };

  return {
    getContext,
    isCurrent,
    currentClient: () => client,
    invalidate,
  };
}
