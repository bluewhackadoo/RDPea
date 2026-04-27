mod commands;
mod storage;
mod rdp;

use commands::*;

pub fn run() {
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
        .setup(|_app| {
            env_logger::init();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
