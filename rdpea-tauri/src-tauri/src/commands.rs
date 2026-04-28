// Tauri IPC command handlers — mirrors the Electron IPC API
use crate::rdp::client::RdpClient;
use crate::rdp::types::RdpClientConfig;
use crate::storage;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

// ── App State ────────────────────────────────────────────────────────

pub struct AppState {
    pub rdp_clients: Mutex<HashMap<String, RdpClient>>,
    pub debug_connections: Mutex<HashSet<String>>,
    pub debug_global: Mutex<bool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            rdp_clients: Mutex::new(HashMap::new()),
            debug_connections: Mutex::new(HashSet::new()),
            debug_global: Mutex::new(false),
        }
    }
}

// ── Serializable types for IPC ───────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ConnectionData {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(rename = "audioMode")]
    pub audio_mode: Option<u8>,
    #[serde(rename = "redirectClipboard")]
    pub redirect_clipboard: Option<bool>,
    #[serde(rename = "hyperVEnabled")]
    pub hyper_v_enabled: Option<bool>,
    #[serde(rename = "hyperVHost")]
    pub hyper_v_host: Option<String>,
    #[serde(rename = "hyperVVmName")]
    pub hyper_v_vm_name: Option<String>,
}

#[derive(Serialize)]
pub struct ConnectResult {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct HyperVTestResult {
    pub success: bool,
    pub state: Option<String>,
    pub error: Option<String>,
    #[serde(rename = "moduleMissing")]
    pub module_missing: Option<bool>,
}

#[derive(Serialize)]
pub struct HyperVInstallResult {
    pub success: bool,
    pub error: Option<String>,
    #[serde(rename = "needsReboot")]
    pub needs_reboot: Option<bool>,
}

#[derive(Serialize)]
pub struct HyperVStartResult {
    pub success: bool,
    pub state: Option<String>,
    pub error: Option<String>,
}

// ── Window Controls ──────────────────────────────────────────────────

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) {
    window.minimize().ok();
}

#[tauri::command]
pub fn window_maximize(window: WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().ok();
    } else {
        window.maximize().ok();
    }
}

#[tauri::command]
pub fn window_close(window: WebviewWindow, app: AppHandle) {
    // If this is the main window, exit the whole process
    let label = window.label().to_string();
    window.close().ok();
    if label == "main" {
        app.exit(0);
    }
}

#[tauri::command]
pub fn window_pin(window: WebviewWindow, pinned: bool) {
    window.set_always_on_top(pinned).ok();
}

// ── Connection CRUD ──────────────────────────────────────────────────

