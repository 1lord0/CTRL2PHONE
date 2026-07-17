"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateSelectionOverlay = activateSelectionOverlay;
async function activateSelectionOverlay(request) {
    // 1. Wait for overlay ready
    await request.waitForReady();
    // 2. Re-verify if current
    if (!request.isCurrent()) {
        throw new Error('Overlay activation cancelled: no longer current after ready');
    }
    // 3. Prepare the render waiter for the session
    request.prepareRenderWaiter(request.sessionId);
    // 4. Set ignore mouse events to true with forward: true (click-through)
    request.windowPort.setIgnoreMouseEvents(true, { forward: true });
    // 5. Set bounds
    request.windowPort.setBounds(request.bounds);
    // 6. Send typed state
    request.windowPort.sendOverlayState({
        visible: true,
        active: true,
        selection: request.selectionRect,
        backgroundImage: request.backgroundImagePath,
        sessionId: request.sessionId,
    });
    // 7. Show window inactive (visible but click-through)
    request.windowPort.showInactive();
    // 8. Wait for renderer-applied confirmation (waiter already prepared)
    await request.waitForRendered(request.sessionId);
    // 9. Re-verify if current
    if (!request.isCurrent()) {
        throw new Error('Overlay activation cancelled: no longer current after rendered');
    }
    // 10. Enable mouse input
    request.windowPort.setIgnoreMouseEvents(false);
}
