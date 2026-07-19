import {
  createGlobalKeyRouter,
  type GlobalKeyRouterPorts,
} from '../src/main/globalKeyRouter';

describe('GlobalKeyRouter', () => {
  let selectionActive = false;
  let hasRect = false;
  let actionBusy = false;
  let shutdownStarted = false;
  let statusMessages: string[] = [];
  let logMessages: string[] = [];
  let errorMessages: string[] = [];

  // Commands triggered
  let startSessionCalled = false;
  let captureSendCalled = false;
  let captureSupabaseCalled = false;
  let captureOcrCalled = false;
  let clipboardPhoneCalled = false;
  let toggleSpotlightCalled = false;
  let dismissSpotlightCalled = false;
  let cancelSelectionCalled = false;
  let quitAppCalled = false;

  const ports: GlobalKeyRouterPorts = {
    isSelectionActive: () => selectionActive,
    hasSelectionRect: () => hasRect,
    isActionBusy: () => actionBusy,
    isShutdownStarted: () => shutdownStarted,
    setStatus: (msg) => { statusMessages.push(msg); },
    log: (msg) => { logMessages.push(msg); },
    error: (msg) => { errorMessages.push(msg); },
    startSelectionSession: () => { startSessionCalled = true; },
    captureAndSend: () => { captureSendCalled = true; },
    captureAndSendToSupabase: () => { captureSupabaseCalled = true; },
    captureAndOcr: () => { captureOcrCalled = true; },
    sendClipboardToPhone: () => { clipboardPhoneCalled = true; },
    toggleSpotlight: () => { toggleSpotlightCalled = true; },
    dismissSpotlight: () => { dismissSpotlightCalled = true; },
    cancelSelection: () => { cancelSelectionCalled = true; },
    quitApplication: () => { quitAppCalled = true; },
  };

  beforeEach(() => {
    selectionActive = false;
    hasRect = false;
    actionBusy = false;
    shutdownStarted = false;
    statusMessages = [];
    logMessages = [];
    errorMessages = [];
    startSessionCalled = false;
    captureSendCalled = false;
    captureSupabaseCalled = false;
    captureOcrCalled = false;
    clipboardPhoneCalled = false;
    toggleSpotlightCalled = false;
    dismissSpotlightCalled = false;
    cancelSelectionCalled = false;
    quitAppCalled = false;
  });

  it('routes READY and HOOK_FAILED correctly', () => {
    const router = createGlobalKeyRouter(ports);
    
    router.route('READY');
    expect(statusMessages).toContain('Çift Ctrl ile seçim modu hazır');

    router.route('HOOK_FAILED');
    expect(statusMessages).toContain('Klavye kancası takılamadı (Sistem engellemiş olabilir)');
  });

  it('triggers startSelectionSession on DOUBLE_CTRL when inactive', () => {
    const router = createGlobalKeyRouter(ports);
    
    router.route('DOUBLE_CTRL');
    expect(startSessionCalled).toBe(true);

    // If already active, it should be a no-op
    startSessionCalled = false;
    selectionActive = true;
    router.route('DOUBLE_CTRL');
    expect(startSessionCalled).toBe(false);
  });

  it('verifies KEY_X/RETURN actions depend on selection active and rect present states', () => {
    const router = createGlobalKeyRouter(ports);
    
    // Inactive selection: no-op
    router.route('KEY_X');
    expect(captureSendCalled).toBe(false);

    // Active, but no rect
    selectionActive = true;
    router.route('KEY_X');
    expect(captureSendCalled).toBe(false);
    expect(statusMessages).toContain('Önce fareyle bir alan seç.');

    // Active, has rect
    hasRect = true;
    router.route('KEY_X');
    expect(captureSendCalled).toBe(true);
  });

  it('handles action route bindings for KEY_M (Supabase) and KEY_C (OCR)', () => {
    const router = createGlobalKeyRouter(ports);
    selectionActive = true;
    hasRect = true;

    router.route('KEY_M');
    expect(captureSupabaseCalled).toBe(true);

    router.route('KEY_C');
    expect(captureOcrCalled).toBe(true);
  });

  it('routes global hotkeys CTRL_SHIFT_V, CTRL_SHIFT_SPACE, SPOTLIGHT_DISMISS', () => {
    const router = createGlobalKeyRouter(ports);

    router.route('CTRL_SHIFT_V');
    expect(clipboardPhoneCalled).toBe(true);

    router.route('CTRL_SHIFT_SPACE');
    expect(toggleSpotlightCalled).toBe(true);

    router.route('SPOTLIGHT_DISMISS');
    expect(dismissSpotlightCalled).toBe(true);
  });

  it('routes KEY_ESCAPE to cancel selection', () => {
    const router = createGlobalKeyRouter(ports);
    
    // Inactive: no-op
    router.route('KEY_ESCAPE');
    expect(cancelSelectionCalled).toBe(false);

    selectionActive = true;
    router.route('KEY_ESCAPE');
    expect(cancelSelectionCalled).toBe(true);
    expect(statusMessages).toContain('Seçim iptal edildi');
  });

  it('routes KEY_Q to cancel selection and quit application', () => {
    const router = createGlobalKeyRouter(ports);
    
    // Inactive: quitApp is still called
    router.route('KEY_Q');
    expect(cancelSelectionCalled).toBe(false);
    expect(quitAppCalled).toBe(true);

    quitAppCalled = false;
    selectionActive = true;
    router.route('KEY_Q');
    expect(cancelSelectionCalled).toBe(true);
    expect(quitAppCalled).toBe(true);
  });

  it('ignores events when shutdown is started', () => {
    shutdownStarted = true;
    const router = createGlobalKeyRouter(ports);
    
    router.route('DOUBLE_CTRL');
    expect(startSessionCalled).toBe(false);
  });
});
