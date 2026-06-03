# chords — native app (Tauri v2)

Native desktop & mobile builds of the chords frontend, wrapped with [Tauri v2](https://tauri.app).

The app **bundles the web frontend** from [`../server/frontend`](../server/frontend) (set as `frontendDist` in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)) and talks to a chords backend over the network. There is **no server URL baked in** — on first launch you enter your server (e.g. `https://your-host`) on the login screen; it's stored locally and can be changed later under **Settings → Connection**.

```
app/
  src-tauri/
    Cargo.toml          Rust crate (lib + bin; lib entry is shared with mobile)
    tauri.conf.json     window, CSP, bundle config; frontendDist → ../../server/frontend
    src/{main,lib}.rs   entry points
    capabilities/       Tauri v2 permissions
    icons/              generated from server/frontend/assets/png/chords-icon-1024.png
    gen/                generated Android project (git-ignored; created by `android init`)
```

## Prerequisites (all platforms)
- **Rust** (stable) + the Tauri CLI: `cargo install tauri-cli --version "^2.0.0"` (already installed on this machine).
- Run all commands from `app/` (or `app/src-tauri/`).

Regenerate icons after changing the source art:
```bash
cd src-tauri && cargo tauri icon ../../server/frontend/assets/png/chords-icon-1024.png
```

---

## Linux ✅ (builds here)
System deps: `webkit2gtk-4.1` (present), plus the usual `base-devel`. On CachyOS/Arch:
```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
  librsvg gtk3 libappindicator-gtk3
```
Run / build:
```bash
cd app
cargo tauri dev                 # hot dev window
cargo tauri build               # → src-tauri/target/release/bundle/{appimage,deb,rpm}/
```
A Linux build produces three installable bundles: a **Debian** package (`.deb`), an
**RPM** package (`.rpm`), and an **AppImage**. Restrict it to specific ones with
e.g. `cargo tauri build --bundles deb rpm appimage`.
If the AppImage step fails with `failed to run linuxdeploy` (missing FUSE), prefix the
build with `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1`. The repo's [`butler.py`](../butler.py)
(`python butler.py app build`) sets these automatically on Linux.

---

## Windows ⚠️ (supported but untested — build on Windows, not from Linux)
Windows support is wired up but **has not been tested yet** — expect rough edges.
Cross-compiling a WebView2 app from Linux isn't practical, so build on a Windows machine (or a Windows CI runner):
1. Install Rust (MSVC toolchain), the **WebView2 runtime** (preinstalled on Win 11), and VS Build Tools (C++).
2. `cargo install tauri-cli --version "^2.0.0"`
3. From `app/`: `cargo tauri build` → `src-tauri/target/release/bundle/{nsis,msi}/` (`.exe` / `.msi`).

---

## Android ⚠️ (supported but untested — CachyOS install, toolchain installed manually)
Android support is wired up but **has not been tested yet** — expect rough edges.
Install JDK (official repo) + SDK cmdline-tools/platform-tools/NDK (AUR):
```bash
sudo pacman -S --needed jdk17-openjdk
paru -S --needed android-sdk-cmdline-tools-latest android-sdk-platform-tools android-ndk
```
The Arch `android-sdk*` packages live in `/opt/android-sdk` (root-owned) — make it
writable for your user, then accept licenses and pull a platform + build-tools:
```bash
sudo chown -R "$USER" /opt/android-sdk
sdkmanager --sdk_root=/opt/android-sdk --licenses
sdkmanager --sdk_root=/opt/android-sdk "platforms;android-34" "build-tools;34.0.0"
```
Export the env (fish — add to `~/.config/fish/config.fish`):
```fish
set -gx JAVA_HOME /usr/lib/jvm/java-17-openjdk
set -gx ANDROID_HOME /opt/android-sdk
set -gx NDK_HOME /opt/android-ndk          # or $ANDROID_HOME/ndk/<version>
fish_add_path $ANDROID_HOME/cmdline-tools/latest/bin $ANDROID_HOME/platform-tools
```
Add the Rust targets:
```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```
Build (run from the repo root; `butler.py` auto-fills the env vars above if they're
unset and copies the resulting APK into `dist/`):
```bash
python butler.py app android init     # one-time: generates src-tauri/gen/android
python butler.py app android build    # → dist/*.apk
# direct equivalent: cd app && cargo tauri android build --apk
```

---

## Notes
- **CSP** (`tauri.conf.json` → `app.security.csp`) allows `connect-src https: http:` so the app can reach whatever backend you configure, and `script-src 'unsafe-eval'` because the frontend transpiles JSX in-browser via Babel. Tighten `connect-src` to your host(s) if you prefer.
- **Identifier** is `app.chords.client` (neutral placeholder). Change it before submitting to any app store.
- `src-tauri/gen/` and `src-tauri/target/` are git-ignored. If you want the generated Android project under version control (to keep manual native tweaks), remove those lines from the root `.gitignore`.
- `butler.py app build` / `app android build` copy their installers into `dist/` automatically.
