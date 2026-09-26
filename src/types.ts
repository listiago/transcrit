export type Settings = { language: string; autoPaste: boolean; keepHistory: boolean; microphoneId: string; shortcut: string; launchAtLogin: boolean };
export type AppState = { settings: Settings; hasKey: boolean; keyStatus: 'missing' | 'ready' | 'unreadable'; platform: string; version: string; shortcutRegistered: boolean; warning: string; secureStorage: boolean };
export type Transcript = { id: string; text: string; createdAt: string; duration: number; source: 'mic' | 'file' };
export type AudioInput = { bytes: ArrayBuffer; name: string; duration: number; source: 'mic' | 'file' };
export type TranscriptionResult = { item: Transcript; delivery: string; warning: string };
export type Phase = 'idle' | 'starting' | 'recording' | 'processing' | 'error';
export type OverlayState = { status: string; message: string; preview: string; pending: number; previewError: string; retryable: boolean; errorAction?: 'record' | 'retry' | 'settings' };
export type Bridge = {
  rendererReady(): Promise<void>;
  getState(): Promise<AppState>; saveSettings(settings: Partial<Settings>): Promise<AppState>;
  saveKey(key: string): Promise<AppState>; removeKey(): Promise<AppState>; testKey(): Promise<boolean>;
  transcribe(audio: AudioInput): Promise<TranscriptionResult>; cancel(): Promise<boolean>;
  beginRecording(): Promise<string>; recordingAction(action: 'start' | 'finish' | 'cancel' | 'retry'): Promise<void>;
  appendSegment(input: { id: string; sequence: number; bytes: ArrayBuffer; duration: number }): Promise<void>;
  finishDictation(id: string, duration: number, retry?: boolean): Promise<TranscriptionResult>;
  onRecordingAction(handler: (action: 'finish' | 'cancel' | 'retry') => void): () => void;
  getOverlayState(): Promise<OverlayState>; moveOverlay(dx: number, dy: number): Promise<void>;
  setRecordingState(state: string, message?: string): Promise<void>; microphonePermission(): Promise<boolean>;
  openSettings(): Promise<void>; dismissOverlay(): Promise<void>;
  getHistory(): Promise<Transcript[]>; deleteHistory(id: string): Promise<void>; clearHistory(): Promise<void>;
  copy(text: string): Promise<void>; exportText(text: string): Promise<boolean>;
  openExternal(name: string): Promise<void>; accessibility(): Promise<boolean>;
  minimize(): Promise<void>; close(): Promise<void>;
  onToggle(handler: () => void): () => void; onNavigate(handler: (page: string) => void): () => void;
  onOverlay(handler: (value: OverlayState) => void): () => void;
};
declare global { interface Window { transcribe?: Bridge } }
