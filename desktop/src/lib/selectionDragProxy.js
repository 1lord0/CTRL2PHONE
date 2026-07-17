"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelectionDragProxy = void 0;
class SelectionDragProxy {
    processPort;
    callbacks;
    sessionId;
    generation;
    readyTimeout = null;
    isReady = false;
    isCleanedUp = false;
    hasStartingFired = false;
    hasGoWritten = false;
    hasStartedFired = false;
    constructor(processPort, callbacks, sessionId, generation) {
        this.processPort = processPort;
        this.callbacks = callbacks;
        this.sessionId = sessionId;
        this.generation = generation;
        // Set up the 3-second ready timeout
        this.readyTimeout = setTimeout(() => {
            this.cleanup();
            this.callbacks.onFailed('READY_TIMEOUT');
        }, 3000);
        // Set up listeners
        this.processPort.onLine((line) => this.handleLine(line));
        this.processPort.onExit((code) => {
            if (this.isCleanedUp)
                return;
            this.cleanup();
            this.callbacks.onFailed(`EXIT_CODE_${code}`);
        });
        this.processPort.onError((err) => {
            if (this.isCleanedUp)
                return;
            this.cleanup();
            this.callbacks.onFailed(`PROCESS_ERROR_${err.message}`);
        });
    }
    handleLine(rawLine) {
        if (this.isCleanedUp)
            return;
        const line = rawLine.trim();
        if (!line)
            return;
        if (line === 'READY') {
            if (this.isReady)
                return;
            if (this.readyTimeout) {
                clearTimeout(this.readyTimeout);
                this.readyTimeout = null;
            }
            this.isReady = true;
            this.callbacks.onReady();
            return;
        }
        if (line === 'STARTING') {
            if (!this.isReady)
                return;
            if (this.hasStartingFired)
                return;
            this.hasStartingFired = true;
            this.callbacks.onStarting(() => {
                if (this.isCleanedUp)
                    return;
                if (this.hasGoWritten)
                    return;
                this.hasGoWritten = true;
                this.processPort.writeStdin('GO\n');
            });
            return;
        }
        if (line === 'STARTED') {
            if (!this.hasStartingFired)
                return;
            if (this.hasStartedFired)
                return;
            this.hasStartedFired = true;
            if (this.callbacks.onStarted) {
                this.callbacks.onStarted();
            }
            return;
        }
        if (line.startsWith('DONE:')) {
            if (!this.isReady)
                return;
            const effect = line.slice(5);
            this.cleanup();
            if (effect === 'Copy' || effect === 'Move' || effect === 'Link' || effect === 'None') {
                this.callbacks.onDone(effect);
            }
            else {
                this.callbacks.onFailed(`UNKNOWN_EFFECT_${effect}`);
            }
            return;
        }
        if (line.startsWith('FAILED:')) {
            const reason = line.slice(7);
            this.cleanup();
            this.callbacks.onFailed(reason);
            return;
        }
    }
    cleanup() {
        if (this.isCleanedUp)
            return;
        this.isCleanedUp = true;
        if (this.readyTimeout) {
            clearTimeout(this.readyTimeout);
            this.readyTimeout = null;
        }
        this.processPort.kill();
    }
    getSessionId() {
        return this.sessionId;
    }
    getGeneration() {
        return this.generation;
    }
    getIsReady() {
        return this.isReady;
    }
    getIsCleanedUp() {
        return this.isCleanedUp;
    }
}
exports.SelectionDragProxy = SelectionDragProxy;
