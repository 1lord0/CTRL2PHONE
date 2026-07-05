import { clipboard } from 'electron';

/** Skip remote clipboard/image sync while a local write is in flight or just finished. */
let guardedUntilMs = 0;

export function guardLocalClipboard(ms = 6000): void {
  guardedUntilMs = Math.max(guardedUntilMs, Date.now() + ms);
}

export function isLocalClipboardGuarded(): boolean {
  return Date.now() < guardedUntilMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write text to the OS clipboard with short retries and a read-back check.
 * Returns false when the payload is empty or the clipboard could not be updated.
 */
export async function writeTextToClipboardReliable(text: string): Promise<boolean> {
  const payload = text ?? '';
  if (!payload.trim()) {
    return false;
  }

  guardLocalClipboard(8000);

  for (let attempt = 0; attempt < 4; attempt++) {
    clipboard.writeText(payload);
    await sleep(40 + attempt * 30);

    const readBack = clipboard.readText();
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

  clipboard.writeText(payload);
  guardLocalClipboard(6000);
  const finalRead = clipboard.readText();
  return finalRead.length > 0;
}