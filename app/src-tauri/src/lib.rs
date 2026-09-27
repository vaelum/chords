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
        // The bundled frontend again, under a name of our own. On Android Tauri
        // serves its pages from http://tauri.localhost, the same address for
        // every Tauri app on the phone, and Android hands that address — not the
        // app — to password managers: Bitwarden filed chords logins under
        // "tauri.localhost" and would offer them in any Tauri app. Pages from
        // this protocol are http://chords.localhost instead, and
        // tauri.android.conf.json points the window here. Desktop keeps the
        // built-in origin, and with it the login its storage already holds.
        // wry claims every request to http://chords.<anything> for this, so a
        // server at a plain-http address starting "chords." cannot be reached
        // from the Android app; https addresses are not affected.
        .register_uri_scheme_protocol("chords", |ctx, request| {
            // The same lookup the built-in protocol does: "/" is index.html, and
            // an HTML page comes with tauri.conf.json's CSP, filled in with the
            // hashes of the scripts Tauri injects.
            match ctx.app_handle().asset_resolver().get(request.uri().path().to_string()) {
                Some(asset) => {
                    let mut response = tauri::http::Response::builder()
                        .header(tauri::http::header::CONTENT_TYPE, asset.mime_type());
                    if let Some(csp) = asset.csp_header() {
                        response = response.header("Content-Security-Policy", csp);
                    }
                    response.body(asset.bytes).unwrap()
                }
                None => tauri::http::Response::builder().status(404).body(Vec::new()).unwrap(),
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
