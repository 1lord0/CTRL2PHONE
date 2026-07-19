export type SelectionRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SelectionSnapshot<Image, Display> = {
  readonly sessionId: number;
  readonly image: Image;
  readonly rect: SelectionRect;
  readonly display: Display;
  readonly hasAnnotations: boolean;
};

export type SelectionSessionController<Image, Display> = {
  readonly active: boolean;
  readonly starting: boolean;
  readonly hasAnnotations: boolean;
  readonly rect: SelectionRect | null;
  readonly display: Display | null;
  readonly sessionId: number;
  readonly actionInFlightSessionId: number | null;
  readonly dragEnabled: boolean;
  readonly startedAt: number;
  start(now?: number): number | null;
  setDisplay(sessionId: number, display: Display | null): boolean;
  activate(sessionId: number, image: Image): boolean;
  setRect(sessionId: number, rect: SelectionRect | null): boolean;
  setAnnotated(sessionId: number, hasAnnotations: boolean): boolean;
  snapshot(sessionId: number): SelectionSnapshot<Image, Display> | null;
  beginAction(sessionId: number): number | null;
  endAction(actionSessionId: number | null): void;
  isActionCurrent(actionSessionId: number): boolean;
  isCurrent(sessionId: number): boolean;
  finishStarting(sessionId: number): void;
  disableDrag(sessionId: number): void;
  reset(sessionId: number): boolean;
  shutdown(): void;
};

export function createSelectionSessionController<Image, Display>(
  isShuttingDown: () => boolean
): SelectionSessionController<Image, Display> {
  let active = false;
  let starting = false;
  let hasAnnotations = false;
  let rect: SelectionRect | null = null;
  let display: Display | null = null;
  let image: Image | null = null;
  let sessionId = 0;
  let actionInFlightSessionId: number | null = null;
  let dragEnabled = false;
  let startedAt = 0;

  const isCurrent = (candidateSessionId: number): boolean =>
    candidateSessionId === sessionId && !isShuttingDown();

  return {
    get active() {
      return active;
    },
    get starting() {
      return starting;
    },
    get hasAnnotations() {
      return hasAnnotations;
    },
    get rect() {
      return rect;
    },
    get display() {
      return display;
    },
    get sessionId() {
      return sessionId;
    },
    get actionInFlightSessionId() {
      return actionInFlightSessionId;
    },
    get dragEnabled() {
      return dragEnabled;
    },
    get startedAt() {
      return startedAt;
    },
    start(now = Date.now()) {
      if (starting || active || isShuttingDown()) return null;
      starting = true;
      sessionId += 1;
      startedAt = now;
      dragEnabled = true;
      return sessionId;
    },
    setDisplay(candidateSessionId, nextDisplay) {
      if (!isCurrent(candidateSessionId)) return false;
      display = nextDisplay;
      return true;
    },
    activate(candidateSessionId, nextImage) {
      if (!isCurrent(candidateSessionId)) return false;
      image = nextImage;
      active = true;
      rect = null;
      return true;
    },
    setRect(candidateSessionId, nextRect) {
      if (!active || !isCurrent(candidateSessionId)) return false;
      rect = nextRect ? { ...nextRect } : null;
      return true;
    },
    setAnnotated(candidateSessionId, nextHasAnnotations) {
      if (!active || !isCurrent(candidateSessionId)) return false;
      hasAnnotations = nextHasAnnotations;
      return true;
    },
    snapshot(candidateSessionId) {
      if (!active || !image || !rect || !display || !isCurrent(candidateSessionId)) {
        return null;
      }
      return {
        sessionId: candidateSessionId,
        image,
        rect: { ...rect },
        display,
        hasAnnotations,
      };
    },
    beginAction(candidateSessionId) {
      if (!isCurrent(candidateSessionId)) return null;
      actionInFlightSessionId = candidateSessionId;
      return candidateSessionId;
    },
    endAction(candidateSessionId) {
      if (candidateSessionId === actionInFlightSessionId) {
        actionInFlightSessionId = null;
      }
    },
    isActionCurrent(candidateSessionId) {
      return candidateSessionId === actionInFlightSessionId;
    },
    isCurrent,
    finishStarting(candidateSessionId) {
      if (candidateSessionId === sessionId) {
        starting = false;
      }
    },
    disableDrag(candidateSessionId) {
      if (candidateSessionId === sessionId) {
        dragEnabled = false;
      }
    },
    reset(candidateSessionId) {
      if (candidateSessionId !== sessionId) return false;
      active = false;
      dragEnabled = false;
      hasAnnotations = false;
      rect = null;
      display = null;
      image = null;
      return true;
    },
    shutdown() {
      sessionId += 1;
      active = false;
      dragEnabled = false;
      starting = false;
      actionInFlightSessionId = null;
      hasAnnotations = false;
      rect = null;
      display = null;
      image = null;
    },
  };
}
