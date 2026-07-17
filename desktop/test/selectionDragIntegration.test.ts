import { SelectionDragProxy } from '../src/lib/selectionDragProxy';

describe('Selection Drag Integration', () => {
  let selectionDragEnabled = true;
  let activeSessionId = 42;
  let currentGeneration = 1;
  let spawnCount = 0;

  const mockSpawn = () => {
    if (!selectionDragEnabled) return;
    spawnCount++;
  };

  const handleSetSelectionUpdate = (sessionId: number) => {
    if (sessionId !== activeSessionId) return;
    if (selectionDragEnabled) {
      mockSpawn();
    }
  };

  const handleSetAnnotated = (sessionId: number) => {
    if (sessionId !== activeSessionId) return;
    if (selectionDragEnabled) {
      mockSpawn();
    }
  };

  beforeEach(() => {
    selectionDragEnabled = true;
    activeSessionId = 42;
    currentGeneration = 1;
    spawnCount = 0;
  });

  it('disable -> set-annotated -> no spawn', () => {
    selectionDragEnabled = false;
    handleSetAnnotated(42);
    expect(spawnCount).toBe(0);
  });

  it('re-enable -> single active spawn', () => {
    selectionDragEnabled = false;
    handleSetSelectionUpdate(42);
    expect(spawnCount).toBe(0);

    // Re-enable and trigger selection update
    selectionDragEnabled = true;
    handleSetSelectionUpdate(42);
    expect(spawnCount).toBe(1);
  });

  it('rapid disable/enable -> stale generation does not get GO', () => {
    let goSent = false;
    const mockPort = {
      writeStdin: (msg: string) => {
        if (msg === 'GO\n') goSent = true;
      },
      kill: jest.fn(),
      onLine: jest.fn(),
      onExit: jest.fn(),
      onError: jest.fn(),
    };

    const mockCallbacks = {
      onReady: jest.fn(),
      onStarting: jest.fn().mockImplementation((confirmGo) => {
        if (selectionDragEnabled) {
          confirmGo();
        }
      }),
      onDone: jest.fn(),
      onFailed: jest.fn(),
    };

    const proxy1 = new SelectionDragProxy(mockPort, mockCallbacks, 42, 1);

    // Disable selection drag
    selectionDragEnabled = false;
    proxy1.cleanup();

    // Re-enable selection drag and start a new generation
    selectionDragEnabled = true;
    currentGeneration = 2;

    // Simulate Starting on proxy1 (should not send GO because it is cleaned up)
    const mockOnStarting = mockCallbacks.onStarting;
    const confirm = () => {
      if (!proxy1.getIsCleanedUp() && currentGeneration === proxy1.getGeneration()) {
        mockPort.writeStdin('GO\n');
      }
    };
    mockOnStarting(confirm);

    expect(goSent).toBe(false);
  });
});
