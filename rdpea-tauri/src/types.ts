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
  colorDepth: 16 | 24 | 32;
  audioMode: 'local' | 'remote' | 'none';
  redirectClipboard: boolean;
  redirectDrives: boolean;
  redirectPrinters: boolean;
  captureWindowsKey: boolean;
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
