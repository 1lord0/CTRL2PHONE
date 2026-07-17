import {
  createGeminiWindowController,
  type GeminiWindow,
} from '../src/main/geminiWindowController';

class FixtureGeminiWindow implements GeminiWindow {
  readonly scripts: string[] = [];
  readonly inputEvents: unknown[] = [];
  readonly webContents = {
    getURL: () => this.url,
    executeJavaScript: async (script: string) => {
      this.scripts.push(script);
      return this.focusResult;
    },
    sendInputEvent: (event: unknown) => this.inputEvents.push(event),
  };
  destroyed = false;
  shown = 0;
  focused = 0;
  hidden = 0;
  url = '';
  focusResult = true;
  private closeListener: ((event: { preventDefault: () => void }) => void) | null = null;
  private closedListener: (() => void) | null = null;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  async loadURL(url: string): Promise<void> {
    this.url = url;
  }

  show(): void {
    this.shown += 1;
  }

  hide(): void {
    this.hidden += 1;
  }

  focus(): void {
    this.focused += 1;
  }

  onClose(listener: (event: { preventDefault: () => void }) => void): void {
    this.closeListener = listener;
  }

  onClosed(listener: () => void): void {
    this.closedListener = listener;
  }

  requestClose(): boolean {
    let prevented = false;
    this.closeListener?.({ preventDefault: () => (prevented = true) });
    return prevented;
  }

  closePermanently(): void {
    this.destroyed = true;
    this.closedListener?.();
  }
}

describe('Gemini window controller', () => {
  function createFixture() {
    const windows: FixtureGeminiWindow[] = [];
    let shuttingDown = false;
    const controller = createGeminiWindowController<FixtureGeminiWindow>({
      url: 'https://gemini.google.com/app',
      isShutdown: () => shuttingDown,
      createWindow: () => {
        const window = new FixtureGeminiWindow();
        windows.push(window);
        return window;
      },
    });
    return {
      controller,
      windows,
      setShuttingDown: (value: boolean) => {
        shuttingDown = value;
      },
    };
  }

  it('creates and lazily loads one reusable Gemini window', async () => {
    // Given a controller without an existing Gemini window
    const fixture = createFixture();

    // When Gemini is opened twice
    const first = await fixture.controller.open();
    const second = await fixture.controller.open();

    // Then the same loaded window is shown and focused both times
    expect(second).toBe(first);
    expect(fixture.windows).toHaveLength(1);
    expect(first.url).toBe('https://gemini.google.com/app');
    expect(first.shown).toBe(2);
    expect(first.focused).toBe(2);
  });

  it('hides a close request during normal operation but allows shutdown', () => {
    // Given an active Gemini window
    const fixture = createFixture();
    const windowPromise = fixture.controller.ensureLoaded();
    const window = fixture.windows[0];

    // When close is requested before and during shutdown
    const normalPrevented = window.requestClose();
    fixture.setShuttingDown(true);
    const shutdownPrevented = window.requestClose();

    // Then only the normal close is converted into a hide
    expect(windowPromise).resolves.toBe(window);
    expect(normalPrevented).toBe(true);
    expect(shutdownPrevented).toBe(false);
    expect(window.hidden).toBe(1);
  });

  it('focuses the composer with an escaped prompt and emits the paste shortcut', async () => {
    // Given a loaded Gemini window and a prompt containing quotes
    const fixture = createFixture();
    const window = await fixture.controller.ensureLoaded();

    // When composer focus and paste are requested
    const focused = await fixture.controller.focusComposer(window, 'alıntı "metin"');
    fixture.controller.sendPasteShortcut(window);

    // Then the prompt is safely embedded and Ctrl+V key events are sent
    expect(focused).toBe(true);
    expect(window.scripts[0]).toContain(JSON.stringify('alıntı "metin"'));
    expect(window.inputEvents).toHaveLength(2);
  });
});
