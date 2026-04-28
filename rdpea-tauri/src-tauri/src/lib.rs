mod commands;
mod storage;
mod rdp;

use commands::*;
use tauri::Emitter;

pub fn run() {
    eprintln!("[RDPea] App starting — Rust backend v{}", env!("CARGO_PKG_VERSION"));
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_connections,
            save_connections,
            rdp_connect,
            rdp_disconnect,
            rdp_status,
            rdp_keyboard,
            rdp_mouse,
            rdp_set_debug,
            rdp_set_debug_global,
            rdp_get_debug_global,
            app_version,
            window_minimize,
            window_maximize,
            window_close,
            window_pin,
            open_session_window,
            open_external,
            hyperv_test,
            hyperv_install_module,
            hyperv_start,
        ])
        .setup(|app| {
            env_logger::init();
            eprintln!("[RDPea] Tauri setup complete");
            app.emit("rdp:debug-log", serde_json::json!({
                "connectionId": "_system",
                "message": format!("RDPea v{} started — Tauri backend ready", env!("CARGO_PKG_VERSION"))
            })).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
