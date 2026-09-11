import { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, clipboard, dialog, globalShortcut } from 'electron';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { exec } from 'child_process';
import { RdpClient, RdpClientConfig, PointerUpdate } from './rdp';
import { installKeyHook, uninstallKeyHook, HookedKeyEvent } from './keyhook';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const sessionWindows = new Map<string, BrowserWindow>();
const rdpClients = new Map<string, RdpClient>();
const clipboardPollers = new Map<string, ReturnType<typeof setInterval>>();
const debugConnections = new Set<string>();
const hyperVConnections = new Map<string, { host: string; vmName: string }>();
// Per-connection: follow the session window's size with live desktop resizes (fitToWindow)
const dynamicResizeConnections = new Set<string>();
// The session window that currently has keyboard focus (null = none / main window)
let focusedSessionId: string | null = null;
// Per-connection: forward Win key / Alt+Tab / Ctrl+Esc / Alt+F4 to the remote instead of the host
const captureSystemKeysConnections = new Set<string>();

// ── System shortcut capture (Win, Alt+Tab, Alt+Esc, Alt+F4, Ctrl+Esc) ───────────────────
const VK_TAB = 0x09, VK_ESCAPE = 0x1B, VK_SPACE = 0x20, VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_F4 = 0x73;
const VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3;
let ctrlHeld = false;
// Keys we forwarded a key-down for through the hook, per connection — so we can also forward
// the matching key-up and release them if focus is lost mid-press.
const hookForwardedKeys = new Map<string, Map<number, { scanCode: number; extended: boolean }>>();

function releaseHookForwardedKeys(connectionId: string): void {
  const keys = hookForwardedKeys.get(connectionId);
  if (!keys || keys.size === 0) return;
  const client = rdpClients.get(connectionId);
  for (const [, k] of keys) client?.sendKeyboard('keyup', k.scanCode, k.extended);
  keys.clear();
}

function handleHookedKey(evt: HookedKeyEvent): boolean {
  // Track Ctrl for Ctrl+Esc regardless of focus; never touch synthetic input
  if (evt.vkCode === VK_LCONTROL || evt.vkCode === VK_RCONTROL) ctrlHeld = evt.down;
  if (evt.injected) return false;

  const id = focusedSessionId;
  if (!id || !captureSystemKeysConnections.has(id)) return false;
  const win = sessionWindows.get(id);
  if (!win || win.isDestroyed() || !win.isFocused()) return false;
  const client = rdpClients.get(id);
  if (!client || !client.isConnected()) return false;

  let forwarded = hookForwardedKeys.get(id);
  if (!forwarded) { forwarded = new Map(); hookForwardedKeys.set(id, forwarded); }

  const vk = evt.vkCode;
  const isWinKey = vk === VK_LWIN || vk === VK_RWIN;
  const isAltCombo = evt.altDown && (vk === VK_TAB || vk === VK_ESCAPE || vk === VK_F4 || vk === VK_SPACE);
  const isCtrlEsc = ctrlHeld && vk === VK_ESCAPE;
  const isPendingRelease = !evt.down && forwarded.has(vk);
  if (!(isWinKey || isAltCombo || isCtrlEsc || isPendingRelease)) return false;

  client.sendKeyboard(evt.down ? 'keydown' : 'keyup', evt.scanCode, evt.extended);
  if (evt.down) forwarded.set(vk, { scanCode: evt.scanCode, extended: evt.extended });
  else forwarded.delete(vk);
  return true; // swallow locally
}
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
const SESSION_TOOLBAR_HEIGHT = 40; // matches h-10 in SessionView toolbar
const RDP_MIN_DIMENSION = 200;
const RDP_MAX_DIMENSION = 8192;

