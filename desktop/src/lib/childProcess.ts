import { ChildProcess } from 'child_process';
import { Readable } from 'stream';

const guardedStdin = new WeakSet<object>();

export function attachStdinErrorGuard(child: ChildProcess, label: string): void {
  const stdin = child.stdin;
  if (!stdin || guardedStdin.has(stdin)) return;
  guardedStdin.add(stdin);
  stdin.on('error', (error) => {
    console.warn(`${label} stdin error:`, error);
  });
}

export function safeWriteStdin(
  child: ChildProcess | null,
  data: string | Buffer,
  label: string
): boolean {
  if (!child || child.killed || !child.stdin) return false;
  const stdin = child.stdin;
  attachStdinErrorGuard(child, label);
  if (stdin.destroyed || !stdin.writable) return false;
  try {
    stdin.write(data, (error) => {
      if (error) console.warn(`${label} stdin write failed:`, error);
    });
    return true;
  } catch (error) {
    console.warn(`${label} stdin write failed:`, error);
    return false;
  }
}

export function bindLineReader(
  stream: Readable | null,
  onLine: (line: string) => void
): () => void {
  if (!stream) return () => undefined;
  let pending = '';
  const flush = (): void => {
    const line = pending.trim();
    pending = '';
    if (line) onLine(line);
  };
  const onData = (chunk: Buffer | string): void => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (line) onLine(line);
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
