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

## Android ⚠️ (Android Studio install; mirrors the CI build in `.github/workflows/build.yml`)
The local build is set up to mirror CI exactly — **same pinned versions** as the
GitHub Actions `android-apk` job: **JDK 17**, **NDK `26.3.11579264`**,
**`platforms;android-34`**, **`build-tools;34.0.0`**.

This machine uses **Android Studio** (JetBrains Toolbox), so its SDK lives at
`~/Android/Sdk` — install the components there rather than in `/opt`. (`butler.py`
checks `~/Android/Sdk` before `/opt/android-sdk`, so keep everything in the Studio
SDK to avoid a split toolchain.)

1. **JDK 17** — official repo (matches CI; avoids relying on Studio's bundled JBR 21):
   ```bash
   sudo pacman -S --needed jdk17-openjdk
   ```
   *(Alternatively skip this and point `JAVA_HOME` at Studio's JBR:
   `~/.local/share/JetBrains/Toolbox/apps/android-studio/jbr` — JDK 21, usually fine.)*

2. **Command-line tools** — Android Studio → **SDK Manager** (Settings → Languages &
   Frameworks → Android SDK) → **SDK Tools** tab → check **"Android SDK Command-line
   Tools (latest)"** → Apply. This puts `sdkmanager` at
   `~/Android/Sdk/cmdline-tools/latest/bin`.

3. **CI-pinned components** — install with that `sdkmanager` so versions match CI
   (don't grab a different NDK via the GUI's "NDK (Side by side)", which pulls the
   latest):
   ```bash
   ~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager --licenses
   ~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager \
     "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.3.11579264"
   ```

4. **Rust targets**:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

`butler.py` auto-fills `JAVA_HOME` / `ANDROID_HOME` / `NDK_HOME` from these locations
when they're unset (it picks `~/Android/Sdk` and prefers NDK `26.3.11579264`), so no
exports are required. To set them anyway (fish — add to `~/.config/fish/config.fish`):
```fish
set -gx JAVA_HOME /usr/lib/jvm/java-17-openjdk
set -gx ANDROID_HOME $HOME/Android/Sdk
set -gx NDK_HOME $ANDROID_HOME/ndk/26.3.11579264
fish_add_path $ANDROID_HOME/cmdline-tools/latest/bin $ANDROID_HOME/platform-tools
```

### Build a sideloadable APK
`cargo tauri android build` produces an **unsigned** release APK — which is exactly
what CI uploads — and **Android won't install an unsigned APK**. So for a phone you
need a *signed* APK. Two options:

**Quick (own phone, no setup): debug APK.** Auto-signed with the Android debug key,
installs immediately:
```bash
python butler.py app android init            # one-time: generates src-tauri/gen/android
python butler.py app android build --debug   # → dist/app-universal-debug.apk
```

**Distributable: signed release APK.** Make a self-signed keystore once (fine for
sideloading; *not* for the Play Store — change the identifier first for that), then
`butler.py` signs every release build automatically (`zipalign` + `apksigner`) and
drops the signed APK in `dist/`:
```bash
python butler.py app android keygen          # → app/.android/{chords.jks,keystore.properties} (git-ignored)
python butler.py app android build           # → dist/app-universal-release.apk (signed)
```
Keep that keystore safe and back it up — Android only allows in-place upgrades when
the new APK is signed with the **same** key. To override the keystore/passwords
without the properties file, set `CHORDS_ANDROID_KEYSTORE`, `CHORDS_ANDROID_KS_PASS`,
`CHORDS_ANDROID_KEY_ALIAS`, `CHORDS_ANDROID_KEY_PASS`. `--no-sign` leaves the release
APK unsigned (matches raw CI output).

Install on a device: enable USB debugging and `adb install dist/app-universal-*.apk`,
or copy the APK over and tap it (allow "install unknown apps").

---

## Notes
- **CSP** (`tauri.conf.json` → `app.security.csp`) allows `connect-src https: http:` so the app can reach whatever backend you configure, and `script-src 'unsafe-eval'` because the frontend transpiles JSX in-browser via Babel. Tighten `connect-src` to your host(s) if you prefer.
- **Identifier** is `app.chords.client` (neutral placeholder). Change it before submitting to any app store.
- `src-tauri/gen/` and `src-tauri/target/` are git-ignored. If you want the generated Android project under version control (to keep manual native tweaks), remove those lines from the root `.gitignore`.
- `butler.py app build` / `app android build` copy their installers into `dist/` automatically.
