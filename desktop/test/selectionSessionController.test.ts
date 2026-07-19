import { createSelectionSessionController } from '../src/main/selectionSessionController';

type TestImage = { readonly name: string };
type TestDisplay = { readonly id: number };

describe('selection session controller', () => {
  function createFixture() {
    let shuttingDown = false;
    const controller = createSelectionSessionController<TestImage, TestDisplay>(
      () => shuttingDown
    );
    return {
      controller,
      shutDownApplication: () => {
        shuttingDown = true;
      },
    };
  }

  it('starts one session at a time and increments the id after reset', () => {
    // Given an idle selection controller
    const { controller } = createFixture();

    // When a session starts and another start is attempted
    const firstSessionId = controller.start(100);
    const duplicateSessionId = controller.start(200);

    // Then only the first session starts with drag support enabled
    expect(firstSessionId).toBe(1);
    expect(duplicateSessionId).toBeNull();
    expect(controller.starting).toBe(true);
    expect(controller.dragEnabled).toBe(true);
    expect(controller.startedAt).toBe(100);

    controller.reset(firstSessionId ?? 0);
    controller.finishStarting(firstSessionId ?? 0);
    expect(controller.start(300)).toBe(2);
  });

  it('exposes a complete snapshot only for the active current session', () => {
    // Given a started session with its display, image, rectangle, and annotation state
    const { controller } = createFixture();
    const sessionId = controller.start() ?? 0;
    const image = { name: 'capture' };
    const display = { id: 7 };
    controller.setDisplay(sessionId, display);
    controller.activate(sessionId, image);
    controller.setRect(sessionId, { x: 1, y: 2, width: 30, height: 40 });
    controller.setAnnotated(sessionId, true);

    // When the active session snapshot is requested
    const snapshot = controller.snapshot(sessionId);

    // Then it contains the immutable selection inputs and rejects stale ids
    expect(snapshot).toEqual({
      sessionId,
      image,
      rect: { x: 1, y: 2, width: 30, height: 40 },
      display,
      hasAnnotations: true,
    });
    expect(controller.snapshot(sessionId + 1)).toBeNull();
  });

  it('guards action completion independently from resetting the visible selection', () => {
    // Given an active current selection
    const { controller } = createFixture();
    const sessionId = controller.start() ?? 0;
    controller.setDisplay(sessionId, { id: 1 });
    controller.activate(sessionId, { name: 'capture' });

    // When an asynchronous action starts and the visible selection resets
    const actionSessionId = controller.beginAction(sessionId);
    controller.reset(sessionId);

    // Then the action remains current until it explicitly ends
    expect(actionSessionId).toBe(sessionId);
    expect(controller.isActionCurrent(sessionId)).toBe(true);
    controller.endAction(actionSessionId);
    expect(controller.isActionCurrent(sessionId)).toBe(false);
  });

  it('invalidates current work when application shutdown begins', () => {
    // Given an active selection and action
    const fixture = createFixture();
    const sessionId = fixture.controller.start() ?? 0;
    fixture.controller.setDisplay(sessionId, { id: 1 });
    fixture.controller.activate(sessionId, { name: 'capture' });
    fixture.controller.beginAction(sessionId);

    // When shutdown is reported and the controller is shut down
    fixture.shutDownApplication();
    fixture.controller.shutdown();

    // Then the old session and action cannot update application state
    expect(fixture.controller.isCurrent(sessionId)).toBe(false);
    expect(fixture.controller.isActionCurrent(sessionId)).toBe(false);
    expect(fixture.controller.active).toBe(false);
    expect(fixture.controller.starting).toBe(false);
  });
});
