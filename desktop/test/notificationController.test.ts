import {
  createNotificationController,
  type NotificationWindow,
} from '../src/main/notificationController';

class FixtureWindow implements NotificationWindow {
  readonly messages: Array<{ channel: string; payload?: unknown }> = [];
  readonly webContents = {
    send: (channel: string, payload?: unknown) => this.messages.push({ channel, payload }),
    once: (_event: 'did-finish-load', listener: () => void) => {
      this.readyListener = listener;
    },
  };
  shown = 0;
  hidden = 0;
  destroyed = false;
  private readyListener: (() => void) | null = null;
  private closedListener: (() => void) | null = null;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  show(): void {
    this.shown += 1;
  }

  hide(): void {
    this.hidden += 1;
  }

  setAlwaysOnTop(): void {}

  on(_event: 'closed', listener: () => void): void {
    this.closedListener = listener;
  }

  finishLoading(): void {
    this.readyListener?.();
  }

  close(): void {
    this.destroyed = true;
    this.closedListener?.();
  }
}

describe('notification controller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function createFixture() {
    const windows: FixtureWindow[] = [];
    let shuttingDown = false;
    const controller = createNotificationController<FixtureWindow>({
      isShutdown: () => shuttingDown,
      createWindow: () => {
        const window = new FixtureWindow();
        windows.push(window);
        return window;
      },
      loadWindow: async () => undefined,
      logLoadError: () => undefined,
    });
    return {
      controller,
      windows,
      setShuttingDown: (value: boolean) => {
        shuttingDown = value;
      },
    };
  }

  it('queues the first payload until the renderer is ready and then dismisses it', () => {
    // Given a controller without a notification window
    const fixture = createFixture();

    // When a notification is shown and the renderer finishes loading
    fixture.controller.show('Başlık', 'İçerik', 'sync');
    const window = fixture.windows[0];
    window.finishLoading();

    // Then the payload is displayed, dismissed, and hidden on the original timings
    expect(window.shown).toBe(1);
    expect(window.messages[0]).toEqual({
      channel: 'notification-data',
      payload: { title: 'Başlık', body: 'İçerik', type: 'sync' },
    });
    jest.advanceTimersByTime(3500);
    expect(window.messages[1]).toEqual({ channel: 'notification-dismiss', payload: undefined });
    jest.advanceTimersByTime(500);
    expect(window.hidden).toBe(1);
  });

  it('reuses a ready window and replaces the previous dismissal timer', () => {
    // Given a ready window displaying its first notification
    const fixture = createFixture();
    fixture.controller.show('İlk', 'Bir', 'info');
    const window = fixture.windows[0];
    window.finishLoading();
    jest.advanceTimersByTime(1000);

    // When a second notification is shown
    fixture.controller.show('İkinci', 'İki', 'success');
    jest.advanceTimersByTime(2500);

    // Then the old timer cannot dismiss the replacement notification
    expect(window.messages.filter(message => message.channel === 'notification-dismiss')).toHaveLength(0);
    jest.advanceTimersByTime(1000);
    expect(window.messages.filter(message => message.channel === 'notification-dismiss')).toHaveLength(1);
    expect(fixture.windows).toHaveLength(1);
  });

  it('clears timers and rejects new work during shutdown', () => {
    // Given a visible notification
    const fixture = createFixture();
    fixture.controller.show('Başlık', 'İçerik');
    const window = fixture.windows[0];
    window.finishLoading();

    // When shutdown begins and another notification is requested
    fixture.setShuttingDown(true);
    fixture.controller.shutdown();
    fixture.controller.show('Atlanacak', 'Atlanacak');
    jest.runAllTimers();

    // Then no dismissal or replacement window is produced
    expect(window.messages.filter(message => message.channel === 'notification-dismiss')).toHaveLength(0);
    expect(fixture.windows).toHaveLength(1);
  });
});
