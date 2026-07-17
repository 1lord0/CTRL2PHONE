import {
  SelectionDragRuntime,
  SelectionDragRuntimePorts,
  DragRestoreContext,
} from '../src/lib/selectionDragRuntime';

describe('SelectionDragRuntime', () => {
  let mockPorts: {
    isSessionCurrent: jest.Mock;
    isGenerationCurrent: jest.Mock;
    hideOverlay: jest.Mock;
    resetSession: jest.Mock;
    invalidateDragAsset: jest.Mock;
    sendDragState: jest.Mock;
    setStatus: jest.Mock;
    moveOverlayOffscreen: jest.Mock;
    restoreOverlay: jest.Mock;
    triggerDragProxySpawn: jest.Mock;
  };
  let runtime: SelectionDragRuntime;
  let restoreCtx: DragRestoreContext;

  beforeEach(() => {
    mockPorts = {
      isSessionCurrent: jest.fn().mockReturnValue(true),
      isGenerationCurrent: jest.fn().mockReturnValue(true),
      hideOverlay: jest.fn(),
      resetSession: jest.fn(),
      invalidateDragAsset: jest.fn(),
      sendDragState: jest.fn(),
      setStatus: jest.fn(),
      moveOverlayOffscreen: jest.fn(),
      restoreOverlay: jest.fn().mockResolvedValue(undefined),
      triggerDragProxySpawn: jest.fn(),
    };

    runtime = new SelectionDragRuntime(mockPorts);

    restoreCtx = {
      sessionId: 42,
      generation: 1,
      displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      selectionRect: { x: 100, y: 100, width: 200, height: 200 },
      dataUrl: 'data:image/png;base64,dummy',
      hasAnnotations: false,
    };
  });

  it('handleReady: sends ready state if session/generation is current', () => {
    runtime.handleReady(42, 1);
    expect(mockPorts.sendDragState).toHaveBeenCalledWith(42, true);
  });

  it('handleReady: ignores if session/generation is stale', () => {
    mockPorts.isGenerationCurrent.mockReturnValue(false);
    runtime.handleReady(42, 1);
    expect(mockPorts.sendDragState).not.toHaveBeenCalled();
  });

  it('handleStarting: moves overlay offscreen and confirms GO', () => {
    const confirmGo = jest.fn();
    runtime.handleStarting(42, 1, confirmGo);

    expect(mockPorts.moveOverlayOffscreen).toHaveBeenCalled();
    expect(confirmGo).toHaveBeenCalled();
  });

  it('handleStarted: marks isDragging as true', () => {
    runtime.handleStarted(42, 1);
    expect(runtime.getIsDragging()).toBe(true);
  });

  it('handleDone (Copy): cleans up and resets session', () => {
    runtime.setRestoreContext(restoreCtx);
    runtime.handleStarted(42, 1);

    runtime.handleDone(42, 1, 'Copy');

    expect(mockPorts.hideOverlay).toHaveBeenCalledWith(42);
    expect(mockPorts.resetSession).toHaveBeenCalledWith(42);
    expect(mockPorts.invalidateDragAsset).toHaveBeenCalled();
    expect(mockPorts.setStatus).toHaveBeenCalledWith('Sürükle-bırak başarıyla tamamlandı: Copy');
    expect(runtime.getIsDragging()).toBe(false);
    expect(runtime.getRestoreContext()).toBeNull();
  });

  it('handleDone (None): cancels drag and restores overlay for retry', async () => {
    runtime.setRestoreContext(restoreCtx);
    runtime.handleStarted(42, 1);

    await runtime.handleDone(42, 1, 'None');

    expect(mockPorts.hideOverlay).not.toHaveBeenCalled();
    expect(mockPorts.resetSession).not.toHaveBeenCalled();
    expect(mockPorts.setStatus).toHaveBeenCalledWith('Bırakma iptal edildi');
    expect(mockPorts.restoreOverlay).toHaveBeenCalledWith(restoreCtx);
    expect(mockPorts.triggerDragProxySpawn).toHaveBeenCalledWith(42);
    expect(runtime.getIsDragging()).toBe(false);
    expect(runtime.getRestoreContext()).toBeNull();
  });

  it('handleCancelOrFailure (fail after offscreen): restores overlay but does not respawn proxy', async () => {
    runtime.setRestoreContext(restoreCtx);
    runtime.handleStarted(42, 1);

    await runtime.handleCancelOrFailure(42, 1, 'fail', 'helper exited');

    expect(mockPorts.restoreOverlay).toHaveBeenCalledWith(restoreCtx);
    expect(mockPorts.setStatus).toHaveBeenCalledWith('Sürükle-bırak başarısız oldu: helper exited');
    expect(mockPorts.triggerDragProxySpawn).not.toHaveBeenCalled();
  });

  it('handleCancelOrFailure (fail before offscreen): only sets status', async () => {
    // No restore context set
    await runtime.handleCancelOrFailure(42, 1, 'fail', 'timeout');

    expect(mockPorts.restoreOverlay).not.toHaveBeenCalled();
    expect(mockPorts.setStatus).toHaveBeenCalledWith('Sürükle-bırak başlatılamadı: timeout');
  });

  it('ignores stale DONE / FAILED calls', async () => {
    mockPorts.isSessionCurrent.mockReturnValue(false);
    runtime.handleDone(42, 1, 'Copy');
    expect(mockPorts.hideOverlay).not.toHaveBeenCalled();

    mockPorts.isSessionCurrent.mockReturnValue(true);
    mockPorts.isGenerationCurrent.mockReturnValue(false);
    await runtime.handleCancelOrFailure(42, 1, 'fail', 'stale');
    expect(mockPorts.setStatus).not.toHaveBeenCalled();
  });
});
