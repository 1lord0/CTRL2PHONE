import {
  createActionTaskMonitor,
  parseActionTaskRow,
  type ActionTaskMonitorPorts,
} from '../src/main/actionTaskMonitor';

const TASK_A = '123e4567-e89b-42d3-a456-426614174000';
const TASK_B = '223e4567-e89b-42d3-a456-426614174000';

function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: TASK_A,
    intent_type: 'general_visual_analysis',
    workflow_status: 'queued',
    progress: 0,
    title: 'Action task',
    summary: null,
    result_json: {},
    sources: [],
    confidence: null,
    error_code: null,
    error_message: null,
    version: 0,
    updated_at: '2026-08-07T10:00:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createFixture() {
  const context = { id: 1 };
  let current = true;
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const subscriptions: Array<{
    taskId: string;
    onRow: (value: unknown) => void;
    onSubscribed: () => void;
    onError: (message: string) => void;
  }> = [];
  const ports: ActionTaskMonitorPorts<typeof context, number, number> = {
    getContext: jest.fn(() => context),
    isContextCurrent: jest.fn(() => current),
    fetchTask: jest.fn(async (_context, taskId) => ({
      row: row({ id: taskId }),
      error: null,
    })),
    subscribe: jest.fn((_context, taskId, onRow, onSubscribed, onError) => {
      subscriptions.push({ taskId, onRow, onSubscribed, onError });
      return subscriptions.length;
    }),
    removeSubscription: jest.fn(async () => undefined),
    publish: jest.fn(),
    setInterval: jest.fn((callback) => {
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    }),
    clearInterval: jest.fn((timer) => {
      timers.delete(timer);
    }),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    ports,
    subscriptions,
    timers,
    invalidate: () => {
      current = false;
    },
  };
}

describe('action task row parser', () => {
  it('normalizes a valid completed task for the renderer boundary', () => {
    const parsed = parseActionTaskRow(
      row({
        workflow_status: 'completed',
        progress: 100,
        summary: 'Done',
        result_json: { keyFindings: ['One'] },
        sources: [{ title: 'Source', url: 'https://example.com/path' }],
        confidence: '0.875',
        version: 2,
        completed_at: '2026-08-07T10:01:00.000Z',
      })
    );

    expect(parsed).toMatchObject({
      id: TASK_A,
      workflowStatus: 'completed',
      progress: 100,
      confidence: 0.875,
      version: 2,
    });
    expect(parsed.sources).toEqual([{ title: 'Source', url: 'https://example.com/path' }]);
  });

  it('rejects oversized or unsafe task data before IPC publication', () => {
    expect(() => parseActionTaskRow(row({ progress: 101 }))).toThrow('action_task_row_invalid');
    expect(() =>
      parseActionTaskRow(row({ sources: [{ title: 'bad', url: 'javascript:alert(1)' }] }))
    ).toThrow('action_task_row_invalid');
    expect(() => parseActionTaskRow(row({ result_json: { text: 'x'.repeat(100_001) } }))).toThrow(
      'action_task_result_too_large'
    );
  });
});

describe('action task monitor', () => {
  it('subscribes before fetching and ignores a late lower-version poll result', async () => {
    const fixture = createFixture();
    const initial = deferred<{ row: unknown; error: null }>();
    (fixture.ports.fetchTask as jest.Mock).mockReturnValueOnce(initial.promise);
    const monitor = createActionTaskMonitor(fixture.ports);
    const watching = monitor.watch(TASK_A);

    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.subscriptions).toHaveLength(1);
    fixture.subscriptions[0].onRow(row({ workflow_status: 'analyzing', progress: 10, version: 1 }));
    initial.resolve({ row: row({ version: 0 }), error: null });

    await expect(watching).resolves.toBe(true);
    expect(fixture.ports.publish).toHaveBeenCalledTimes(1);
    expect(fixture.ports.publish).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1, workflowStatus: 'analyzing' })
    );
  });

  it('tears down realtime and polling as soon as a terminal result arrives', async () => {
    const fixture = createFixture();
    const monitor = createActionTaskMonitor(fixture.ports);
    await monitor.watch(TASK_A);

    fixture.subscriptions[0].onRow(
      row({ workflow_status: 'completed', progress: 100, version: 1 })
    );
    await Promise.resolve();

    expect(fixture.ports.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ workflowStatus: 'completed' })
    );
    expect(fixture.ports.clearInterval).toHaveBeenCalledTimes(1);
    expect(fixture.ports.removeSubscription).toHaveBeenCalledTimes(1);
    expect(fixture.timers.size).toBe(0);
  });

  it('prevents an older task from overwriting a newer watch', async () => {
    const fixture = createFixture();
    const firstFetch = deferred<{ row: unknown; error: null }>();
    (fixture.ports.fetchTask as jest.Mock)
      .mockReturnValueOnce(firstFetch.promise)
      .mockResolvedValueOnce({ row: row({ id: TASK_B }), error: null });
    const monitor = createActionTaskMonitor(fixture.ports);

    const first = monitor.watch(TASK_A);
    await Promise.resolve();
    await Promise.resolve();
    const second = monitor.watch(TASK_B);
    fixture.subscriptions[0].onRow(row({ version: 1 }));
    firstFetch.resolve({ row: row({ version: 0 }), error: null });

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(fixture.ports.publish).toHaveBeenCalledTimes(1);
    expect(fixture.ports.publish).toHaveBeenCalledWith(expect.objectContaining({ id: TASK_B }));
  });

  it('drains subscriptions and rejects invalid task IDs', async () => {
    const fixture = createFixture();
    const monitor = createActionTaskMonitor(fixture.ports);
    await expect(monitor.watch('not-a-uuid')).rejects.toThrow('action_task_id_invalid');
    await monitor.watch(TASK_A);
    fixture.invalidate();
    await monitor.stopAndDrain();
    expect(fixture.ports.removeSubscription).toHaveBeenCalledTimes(1);
  });
});
