import { createElectronActionTaskMonitor } from '../src/main/electronActionTaskMonitor';

const TASK_ID = '123e4567-e89b-42d3-a456-426614174000';

function taskRow() {
  return {
    id: TASK_ID,
    intent_type: 'general_visual_analysis',
    workflow_status: 'queued',
    progress: 0,
    title: 'Task',
    summary: null,
    result_json: {},
    sources: [],
    confidence: null,
    error_code: null,
    error_message: null,
    version: 0,
    updated_at: '2026-08-07T10:00:00.000Z',
    completed_at: null,
  };
}

describe('Electron action task monitor adapter', () => {
  it('uses an id-filtered public realtime channel and a narrow task query', async () => {
    let realtimeConfig: Record<string, unknown> | undefined;
    let subscribeCallback: ((status: string) => void) | undefined;
    const maybeSingle = jest.fn(async () => ({ data: taskRow(), error: null }));
    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));
    const channelObject = {
      on: jest.fn((_event, config, _callback) => {
        realtimeConfig = config;
        return channelObject;
      }),
      subscribe: jest.fn((callback) => {
        subscribeCallback = callback;
        return channelObject;
      }),
    };
    const client = {
      from,
      channel: jest.fn(() => channelObject),
      removeChannel: jest.fn(async () => 'ok'),
    };
    const context = { client: client as any, url: 'https://project.supabase.co' };
    const publish = jest.fn();
    const monitor = createElectronActionTaskMonitor({
      getContext: () => context,
      isContextCurrent: (candidate) => candidate === context,
      publish,
      warn: jest.fn(),
      error: jest.fn(),
    });

    await expect(monitor.watch(TASK_ID)).resolves.toBe(true);
    subscribeCallback?.('SUBSCRIBED');
    await Promise.resolve();

    expect(from).toHaveBeenCalledWith('action_tasks');
    expect(select).toHaveBeenCalledWith(expect.stringContaining('result_json'));
    expect(eq).toHaveBeenCalledWith('id', TASK_ID);
    expect(realtimeConfig).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'action_tasks',
      filter: `id=eq.${TASK_ID}`,
    });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: TASK_ID, version: 0 }));

    await monitor.stopAndDrain();
    expect(client.removeChannel).toHaveBeenCalledWith(channelObject);
  });
});
