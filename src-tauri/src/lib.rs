use tauri::Manager;

mod commands;
mod config;
mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::api_key::api_key_get,
            commands::api_key::api_key_set,
            commands::api_key::api_key_has,
            commands::api_key::api_key_delete,
            commands::settings::settings_load,
            commands::settings::settings_save,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").expect("main window");
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
