"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.makePhoneSyncKey = makePhoneSyncKey;
exports.createPhoneSyncState = createPhoneSyncState;
exports.createElectronPhoneSyncState = createElectronPhoneSyncState;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function makePhoneSyncKey(context, filePath, metadata) {
    const namespace = `${context.url}|${context.bucket}`;
    if (metadata?.id)
        return `${namespace}|id:${metadata.id}`;
    if (metadata?.updated_at)
        return `${namespace}|${filePath}@${metadata.updated_at}`;
    return `${namespace}|${filePath}`;
}
function createPhoneSyncState(ports, maxEntries = 2000) {
    let syncedPaths = new Set();
    const load = () => {
        try {
            const statePath = ports.resolvePath();
            if (!ports.exists(statePath)) {
                syncedPaths = new Set();
                return;
            }
            const parsed = JSON.parse(ports.readText(statePath));
            if (!isRecord(parsed) || !Array.isArray(parsed.synced)) {
                syncedPaths = new Set();
                return;
            }
            syncedPaths = new Set(parsed.synced.filter(isString));
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            ports.warn('Phone sync state load failed, starting fresh:', error);
            syncedPaths = new Set();
        }
    };
    const save = () => {
        try {
            const newestKeys = [...syncedPaths].slice(-maxEntries);
            syncedPaths = new Set(newestKeys);
            ports.writeText(ports.resolvePath(), JSON.stringify({ synced: newestKeys }, null, 2));
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            ports.error('Phone sync state save failed:', error);
        }
    };
    const isSynced = (context, filePath, metadata) => syncedPaths.has(makePhoneSyncKey(context, filePath, metadata));
    const markSynced = (context, filePath, metadata) => {
        syncedPaths.add(makePhoneSyncKey(context, filePath, metadata));
        save();
    };
    return {
        load,
        hasKey: key => syncedPaths.has(key),
        isSynced,
        markSynced,
    };
}
function createElectronPhoneSyncState(maxEntries = 2000) {
    return createPhoneSyncState({
        resolvePath: () => path.join(electron_1.app.getPath('userData'), 'phone-sync-state.json'),
        exists: filePath => fs.existsSync(filePath),
        readText: filePath => fs.readFileSync(filePath, 'utf8'),
        writeText: (filePath, content) => fs.writeFileSync(filePath, content, 'utf8'),
        warn: (message, error) => console.warn(message, error),
        error: (message, error) => console.error(message, error),
    }, maxEntries);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isString(value) {
    return typeof value === 'string';
}
