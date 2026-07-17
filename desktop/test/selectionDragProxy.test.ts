import {
  SelectionDragProxy,
  ChildProcessPort,
  DragProxyCallbacks,
} from '../src/lib/selectionDragProxy';

describe('SelectionDragProxy', () => {
  let mockProcessPort: ChildProcessPort & {
    writeStdin: jest.Mock;
    kill: jest.Mock;
    onLine: jest.Mock;
    onExit: jest.Mock;
    onError: jest.Mock;
  };
  let mockCallbacks: DragProxyCallbacks & {
    onReady: jest.Mock;
    onStarting: jest.Mock;
    onStarted: jest.Mock;
    onDone: jest.Mock;
    onFailed: jest.Mock;
  };
  let lineCallback: (line: string) => void;
  let exitCallback: (code: number | null, signal: string | null) => void;
  let errorCallback: (err: Error) => void;

  beforeEach(() => {
    jest.useFakeTimers();

    mockProcessPort = {
      writeStdin: jest.fn(),
      kill: jest.fn(),
      onLine: jest.fn().mockImplementation((cb) => {
        lineCallback = cb;
      }),
      onExit: jest.fn().mockImplementation((cb) => {
        exitCallback = cb;
      }),
      onError: jest.fn().mockImplementation((cb) => {
        errorCallback = cb;
      }),
    };

    mockCallbacks = {
      onReady: jest.fn(),
      onStarting: jest.fn(),
      onStarted: jest.fn(),
      onDone: jest.fn(),
      onFailed: jest.fn(),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets up 3-second ready timeout and fires onFailed if timeout occurs', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    expect(proxy.getIsReady()).toBe(false);
    expect(proxy.getIsCleanedUp()).toBe(false);

    // Fast-forward 3 seconds
    jest.advanceTimersByTime(3000);

    expect(proxy.getIsCleanedUp()).toBe(true);
    expect(mockProcessPort.kill).toHaveBeenCalled();
    expect(mockCallbacks.onFailed).toHaveBeenCalledWith('READY_TIMEOUT');
  });

  it('transitions to ready state on receiving READY stdout line and clears timeout', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');

    expect(proxy.getIsReady()).toBe(true);
    expect(mockCallbacks.onReady).toHaveBeenCalled();

    // Fast-forward 3 seconds, should NOT trigger timeout
    jest.advanceTimersByTime(3000);
    expect(proxy.getIsCleanedUp()).toBe(false);
    expect(mockCallbacks.onFailed).not.toHaveBeenCalled();
  });

  it('triggers onStarting and writes GO to stdin only when callback confirms', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');

    let confirmGoCallback: () => void = () => {};
    mockCallbacks.onStarting.mockImplementation((cb) => {
      confirmGoCallback = cb;
    });

    lineCallback('STARTING');

    expect(mockCallbacks.onStarting).toHaveBeenCalled();
    expect(mockProcessPort.writeStdin).not.toHaveBeenCalled();

    // Now invoke the confirm callback
    confirmGoCallback();

    expect(mockProcessPort.writeStdin).toHaveBeenCalledWith('GO\n');
  });

  it('does not write GO to stdin if proxy was cleaned up before callback confirms', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');

    let confirmGoCallback: () => void = () => {};
    mockCallbacks.onStarting.mockImplementation((cb) => {
      confirmGoCallback = cb;
    });

    lineCallback('STARTING');

    proxy.cleanup();

    confirmGoCallback();

    expect(mockProcessPort.writeStdin).not.toHaveBeenCalled();
  });

  it('transitions to done state on receiving DONE:Copy', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');
    lineCallback('DONE:Copy');

    expect(proxy.getIsCleanedUp()).toBe(true);
    expect(mockProcessPort.kill).toHaveBeenCalled();
    expect(mockCallbacks.onDone).toHaveBeenCalledWith('Copy');
  });

  it('transitions to failed state on receiving FAILED:SomeError', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');
    lineCallback('FAILED:SomeError');

    expect(proxy.getIsCleanedUp()).toBe(true);
    expect(mockProcessPort.kill).toHaveBeenCalled();
    expect(mockCallbacks.onFailed).toHaveBeenCalledWith('SomeError');
  });

  it('transitions to failed state on process exit', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    exitCallback(1, null);

    expect(proxy.getIsCleanedUp()).toBe(true);
    expect(mockCallbacks.onFailed).toHaveBeenCalledWith('EXIT_CODE_1');
  });

  it('transitions to failed state on process error', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    errorCallback(new Error('Spawn Failed'));

    expect(proxy.getIsCleanedUp()).toBe(true);
    expect(mockCallbacks.onFailed).toHaveBeenCalledWith('PROCESS_ERROR_Spawn Failed');
  });

  // Additional protocol compliance tests
  it('ignores duplicate STARTING event and only writes GO once', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');

    let confirmGoCallback: () => void = () => {};
    mockCallbacks.onStarting.mockImplementation((cb) => {
      confirmGoCallback = cb;
    });

    lineCallback('STARTING');
    lineCallback('STARTING'); // Duplicate

    confirmGoCallback();

    expect(mockCallbacks.onStarting).toHaveBeenCalledTimes(1);
    expect(mockProcessPort.writeStdin).toHaveBeenCalledTimes(1);
  });

  it('triggers onStarted on STARTED event after STARTING', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');
    lineCallback('STARTING');
    lineCallback('STARTED');

    expect(mockCallbacks.onStarted).toHaveBeenCalled();
  });

  it('normalizes DONE:None as a valid effect and ignores duplicate terminal events', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');
    lineCallback('DONE:None');
    lineCallback('FAILED:SubsequentFail'); // Should be ignored

    expect(proxy.getIsCleanedUp()).toBe(true);
    expect(mockCallbacks.onDone).toHaveBeenCalledWith('None');
    expect(mockCallbacks.onFailed).not.toHaveBeenCalled();
  });

  it('rejects unknown effects in DONE and reports as failed', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');
    lineCallback('DONE:InvalidEffect');

    expect(proxy.getIsCleanedUp()).toBe(true);
    expect(mockCallbacks.onFailed).toHaveBeenCalledWith('UNKNOWN_EFFECT_InvalidEffect');
    expect(mockCallbacks.onDone).not.toHaveBeenCalled();
  });

  it('ignores exit callback after successful DONE cleanup', () => {
    const proxy = new SelectionDragProxy(
      mockProcessPort,
      mockCallbacks,
      42,
      1
    );

    lineCallback('READY');
    lineCallback('DONE:Copy');
    
    // Simulate process exiting after cleanup
    exitCallback(0, null);

    expect(mockCallbacks.onDone).toHaveBeenCalledWith('Copy');
    expect(mockCallbacks.onFailed).not.toHaveBeenCalled();
  });
});
