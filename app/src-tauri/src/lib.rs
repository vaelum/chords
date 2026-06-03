// Shared entry point for desktop (main.rs) and mobile (Android/iOS) runtimes.
// On mobile, `tauri::mobile_entry_point` exposes `run()` to the platform shell.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Work around a webkit2gtk DMABUF-renderer bug that breaks resource loading
    // (blank window + repeated "internallyFailedLoadTimerFired", and Wayland
    // "Protocol error") on many Linux GPU/compositor combos. Set before GTK/
    // WebKit init. Harmless elsewhere; an explicit env export still wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