function createSessionWindow(connectionId: string, connectionName: string, rdpWidth = 1920, rdpHeight = 1080) {
  if (sessionWindows.has(connectionId)) {
    const existing = sessionWindows.get(connectionId)!;
    existing.focus();
    return;
  }

  // Scale window to fit within 85% of the screen work area while preserving aspect ratio
  const TOOLBAR_HEIGHT = SESSION_TOOLBAR_HEIGHT;
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

  sessionWin.on('focus', () => { focusedSessionId = connectionId; });
  sessionWin.on('blur', () => {
    if (focusedSessionId === connectionId) focusedSessionId = null;
    releaseHookForwardedKeys(connectionId);
  });

  sessionWin.on('closed', () => {
    if (focusedSessionId === connectionId) focusedSessionId = null;
    hookForwardedKeys.delete(connectionId);
    sessionWindows.delete(connectionId);
    terminateRdpClient(connectionId);
    // Notify main window so it updates connection status
    mainWindow?.webContents.send('rdp:disconnected', connectionId);
  });
}

// Measure the session window's canvas area in *physical* pixels so the remote desktop can be
// negotiated at exactly that size — a 1:1 pixel mapping is the only way to get a truly sharp image.
function measureSessionDesktopSize(connectionId: string): { width: number; height: number } | null {
  const win = sessionWindows.get(connectionId);
  if (!win || win.isDestroyed()) return null;
  const [contentW, contentH] = win.getContentSize();
  const scaleFactor = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
  // Multiples of 4 keep bitmap strides aligned for every codec; clamp to what RDP servers accept
  const width = Math.floor((contentW * scaleFactor) / 4) * 4;
  const height = Math.floor(((contentH - SESSION_TOOLBAR_HEIGHT) * scaleFactor) / 4) * 4;
  if (width < RDP_MIN_DIMENSION || height < RDP_MIN_DIMENSION) return null;
  return {
    width: Math.min(width, RDP_MAX_DIMENSION),
    height: Math.min(height, RDP_MAX_DIMENSION),
  };
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

// Run a PS script file elevated via UAC. The script body is written to a .ps1 file,
// output is captured via [IO.File]::WriteAllText to avoid encoding issues.
function runPowerShellElevated(scriptBody: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpDir = app.getPath('temp');
    const id = Date.now();
    const scriptPath = path.join(tmpDir, `rdpea_hv_${id}.ps1`);
    const outPath = path.join(tmpDir, `rdpea_hv_${id}_out.txt`);
    const errPath = path.join(tmpDir, `rdpea_hv_${id}_err.txt`);

    // Wrap user script: capture output via .NET IO for reliability
    const wrapper = [
      '$ErrorActionPreference = "Stop"',
      'try {',
      scriptBody,
      `  [IO.File]::WriteAllText('${outPath}', $__out)`,
      '} catch {',
      `  [IO.File]::WriteAllText('${errPath}', $_.Exception.Message)`,
      '  exit 1',
      '}',
    ].join('\r\n');
    fs.writeFileSync(scriptPath, wrapper, 'utf8');

    // Clean stale output files
    try { fs.unlinkSync(outPath); } catch {}
    try { fs.unlinkSync(errPath); } catch {}

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

// Prompt user for elevation on first permission error, then cache for session.
async function ensureElevation(): Promise<void> {
  if (hyperVNeedsElevation) return;
  const parentWin = BrowserWindow.getFocusedWindow() || mainWindow;
  const { response } = await dialog.showMessageBox(parentWin!, {
    type: 'warning',
    title: 'Administrator Privileges Required',
    message: 'Hyper-V management requires administrator privileges.',
    detail: 'Windows will show a User Account Control (UAC) prompt. This will be remembered for the rest of this session.',
    buttons: ['Continue', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 1) throw new Error('Elevation cancelled by user');
  hyperVNeedsElevation = true;
}

// Run a simple PS command, trying non-elevated first.
// If permission denied, prompts for elevation and retries.
// Returns the trimmed stdout.
async function runHyperVCmd(cmd: string): Promise<string> {
  if (!hyperVNeedsElevation) {
    try {
      return await runPowerShell(cmd);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('do not have the required permission') ||
          msg.includes('Access is denied') ||
          msg.includes('authorization policy') ||
          msg.includes('UnauthorizedAccessException')) {
        console.log('[HyperV] Permission denied, will request elevation...');
        await ensureElevation();
      } else {
        throw err;
      }
    }
  }
  // Elevated path: wrap single command into a script
  return await runPowerShellElevated(`  $__out = (${cmd}) | Out-String`);
}

// Run a multi-line PS script elevated. The script must set $__out to the desired output string.
async function runHyperVScript(scriptBody: string): Promise<string> {
  if (!hyperVNeedsElevation) {
    // Probe with a simple command to see if we need elevation
    try {
      await runPowerShell('Get-VM | Out-Null');
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('do not have the required permission') ||
          msg.includes('Access is denied') ||
          msg.includes('authorization policy') ||
          msg.includes('UnauthorizedAccessException')) {
        await ensureElevation();
      } else {
        throw err;
      }
    }
  }
  // If we still don't need elevation after the probe, try non-elevated
  if (!hyperVNeedsElevation) {
    // Non-elevated: run the script body in a normal powershell
    // We can't easily do multi-line non-elevated, so just run elevated
    // This path means Get-VM succeeded without elevation (rare but possible)
    return await runPowerShellElevated(scriptBody);
  }
  return await runPowerShellElevated(scriptBody);
}

// Single elevated script: query state → start/resume if needed → return final state
async function hyperVStartOrResume(host: string, vmName: string): Promise<string> {
  const remote = host ? `-ComputerName ${host} ` : '';
  const script = [
    `$vm = Get-VM ${remote}-Name '${vmName}'`,
    `$state = $vm.State.ToString()`,
    `$action = 'none'`,
    `if ($state -eq 'Off' -or $state -eq 'Stopped') {`,
    `  Start-VM ${remote}-Name '${vmName}'`,
    `  $action = 'started'`,
    `} elseif ($state -eq 'Paused' -or $state -eq 'Saved') {`,
    `  Resume-VM ${remote}-Name '${vmName}'`,
    `  $action = 'resumed'`,
    `} elseif ($state -ne 'Running') {`,
    `  Start-VM ${remote}-Name '${vmName}'`,
    `  $action = 'started (fallback)'`,
    `}`,
    `Start-Sleep -Milliseconds 1500`,
    `$final = (Get-VM ${remote}-Name '${vmName}').State.ToString()`,
    `$__out = "$action|$state|$final"`,
  ].join('\r\n');

  const result = await runHyperVScript(script);
  const [action, initialState, finalState] = result.split('|');
  console.log(`[HyperV] VM "${vmName}" was ${initialState}, action=${action}, now ${finalState}`);
  return finalState || '';
}

async function hyperVSave(host: string, vmName: string): Promise<void> {
  const remote = host ? `-ComputerName ${host} ` : '';
  try {
    const script = [
      `Save-VM ${remote}-Name '${vmName}'`,
      `$__out = 'saved'`,
    ].join('\r\n');
    await runHyperVScript(script);
    console.log(`[HyperV] Saved VM "${vmName}"`);
  } catch (err: any) {
    console.error(`[HyperV] Failed to save "${vmName}":`, err.message);
  }
}

async function hyperVCheckModule(): Promise<boolean> {
  try {
    const result = await runPowerShell('Get-Module -ListAvailable Hyper-V | Select-Object -First 1 -ExpandProperty Name');
    return result.toLowerCase().includes('hyper-v');
  } catch {
    return false;
  }
}

// Single script: check module → query VM → return state + diagnostics
async function hyperVTest(host: string, vmName: string): Promise<{ success: boolean; state?: string; error?: string; moduleMissing?: boolean; rawOutput?: string }> {
  const hasModule = await hyperVCheckModule();
  if (!hasModule) {
    return { success: false, error: 'Hyper-V PowerShell module is not installed.', moduleMissing: true };
  }

  const remote = host ? `-ComputerName ${host} ` : '';
  try {
    const script = [
      `$vm = Get-VM ${remote}-Name '${vmName}'`,
      `$state = $vm.State.ToString()`,
      `$name = $vm.Name`,
      `$status = $vm.Status`,
      `$__out = "STATE=$state|NAME=$name|STATUS=$status"`,
    ].join('\r\n');

    const raw = await runHyperVScript(script);
    // Parse structured output
    const parts: Record<string, string> = {};
    for (const pair of raw.split('|')) {
      const [k, ...v] = pair.split('=');
      if (k) parts[k.trim()] = v.join('=').trim();
    }
    const state = parts['STATE'] || undefined;
    return { success: true, state, rawOutput: raw };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function hyperVInstallModule(): Promise<{ success: boolean; error?: string; needsReboot?: boolean }> {
  try {
    const result = await runPowerShellElevated(
      `$feat = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell\r\n` +
      `if ($feat.State -eq 'Enabled') { $__out = 'ALREADY_ENABLED' }\r\n` +
      `else {\r\n` +
      `  $r = Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell -NoRestart -All\r\n` +
      `  if ($r.RestartNeeded) { $__out = 'NEEDS_REBOOT' } else { $__out = 'INSTALLED' }\r\n` +
      `}`
    );
    if (result.includes('NEEDS_REBOOT')) return { success: true, needsReboot: true };
    return { success: true };
  } catch (desktopErr: any) {
    try {
      await runPowerShellElevated(
        `Install-WindowsFeature -Name Hyper-V-PowerShell\r\n$__out = 'INSTALLED'`
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

    // Fit-to-window (default): negotiate the desktop at the window's exact physical pixel size so
    // frames render 1:1 with no scaling. On reconnect this adopts the window's current size.
    if (conn.captureSystemKeys !== false) captureSystemKeysConnections.add(conn.id);
    else captureSystemKeysConnections.delete(conn.id);

    if (conn.fitToWindow !== false) {
      dynamicResizeConnections.add(conn.id);
      const fitted = measureSessionDesktopSize(conn.id);
      if (fitted) {
        console.log(`Fit-to-window: ${fitted.width}x${fitted.height} (profile ${config.width}x${config.height})`);
        config.width = fitted.width;
        config.height = fitted.height;
      }
    } else {
      dynamicResizeConnections.delete(conn.id);
    }

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

    // Cursor shape changes → session window (renderer turns them into CSS cursors)
    client.on('pointer', (upd: PointerUpdate) => {
      const sessionWin = sessionWindows.get(conn.id);
      if (!sessionWin || sessionWin.isDestroyed()) return;
      if (upd.kind === 'new') {
        const img = upd.image;
        sessionWin.webContents.send('rdp:pointer', conn.id, {
          kind: 'new',
          cacheIndex: img.cacheIndex,
          hotX: img.hotX, hotY: img.hotY,
          width: img.width, height: img.height,
          data: new Uint8Array(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength),
        });
      } else if (upd.kind !== 'position') {
        sessionWin.webContents.send('rdp:pointer', conn.id, upd);
      }
    });

    // Server re-activated at a new size (result of a Display Control resize request)
    client.on('resize', (size: { width: number; height: number }) => {
      sendDebugLog(conn.id, `[Display] Desktop resized to ${size.width}x${size.height}`);
      const sessionWin = sessionWindows.get(conn.id);
      if (sessionWin && !sessionWin.isDestroyed()) {
        sessionWin.webContents.send('rdp:resized', conn.id, size);
      }
    });

    client.on('displayControl', (available: boolean) => {
      sendDebugLog(conn.id, `[Display] Dynamic resize ${available ? 'available' : 'unavailable'} (Display Control channel)`);
    });

    client.on('ready', () => {
      const sessionWin = sessionWindows.get(conn.id);
      if (sessionWin && !sessionWin.isDestroyed()) {
        const size = client.getDesktopSize();
        sessionWin.webContents.send('rdp:connected', conn.id, {
          width: size.width,
          height: size.height,
          dynamicResize: dynamicResizeConnections.has(conn.id),
        });
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

  // Session window changed size → ask the server for a matching desktop (fit-to-window only)
  ipcMain.handle('rdp:resize', (_event, connectionId: string, width: number, height: number) => {
    const client = rdpClients.get(connectionId);
    if (!client || !client.isConnected() || !dynamicResizeConnections.has(connectionId)) return false;
    const sent = client.requestDesktopResize(width, height);
    if (!sent) sendDebugLog(connectionId, `[Display] Resize to ${width}x${height} deferred — server has not offered Display Control`);
    return sent;
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
      const state = await hyperVStartOrResume(host, vmName);
      return { success: true, state };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Check for updates (manual trigger)
  ipcMain.on('update:check', () => {
    runUpdateCheck('manual');
  });

  // Current updater state — lets a window that mounted after an event was emitted catch up
  ipcMain.handle('update:get-state', () => updateState);

  // Quit and install downloaded update
  ipcMain.on('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  // Shell
  ipcMain.on('shell:open-external', (_event, url: string) => {
    shell.openExternal(url);
  });
}

// ── Auto-Update ─────────────────────────────────────────────────────
type UpdateStatus = 'idle' | 'unsupported' | 'checking' | 'available' | 'downloading' | 'ready' | 'not-available' | 'error';
interface UpdateState {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  message?: string;
  checkedAt?: number;
}

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // periodic re-check while the app stays open
const UPDATE_RETRY_DELAY_MS = 10 * 60 * 1000;         // after a failed check (offline at launch, GitHub hiccup)
// electron-builder's portable launcher sets this; portable builds cannot self-update
const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;

let updateState: UpdateState = { status: 'idle' };
let updateRetryTimer: ReturnType<typeof setTimeout> | null = null;

function setUpdateState(next: UpdateState, channel?: string, ...args: any[]) {
  updateState = next;
  if (channel && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function runUpdateCheck(reason: 'startup' | 'periodic' | 'retry' | 'manual') {
  if (isDev) return;
  if (updateRetryTimer) { clearTimeout(updateRetryTimer); updateRetryTimer = null; }

  if (isPortableBuild) {
    const message = 'Portable build: download new versions from GitHub';
    // Only surface this when the user asked explicitly; don't nag on every launch
    setUpdateState({ status: 'unsupported', message }, reason === 'manual' ? 'update:error' : undefined, message);
    return;
  }

  console.log(`[updater] Checking for updates (${reason}), current version ${app.getVersion()}`);
  autoUpdater.checkForUpdates().catch((err) => {
    // The 'error' event handler already reports and schedules a retry
    console.error('[updater] checkForUpdates rejected:', err?.message || err);
  });
}

function setupAutoUpdater() {
  if (isDev) return; // Skip in dev mode

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Set update channel based on version so each install only gets its own updates
  const version = app.getVersion();
  if (version.includes('alpha')) {
    autoUpdater.channel = 'alpha';
    autoUpdater.allowPrerelease = true;
  } else if (version.includes('beta')) {
    autoUpdater.channel = 'beta';
    autoUpdater.allowPrerelease = true;
  }
  // Stable builds default to 'latest' channel — no changes needed

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
    setUpdateState({ status: 'checking' }, 'update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
    setUpdateState({ status: 'available', version: info.version }, 'update:available', info.version);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[updater] No update available (latest ${info?.version ?? 'unknown'})`);
    setUpdateState({ status: 'not-available', version: info?.version, checkedAt: Date.now() }, 'update:not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    setUpdateState({ status: 'downloading', version: updateState.version, percent }, 'update:progress', percent);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    setUpdateState({ status: 'ready', version: info.version }, 'update:ready', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
    setUpdateState({ status: 'error', message: err.message, checkedAt: Date.now() }, 'update:error', err.message);
    // Network was probably down (laptop resume, captive portal, GitHub outage) — try again later
    if (updateRetryTimer) clearTimeout(updateRetryTimer);
    updateRetryTimer = setTimeout(() => runUpdateCheck('retry'), UPDATE_RETRY_DELAY_MS);
  });

  // First check only once the renderer is listening, otherwise the result is emitted into a
  // window that hasn't mounted yet and the "update available" toast is silently lost.
  const startFirstCheck = () => setTimeout(() => runUpdateCheck('startup'), 3000);
  if (mainWindow && mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', startFirstCheck);
  } else {
    startFirstCheck();
  }

  // Keep checking while the app stays open
  setInterval(() => runUpdateCheck('periodic'), UPDATE_CHECK_INTERVAL_MS);
}

// ── App Lifecycle ────────────────────────────────────────────────────
app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
  setupAutoUpdater();
  installKeyHook(handleHookedKey);

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

app.on('will-quit', () => {
  uninstallKeyHook();
});
