import { executeSelectionAiAction, type SelectionAiActionPorts } from '../src/main/selectionAiAction';

describe('SelectionAiAction', () => {
  let isCurrent = true;
  let isAction = true;
  let apiConfigured = false;
  let resolvedImage: string | null = 'mock-image';
  
  // Triggers
  let hiddenOverlay = false;
  let resetSession = false;
  let clipboardImage: string | null = null;
  let statusMsg = '';
  let responseMsg = '';
  let transientPillActivated = false;
  let analyzeCalled = false;
  let openGeminiCalled = false;
  let focusComposerCalled = false;
  let pasteShortcutSent = false;
  
  const ports: SelectionAiActionPorts<string> = {
    isSelectionSessionCurrent: () => isCurrent,
    isActionCurrent: () => isAction,
    beginSelectionAction: () => 100,
    endSelectionAction: () => {},
    writeImageToClipboard: (img) => { clipboardImage = img; },
    isApiProviderConfigured: () => apiConfigured,
    getPrompt: () => 'Test Prompt',
    hideSelectionOverlay: () => { hiddenOverlay = true; },
    resetSelectionSession: () => { resetSession = true; },
    setStatus: (msg) => { statusMsg = msg; },
    setResponse: (msg) => { responseMsg = msg; },
    activateTransientPill: () => { transientPillActivated = true; },
    analyzeImage: async () => {
      analyzeCalled = true;
      return 'API response';
    },
    getAiProviderName: () => 'gemini-custom',
    openGeminiWindow: async () => {
      openGeminiCalled = true;
      return {};
    },
    focusComposer: async () => {
      focusComposerCalled = true;
      return true;
    },
    sendPasteShortcut: () => { pasteShortcutSent = true; },
    resolveSelectionImage: async () => resolvedImage,
  };

  beforeEach(() => {
    isCurrent = true;
    isAction = true;
    apiConfigured = false;
    resolvedImage = 'mock-image';
    hiddenOverlay = false;
    resetSession = false;
    clipboardImage = null;
    statusMsg = '';
    responseMsg = '';
    transientPillActivated = false;
    analyzeCalled = false;
    openGeminiCalled = false;
    focusComposerCalled = false;
    pasteShortcutSent = false;
  });

  it('runs Gemini Web path when API is not configured', async () => {
    await executeSelectionAiAction(1, ports);

    expect(clipboardImage).toBe('mock-image');
    expect(openGeminiCalled).toBe(true);
    expect(focusComposerCalled).toBe(true);
    expect(pasteShortcutSent).toBe(true);
    expect(statusMsg).toBe("Seçilen görsel Gemini web'e yapıştırıldı");
  });

  it('runs API analysis path when configured', async () => {
    apiConfigured = true;
    await executeSelectionAiAction(1, ports);

    expect(clipboardImage).toBe('mock-image');
    expect(analyzeCalled).toBe(true);
    expect(responseMsg).toBe('API response');
    expect(statusMsg).toBe('Yanıt alındı (gemini-custom)');
  });

  it('aborts on stale session', async () => {
    isCurrent = false;
    await executeSelectionAiAction(1, ports);

    expect(clipboardImage).toBeNull();
    expect(openGeminiCalled).toBe(false);
  });
});
