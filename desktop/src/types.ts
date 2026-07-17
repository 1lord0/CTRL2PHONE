export interface AppSettings {
  prompt: string;
  supabaseUrl: string;
  supabaseKey: string;
  supabaseBucket: string;
  autoCopyFromPhone: boolean;
  /** Virtual-key code of the trigger key that is double-tapped (default 0xA2 = Left Ctrl). */
  hotkeyVk: number;
  /** Max ms between the two taps to count as a double-press (default 400). */
  doublePressMs: number;
  /**
   * Which AI backend the X/Gemini shortcut uses. 'web' (default) keeps the legacy
   * "paste into gemini.google.com" flow; the others call the provider's API directly
   * and show the reply in-app.
   */
  aiProvider: 'web' | 'gemini' | 'claude' | 'openai' | 'custom';
  /** BYO API key for the selected provider. Stored safeStorage-encrypted at rest. */
  aiApiKey: string;
  /** Optional model override; empty = the provider's sensible default. */
  aiModel: string;
  /** Base URL for the 'custom' OpenAI-compatible provider (Ollama, LM Studio, OpenRouter…). */
  aiBaseUrl: string;
  /** Interface language. 'system' follows the OS locale (Turkish → tr, else en). */
  language: 'system' | 'en' | 'tr';
  /** Last floating panel position (screen coordinates). */
  panelX?: number;
  panelY?: number;
  /** When true the panel stays expanded after the mouse leaves. */
  panelPinned?: boolean;
  /**
   * Floating pill visibility when idle.
   * - always: pill stays on screen (legacy default)
   * - background: hidden while idle; briefly shown for status and during capture
   * - capture-only: hidden except while a screen selection is active
   */
  pillVisibility?: 'always' | 'background' | 'capture-only';
}

export type PanelMode = 'compact' | 'presented';
export type PillVisibility = NonNullable<AppSettings['pillVisibility']>;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface OverlayState {
  visible: boolean;
  active: boolean;
  selection: Rect | null;
  backgroundImage: string | null;
  sessionId: number | null;
}

export interface SelectionPayload {
  type: 'start' | 'update';
  rect?: Rect;
  sessionId: number;
}

export interface AnnotationPayload {
  hasAnnotations: boolean;
  sessionId: number;
}

export interface BridgeAPI {
  ready: () => Promise<
    AppSettings & {
      selectionActive: boolean;
      panelMode: PanelMode;
      pillMaxWidth: number;
      i18n: Record<string, string>;
      phoneDownloads?: Array<{ path: string; name: string; isImage: boolean }>;
    }
  >;
  saveSettings: (settings: Partial<AppSettings>) => Promise<{ ok: boolean }>;
  generateQr: () => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  captureNow: () => Promise<{ ok: boolean; mode?: string }>;
  openGemini: () => Promise<{ ok: boolean }>;
  focusGemini: () => Promise<{ ok: boolean }>;
  notifyOverlayReady: () => Promise<{ ok: boolean }>;
  notifyOverlayRendered: (sessionId: number) => Promise<{ ok: boolean }>;
  setSelection: (payload: SelectionPayload) => Promise<{ ok: boolean }>;
  cancelSelection: (sessionId: number) => Promise<{ ok: boolean }>;
  setAnnotated: (payload: AnnotationPayload) => Promise<{ ok: boolean }>;
  startSelectionDrag: (sessionId: number) => void;
  onSelectionDragState: (callback: (data: { sessionId: number; ready: boolean; reason?: string }) => void) => void;
  copySelection: (sessionId: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  onStatus: (callback: (message: string) => void) => void;
  onResponse: (callback: (message: string) => void) => void;
  onOverlayState: (callback: (state: OverlayState) => void) => void;
  onOverlayMessage: (callback: (message: string) => void) => void;
  confirmSelectionGemini: (sessionId: number) => Promise<{ ok: boolean }>;
  confirmSelectionPhone: (sessionId: number) => Promise<{ ok: boolean }>;
  confirmSelectionOcr: (sessionId: number) => Promise<{ ok: boolean }>;
  getStorageUsage: () => Promise<{
    ok: boolean;
    usedBytes?: number;
    limitBytes?: number;
    usedPercentage?: number;
    error?: string;
  }>;
  purgeStorage: () => Promise<{ ok: boolean; deletedCount?: number; error?: string }>;
  setupRls: () => Promise<{ ok: boolean; sql?: string; error?: string }>;
  sendClipboard: () => Promise<{ ok: boolean; error?: string }>;
  panelToggle: () => Promise<{ ok: boolean; mode: PanelMode }>;
  panelInteractStart: () => Promise<{ ok: boolean }>;
  panelDragBy: (dx: number, dy: number) => Promise<{ ok: boolean }>;
  panelDismiss: () => Promise<{ ok: boolean; mode: PanelMode }>;
  quitApp: () => Promise<{ ok: boolean }>;
  savePanelPinned: (pinned: boolean) => Promise<{ ok: boolean }>;
  panelResizeCompact: (size: { width: number; height: number }) => Promise<{
    ok: boolean;
    width?: number;
    height?: number;
  }>;
  onPanelMode: (callback: (mode: PanelMode) => void) => void;
  onHudCapturing: (callback: (active: boolean) => void) => void;
  onPillDragState: (callback: (dragging: boolean) => void) => void;
  onPillResized: (callback: (size: { width: number; height: number }) => void) => void;
  onNotification: (callback: (data: { title: string; body: string; type: 'success' | 'info' | 'error' | 'sync' }) => void) => void;
  onDismissNotification: (callback: () => void) => void;
  uploadFileToPhone: (filePath: string) => Promise<{ ok: boolean }>;
  startDragDownloadedFile: (filePath: string) => void;
  deleteDownloadedFile: (filePath: string) => Promise<{ ok: boolean }>;
  onPhoneDownloadsUpdated: (callback: (files: Array<{ path: string; name: string; isImage: boolean }>) => void) => void;
}

declare global {
  interface Window {
    bridge: BridgeAPI;
    /** Set by the overlay renderer; composites the selection + annotations into a PNG data URL. */
    __ctrl2phoneCompose?: () => Promise<string | null>;
  }
}
