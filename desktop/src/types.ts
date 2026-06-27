export interface AppSettings {
  prompt: string;
  supabaseUrl: string;
  supabaseKey: string;
  supabaseBucket: string;
  autoCopyFromPhone: boolean;
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
  confirmSelectionGemini: () => Promise<{ ok: boolean }>;
  confirmSelectionPhone: () => Promise<{ ok: boolean }>;
  getStorageUsage: () => Promise<{ ok: boolean; usedBytes?: number; limitBytes?: number; usedPercentage?: number; error?: string }>;
  purgeStorage: () => Promise<{ ok: boolean; deletedCount?: number; error?: string }>;
}

declare global {
  interface Window {
    bridge: BridgeAPI;
  }
}
