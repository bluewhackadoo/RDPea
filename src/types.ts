export interface RdpConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  domain: string;
  gateway: string;
  width: number;
  height: number;
  /** Negotiate the remote desktop at the session window's exact pixel size (sharp 1:1 rendering). */
  fitToWindow: boolean;
  colorDepth: 16 | 24 | 32;
  audioMode: 'local' | 'remote' | 'none';
  redirectClipboard: boolean;
  redirectDrives: boolean;
  redirectPrinters: boolean;
  /** Forward Win key, Alt+Tab, Alt+Esc, Alt+F4 and Ctrl+Esc to the remote while the session is focused. */
  captureSystemKeys: boolean;
  hyperVEnabled: boolean;
  hyperVHost: string;
  hyperVVmName: string;
  group: string;
  notes: string;
  tags: string[];
  pinned: boolean;
  lastConnected: string | null;
  createdAt: string;
  color: string;
}

export interface ConnectionGroup {
  name: string;
  connections: RdpConnection[];
}

export type ViewMode = 'grid' | 'list';
export type SortField = 'name' | 'host' | 'lastConnected' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export interface AppState {
  connections: RdpConnection[];
  activeConnections: Set<string>;
  searchQuery: string;
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  selectedGroup: string | null;
}

export interface BitmapRectIPC {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array; // raw RGBA pixels
}

export interface AudioDataIPC {
  data: Uint8Array; // raw PCM samples
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

export type PointerUpdateIPC =
  | { kind: 'hidden' }
  | { kind: 'default' }
  | { kind: 'cached'; cacheIndex: number }
  | { kind: 'new'; cacheIndex: number; hotX: number; hotY: number; width: number; height: number; data: Uint8Array };

export interface SessionInfoIPC {
  width: number;
  height: number;
  /** Main process will honour resize requests (profile has fitToWindow on). */
  dynamicResize?: boolean;
}

export interface UpdateStateIPC {
  status: 'idle' | 'unsupported' | 'checking' | 'available' | 'downloading' | 'ready' | 'not-available' | 'error';
  version?: string;
  percent?: number;
  message?: string;
  checkedAt?: number;
}

declare global {
  interface Window {
    rdpea: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      pin: (pinned: boolean) => void;
      loadConnections: () => Promise<RdpConnection[]>;
      saveConnections: (connections: RdpConnection[]) => Promise<boolean>;
      connect: (connection: RdpConnection) => Promise<{ success: boolean; error?: string }>;
      disconnect: (connectionId: string) => Promise<boolean>;
      getStatus: (connectionId: string) => Promise<boolean>;
      sendKeyboard: (connectionId: string, type: 'keydown' | 'keyup', scanCode: number, extended: boolean) => void;
      sendMouse: (connectionId: string, type: string, x: number, y: number, button?: string, wheelDelta?: number) => void;
      setDebug: (connectionId: string, enabled: boolean) => void;
      setDebugGlobal: (enabled: boolean) => void;
      onDebugGlobal: (callback: (enabled: boolean) => void) => () => void;
      getDebugGlobal: () => Promise<boolean>;
      getAppVersion: () => Promise<string>;
      testHyperV: (host: string, vmName: string) => Promise<{ success: boolean; state?: string; error?: string; moduleMissing?: boolean }>;
      installHyperVModule: () => Promise<{ success: boolean; error?: string; needsReboot?: boolean }>;
      startHyperV: (host: string, vmName: string) => Promise<{ success: boolean; state?: string; error?: string }>;
      openSessionWindow: (connectionId: string, connectionName: string) => void;
      onDebugLog: (callback: (connectionId: string, message: string) => void) => () => void;
      onFrame: (callback: (connectionId: string, rects: BitmapRectIPC[]) => void) => () => void;
      onAudio: (callback: (connectionId: string, audioData: AudioDataIPC) => void) => () => void;
      onConnected: (callback: (connectionId: string, info?: SessionInfoIPC) => void) => () => void;
      onResized: (callback: (connectionId: string, size: { width: number; height: number }) => void) => () => void;
      onPointer: (callback: (connectionId: string, update: PointerUpdateIPC) => void) => () => void;
      requestResize: (connectionId: string, width: number, height: number) => Promise<boolean>;
      onDisconnected: (callback: (connectionId: string) => void) => () => void;
      onError: (callback: (connectionId: string, message: string) => void) => () => void;
      openExternal: (url: string) => void;
      checkForUpdates: () => void;
      restartAndInstall: () => void;
      getUpdateState: () => Promise<UpdateStateIPC>;
      onUpdateChecking: (callback: () => void) => () => void;
      onUpdateAvailable: (callback: (version: string) => void) => () => void;
      onUpdateNotAvailable: (callback: () => void) => () => void;
      onUpdateProgress: (callback: (percent: number) => void) => () => void;
      onUpdateReady: (callback: (version: string) => void) => () => void;
      onUpdateError: (callback: (error: string) => void) => () => void;
    };
  }
}
