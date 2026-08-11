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
  /** n8n webhook endpoint. Plain HTTP is accepted only for a loopback host. */
  actionWebhookUrl: string;
  /** Shared n8n webhook secret. Stored safeStorage-encrypted at rest. */
  actionWebhookSecret: string;
  /** Interface language. 'system' follows the OS locale (Turkish → tr, else en). */
  language: 'system' | 'en' | 'tr';
  /** Last floating panel position (screen coordinates). */
  panelX?: number;
  panelY?: number;
  /** When true the expanded panel stays above other application windows. */
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

export type ActionTaskIntentType =
  | 'pending'
  | 'profile_research'
  | 'recipe_extraction'
  | 'general_visual_analysis';

export type ActionTaskWorkflowStatus =
  | 'queued'
  | 'analyzing'
  | 'researching'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ActionTaskSource {
  readonly title: string;
  readonly url: string;
}

export interface ActionTaskSnapshot {
  readonly id: string;
  readonly intentType: ActionTaskIntentType;
  readonly workflowStatus: ActionTaskWorkflowStatus;
  readonly progress: number;
  readonly title: string;
  readonly summary: string | null;
  readonly resultJson: Readonly<Record<string, unknown>>;
  readonly sources: readonly ActionTaskSource[];
  readonly confidence: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly version: number;
  readonly sentToPhone: boolean;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

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

export type MainReadyState = AppSettings & {
  selectionActive: boolean;
  panelMode: PanelMode;
  pillMaxWidth: number;
  i18n: Record<string, string>;
  phoneDownloads?: Array<{ path: string; name: string; isImage: boolean }>;
};

export type MainBridgeAPI = {
  readonly ready: () => Promise<MainReadyState>;
  readonly saveSettings: (
    settings: Partial<AppSettings>
  ) => Promise<{ ok: boolean; error?: string }>;
  readonly generateQr: () => Promise<{
    ok: boolean;
    dataUrl?: string;
    error?: string;
    warning?: string;
    actionPairingIncluded?: boolean;
  }>;
  readonly captureNow: () => Promise<{ ok: boolean; mode?: string }>;
  readonly openGemini: () => Promise<{ ok: boolean }>;
  readonly focusGemini: () => Promise<{ ok: boolean }>;
  readonly getStorageUsage: () => Promise<{
    ok: boolean;
    usedBytes?: number;
    limitBytes?: number;
    usedPercentage?: number;
    error?: string;
  }>;
  readonly purgeStorage: () => Promise<{ ok: boolean; deletedCount?: number; error?: string }>;
  readonly setupRls: () => Promise<{ ok: boolean; sql?: string; error?: string }>;
  readonly sendClipboard: () => Promise<{ ok: boolean; error?: string }>;
  readonly panelToggle: () => Promise<{ ok: boolean; mode: PanelMode }>;
  readonly panelInteractStart: () => Promise<{ ok: boolean }>;
  readonly panelDragBy: (dx: number, dy: number) => Promise<{ ok: boolean }>;
  readonly panelDismiss: () => Promise<{ ok: boolean; mode: PanelMode }>;
  readonly quitApp: () => Promise<{ ok: boolean; error?: string }>;
  readonly savePanelPinned: (pinned: boolean) => Promise<{ ok: boolean }>;
  readonly panelResizeCompact: (size: { width: number; height: number }) => Promise<{
    ok: boolean;
    width?: number;
    height?: number;
  }>;
  readonly onPanelMode: (callback: (mode: PanelMode) => void) => void;
  readonly onHudCapturing: (callback: (active: boolean) => void) => void;
  readonly onPillDragState: (callback: (dragging: boolean) => void) => void;
  readonly onPillResized: (callback: (size: { width: number; height: number }) => void) => void;
  readonly onStatus: (callback: (message: string) => void) => void;
  readonly onResponse: (callback: (message: string) => void) => void;
  readonly onActionTaskUpdated: (callback: (task: ActionTaskSnapshot) => void) => void;
  readonly onOverlayMessage: (callback: (message: string) => void) => void;
  readonly uploadFileToPhone: (filePath: string) => Promise<{ ok: boolean }>;
  readonly startDragDownloadedFile: (filePath: string) => void;
  readonly deleteDownloadedFile: (filePath: string) => Promise<{ ok: boolean }>;
  readonly sendActionToPhone: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
  readonly logUserAction: (action: string, details?: Readonly<Record<string, unknown>>) => void;
  readonly onPhoneDownloadsUpdated: (
    callback: (files: Array<{ path: string; name: string; isImage: boolean }>) => void
  ) => void;
};

export type OverlayBridgeAPI = {
  readonly notifyOverlayReady: () => Promise<{ ok: boolean }>;
  readonly notifyOverlayRendered: (sessionId: number) => Promise<{ ok: boolean }>;
  readonly setSelection: (payload: SelectionPayload) => Promise<{ ok: boolean }>;
  readonly cancelSelection: (sessionId: number) => Promise<{ ok: boolean }>;
  readonly setAnnotated: (payload: AnnotationPayload) => Promise<{ ok: boolean }>;
  readonly startSelectionDrag: (sessionId: number) => void;
  readonly onSelectionDragState: (
    callback: (data: { sessionId: number; ready: boolean; reason?: string }) => void
  ) => void;
  readonly copySelection: (
    sessionId: number
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  readonly onOverlayState: (callback: (state: OverlayState) => void) => void;
  readonly onOverlayMessage: (callback: (message: string) => void) => void;
  readonly confirmSelectionGemini: (sessionId: number) => Promise<{ ok: boolean }>;
  readonly confirmSelectionAction: (sessionId: number) => Promise<{ ok: boolean }>;
  readonly confirmSelectionPhone: (sessionId: number) => Promise<{ ok: boolean }>;
  readonly confirmSelectionOcr: (sessionId: number) => Promise<{ ok: boolean }>;
};

export type NotificationBridgeAPI = {
  readonly onNotification: (
    callback: (data: {
      title: string;
      body: string;
      type: 'success' | 'info' | 'error' | 'sync';
    }) => void
  ) => void;
  readonly onDismissNotification: (callback: () => void) => void;
};

export type BridgeAPI = MainBridgeAPI | OverlayBridgeAPI | NotificationBridgeAPI;

declare global {
  interface Window {
    bridge: BridgeAPI;
    /** Set by the overlay renderer; composites the selection + annotations into a PNG data URL. */
    __ctrl2phoneCompose?: () => Promise<string | null>;
  }
}
