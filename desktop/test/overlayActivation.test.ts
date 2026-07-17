import {
  activateSelectionOverlay,
  ActivationRequest,
  OverlayWindowPort,
  OverlayState,
  Rect,
} from '../src/lib/overlayActivation';

describe('activateSelectionOverlay', () => {
  let mockWindowPort: jest.Mocked<OverlayWindowPort>;
  let mockRequest: any;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    mockWindowPort = {
      setIgnoreMouseEvents: jest.fn().mockImplementation((ignore, options) => {
        callOrder.push(`setIgnoreMouseEvents(${ignore}, ${options ? JSON.stringify(options) : ''})`);
      }),
      setBounds: jest.fn().mockImplementation((bounds) => {
        callOrder.push(`setBounds(${JSON.stringify(bounds)})`);
      }),
      sendOverlayState: jest.fn().mockImplementation((state) => {
        callOrder.push(`sendOverlayState(${JSON.stringify(state)})`);
      }),
      showInactive: jest.fn().mockImplementation(() => {
        callOrder.push('showInactive');
      }),
    };

    mockRequest = {
      windowPort: mockWindowPort,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      selectionRect: null,
      backgroundImagePath: 'dummy.png',
      sessionId: 42,
      waitForReady: jest.fn().mockImplementation(() => {
        callOrder.push('waitForReady');
        return Promise.resolve();
      }),
      prepareRenderWaiter: jest.fn().mockImplementation((sessId) => {
        callOrder.push(`prepareRenderWaiter(${sessId})`);
      }),
      waitForRendered: jest.fn().mockImplementation((sessId) => {
        callOrder.push(`waitForRendered(${sessId})`);
        return Promise.resolve();
      }),
      isCurrent: jest.fn().mockImplementation(() => {
        callOrder.push('isCurrent');
        return true;
      }),
    };
  });

  it('does not trigger any window actions before ready resolves', async () => {
    let resolveReady: any;
    mockRequest.waitForReady = jest.fn().mockImplementation(() => {
      callOrder.push('waitForReady');
      return new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    });

    const activationPromise = activateSelectionOverlay(mockRequest);

    // Give it a microtask tick
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOrder).toEqual(['waitForReady']);
    expect(mockWindowPort.setBounds).not.toHaveBeenCalled();
    expect(mockWindowPort.sendOverlayState).not.toHaveBeenCalled();
    expect(mockWindowPort.showInactive).not.toHaveBeenCalled();
    expect(mockWindowPort.setIgnoreMouseEvents).not.toHaveBeenCalled();

    resolveReady();
    await activationPromise;
  });

  it('runs activation sequence in correct order after ready resolves', async () => {
    await activateSelectionOverlay(mockRequest);

    expect(callOrder).toEqual([
      'waitForReady',
      'isCurrent',
      'prepareRenderWaiter(42)',
      'setIgnoreMouseEvents(true, {"forward":true})',
      'setBounds({"x":0,"y":0,"width":1920,"height":1080})',
      'sendOverlayState({"visible":true,"active":true,"selection":null,"backgroundImage":"dummy.png","sessionId":42})',
      'showInactive',
      'waitForRendered(42)',
      'isCurrent',
      'setIgnoreMouseEvents(false, )',
    ]);
  });

  it('does not enable mouse if request becomes stale (not current) after ready resolves', async () => {
    mockRequest.isCurrent = jest.fn().mockImplementation(() => {
      callOrder.push('isCurrent');
      return false; // false immediately on the first check
    });

    await expect(activateSelectionOverlay(mockRequest)).rejects.toThrow(
      'Overlay activation cancelled: no longer current after ready'
    );

    expect(callOrder).toEqual(['waitForReady', 'isCurrent']);
    expect(mockWindowPort.setBounds).not.toHaveBeenCalled();
    expect(mockWindowPort.setIgnoreMouseEvents).not.toHaveBeenCalled();
  });

  it('does not enable mouse if request becomes stale (not current) after rendered resolves', async () => {
    let isCurrentCallCount = 0;
    mockRequest.isCurrent = jest.fn().mockImplementation(() => {
      callOrder.push('isCurrent');
      isCurrentCallCount++;
      // First isCurrent: true (after ready)
      // Second isCurrent: false (after rendered)
      return isCurrentCallCount === 1;
    });

    await expect(activateSelectionOverlay(mockRequest)).rejects.toThrow(
      'Overlay activation cancelled: no longer current after rendered'
    );

    expect(callOrder).toEqual([
      'waitForReady',
      'isCurrent',
      'prepareRenderWaiter(42)',
      'setIgnoreMouseEvents(true, {"forward":true})',
      'setBounds({"x":0,"y":0,"width":1920,"height":1080})',
      'sendOverlayState({"visible":true,"active":true,"selection":null,"backgroundImage":"dummy.png","sessionId":42})',
      'showInactive',
      'waitForRendered(42)',
      'isCurrent',
    ]);
    expect(mockWindowPort.setIgnoreMouseEvents).not.toHaveBeenCalledWith(false);
  });

  it('fails activation if ready promise rejects', async () => {
    mockRequest.waitForReady = jest.fn().mockImplementation(() => {
      callOrder.push('waitForReady');
      return Promise.reject(new Error('Ready Timeout'));
    });

    await expect(activateSelectionOverlay(mockRequest)).rejects.toThrow('Ready Timeout');

    expect(callOrder).toEqual(['waitForReady']);
    expect(mockWindowPort.setBounds).not.toHaveBeenCalled();
    expect(mockWindowPort.setIgnoreMouseEvents).not.toHaveBeenCalled();
  });

  it('fails activation if rendered promise rejects', async () => {
    mockRequest.waitForRendered = jest.fn().mockImplementation((sessId) => {
      callOrder.push(`waitForRendered(${sessId})`);
      return Promise.reject(new Error('Render Timeout'));
    });

    await expect(activateSelectionOverlay(mockRequest)).rejects.toThrow('Render Timeout');

    expect(callOrder).toEqual([
      'waitForReady',
      'isCurrent',
      'prepareRenderWaiter(42)',
      'setIgnoreMouseEvents(true, {"forward":true})',
      'setBounds({"x":0,"y":0,"width":1920,"height":1080})',
      'sendOverlayState({"visible":true,"active":true,"selection":null,"backgroundImage":"dummy.png","sessionId":42})',
      'showInactive',
      'waitForRendered(42)',
    ]);
    expect(mockWindowPort.setIgnoreMouseEvents).not.toHaveBeenCalledWith(false);
  });
});
