import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rdpea', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  pin: (pinned: boolean) => ipcRenderer.send('window:pin', pinned),

  // Connection management
  loadConnections: () => ipcRenderer.invoke('connections:load'),
  saveConnections: (connections: any[]) => ipcRenderer.invoke('connections:save', connections),

  // RDP session
  connect: (connection: any) => ipcRenderer.invoke('rdp:connect', connection),
  disconnect: (connectionId: string) => ipcRenderer.invoke('rdp:disconnect', connectionId),
  getStatus: (connectionId: string) => ipcRenderer.invoke('rdp:status', connectionId),

  // Input forwarding (renderer → main → RDP server)
  sendKeyboard: (connectionId: string, type: 'keydown' | 'keyup', scanCode: number, extended: boolean) =>
    ipcRenderer.send('rdp:keyboard', connectionId, type, scanCode, extended),
  sendMouse: (connectionId: string, type: string, x: number, y: number, button?: string, wheelDelta?: number) =>
    ipcRenderer.send('rdp:mouse', connectionId, type, x, y, button, wheelDelta),

  // Debug logging
  setDebug: (connectionId: string, enabled: boolean) =>
    ipcRenderer.send('rdp:set-debug', connectionId, enabled),

  // Session windows
  openSessionWindow: (connectionId: string, connectionName: string) =>
    ipcRenderer.send('session:open-window', connectionId, connectionName),

  // Events from main process
  onDebugLog: (callback: (connectionId: string, message: string) => void) => {
    const handler = (_event: any, connectionId: string, message: string) => callback(connectionId, message);
    ipcRenderer.on('rdp:debug-log', handler);
    return () => ipcRenderer.removeListener('rdp:debug-log', handler);
  },
  onFrame: (callback: (connectionId: string, rects: any[]) => void) => {
    const handler = (_event: any, connectionId: string, rects: any[]) => callback(connectionId, rects);
    ipcRenderer.on('rdp:frame', handler);
    return () => ipcRenderer.removeListener('rdp:frame', handler);
  },
  onAudio: (callback: (connectionId: string, audioData: any) => void) => {
    const handler = (_event: any, connectionId: string, audioData: any) => callback(connectionId, audioData);
    ipcRenderer.on('rdp:audio', handler);
    return () => ipcRenderer.removeListener('rdp:audio', handler);
  },
  onConnected: (callback: (connectionId: string, info?: { width: number; height: number }) => void) => {
    const handler = (_event: any, connectionId: string, info?: { width: number; height: number }) => callback(connectionId, info);
    ipcRenderer.on('rdp:connected', handler);
    return () => ipcRenderer.removeListener('rdp:connected', handler);
  },
  onDisconnected: (callback: (connectionId: string) => void) => {
    const handler = (_event: any, connectionId: string) => callback(connectionId);
    ipcRenderer.on('rdp:disconnected', handler);
    return () => ipcRenderer.removeListener('rdp:disconnected', handler);
  },
  onError: (callback: (connectionId: string, message: string) => void) => {
    const handler = (_event: any, connectionId: string, message: string) => callback(connectionId, message);
    ipcRenderer.on('rdp:error', handler);
    return () => ipcRenderer.removeListener('rdp:error', handler);
  },

  // Shell
  openExternal: (url: string) => ipcRenderer.send('shell:open-external', url),

  // Auto-update events
  onUpdateChecking: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('update:checking', handler);
    return () => ipcRenderer.removeListener('update:checking', handler);
  },
  onUpdateAvailable: (callback: (version: string) => void) => {
    const handler = (_event: any, version: string) => callback(version);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('update:not-available', handler);
    return () => ipcRenderer.removeListener('update:not-available', handler);
  },
  onUpdateProgress: (callback: (percent: number) => void) => {
    const handler = (_event: any, percent: number) => callback(percent);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  onUpdateReady: (callback: (version: string) => void) => {
    const handler = (_event: any, version: string) => callback(version);
    ipcRenderer.on('update:ready', handler);
    return () => ipcRenderer.removeListener('update:ready', handler);
  },
  onUpdateError: (callback: (error: string) => void) => {
    const handler = (_event: any, error: string) => callback(error);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },
});
