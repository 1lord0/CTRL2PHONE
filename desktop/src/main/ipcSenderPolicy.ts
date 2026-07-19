import { BrowserWindow } from 'electron';

export interface IpcSenderPolicyPorts {
  getMainWindow(): BrowserWindow | null;
  getOverlayWindow(): BrowserWindow | null;
  getNotificationWindow(): BrowserWindow | null;
  mainFrameUrl: string;
  overlayFrameUrl: string;
  notificationFrameUrl: string;
}

export function createIpcSenderPolicy(ports: IpcSenderPolicyPorts) {
  /**
   * Extract the WebContents sender from the argument.
   *
   * Callers may pass either:
   *   - A raw WebContents object (from `event.sender` in registrars)
   *   - A full IPC event object `{ sender, senderFrame }`
   *
   * We detect the case by checking for `senderFrame`. Only real IPC
   * event objects (and test mocks emulating them) carry this property.
   * Raw WebContents objects never have `senderFrame`.
   */
  function extractSender(eventOrSender: any): { sender: any; senderFrame: any } | null {
    if (!eventOrSender || typeof eventOrSender !== 'object') return null;

    // If the object has senderFrame, treat as an IPC event
    if ('senderFrame' in eventOrSender) {
      return { sender: eventOrSender.sender, senderFrame: eventOrSender.senderFrame };
    }

    // Otherwise treat as raw WebContents
    return { sender: eventOrSender, senderFrame: undefined };
  }

  const isAuthorized = (
    win: BrowserWindow | null,
    allowedUrls: string[],
    eventOrSender: any
  ): boolean => {
    if (!win || win.isDestroyed()) return false;

    const extracted = extractSender(eventOrSender);
    if (!extracted || !extracted.sender) return false;

    const { sender, senderFrame } = extracted;

    try {
      const winContents = win.webContents;
      if (!winContents) return false;

      // The sender WebContents must match the window's WebContents
      if (winContents !== sender) return false;

      // If we have frame information, validate it too
      if (senderFrame) {
        // All allowed URLs must be file:// URLs
        for (const u of allowedUrls) {
          if (!u.startsWith('file://')) return false;
        }
        if ((winContents as any).mainFrame !== senderFrame) return false;
        if (!allowedUrls.includes(senderFrame.url)) return false;
      }

      return true;
    } catch {
      return false;
    }
  };

  return {
    isMain: (event: any): boolean => {
      const allowedUrls = [ports.mainFrameUrl];
      if (ports.mainFrameUrl && ports.mainFrameUrl.endsWith('index.html')) {
        allowedUrls.push(ports.mainFrameUrl.replace('index.html', 'pill.html'));
      }
      return isAuthorized(ports.getMainWindow(), allowedUrls, event);
    },
    isOverlay: (event: any): boolean =>
      isAuthorized(ports.getOverlayWindow(), [ports.overlayFrameUrl], event),
    isNotification: (event: any): boolean =>
      isAuthorized(ports.getNotificationWindow(), [ports.notificationFrameUrl], event),
  };
}
