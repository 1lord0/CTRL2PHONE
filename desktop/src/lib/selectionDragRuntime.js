"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelectionDragRuntime = void 0;
class SelectionDragRuntime {
    ports;
    isDragging = false;
    restoreContext = null;
    constructor(ports) {
        this.ports = ports;
    }
    setRestoreContext(context) {
        this.restoreContext = context;
    }
    getRestoreContext() {
        return this.restoreContext;
    }
    handleReady(sessionId, generation) {
        if (!this.ports.isSessionCurrent(sessionId) || !this.ports.isGenerationCurrent(generation)) {
            return;
        }
        this.ports.sendDragState(sessionId, true);
    }
    handleStarting(sessionId, generation, confirmGo) {
        if (!this.ports.isSessionCurrent(sessionId) || !this.ports.isGenerationCurrent(generation)) {
            return;
        }
        // Move overlay offscreen before writing GO
        this.ports.moveOverlayOffscreen();
        confirmGo();
    }
    handleStarted(sessionId, generation) {
        if (!this.ports.isSessionCurrent(sessionId) || !this.ports.isGenerationCurrent(generation)) {
            return;
        }
        this.isDragging = true;
    }
    handleDone(sessionId, generation, effect) {
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
        }
        else {
            // Treat other effects (like None, empty) as cancel/aborted
            void this.handleCancelOrFailure(sessionId, generation, 'cancel', 'aborted');
        }
    }
    async handleCancelOrFailure(sessionId, generation, type, reason) {
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
        }
        else {
            this.ports.setStatus(`Sürükle-bırak başlatılamadı: ${reason}`);
        }
    }
    getIsDragging() {
        return this.isDragging;
    }
}
exports.SelectionDragRuntime = SelectionDragRuntime;
