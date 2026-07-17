"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseRuntime = createSupabaseRuntime;
function createSupabaseRuntime(settings, ports) {
    let client = null;
    let clientUrl = '';
    let clientKey = '';
    let generation = 0;
    const ensureClient = () => {
        if (!settings.supabaseUrl || !settings.supabaseKey)
            return null;
        if (client === null ||
            clientUrl !== settings.supabaseUrl ||
            clientKey !== settings.supabaseKey) {
            client = ports.createClient(settings.supabaseUrl, settings.supabaseKey);
            clientUrl = settings.supabaseUrl;
            clientKey = settings.supabaseKey;
        }
        return client;
    };
    const getContext = () => {
        const currentClient = ensureClient();
        if (currentClient === null)
            return null;
        return {
            client: currentClient,
            url: settings.supabaseUrl,
            bucket: settings.supabaseBucket || 'screenshots',
            generation,
        };
    };
    const isCurrent = (context) => {
        return (context.generation === generation &&
            context.client === client &&
            context.bucket === (settings.supabaseBucket || 'screenshots'));
    };
    const invalidate = () => {
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
