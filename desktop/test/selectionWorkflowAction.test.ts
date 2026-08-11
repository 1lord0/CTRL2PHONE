import {
  executeSelectionWorkflowAction,
  formatActionErrorMessage,
  type SelectionWorkflowActionPorts,
} from '../src/main/selectionWorkflowAction';

const PNG = Buffer.from('png');
const INTENT = {
  intentType: 'general_visual_analysis' as const,
  confidence: 0.8,
  title: 'Genel analiz',
  rationale: 'Genel bir ekran görüntüsü.',
  searchQueries: [],
  visibleText: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createFixture() {
  let sessionCurrent = true;
  let actionCurrent = true;
  const ports: SelectionWorkflowActionPorts<string> = {
    isSelectionSessionCurrent: jest.fn(() => sessionCurrent),
    isActionCurrent: jest.fn(() => actionCurrent),
    beginSelectionAction: jest.fn(() => 5),
    endSelectionAction: jest.fn(),
    resolveSelectionImage: jest.fn(async () => 'image'),
    getImagePngBuffer: jest.fn(() => PNG),
    analyzeIntent: jest.fn(async () => INTENT),
    submitAction: jest.fn(async () => ({ taskId: 'task-1' })),
    hideSelectionOverlay: jest.fn(),
    resetSelectionSession: jest.fn(() => {
      sessionCurrent = false;
    }),
    setStatus: jest.fn(),
    setResponse: jest.fn(),
    activateTransientPill: jest.fn(),
    reportError: jest.fn(),
    reportEvent: jest.fn(),
  };
  return {
    ports,
    closeSession: () => {
      sessionCurrent = false;
      actionCurrent = false;
    },
  };
}

describe('selection workflow action', () => {
  it('captures once, closes the overlay and reports the dispatched task', async () => {
    const fixture = createFixture();

    await expect(executeSelectionWorkflowAction(5, fixture.ports)).resolves.toBe(true);

    expect(fixture.ports.resolveSelectionImage).toHaveBeenCalledTimes(1);
    expect(fixture.ports.analyzeIntent).toHaveBeenCalledWith(PNG);
    expect(fixture.ports.submitAction).toHaveBeenCalledTimes(1);
    expect(fixture.ports.hideSelectionOverlay).toHaveBeenCalledWith(5);
    expect(fixture.ports.setResponse).toHaveBeenCalledWith(expect.stringContaining('task-1'));
    expect(fixture.ports.endSelectionAction).toHaveBeenCalledWith(5);
    expect(fixture.ports.reportEvent).toHaveBeenCalledWith(
      'selection_intent_analyzed',
      expect.objectContaining({
        intentType: 'general_visual_analysis',
        confidence: 0.8,
      })
    );
    expect(fixture.ports.reportEvent).toHaveBeenCalledWith(
      'selection_task_submitted',
      expect.objectContaining({ taskId: 'task-1' })
    );
  });

  it('rejects a duplicate click while the single-flight lock is held', async () => {
    const fixture = createFixture();
    (fixture.ports.beginSelectionAction as jest.Mock).mockReturnValue(null);

    await expect(executeSelectionWorkflowAction(5, fixture.ports)).resolves.toBe(false);

    expect(fixture.ports.resolveSelectionImage).not.toHaveBeenCalled();
    expect(fixture.ports.analyzeIntent).not.toHaveBeenCalled();
    expect(fixture.ports.submitAction).not.toHaveBeenCalled();
  });

  it('does not upload or dispatch when the selection closes during image composition', async () => {
    const fixture = createFixture();
    const image = deferred<string | null>();
    (fixture.ports.resolveSelectionImage as jest.Mock).mockReturnValue(image.promise);
    const pending = executeSelectionWorkflowAction(5, fixture.ports);

    fixture.closeSession();
    image.resolve('image');

    await expect(pending).resolves.toBe(false);
    expect(fixture.ports.submitAction).not.toHaveBeenCalled();
    expect(fixture.ports.setResponse).not.toHaveBeenCalled();
    expect(fixture.ports.endSelectionAction).toHaveBeenCalledWith(5);
  });

  it('suppresses late UI updates after shutdown invalidates an in-flight dispatch', async () => {
    const fixture = createFixture();
    const submission = deferred<{ taskId: string }>();
    const submissionStarted = deferred<void>();
    (fixture.ports.submitAction as jest.Mock).mockImplementation(() => {
      submissionStarted.resolve();
      return submission.promise;
    });
    const pending = executeSelectionWorkflowAction(5, fixture.ports);

    await submissionStarted.promise;
    fixture.closeSession();
    submission.resolve({ taskId: 'late-task' });

    await expect(pending).resolves.toBe(false);
    expect(fixture.ports.setResponse).not.toHaveBeenCalledWith(
      expect.stringContaining('late-task')
    );
    expect(fixture.ports.activateTransientPill).not.toHaveBeenCalled();
  });

  it('formats technical error codes into user-friendly Turkish error messages', () => {
    expect(formatActionErrorMessage(new Error('action_gemini_api_key_missing'))).toContain(
      'Gemini API anahtarı eksik'
    );
    expect(formatActionErrorMessage(new Error('fetch failed'))).toContain(
      'n8n sunucusuna erişilemedi'
    );
    expect(formatActionErrorMessage(new Error('action_input_upload_failed: 403'))).toContain(
      'Supabase Storage sunucusuna yüklenemedi'
    );
    expect(formatActionErrorMessage(new Error('action_task_enqueue_failed'))).toContain(
      'veritabanına eklenemedi'
    );
  });

  it('reports friendly error messages when analyzeIntent fails with missing API key', async () => {
    const fixture = createFixture();
    (fixture.ports.analyzeIntent as jest.Mock).mockRejectedValue(
      new Error('action_gemini_api_key_missing')
    );

    await expect(executeSelectionWorkflowAction(5, fixture.ports)).resolves.toBe(false);

    expect(fixture.ports.setResponse).toHaveBeenCalledWith(
      expect.stringContaining('Gemini API anahtarı eksik')
    );
  });
});
