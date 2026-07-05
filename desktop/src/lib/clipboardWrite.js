"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardLocalClipboard = guardLocalClipboard;
exports.isLocalClipboardGuarded = isLocalClipboardGuarded;
exports.writeTextToClipboardReliable = writeTextToClipboardReliable;
const electron_1 = require("electron");
/** Skip remote clipboard/image sync while a local write is in flight or just finished. */
let guardedUntilMs = 0;
function guardLocalClipboard(ms = 6000) {
    guardedUntilMs = Math.max(guardedUntilMs, Date.now() + ms);
}
function isLocalClipboardGuarded() {
    return Date.now() < guardedUntilMs;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Write text to the OS clipboard with short retries and a read-back check.
 * Returns false when the payload is empty or the clipboard could not be updated.
 */
async function writeTextToClipboardReliable(text) {
    const payload = text ?? '';
    if (!payload.trim()) {
        return false;
    }
    guardLocalClipboard(8000);
    for (let attempt = 0; attempt < 4; attempt++) {
        electron_1.clipboard.writeText(payload);
        await sleep(40 + attempt * 30);
        const readBack = electron_1.clipboard.readText();
        if (readBack === payload) {
            guardLocalClipboard(6000);
            return true;
        }
        // Trim-tolerant match — some apps normalize line endings on read.
        if (readBack.replace(/\r\n/g, '\n') === payload.replace(/\r\n/g, '\n')) {
            guardLocalClipboard(6000);
            return true;
        }
    }
    electron_1.clipboard.writeText(payload);
    guardLocalClipboard(6000);
    const finalRead = electron_1.clipboard.readText();
    return finalRead.length > 0;
}
