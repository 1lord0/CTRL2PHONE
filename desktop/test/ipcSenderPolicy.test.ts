import { createIpcSenderPolicy } from '../src/main/ipcSenderPolicy';

const MAIN_URL = 'file:///C:/ctrl2phone/dist/js/index.html';
const OVERLAY_URL = 'file:///C:/ctrl2phone/dist/js/overlay.html';
const NOTIFICATION_URL = 'file:///C:/ctrl2phone/dist/js/notification.html';

type TestFrame = {
  readonly url: string;
};

type TestContents = {
  readonly mainFrame: TestFrame;
};

type TestWindow = {
  readonly webContents: TestContents;
  isDestroyed(): boolean;
};

function createEvent(sender: TestContents, senderFrame: TestFrame = sender.mainFrame) {
  return { sender, senderFrame };
}

describe('IPC sender policy', () => {
  const mainContents = { mainFrame: { url: MAIN_URL } };
  const overlayContents = { mainFrame: { url: OVERLAY_URL } };
  const notificationContents = { mainFrame: { url: NOTIFICATION_URL } };
  let mainWindow: TestWindow | null;
  let policy: ReturnType<typeof createIpcSenderPolicy>;

  beforeEach(() => {
    mainWindow = { webContents: mainContents, isDestroyed: () => false };
    const ports = {
      getMainWindow: () => mainWindow,
      getOverlayWindow: () => ({ webContents: overlayContents, isDestroyed: () => false }),
      getNotificationWindow: () => ({
        webContents: notificationContents,
        isDestroyed: () => false,
      }),
      mainFrameUrl: MAIN_URL,
      overlayFrameUrl: OVERLAY_URL,
      notificationFrameUrl: NOTIFICATION_URL,
    };
    policy = createIpcSenderPolicy(ports);
  });

  it.each([
    ['main', () => policy.isMain(createEvent(mainContents))],
    ['overlay', () => policy.isOverlay(createEvent(overlayContents))],
    ['notification', () => policy.isNotification(createEvent(notificationContents))],
  ])('authorizes the %s owner when the event comes from its exact local main frame', (_name, authorize) => {
    // Given the owner WebContents and its composition-root supplied local URL
    // When the owner main frame invokes IPC
    const authorized = authorize();

    // Then the policy grants the owner capability
    expect(authorized).toBe(true);
  });

  it('rejects a remote child frame even when it shares the owner WebContents', () => {
    // Given a hostile child frame inside the main window WebContents
    const hostileFrame = { url: 'https://attacker.invalid/frame.html' };

    // When the hostile frame invokes IPC
    const authorized = policy.isMain(createEvent(mainContents, hostileFrame));

    // Then the owner WebContents identity alone is insufficient
    expect(authorized).toBe(false);
  });

  it('rejects a child frame that copies the trusted URL', () => {
    // Given a distinct child frame object that reports the trusted main URL
    const spoofedFrame = { url: MAIN_URL };

    // When the child frame invokes IPC
    const authorized = policy.isMain(createEvent(mainContents, spoofedFrame));

    // Then only the actual WebContents mainFrame is authorized
    expect(authorized).toBe(false);
  });

  it('rejects a main frame whose current URL differs from the supplied exact URL', () => {
    // Given the owner WebContents after its main frame navigated elsewhere
    const navigatedContents = { mainFrame: { url: 'file:///C:/ctrl2phone/dist/js/other.html' } };
    mainWindow = { webContents: navigatedContents, isDestroyed: () => false };

    // When the navigated main frame invokes IPC
    const authorized = policy.isMain(createEvent(navigatedContents));

    // Then exact URL equality is required
    expect(authorized).toBe(false);
  });

  it('rejects an allowed URL that is not a local file URL', () => {
    // Given a composition input that attempts to authorize an HTTPS origin
    const remoteContents = { mainFrame: { url: 'https://trusted.example/app' } };
    const remotePolicy = createIpcSenderPolicy({
      getMainWindow: () => ({ webContents: remoteContents, isDestroyed: () => false }),
      getOverlayWindow: () => null,
      getNotificationWindow: () => null,
      mainFrameUrl: remoteContents.mainFrame.url,
      overlayFrameUrl: OVERLAY_URL,
      notificationFrameUrl: NOTIFICATION_URL,
    });

    // When the matching remote main frame invokes IPC
    const authorized = remotePolicy.isMain(createEvent(remoteContents));

    // Then a non-file URL cannot become trusted configuration
    expect(authorized).toBe(false);
  });

  it('rejects destroyed or absent owner windows', () => {
    // Given a destroyed owner window
    mainWindow = { webContents: mainContents, isDestroyed: () => true };

    // When its former main frame invokes IPC
    const destroyedAuthorized = policy.isMain(createEvent(mainContents));
    mainWindow = null;
    const absentAuthorized = policy.isMain(createEvent(mainContents));

    // Then neither stale window state is authorized
    expect(destroyedAuthorized).toBe(false);
    expect(absentAuthorized).toBe(false);
  });
});
