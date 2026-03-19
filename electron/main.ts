import { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, clipboard, dialog } from 'electron';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { RdpClient, RdpClientConfig } from './rdp';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const sessionWindows = new Map<string, BrowserWindow>();
const rdpClients = new Map<string, RdpClient>();
const clipboardPollers = new Map<string, ReturnType<typeof setInterval>>();
let lastKnownClipboardText = '';

// ── Encrypted Storage ────────────────────────────────────────────────
const STORE_PATH = path.join(app.getPath('userData'), 'connections.enc');
const ALGORITHM = 'aes-256-gcm';

function getDerivedKey(): Buffer {
  const machineId = `${process.env.COMPUTERNAME || 'rdpea'}-${process.env.USERNAME || 'user'}`;
  return crypto.scryptSync(machineId, 'RDPea-salt-v1', 32);
}

function encryptData(data: string): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), encrypted, authTag });
}

function decryptData(payload: string): string {
  const key = getDerivedKey();
  const { iv, encrypted, authTag } = JSON.parse(payload);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function loadConnections(): any[] {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      return JSON.parse(decryptData(raw));
    }
  } catch (e) {
    console.error('Failed to load connections:', e);
  }
  return [];
}

function saveConnections(connections: any[]): void {
  const encrypted = encryptData(JSON.stringify(connections));
  fs.writeFileSync(STORE_PATH, encrypted, 'utf8');
}

// ── Main Window ──────────────────────────────────────────────────────
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(820, height),
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Session Window (per connection) ──────────────────────────────────
function createSessionWindow(connectionId: string, connectionName: string, rdpWidth = 1920, rdpHeight = 1080) {
  if (sessionWindows.has(connectionId)) {
    const existing = sessionWindows.get(connectionId)!;
    existing.focus();
    return;
  }

  // Scale window to fit within 85% of the screen work area while preserving aspect ratio
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const maxW = Math.floor(workArea.width * 0.85);
  const maxH = Math.floor(workArea.height * 0.85);
  const scale = Math.min(maxW / rdpWidth, maxH / rdpHeight, 1);
  const winWidth = Math.round(rdpWidth * scale);
  const winHeight = Math.round(rdpHeight * scale);

  const sessionWin = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 320,
    minHeight: Math.round(320 * (rdpHeight / rdpWidth)),
    frame: false,
    backgroundColor: '#0f172a',
    title: `RDPea — ${connectionName}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Lock aspect ratio to the RDP display resolution
  sessionWin.setAspectRatio(rdpWidth / rdpHeight);

  if (isDev) {
    sessionWin.loadURL(`http://localhost:5173/#/session/${connectionId}`);
  } else {
    sessionWin.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: `/session/${connectionId}`,
    });
  }

  sessionWindows.set(connectionId, sessionWin);

  sessionWin.on('closed', () => {
    sessionWindows.delete(connectionId);
    terminateRdpClient(connectionId);
  });
}

// ── Native RDP Client Management ─────────────────────────────────────
function launchRdpConnection(conn: any): { success: boolean; error?: string } {
  try {
    if (rdpClients.has(conn.id)) {
      return { success: true }; // already connected
    }

    // If no domain/workgroup specified, use the server hostname as fallback
    // (strip port, take first label of FQDN, uppercase — mimics Windows RDP client)
    let domain = conn.domain || '';
    if (!domain) {
      const hostPart = (conn.host || '').split(':')[0]; // strip port if present
      const label = hostPart.split('.')[0];             // first DNS label
      domain = label.toUpperCase();
    }

    const config: RdpClientConfig = {
      host: conn.host,
      port: conn.port || 3389,
      username: conn.username || '',
      password: conn.password || '',
      domain,
      width: conn.width || 1920,
      height: conn.height || 1080,
      colorDepth: 16,
      enableAudio: conn.audioMode !== 2, // 2 = do not play
      enableClipboard: conn.redirectClipboard !== false,
      security: 'any',
    };

    // Open session window immediately, sized to match connection resolution
    createSessionWindow(conn.id, conn.name || conn.host, config.width, config.height);

    const client = new RdpClient(config);
    rdpClients.set(conn.id, client);

    // Forward bitmap frames to session window only (raw Uint8Array, no base64)
    client.on('bitmap', (rects: Array<{ x: number; y: number; width: number; height: number; data: Buffer }>) => {
      const sessionWin = sessionWindows.get(conn.id);
      if (sessionWin && !sessionWin.isDestroyed()) {
        const frames = rects.map(r => ({
          x: r.x, y: r.y, width: r.width, height: r.height,
          data: new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength),
        }));
        sessionWin.webContents.send('rdp:frame', conn.id, frames);
      }
    });

    // Forward audio data to session window only (raw Uint8Array, no base64)
    client.on('audio', (pcmData: Buffer, format: any) => {
      const sessionWin = sessionWindows.get(conn.id);
      if (sessionWin && !sessionWin.isDestroyed()) {
        sessionWin.webContents.send('rdp:audio', conn.id, {
          data: new Uint8Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength),
          channels: format.nChannels,
          sampleRate: format.nSamplesPerSec,
          bitsPerSample: format.wBitsPerSample,
        });
      }
    });

    // Forward clipboard text from remote server to local system clipboard
    client.on('clipboard', (text: string) => {
      if (text) {
        lastKnownClipboardText = text;
        clipboard.writeText(text);
      }
    });

    client.on('ready', () => {
      const sessionWin = sessionWindows.get(conn.id);
      if (sessionWin && !sessionWin.isDestroyed()) {
        sessionWin.webContents.send('rdp:connected', conn.id, { width: config.width, height: config.height });
      }
      mainWindow?.webContents.send('rdp:connected', conn.id);

      // Start polling local clipboard for changes to push to remote
      lastKnownClipboardText = clipboard.readText() || '';
      const poller = setInterval(() => {
        try {
          const current = clipboard.readText() || '';
          if (current !== lastKnownClipboardText && current.length > 0) {
            lastKnownClipboardText = current;
            client.setClipboardText(current);
          }
        } catch { /* clipboard read can fail if locked */ }
      }, 500);
      clipboardPollers.set(conn.id, poller);
    });

    client.on('close', () => {
      rdpClients.delete(conn.id);
      // Stop clipboard polling for this connection
      const poller = clipboardPollers.get(conn.id);
      if (poller) { clearInterval(poller); clipboardPollers.delete(conn.id); }
      const sessionWin = sessionWindows.get(conn.id);
      if (sessionWin && !sessionWin.isDestroyed()) {
        sessionWin.webContents.send('rdp:disconnected', conn.id);
      }
      mainWindow?.webContents.send('rdp:disconnected', conn.id);
    });

    client.on('error', (err: Error) => {
      console.error(`RDP error for ${conn.id}:`, err.message);
      const sessionWin = sessionWindows.get(conn.id);
      if (sessionWin && !sessionWin.isDestroyed()) {
        sessionWin.webContents.send('rdp:error', conn.id, err.message);
      }
      mainWindow?.webContents.send('rdp:error', conn.id, err.message);
    });

    // Start connection
    client.connect().catch((err) => {
      console.error(`RDP connect failed for ${conn.id}:`, err);
      rdpClients.delete(conn.id);
    });

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

