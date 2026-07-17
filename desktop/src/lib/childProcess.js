"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachStdinErrorGuard = attachStdinErrorGuard;
exports.safeWriteStdin = safeWriteStdin;
exports.bindLineReader = bindLineReader;
const guardedStdin = new WeakSet();
function attachStdinErrorGuard(child, label) {
    const stdin = child.stdin;
    if (!stdin || guardedStdin.has(stdin))
        return;
    guardedStdin.add(stdin);
    stdin.on('error', (error) => {
        console.warn(`${label} stdin error:`, error);
    });
}
function safeWriteStdin(child, data, label) {
    if (!child || child.killed || !child.stdin)
        return false;
    const stdin = child.stdin;
    attachStdinErrorGuard(child, label);
    if (stdin.destroyed || !stdin.writable)
        return false;
    try {
        stdin.write(data, (error) => {
            if (error)
                console.warn(`${label} stdin write failed:`, error);
        });
        return true;
    }
    catch (error) {
        console.warn(`${label} stdin write failed:`, error);
        return false;
    }
}
function bindLineReader(stream, onLine) {
    if (!stream)
        return () => undefined;
    let pending = '';
    const flush = () => {
        const line = pending.trim();
        pending = '';
        if (line)
            onLine(line);
    };
    const onData = (chunk) => {
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const raw of lines) {
            const line = raw.trim();
            if (line)
                onLine(line);
        }
    };
    stream.on('data', onData);
    stream.once('end', flush);
    return () => {
        stream.off('data', onData);
        stream.off('end', flush);
        pending = '';
    };
}