#[tauri::command]
pub fn load_connections() -> Result<serde_json::Value, String> {
    storage::load_connections().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_connections(connections: serde_json::Value) -> Result<bool, String> {
    storage::save_connections(&connections).map_err(|e| e.to_string())?;
    Ok(true)
}

// ── RDP Session Management ───────────────────────────────────────────

#[tauri::command]
pub async fn rdp_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    connection: ConnectionData,
) -> Result<ConnectResult, String> {
    let conn_id = connection.id.clone();
    let conn_name = connection.name.clone();

    // Check for existing connection
    {
        let clients = state.rdp_clients.lock().map_err(|e| e.to_string())?;
        if let Some(client) = clients.get(&conn_id) {
            if client.is_connected() {
                return Ok(ConnectResult {
                    success: true,
                    error: None,
                });
            }
        }
    }

    // Clean up stale client
    {
        let mut clients = state.rdp_clients.lock().map_err(|e| e.to_string())?;
        if let Some(mut old) = clients.remove(&conn_id) {
            old.disconnect();
        }
    }

    // Build config
    let domain = connection.domain.clone().unwrap_or_default();
    let domain = if domain.is_empty() {
        let host_part = connection.host.split(':').next().unwrap_or(&connection.host);
        let label = host_part.split('.').next().unwrap_or(host_part);
        label.to_uppercase()
    } else {
        domain
    };

    let config = RdpClientConfig {
        host: connection.host.clone(),
        port: connection.port.unwrap_or(3389),
        username: connection.username.clone().unwrap_or_default(),
        password: connection.password.clone().unwrap_or_default(),
        domain,
        width: connection.width.unwrap_or(1920),
        height: connection.height.unwrap_or(1080),
        color_depth: 16,
        enable_audio: connection.audio_mode.unwrap_or(0) != 2,
        enable_clipboard: connection.redirect_clipboard.unwrap_or(true),
        security: "any".to_string(),
    };

    // Open session window
    open_session_window_internal(&app, &conn_id, &conn_name, config.width, config.height)?;

    // Create and start client
    let app_handle = app.clone();
    let conn_id_clone = conn_id.clone();
    let mut client = RdpClient::new(config);

    // Set up event forwarding to the session window
    client.set_event_handler(move |event| {
        let _ = forward_rdp_event(&app_handle, &conn_id_clone, event);
    });

    // Auto-enable debug if global
    {
        let debug_global = state.debug_global.lock().map_err(|e| e.to_string())?;
        if *debug_global {
            let mut debug_conns = state.debug_connections.lock().map_err(|e| e.to_string())?;
            debug_conns.insert(conn_id.clone());
        }
    }

    // Start connection in background
    let connect_result = client.connect().await;

    match connect_result {
        Ok(()) => {
            let mut clients = state.rdp_clients.lock().map_err(|e| e.to_string())?;
            clients.insert(conn_id, client);
            Ok(ConnectResult {
                success: true,
                error: None,
            })
        }
        Err(e) => Ok(ConnectResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub fn rdp_disconnect(state: State<'_, AppState>, connection_id: String) -> Result<bool, String> {
    let mut clients = state.rdp_clients.lock().map_err(|e| e.to_string())?;
    if let Some(mut client) = clients.remove(&connection_id) {
        client.disconnect();
    }
    let mut debug_conns = state.debug_connections.lock().map_err(|e| e.to_string())?;
    debug_conns.remove(&connection_id);
    Ok(true)
}

#[tauri::command]
pub fn rdp_status(state: State<'_, AppState>, connection_id: String) -> Result<bool, String> {
    let clients = state.rdp_clients.lock().map_err(|e| e.to_string())?;
    Ok(clients
        .get(&connection_id)
        .map(|c| c.is_connected())
        .unwrap_or(false))
}

#[tauri::command]
pub fn rdp_keyboard(
    state: State<'_, AppState>,
    connection_id: String,
    event_type: String,
    scan_code: u16,
    extended: bool,
) -> Result<(), String> {
    let clients = state.rdp_clients.lock().map_err(|e| e.to_string())?;
    if let Some(client) = clients.get(&connection_id) {
        client.send_keyboard(&event_type, scan_code, extended);
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_mouse(
    state: State<'_, AppState>,
    connection_id: String,
    event_type: String,
    x: u16,
    y: u16,
    button: Option<String>,
    wheel_delta: Option<i16>,
) -> Result<(), String> {
    let clients = state.rdp_clients.lock().map_err(|e| e.to_string())?;
    if let Some(client) = clients.get(&connection_id) {
        client.send_mouse(&event_type, x, y, button.as_deref(), wheel_delta);
    }
    Ok(())
}

// ── Debug ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn rdp_set_debug(
    state: State<'_, AppState>,
    connection_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut debug_conns = state.debug_connections.lock().map_err(|e| e.to_string())?;
    if enabled {
        debug_conns.insert(connection_id);
    } else {
        debug_conns.remove(&connection_id);
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_set_debug_global(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    {
        let mut debug_global = state.debug_global.lock().map_err(|e| e.to_string())?;
        *debug_global = enabled;
    }
    if enabled {
        let clients = state.rdp_clients.lock().map_err(|e| e.to_string())?;
        let mut debug_conns = state.debug_connections.lock().map_err(|e| e.to_string())?;
        for id in clients.keys() {
            debug_conns.insert(id.clone());
        }
    } else {
        let mut debug_conns = state.debug_connections.lock().map_err(|e| e.to_string())?;
        debug_conns.clear();
    }
    // Notify all windows
    app.emit("rdp:debug-global", enabled).ok();
    Ok(())
}

#[tauri::command]
pub fn rdp_get_debug_global(state: State<'_, AppState>) -> Result<bool, String> {
    let debug_global = state.debug_global.lock().map_err(|e| e.to_string())?;
    Ok(*debug_global)
}

// ── App Info ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── Session Window ───────────────────────────────────────────────────

#[tauri::command]
pub fn open_session_window(
    app: AppHandle,
    connection_id: String,
    connection_name: String,
) -> Result<(), String> {
    open_session_window_internal(&app, &connection_id, &connection_name, 1920, 1080)
}

fn open_session_window_internal(
    app: &AppHandle,
    connection_id: &str,
    connection_name: &str,
    rdp_width: u32,
    rdp_height: u32,
) -> Result<(), String> {
    let label = format!("session-{}", connection_id);

    // If window already exists, focus it
    if let Some(win) = app.get_webview_window(&label) {
        win.set_focus().ok();
        return Ok(());
    }

    // Scale to 85% of primary monitor
    let scale = 0.85f64;
    let win_width = (rdp_width as f64 * scale) as u32;
    let win_height = (rdp_height as f64 * scale + 40.0) as u32; // +40 for toolbar

    let url = format!("#/session/{}", connection_id);

    let _window = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(url.into()))
        .title(format!("RDPea — {}", connection_name))
        .inner_size(win_width as f64, win_height as f64)
        .min_inner_size(320.0, 280.0)
        .decorations(false)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Shell ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_external(url: String) {
    // Use tauri-plugin-shell to open URLs
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", &url])
            .spawn()
            .ok();
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&url).spawn().ok();
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .ok();
    }
}

// ── Hyper-V (Windows only) ───────────────────────────────────────────

#[tauri::command]
pub async fn hyperv_test(host: String, vm_name: String) -> Result<HyperVTestResult, String> {
    #[cfg(target_os = "windows")]
    {
        let remote = if host.is_empty() {
            String::new()
        } else {
            format!("-ComputerName {} ", host)
        };
        let cmd = format!(
            "Get-VM {}-Name '{}' | Select-Object -ExpandProperty State",
            remote, vm_name
        );
        match run_powershell(&cmd).await {
            Ok(output) => Ok(HyperVTestResult {
                success: true,
                state: Some(output.trim().to_string()),
                error: None,
                module_missing: None,
            }),
            Err(e) => {
                let msg = e.to_string();
                let module_missing = msg.contains("not recognized") || msg.contains("not loaded");
                Ok(HyperVTestResult {
                    success: false,
                    state: None,
                    error: Some(msg),
                    module_missing: Some(module_missing),
                })
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (host, vm_name);
        Ok(HyperVTestResult {
            success: false,
            state: None,
            error: Some("Hyper-V is only available on Windows".to_string()),
            module_missing: None,
        })
    }
}

#[tauri::command]
pub async fn hyperv_install_module() -> Result<HyperVInstallResult, String> {
    #[cfg(target_os = "windows")]
    {
        match run_powershell("Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell -NoRestart -All").await {
            Ok(_) => Ok(HyperVInstallResult { success: true, error: None, needs_reboot: Some(false) }),
            Err(e) => Ok(HyperVInstallResult { success: false, error: Some(e.to_string()), needs_reboot: None }),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(HyperVInstallResult {
            success: false,
            error: Some("Hyper-V is only available on Windows".to_string()),
            needs_reboot: None,
        })
    }
}

#[tauri::command]
pub async fn hyperv_start(host: String, vm_name: String) -> Result<HyperVStartResult, String> {
    #[cfg(target_os = "windows")]
    {
        let remote = if host.is_empty() {
            String::new()
        } else {
            format!("-ComputerName {} ", host)
        };
        let cmd = format!("Start-VM {}-Name '{}'", remote, vm_name);
        match run_powershell(&cmd).await {
            Ok(_) => Ok(HyperVStartResult {
                success: true,
                state: Some("Running".to_string()),
                error: None,
            }),
            Err(e) => Ok(HyperVStartResult {
                success: false,
                state: None,
                error: Some(e.to_string()),
            }),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (host, vm_name);
        Ok(HyperVStartResult {
            success: false,
            state: None,
            error: Some("Hyper-V is only available on Windows".to_string()),
        })
    }
}

#[cfg(target_os = "windows")]
async fn run_powershell(cmd: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let output = tokio::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", cmd])
        .output()
        .await?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string().into())
    }
}

// ── RDP Event Forwarding ─────────────────────────────────────────────

use crate::rdp::client::RdpEvent;

fn forward_rdp_event(
    app: &AppHandle,
    connection_id: &str,
    event: RdpEvent,
) -> Result<(), String> {
    let label = format!("session-{}", connection_id);
    let window = app.get_webview_window(&label);

    match event {
        RdpEvent::Connected { width, height } => {
            if let Some(win) = &window {
                win.emit("rdp:connected", serde_json::json!({
                    "connectionId": connection_id,
                    "width": width,
                    "height": height,
                })).ok();
            }
            // Also notify main window
            app.emit("rdp:connected", connection_id).ok();
        }
        RdpEvent::Bitmap { rects } => {
            if let Some(win) = &window {
                win.emit("rdp:frame", serde_json::json!({
                    "connectionId": connection_id,
                    "rects": rects,
                })).ok();
            }
        }
        RdpEvent::Audio { data, channels, sample_rate, bits_per_sample } => {
            if let Some(win) = &window {
                win.emit("rdp:audio", serde_json::json!({
                    "connectionId": connection_id,
                    "data": data,
                    "channels": channels,
                    "sampleRate": sample_rate,
                    "bitsPerSample": bits_per_sample,
                })).ok();
            }
        }
        RdpEvent::Clipboard { text } => {
            // Write to system clipboard
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                clipboard.set_text(&text).ok();
            }
        }
        RdpEvent::Disconnected => {
            if let Some(win) = &window {
                win.emit("rdp:disconnected", connection_id).ok();
            }
            app.emit("rdp:disconnected", connection_id).ok();
        }
        RdpEvent::Error { message } => {
            if let Some(win) = &window {
                win.emit("rdp:error", serde_json::json!({
                    "connectionId": connection_id,
                    "message": message,
                })).ok();
            }
            app.emit("rdp:error", serde_json::json!({
                "connectionId": connection_id,
                "message": message,
            })).ok();
        }
        RdpEvent::Log { message } => {
            eprintln!("[RDP:{}] {}", connection_id, message);
            let payload = serde_json::json!({
                "connectionId": connection_id,
                "message": message,
            });
            if let Some(win) = &window {
                win.emit("rdp:debug-log", &payload).ok();
            }
            // Also broadcast to all windows so dashboard/console can show it
            app.emit("rdp:debug-log", &payload).ok();
        }
    }

    Ok(())
}