function terminateRdpClient(connectionId: string) {
  const client = rdpClients.get(connectionId);
  if (client) {
    client.disconnect();
    rdpClients.delete(connectionId);
  }
  const poller = clipboardPollers.get(connectionId);
  if (poller) { clearInterval(poller); clipboardPollers.delete(connectionId); }
}

// ── IPC Handlers ─────────────────────────────────────────────────────
function registerIpcHandlers() {
  // Window controls
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.on('window:pin', (event, pinned: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(pinned);
  });

  // Connection CRUD
  ipcMain.handle('connections:load', () => loadConnections());
  ipcMain.handle('connections:save', (_event, connections: any[]) => {
    saveConnections(connections);
    return true;
  });

  // RDP session management
  ipcMain.handle('rdp:connect', (_event, connection: any) => {
    return launchRdpConnection(connection);
  });

  ipcMain.handle('rdp:disconnect', (_event, connectionId: string) => {
    terminateRdpClient(connectionId);
    return true;
  });

  ipcMain.handle('rdp:status', (_event, connectionId: string) => {
    return rdpClients.has(connectionId) && rdpClients.get(connectionId)!.isConnected();
  });

  // Forward keyboard input from renderer to RDP client
  ipcMain.on('rdp:keyboard', (_event, connectionId: string, type: 'keydown' | 'keyup', scanCode: number, extended: boolean) => {
    const client = rdpClients.get(connectionId);
    if (client) client.sendKeyboard(type, scanCode, extended);
  });

  // Forward mouse input from renderer to RDP client
  ipcMain.on('rdp:mouse', (_event, connectionId: string, type: string, x: number, y: number, button?: string, wheelDelta?: number) => {
    const client = rdpClients.get(connectionId);
    if (client) {
      client.sendMouse(
        type as 'move' | 'down' | 'up' | 'wheel',
        x, y,
        button as 'left' | 'right' | 'middle' | undefined,
        wheelDelta
      );
    }
  });

  // Open session in separate window
  ipcMain.on('session:open-window', (_event, connectionId: string, connectionName: string) => {
    createSessionWindow(connectionId, connectionName);
  });

  // Shell
  ipcMain.on('shell:open-external', (_event, url: string) => {
    shell.openExternal(url);
  });
}

// ── Auto-Update ─────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (isDev) return; // Skip in dev mode

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
    mainWindow?.webContents.send('update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    mainWindow?.webContents.send('update:available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available');
    mainWindow?.webContents.send('update:not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Download progress: ${Math.round(progress.percent)}%`);
    mainWindow?.webContents.send('update:progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    mainWindow?.webContents.send('update:ready', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
    mainWindow?.webContents.send('update:error', err.message);
  });

  // Check for updates on launch
  autoUpdater.checkForUpdates().catch(() => {});
}

// ── App Lifecycle ────────────────────────────────────────────────────
app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Cleanup all RDP clients
  for (const [id] of rdpClients) {
    terminateRdpClient(id);
  }
  if (process.platform !== 'darwin') app.quit();
});
