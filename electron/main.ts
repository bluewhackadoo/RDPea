import { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, clipboard, dialog, globalShortcut } from 'electron';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { exec } from 'child_process';
import { RdpClient, RdpClientConfig } from './rdp';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const sessionWindows = new Map<string, BrowserWindow>();
const rdpClients = new Map<string, RdpClient>();
const clipboardPollers = new Map<string, ReturnType<typeof setInterval>>();
const debugConnections = new Set<string>();
const hyperVConnections = new Map<string, { host: string; vmName: string }>();
let lastKnownClipboardText = '';
let debugGlobal = false;
let hyperVNeedsElevation = false;

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
  const TOOLBAR_HEIGHT = 40; // matches h-10 in SessionView toolbar
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const maxW = Math.floor(workArea.width * 0.85);
  const maxH = Math.floor(workArea.height * 0.85) - TOOLBAR_HEIGHT;
  const scale = Math.min(maxW / rdpWidth, maxH / rdpHeight, 1);
  const winWidth = Math.round(rdpWidth * scale);
  const winHeight = Math.round(rdpHeight * scale) + TOOLBAR_HEIGHT;

  const sessionWin = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 320,
    minHeight: Math.round(320 * (rdpHeight / rdpWidth)) + TOOLBAR_HEIGHT,
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

  if (isDev) {
    sessionWin.loadURL(`http://localhost:5173/#/session/${connectionId}`);
  } else {
    sessionWin.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: `/session/${connectionId}`,
    });
  }

  sessionWindows.set(connectionId, sessionWin);

  // Push current debug-global state once the renderer is ready
  sessionWin.webContents.on('did-finish-load', () => {
    if (debugGlobal && !sessionWin.isDestroyed()) {
      sessionWin.webContents.send('rdp:debug-global', true);
    }
  });

  sessionWin.on('closed', () => {
    sessionWindows.delete(connectionId);
    terminateRdpClient(connectionId);
    // Notify main window so it updates connection status
    mainWindow?.webContents.send('rdp:disconnected', connectionId);
  });
}

// ── Hyper-V Management ───────────────────────────────────────────────
function runPowerShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`powershell.exe -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function runPowerShellElevated(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpDir = app.getPath('temp');
    const id = Date.now();
    const scriptPath = path.join(tmpDir, `rdpea_hv_${id}.ps1`);
    const outPath = path.join(tmpDir, `rdpea_hv_${id}_out.txt`);
    const errPath = path.join(tmpDir, `rdpea_hv_${id}_err.txt`);

    // PS single-quoted strings treat backslashes literally — no escaping needed
    const script = [
      'try {',
      `  $r = ${cmd}`,
      `  if ($r -ne $null) { $r | Out-File -FilePath '${outPath}' -Encoding ascii }`,
      `  else { [IO.File]::WriteAllText('${outPath}', '') }`,
      '} catch {',
      `  $_.Exception.Message | Out-File -FilePath '${errPath}' -Encoding ascii`,
      '  exit 1',
      '}',
    ].join('\r\n');
    fs.writeFileSync(scriptPath, script, 'utf8');

    // Clean stale output files
    try { fs.unlinkSync(outPath); } catch {}
    try { fs.unlinkSync(errPath); } catch {}

    // Launch elevated PowerShell to run the script
    const args = `'-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}'`;
    const launcher = `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${args}`;
    exec(`powershell.exe -NoProfile -Command "${launcher.replace(/"/g, '\\"')}"`, (err) => {
      const cleanup = () => {
        try { fs.unlinkSync(scriptPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
        try { fs.unlinkSync(errPath); } catch {}
      };
      try {
        if (fs.existsSync(errPath)) {
          const errText = fs.readFileSync(errPath, 'utf8').replace(/^\uFEFF/, '').trim();
          if (errText) { cleanup(); reject(new Error(errText)); return; }
        }
        if (fs.existsSync(outPath)) {
          const output = fs.readFileSync(outPath, 'utf8').replace(/^\uFEFF/, '').trim();
          cleanup();
          resolve(output);
        } else if (err) {
          cleanup();
          reject(new Error(`Elevated command failed: ${err.message}`));
        } else {
          cleanup();
          resolve('');
        }
      } catch (readErr: any) {
        cleanup();
        reject(new Error(`Failed to read output: ${readErr.message}`));
      }
    });
  });
}

