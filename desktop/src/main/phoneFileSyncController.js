"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPhoneFileSyncController = createPhoneFileSyncController;
exports.isValidPhoneFileName = isValidPhoneFileName;
function createPhoneFileSyncController(ports) {
    let inFlightGeneration = null;
    let pollingInterval = null;
    let subscription = null;
    const deleteRemote = async (context, path) => {
        if (!ports.isContextCurrent(context))
            return;
        const error = await ports.deleteRemoteFile(context, path);
        if (error)
            ports.warn(`Phone sync: remote delete failed for ${path}:`, error);
    };
    const processFile = async (context, file, batchIndex) => {
        const path = `to_pc/${file.name}`;
        if (ports.isSynced(context, path, file)) {
            await deleteRemote(context, path);
            return null;
        }
        const localPath = await ports.downloadFile(context, file, batchIndex);
        if (!localPath || !ports.isContextCurrent(context))
            return null;
        ports.markSynced(context, path, file);
        await deleteRemote(context, path);
        return localPath;
    };
    const cleanupSynced = async (context, files) => {
        for (const file of files) {
            if (!ports.isContextCurrent(context))
                return;
            if (!isValidPhoneFileName(file.name))
                continue;
            const path = `to_pc/${file.name}`;
            if (ports.isSynced(context, path, file))
                await deleteRemote(context, path);
        }
    };
    const check = async () => {
        if (!ports.isEnabled())
            return;
        const context = ports.getContext();
        if (!context || inFlightGeneration === context.generation)
            return;
        inFlightGeneration = context.generation;
        try {
            const result = await ports.listRemoteFiles(context);
            if (result.error) {
                ports.warn('Phone sync list error:', result.error);
                return;
            }
            if (!ports.isContextCurrent(context) || result.files.length === 0)
                return;
            const pending = result.files.filter(file => {
                if (!isValidPhoneFileName(file.name))
                    return false;
                return !ports.isSynced(context, `to_pc/${file.name}`, file);
            });
            if (pending.length === 0) {
                await cleanupSynced(context, result.files);
                return;
            }
            const localPaths = [];
            const batch = pending.slice(0, 10);
            for (let index = 0; index < batch.length; index += 1) {
                const file = batch[index];
                if (!file || !ports.isContextCurrent(context))
                    return;
                const localPath = await processFile(context, file, index);
                if (localPath)
                    localPaths.push(localPath);
            }
            if (ports.isContextCurrent(context) && localPaths.length > 0) {
                ports.notifyDownloads(localPaths);
            }
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            ports.error('Error in checkPhoneSync:', error);
        }
        finally {
            if (inFlightGeneration === context.generation)
                inFlightGeneration = null;
        }
    };
    const syncPath = async (path, metadata) => {
        const context = ports.getContext();
        if (!context || !path.startsWith('to_pc/'))
            return;
        const name = path.slice('to_pc/'.length);
        if (!isValidPhoneFileName(name))
            return;
        const file = {
            name,
            id: metadata?.id,
            updated_at: metadata?.updated_at,
        };
        if (ports.isSynced(context, path, file)) {
            await deleteRemote(context, path);
            return;
        }
        if (inFlightGeneration === context.generation)
            return;
        inFlightGeneration = context.generation;
        try {
            const localPath = await processFile(context, file, 0);
            if (localPath && ports.isContextCurrent(context))
                ports.notifyDownloads([localPath]);
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            ports.error('Error in syncPhoneFileByPath:', error);
        }
        finally {
            if (inFlightGeneration === context.generation)
                inFlightGeneration = null;
        }
    };
    const stop = () => {
        if (pollingInterval)
            clearInterval(pollingInterval);
        pollingInterval = null;
        const currentSubscription = subscription;
        subscription = null;
        if (currentSubscription === null)
            return;
        void ports.removeSubscription(currentSubscription).catch((error) => {
            if (!(error instanceof Error))
                throw error;
            ports.error('Phone sync channel teardown failed:', error);
        });
    };
    const setup = () => {
        stop();
        if (!ports.isEnabled()) {
            ports.log('Phone sync: disabled by settings');
            return;
        }
        const context = ports.getContext();
        if (!context) {
            ports.log('Phone sync: waiting for Supabase settings');
            return;
        }
        subscription = ports.subscribe(context, file => {
            if (ports.isContextCurrent(context) && file.name.startsWith('to_pc/')) {
                void syncPath(file.name, file);
            }
        }, () => {
            if (ports.isContextCurrent(context))
                void check();
        });
        pollingInterval = setInterval(() => void check(), 15000);
        ports.log('Phone sync: realtime + 15s fallback initialized');
        void check();
    };
    return { check, syncPath, setup, stop };
}
function isValidPhoneFileName(name) {
    return Boolean(name && name !== '.keep' && !name.startsWith('.'));
}
