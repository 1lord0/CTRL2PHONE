export interface AppSettings {
  prompt: string;
  supabaseUrl: string;
  supabaseKey: string;
  supabaseBucket: string;
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
}

export interface SelectionPayload {
  type: 'start' | 'update';
  rect?: Rect;
}

export interface BridgeAPI {
  ready: () => Promise<AppSettings & { selectionActive: boolean }>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<{ ok: boolean }>;
  generateQr: () => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  captureNow: () => Promise<{ ok: boolean; mode?: string }>;
  openGemini: () => Promise<{ ok: boolean }>;
  focusGemini: () => Promise<{ ok: boolean }>;
  setSelection: (payload: SelectionPayload) => Promise<{ ok: boolean }>;
  cancelSelection: () => Promise<{ ok: boolean }>;
  onStatus: (callback: (message: string) => void) => void;
  onResponse: (callback: (message: string) => void) => void;
  onOverlayState: (callback: (state: OverlayState) => void) => void;
  onOverlayMessage: (callback: (message: string) => void) => void;
}

declare global {
  interface Window {
    bridge: BridgeAPI;
  }
}
