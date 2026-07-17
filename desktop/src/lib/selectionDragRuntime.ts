import { Rect } from '../types';

export interface DragRestoreContext {
  sessionId: number;
  generation: number;
  displayBounds: Rect;
  selectionRect: Rect;
  dataUrl: string;
  hasAnnotations: boolean;
}

export interface SelectionDragRuntimePorts {
  isSessionCurrent: (sessionId: number) => boolean;
  isGenerationCurrent: (generation: number) => boolean;
  hideOverlay: (sessionId: number) => void;
  resetSession: (sessionId: number) => void;
  invalidateDragAsset: () => void;
  sendDragState: (sessionId: number, ready: boolean, reason?: string) => void;
  setStatus: (msg: string) => void;
  moveOverlayOffscreen: () => void;
  restoreOverlay: (context: DragRestoreContext) => Promise<void>;
  triggerDragProxySpawn: (sessionId: number) => void;
}

export class SelectionDragRuntime {
  private ports: SelectionDragRuntimePorts;
  private isDragging = false;
  private restoreContext: DragRestoreContext | null = null;

  constructor(ports: SelectionDragRuntimePorts) {
    this.ports = ports;
  }

  public setRestoreContext(context: DragRestoreContext): void {
    this.restoreContext = context;
  }

  public getRestoreContext(): DragRestoreContext | null {
    return this.restoreContext;
  }

  public handleReady(sessionId: number, generation: number): void {
    if (!this.ports.isSessionCurrent(sessionId) || !this.ports.isGenerationCurrent(generation)) {
      return;
    }
    this.ports.sendDragState(sessionId, true);
  }

  public handleStarting(
    sessionId: number,
    generation: number,
    confirmGo: () => void
  ): void {
    if (!this.ports.isSessionCurrent(sessionId) || !this.ports.isGenerationCurrent(generation)) {
      return;
    }
    
    // Move overlay offscreen before writing GO
    this.ports.moveOverlayOffscreen();
    
    confirmGo();
  }

  public handleStarted(sessionId: number, generation: number): void {
    if (!this.ports.isSessionCurrent(sessionId) || !this.ports.isGenerationCurrent(generation)) {
      return;
    }
    this.isDragging = true;
  }

  public handleDone(sessionId: number, generation: number, effect: string): void {
    if (!this.ports.isSessionCurrent(sessionId) || !this.ports.isGenerationCurrent(generation)) {
      return;
    }

    if (effect === 'Copy' || effect === 'Move' || effect === 'Link') {
      this.ports.hideOverlay(sessionId);
      this.ports.resetSession(sessionId);
      this.ports.invalidateDragAsset();
      this.ports.setStatus(`Sürükle-bırak başarıyla tamamlandı: ${effect}`);
      this.isDragging = false;
      this.restoreContext = null;
    } else {
      // Treat other effects (like None, empty) as cancel/aborted
      void this.handleCancelOrFailure(sessionId, generation, 'cancel', 'aborted');
    }
  }

  public async handleCancelOrFailure(
    sessionId: number,
    generation: number,
    type: 'cancel' | 'fail',
    reason?: string
  ): Promise<void> {
    if (!this.ports.isSessionCurrent(sessionId) || !this.ports.isGenerationCurrent(generation)) {
      return;
    }

    this.isDragging = false;
    this.ports.sendDragState(sessionId, false, reason);

    if (this.restoreContext) {
      const context = this.restoreContext;
      this.restoreContext = null; // consume once
      
      this.ports.setStatus(type === 'cancel' ? 'Bırakma iptal edildi' : `Sürükle-bırak başarısız oldu: ${reason}`);
      await this.ports.restoreOverlay(context);
      
      if (type === 'cancel') {
        // Re-prepare new drag proxy for retry if still enabled and cancelled
        this.ports.triggerDragProxySpawn(sessionId);
      }
    } else {
      this.ports.setStatus(`Sürükle-bırak başlatılamadı: ${reason}`);
    }
  }

  public getIsDragging(): boolean {
    return this.isDragging;
  }
}
