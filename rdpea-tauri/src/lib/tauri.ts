// Tauri IPC bridge — replaces window.rdpea from Electron
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-shell';

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

export interface BitmapRectIPC {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface AudioDataIPC {
  data: Uint8Array;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

const appWindow = getCurrentWebviewWindow();

export const tauri = {
  // Window controls
  minimize: () => invoke('window_minimize'),
  maximize: () => invoke('window_maximize'),
  close: () => invoke('window_close'),
  pin: (pinned: boolean) => invoke('window_pin', { pinned }),

  // Connection storage
  loadConnections: (): Promise<RdpConnection[]> => invoke('load_connections'),
  saveConnections: (connections: RdpConnection[]): Promise<boolean> =>
    invoke('save_connections', { connections }),

  // RDP session
  connect: (connection: RdpConnection): Promise<{ success: boolean; error?: string }> => {
    console.log('[tauri] rdp_connect invoke →', connection.id, connection.host, connection.port);
    return invoke('rdp_connect', { connection });
  },
  disconnect: (connectionId: string): Promise<boolean> =>
    invoke('rdp_disconnect', { connectionId }),
  getStatus: (connectionId: string): Promise<boolean> =>
    invoke('rdp_status', { connectionId }),
  sendKeyboard: (connectionId: string, type: 'keydown' | 'keyup', scanCode: number, extended: boolean) =>
    invoke('rdp_keyboard', { connectionId, eventType: type, scanCode, extended }),
  sendMouse: (connectionId: string, type: string, x: number, y: number, button?: string, wheelDelta?: number) =>
    invoke('rdp_mouse', { connectionId, eventType: type, x, y, button, wheelDelta }),

  // Debug
  setDebug: (connectionId: string, enabled: boolean) =>
    invoke('rdp_set_debug', { connectionId, enabled }),
  setDebugGlobal: (enabled: boolean) =>
    invoke('rdp_set_debug_global', { enabled }),
  getDebugGlobal: (): Promise<boolean> =>
    invoke('rdp_get_debug_global'),
  onDebugGlobal: (callback: (enabled: boolean) => void) => {
    const unlisten = listen<boolean>('rdp:debug-global', (event) => callback(event.payload));
    return () => { unlisten.then(fn => fn()); };
  },

  // App info
  getAppVersion: (): Promise<string> => invoke('app_version'),

  // Hyper-V
  testHyperV: (host: string, vmName: string): Promise<{ success: boolean; state?: string; error?: string; moduleMissing?: boolean }> =>
    invoke('hyperv_test', { host, vmName }),
  installHyperVModule: (): Promise<{ success: boolean; error?: string; needsReboot?: boolean }> =>
    invoke('hyperv_install_module'),
  startHyperV: (host: string, vmName: string): Promise<{ success: boolean; state?: string; error?: string }> =>
    invoke('hyperv_start', { host, vmName }),

  // Session window
  openSessionWindow: (connectionId: string, connectionName: string) =>
    invoke('open_session_window', { connectionId, connectionName }),

  // Shell
  openExternal: (url: string) => open(url),

  // RDP events
  onDebugLog: (callback: (connectionId: string, message: string) => void) => {
    console.log('[Tauri] Setting up debug log listener');
    const unlisten = listen<{ connectionId: string; message: string }>('rdp:debug-log', (event) => {
      console.log('[Tauri] Debug log event received:', event.payload);
      callback(event.payload.connectionId, event.payload.message);
    });
    return () => { unlisten.then(fn => fn()); };
  },
  onFrame: (callback: (connectionId: string, rects: BitmapRectIPC[]) => void) => {
    const unlisten = listen<{ connectionId: string; rects: BitmapRectIPC[] }>('rdp:frame', (event) =>
      callback(event.payload.connectionId, event.payload.rects)
    );
    return () => { unlisten.then(fn => fn()); };
  },
  onAudio: (callback: (connectionId: string, audioData: AudioDataIPC) => void) => {
    const unlisten = listen<{ connectionId: string; data: number[]; channels: number; sampleRate: number; bitsPerSample: number }>('rdp:audio', (event) =>
      callback(event.payload.connectionId, {
        data: new Uint8Array(event.payload.data),
        channels: event.payload.channels,
        sampleRate: event.payload.sampleRate,
        bitsPerSample: event.payload.bitsPerSample,
      })
    );
    return () => { unlisten.then(fn => fn()); };
  },
  onConnected: (callback: (connectionId: string, info?: { width: number; height: number }) => void) => {
    const unlisten = listen<{ connectionId: string; width?: number; height?: number }>('rdp:connected', (event) =>
      callback(event.payload.connectionId, event.payload.width && event.payload.height
        ? { width: event.payload.width, height: event.payload.height }
        : undefined
      )
    );
    return () => { unlisten.then(fn => fn()); };
  },
  onDisconnected: (callback: (connectionId: string) => void) => {
    const unlisten = listen<string>('rdp:disconnected', (event) => callback(event.payload));
    return () => { unlisten.then(fn => fn()); };
  },
  onError: (callback: (connectionId: string, message: string) => void) => {
    const unlisten = listen<{ connectionId: string; message: string }>('rdp:error', (event) =>
      callback(event.payload.connectionId, event.payload.message)
    );
    return () => { unlisten.then(fn => fn()); };
  },

  // Auto-updater stubs (not implemented in Tauri version yet)
  checkForUpdates: () => {},
  restartAndInstall: () => {},
  onUpdateChecking: (callback: () => void) => () => {},
  onUpdateAvailable: (callback: (version: string) => void) => () => {},
  onUpdateNotAvailable: (callback: () => void) => () => {},
  onUpdateProgress: (callback: (percent: number) => void) => () => {},
  onUpdateReady: (callback: (version: string) => void) => () => {},
  onUpdateError: (callback: (error: string) => void) => () => {},
};