// Try non-elevated first; auto-escalate via UAC on permission errors.
// Caches the elevation requirement so subsequent calls skip straight to elevated.
async function runHyperVPowerShell(cmd: string): Promise<string> {
  if (hyperVNeedsElevation) {
    return await runPowerShellElevated(cmd);
  }
  try {
    return await runPowerShell(cmd);
  } catch (err: any) {
    const msg = err.message || '';
    if (msg.includes('do not have the required permission') ||
        msg.includes('Access is denied') ||
        msg.includes('authorization policy') ||
        msg.includes('UnauthorizedAccessException')) {
      // Warn the user before the first UAC prompt
      const parentWin = BrowserWindow.getFocusedWindow() || mainWindow;
      const { response } = await dialog.showMessageBox(parentWin!, {
        type: 'warning',
        title: 'Administrator Privileges Required',
        message: 'Hyper-V management requires administrator privileges.',
        detail: 'Windows will ask you to approve a User Account Control (UAC) prompt to continue. This will be remembered for the rest of this session.',
        buttons: ['Continue', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 1) {
        throw new Error('Elevation cancelled by user');
      }
      hyperVNeedsElevation = true;
      console.log('[HyperV] Permission denied, retrying with elevation (cached for session)...');
      return await runPowerShellElevated(cmd);
    }
    throw err;
  }
}

async function hyperVStartOrResume(host: string, vmName: string): Promise<void> {
  const remote = host ? `-ComputerName ${host} ` : '';
  const state = (await runHyperVPowerShell(`Get-VM ${remote}-Name '${vmName}' | ForEach-Object { $_.State.ToString() }`)).trim();
  const stateLower = state.toLowerCase();
  console.log(`[HyperV] VM "${vmName}" state: "${state}"`);
  if (stateLower === 'off' || stateLower === 'stopped') {
    await runHyperVPowerShell(`Start-VM ${remote}-Name '${vmName}'`);
    console.log(`[HyperV] Started VM "${vmName}"`);
  } else if (stateLower === 'paused' || stateLower === 'saved') {
    await runHyperVPowerShell(`Resume-VM ${remote}-Name '${vmName}'`);
    console.log(`[HyperV] Resumed VM "${vmName}"`);
  } else if (stateLower !== 'running') {
    console.log(`[HyperV] VM "${vmName}" in unexpected state "${state}", attempting Start-VM`);
    await runHyperVPowerShell(`Start-VM ${remote}-Name '${vmName}'`);
  } else {
    console.log(`[HyperV] VM "${vmName}" already running`);
  }
}

async function hyperVSave(host: string, vmName: string): Promise<void> {
  const remote = host ? `-ComputerName ${host} ` : '';
  try {
    await runHyperVPowerShell(`Save-VM ${remote}-Name '${vmName}'`);
    console.log(`[HyperV] Saved VM "${vmName}"`);
  } catch (err: any) {
    console.error(`[HyperV] Failed to save "${vmName}":`, err.message);
  }
}

async function hyperVCheckModule(): Promise<boolean> {
  try {
    const result = await runPowerShell(`Get-Module -ListAvailable Hyper-V | Select-Object -First 1 -ExpandProperty Name`);
    return result.toLowerCase().includes('hyper-v');
  } catch {
    return false;
  }
}

async function hyperVTest(host: string, vmName: string): Promise<{ success: boolean; state?: string; error?: string; moduleMissing?: boolean; rawOutput?: string }> {
  // Step 1: Check if the Hyper-V module is available
  const hasModule = await hyperVCheckModule();
  if (!hasModule) {
    return { success: false, error: 'Hyper-V PowerShell module is not installed.', moduleMissing: true };
  }

  // Step 2: Try to query the VM — use pipeline to force string output of State enum
  const remote = host ? `-ComputerName ${host} ` : '';
  try {
    const raw = await runHyperVPowerShell(
      `Get-VM ${remote}-Name '${vmName}' | ForEach-Object { $_.State.ToString() }`
    );
    const state = raw.trim();
    return { success: true, state: state || undefined, rawOutput: raw };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function hyperVInstallModule(): Promise<{ success: boolean; error?: string; needsReboot?: boolean }> {
  try {
    // Try Windows 10/11 desktop approach first
    const result = await runPowerShell(
      `$ErrorActionPreference='Stop'; ` +
      `$feat = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell; ` +
      `if ($feat.State -eq 'Enabled') { Write-Output 'ALREADY_ENABLED' } ` +
      `else { $r = Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell -NoRestart -All; ` +
      `if ($r.RestartNeeded) { Write-Output 'NEEDS_REBOOT' } else { Write-Output 'INSTALLED' } }`
    );
    if (result.includes('NEEDS_REBOOT')) {
      return { success: true, needsReboot: true };
    }
    return { success: true };
  } catch (desktopErr: any) {
    // Fallback: try Windows Server approach
    try {
      await runPowerShell(
        `$ErrorActionPreference='Stop'; Install-WindowsFeature -Name Hyper-V-PowerShell`
      );
      return { success: true };
    } catch (serverErr: any) {
      return { success: false, error: `Desktop: ${desktopErr.message}\nServer: ${serverErr.message}` };
    }
  }
}

function sendDebugLog(connectionId: string, message: string): void {
  if (!debugGlobal && !debugConnections.has(connectionId)) return;
  const sessionWin = sessionWindows.get(connectionId);
  if (sessionWin && !sessionWin.isDestroyed()) {
    sessionWin.webContents.send('rdp:debug-log', connectionId, `[${new Date().toISOString().slice(11, 23)}] ${message}`);
  }
}

// ── Native RDP Client Management ─────────────────────────────────────
async function launchRdpConnection(conn: any): Promise<{ success: boolean; error?: string }> {
  try {
    if (rdpClients.has(conn.id)) {
      const existing = rdpClients.get(conn.id)!;
      if (existing.isConnected()) {
        return { success: true }; // genuinely still connected
      }
      // Stale/dead client — clean up before reconnecting
      terminateRdpClient(conn.id);
      // Wait for TCP socket to fully close before opening a new connection,
      // otherwise the server sees two sessions and sends error 0x5
      await new Promise(resolve => setTimeout(resolve, 500));
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

    // Hyper-V: start/resume VM before connecting RDP
    if (conn.hyperVEnabled && conn.hyperVVmName) {
      sendDebugLog(conn.id, `[HyperV] Starting/resuming VM "${conn.hyperVVmName}"…`);
      hyperVStartOrResume(conn.hyperVHost || '', conn.hyperVVmName).catch(() => {});
      hyperVConnections.set(conn.id, { host: conn.hyperVHost || '', vmName: conn.hyperVVmName });
    }

    // Open session window immediately, sized to match connection resolution
    createSessionWindow(conn.id, conn.name || conn.host, config.width, config.height);

    const client = new RdpClient(config);
    rdpClients.set(conn.id, client);

    // If global debug is on, auto-enable for this connection
    if (debugGlobal) debugConnections.add(conn.id);

    // Forward RDP client log messages to the session window when debug mode is on
    client.on('log', (msg: string) => sendDebugLog(conn.id, msg));

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
      // Only clean up if we're still the active client for this connection.
      // After reconnect, the old client's async close event must not stomp the new client.
      if (rdpClients.get(conn.id) !== client) return;

      rdpClients.delete(conn.id);
      // Stop clipboard polling for this connection
      const poller = clipboardPollers.get(conn.id);
      if (poller) { clearInterval(poller); clipboardPollers.delete(conn.id); }
      // Hyper-V: save/pause VM on disconnect
      const hv = hyperVConnections.get(conn.id);
      if (hv) {
        sendDebugLog(conn.id, `[HyperV] Saving VM "${hv.vmName}"…`);
        hyperVSave(hv.host, hv.vmName).catch(() => {});
        hyperVConnections.delete(conn.id);
      }
      const sessionWin = sessionWindows.get(conn.id);
      if (sessionWin && !sessionWin.isDestroyed()) {
        sessionWin.webContents.send('rdp:disconnected', conn.id);
      }
      mainWindow?.webContents.send('rdp:disconnected', conn.id);
    });

    client.on('error', (err: Error) => {
      // Ignore errors from stale clients that have been replaced by a reconnect
      if (rdpClients.get(conn.id) !== client) return;

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
    client.removeAllListeners(); // prevent stale events from firing after reconnect
    client.disconnect();
    rdpClients.delete(connectionId);
  }
  const poller = clipboardPollers.get(connectionId);
  if (poller) { clearInterval(poller); clipboardPollers.delete(connectionId); }
  // Hyper-V: save VM on terminate
  const hv = hyperVConnections.get(connectionId);
  if (hv) {
    hyperVSave(hv.host, hv.vmName).catch(() => {});
    hyperVConnections.delete(connectionId);
  }
  debugConnections.delete(connectionId);
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

  // Debug logging toggle (per-session)
  ipcMain.on('rdp:set-debug', (_event, connectionId: string, enabled: boolean) => {
    if (enabled) debugConnections.add(connectionId);
    else debugConnections.delete(connectionId);
  });

  // Debug logging toggle (global from main window)
  ipcMain.on('rdp:set-debug-global', (_event, enabled: boolean) => {
    debugGlobal = enabled;
    if (enabled) {
      // Enable for all existing connections
      for (const id of rdpClients.keys()) debugConnections.add(id);
    } else {
      debugConnections.clear();
    }
    // Notify all session windows so they can show/hide debug panel
    for (const [, win] of sessionWindows) {
      if (!win.isDestroyed()) win.webContents.send('rdp:debug-global', enabled);
    }
  });

  // App version
  ipcMain.handle('app:version', () => app.getVersion());

  // Query current global debug state (for session windows that mount after toggle)
  ipcMain.handle('rdp:get-debug-global', () => debugGlobal);

  // Hyper-V test & module install
  ipcMain.handle('hyperv:test', (_event, host: string, vmName: string) => {
    return hyperVTest(host, vmName);
  });
  ipcMain.handle('hyperv:install-module', async () => {
    return hyperVInstallModule();
  });
  ipcMain.handle('hyperv:start', async (_event, host: string, vmName: string) => {
    try {
      await hyperVStartOrResume(host, vmName);
      // Re-query state after start/resume
      const remote = host ? `-ComputerName ${host} ` : '';
      const state = (await runHyperVPowerShell(`Get-VM ${remote}-Name '${vmName}' | ForEach-Object { $_.State.ToString() }`)).trim();
      return { success: true, state };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Check for updates (manual trigger)
  ipcMain.on('update:check', () => {
    if (!isDev) {
      autoUpdater.checkForUpdates().catch(() => {});
    }
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

  // Beta builds should find other beta (pre-release) updates
  if (app.getVersion().includes('beta')) {
    autoUpdater.allowPrerelease = true;
  }

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
