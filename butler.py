#!/usr/bin/env python3
"""chords project butler — one entry point for the three components.

Usage:
    python butler.py <component> <action> [options]

Components & actions:

  server    run        Run the backend locally with uvicorn --reload (no Docker)
            dev        Build & start the dev stack in Docker (port 8000, no Caddy)
            build      Build & start the production stack in Docker (Caddy + TLS)
            deploy     Rsync the server/ folder to the remote and restart it
            backup     Back up the local ~/.chords data directory

  app       dev        Run the Tauri desktop app with hot reload
            build      Build desktop bundles for THIS OS (--debug, --bundles ...)
            icon       Regenerate app icons from the 1024px source art
            android    <init|dev|build|keygen>   Android (needs the SDK/NDK toolchain)
                       build [--debug] [--no-sign]; keygen creates a signing key

  extension package    Zip the browser extension into dist/ for distribution

Examples:
    python butler.py server dev
    python butler.py server deploy
    python butler.py app dev
    python butler.py app build --bundles deb appimage
    python butler.py app android keygen          # one-time: signing key for release APKs
    python butler.py app android build           # signed release APK -> dist/
    python butler.py app android build --debug   # debug APK (auto-signed), quick sideload
    python butler.py extension package
"""

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server"
APP = ROOT / "app"
EXT = ROOT / "extension"
DIST = ROOT / "dist"

# Android toolchain version pinned to match CI (.github/workflows/build.yml), so a
# local build mirrors the released APK. Install it with:
#   sdkmanager "ndk;26.3.11579264" "platforms;android-34" "build-tools;34.0.0"
CI_NDK_VERSION = "26.3.11579264"

# Local Android signing material lives in a central vault OUTSIDE the repo, so the
# keystore is never inside a project tree and one vault can sign several apps (one
# subfolder per app: <vault>/<app>/<app>.jks + keystore.properties). Point
# ANDROID_KEYSTORE_VAULT at the vault root; we use the <vault>/chords/ subfolder.
# If the vault isn't configured (other contributors, or CI — which signs via its
# own env vars / GitHub secrets), fall back to the in-repo app/.android so the repo
# still builds. The generated gen/android project stays regenerable — we sign the
# built release APK as a post-build step instead of editing the generated Gradle
# files. CI ships an *unsigned* release APK; signing here makes it sideloadable.
APP_KEY_NAME = "chords"
_KEYSTORE_VAULT = os.environ.get("ANDROID_KEYSTORE_VAULT")
ANDROID_DIR = (Path(_KEYSTORE_VAULT).expanduser() / APP_KEY_NAME
               if _KEYSTORE_VAULT else APP / ".android")
KEYSTORE = ANDROID_DIR / f"{APP_KEY_NAME}.jks"
KEYSTORE_PROPS = ANDROID_DIR / "keystore.properties"


def _disp(path):
    """Path for display: repo-relative when inside the tree, else absolute (the
    keystore vault lives outside the repo)."""
    try:
        return path.relative_to(ROOT)
    except ValueError:
        return path


def run(cmd, cwd, extra_env=None):
    """Echo and run a command in `cwd`, returning its exit code."""
    printable = " ".join(str(c) for c in cmd)
    print(f"\n\033[1;34m$ {printable}\033[0m  \033[2m(cwd={cwd})\033[0m\n", flush=True)
    env = {**os.environ, **extra_env} if extra_env else None
    try:
        return subprocess.run([str(c) for c in cmd], cwd=str(cwd), env=env).returncode
    except FileNotFoundError as e:
        print(f"\033[1;31merror:\033[0m {e}", file=sys.stderr)
        return 127
    except KeyboardInterrupt:
        return 130


# Every installable we know how to produce ends with one of these.
INSTALLER_SUFFIXES = (
    ".deb", ".appimage", ".rpm",          # linux
    ".msi", ".exe",                        # windows
    ".dmg", ".app.tar.gz",                 # macOS
    ".apk", ".aab",                        # android
)


def collect_to_dist(roots):
    """Copy any installer artifacts found under `roots` into dist/. Returns the list."""
    DIST.mkdir(exist_ok=True)
    copied = []
    for root in roots:
        if not root.is_dir():
            continue
        for p in root.rglob("*"):
            if p.is_file() and any(p.name.lower().endswith(s) for s in INSTALLER_SUFFIXES):
                dest = DIST / p.name
                shutil.copy2(p, dest)
                copied.append(dest)
    if copied:
        print("\n\033[1;32mcopied to dist/\033[0m")
        for d in copied:
            print(f"  {d.relative_to(ROOT)}  ({d.stat().st_size:,} bytes)")
    else:
        print("\n\033[1;33mnote:\033[0m no installer artifacts found to copy into dist/.")
    return copied


# --------------------------------------------------------------------------- #
# server
# --------------------------------------------------------------------------- #

def server_run(_args):
    # Local dev without Docker. Needs server/backend/requirements.txt installed
    # in the active environment. backend is a package under server/.
    return run(
        [sys.executable, "-m", "uvicorn", "backend.main:app",
         "--reload", "--host", "127.0.0.1", "--port", "8000"],
        cwd=SERVER,
    )


def server_dev(_args):
    return run(["bash", "scripts/build.sh", "dev"], cwd=SERVER)


def server_build(_args):
    return run(["bash", "scripts/build.sh"], cwd=SERVER)


def server_deploy(_args):
    return run(["bash", "scripts/deploy.sh"], cwd=SERVER)


def server_backup(_args):
    return run(["bash", "scripts/backup.sh"], cwd=SERVER)


# --------------------------------------------------------------------------- #
# app (Tauri)
# --------------------------------------------------------------------------- #

def android_env():
    """Best-effort fill of JAVA_HOME / ANDROID_HOME / NDK_HOME from common Arch
    (CachyOS) package locations when they aren't already exported. The shell
    environment always wins — this only fills in what's missing."""
    home = Path.home()
    env = {}

    if not (os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")):
        for cand in (home / "Android" / "Sdk", Path("/opt/android-sdk")):
            if cand.is_dir():
                env["ANDROID_HOME"] = str(cand)
                break

    sdk = Path(env.get("ANDROID_HOME") or os.environ.get("ANDROID_HOME")
               or os.environ.get("ANDROID_SDK_ROOT") or (home / "Android" / "Sdk"))
    if not os.environ.get("NDK_HOME"):
        # Prefer the exact NDK version CI uses; otherwise fall back to the newest
        # one installed (sdkmanager under $ANDROID_HOME/ndk, or the Arch AUR path).
        pinned = sdk / "ndk" / CI_NDK_VERSION
        cands = sorted(p for p in (sdk / "ndk").iterdir() if p.is_dir()) if (sdk / "ndk").is_dir() else []
        if Path("/opt/android-ndk").is_dir():
            cands.append(Path("/opt/android-ndk"))
        if pinned.is_dir():
            env["NDK_HOME"] = str(pinned)
        elif cands:
            env["NDK_HOME"] = str(cands[-1])

    if not os.environ.get("JAVA_HOME"):
        for cand in (Path("/usr/lib/jvm/java-17-openjdk"), Path("/usr/lib/jvm/default"),
                     home / "Android" / "jdk"):
            if cand.is_dir():
                env["JAVA_HOME"] = str(cand)
                break

    return env or None


def app_dev(_args):
    return run(["cargo", "tauri", "dev"], cwd=APP)


def app_build(args):
    cmd = ["cargo", "tauri", "build"]
    if args.debug:
        cmd.append("--debug")
    if args.no_bundle:
        cmd.append("--no-bundle")
    elif args.bundles:
        cmd += ["--bundles", *args.bundles]
    # AppImage's linuxdeploy needs FUSE; this fallback extracts-and-runs instead,
    # which works on headless/sandboxed Linux hosts where FUSE is unavailable.
    extra_env = {"APPIMAGE_EXTRACT_AND_RUN": "1", "NO_STRIP": "1"} if sys.platform.startswith("linux") else None
    rc = run(cmd, cwd=APP, extra_env=extra_env)
    if rc == 0 and not args.no_bundle:
        profile = "debug" if args.debug else "release"
        collect_to_dist([APP / "src-tauri" / "target" / profile / "bundle"])
    return rc


def app_icon(_args):
    src = SERVER / "frontend" / "assets" / "png" / "chords-icon-1024.png"
    return run(["cargo", "tauri", "icon", str(src)], cwd=APP / "src-tauri")


def sync_android_icons():
    """Copy the real chords launcher icons into the (regenerable) gen/android tree.

    `cargo tauri android init` recreates gen/android from a template that carries
    Tauri's default placeholder launcher icon, and gen/ is git-ignored — so without
    this the APK ships the wrong icon. The source set (tracked, produced by
    `cargo tauri icon`) is src-tauri/icons/android/ and mirrors the res/ layout
    exactly (mipmap-* PNGs, the mipmap-anydpi-v26 adaptive icon, and the
    ic_launcher_background color). CI does the same copy in build.yml."""
    src = APP / "src-tauri" / "icons" / "android"
    dst = APP / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"
    if not src.is_dir() or not dst.is_dir():
        return
    n = 0
    for f in src.rglob("*"):
        if f.is_file():
            out = dst / f.relative_to(src)
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, out)
            n += 1
    print(f"\033[1;32msynced\033[0m {n} chords launcher-icon file(s) into gen/android/")


def _java_home(env):
    return (env or {}).get("JAVA_HOME") or os.environ.get("JAVA_HOME")


def _build_tools_dir(env):
    """Newest $ANDROID_HOME/build-tools/<ver> dir (holds apksigner / zipalign)."""
    sdk = (env or {}).get("ANDROID_HOME") or os.environ.get("ANDROID_HOME") \
        or os.environ.get("ANDROID_SDK_ROOT")
    bt = Path(sdk) / "build-tools" if sdk else None
    if not bt or not bt.is_dir():
        return None
    versions = sorted((p for p in bt.iterdir() if p.is_dir()), key=lambda p: p.name)
    return versions[-1] if versions else None


def _read_keystore_props():
    """Signing config from app/.android/keystore.properties; env vars override.
    Returns a dict with all four keys, or None if anything is missing."""
    props = {}
    if KEYSTORE_PROPS.is_file():
        for line in KEYSTORE_PROPS.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                props[k.strip()] = v.strip()
    overrides = {
        "storeFile": os.environ.get("CHORDS_ANDROID_KEYSTORE"),
        "storePassword": os.environ.get("CHORDS_ANDROID_KS_PASS"),
        "keyAlias": os.environ.get("CHORDS_ANDROID_KEY_ALIAS"),
        "keyPassword": os.environ.get("CHORDS_ANDROID_KEY_PASS"),
    }
    props.update({k: v for k, v in overrides.items() if v})
    if all(props.get(k) for k in ("storeFile", "storePassword", "keyAlias", "keyPassword")):
        return props
    return None


def android_keygen(args, env):
    """Create a self-signed keystore + keystore.properties for sideloadable
    release APKs. Self-signed is fine for sideloading (not for the Play Store)."""
    if KEYSTORE.exists():
        print(f"\033[1;33mkeystore already exists:\033[0m {_disp(KEYSTORE)} "
              "(delete it to regenerate)")
        return 1
    java_home = _java_home(env)
    keytool = str(Path(java_home) / "bin" / "keytool") if java_home else "keytool"
    import secrets
    password = args.password or secrets.token_urlsafe(18)
    alias = "chords"
    ANDROID_DIR.mkdir(parents=True, exist_ok=True)
    rc = run([keytool, "-genkeypair", "-v",
              "-keystore", KEYSTORE, "-alias", alias,
              "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
              "-storepass", password, "-keypass", password,
              "-dname", "CN=chords, OU=chords, O=chords, C=DE"],
             cwd=APP, extra_env=env)
    if rc != 0:
        return rc
    KEYSTORE_PROPS.write_text(
        f"storeFile={KEYSTORE}\nstorePassword={password}\nkeyAlias={alias}\nkeyPassword={password}\n")
    print(f"\n\033[1;32mwrote\033[0m {_disp(KEYSTORE)} + keystore.properties.")
    print("Back this keystore up — you need the same key to ship in-place upgrades.")
    return 0


def _release_label():
    """Short label for naming release artifacts: the exact git tag on HEAD when
    this is a tagged release build, else a UTC datetime stamp. CI mirrors this in
    .github/workflows/build.yml."""
    try:
        r = subprocess.run(["git", "describe", "--tags", "--exact-match"],
                           cwd=str(ROOT), capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _signed_apk_name(unsigned_name, label):
    """Tauri's `app-universal-release-unsigned.apk` -> `chords-<label>.apk`. Keeps
    any architecture marker for split builds (e.g. `chords-arm64-v8a-<label>.apk`)
    so multiple APKs never collide on the same name."""
    stem = unsigned_name.replace("-release-unsigned.apk", "")
    parts = [p for p in stem.split("-") if p not in ("app", "universal")]
    suffix = ("-" + "-".join(parts)) if parts else ""
    return f"chords{suffix}-{label}.apk"


def _sign_release_apks(outputs, env):
    """zipalign + apksigner every *-release-unsigned.apk under `outputs`, writing a
    signed chords-<tag-or-datetime>.apk next to each. Returns the signed paths
    (empty if it can't)."""
    props = _read_keystore_props()
    if not props:
        print("\n\033[1;33mnote:\033[0m no keystore — release APK is UNSIGNED and can't be "
              "sideloaded.\n      Run 'python butler.py app android keygen', or build with "
              "'--debug' for an auto-signed APK.")
        return []
    bt = _build_tools_dir(env)
    if not bt:
        print("\n\033[1;31merror:\033[0m build-tools not found (need ANDROID_HOME); cannot sign.",
              file=sys.stderr)
        return []
    label = _release_label()
    signed = []
    for unsigned in sorted(outputs.rglob("*-release-unsigned.apk")):
        aligned = unsigned.with_name(unsigned.name.replace("-unsigned", "-aligned"))
        out = unsigned.with_name(_signed_apk_name(unsigned.name, label))
        if run([bt / "zipalign", "-p", "-f", "4", unsigned, aligned], cwd=APP, extra_env=env) != 0:
            continue
        rc = run([bt / "apksigner", "sign",
                  "--ks", props["storeFile"],
                  "--ks-key-alias", props["keyAlias"],
                  "--ks-pass", "pass:" + props["storePassword"],
                  "--key-pass", "pass:" + props["keyPassword"],
                  "--out", out, aligned], cwd=APP, extra_env=env)
        aligned.unlink(missing_ok=True)
        if rc == 0:
            signed.append(out)
    return signed


def app_android(args):
    env = android_env()
    if args.action == "keygen":
        return android_keygen(args, env)
    if args.action != "build":
        rc = run(["cargo", "tauri", "android", args.action], cwd=APP, extra_env=env)
        if args.action == "init" and rc == 0:
            sync_android_icons()  # init lays down placeholder icons; replace them
        return rc

    cmd = ["cargo", "tauri", "android", "build", "--apk"]
    if args.debug:
        cmd.append("--debug")
    # Drop the real chords launcher icons into the regenerable gen/android tree
    # before the APK is assembled (a no-op if `android init` hasn't run yet).
    sync_android_icons()
    rc = run(cmd, cwd=APP, extra_env=env)
    if rc != 0:
        return rc

    outputs = APP / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs"
    # Debug APKs are already signed with the Android debug key (instantly
    # sideloadable). Release APKs come out unsigned, so sign them here.
    if args.debug or args.no_sign:
        collect_to_dist([outputs])
        return rc
    signed = _sign_release_apks(outputs, env)
    if signed:
        DIST.mkdir(exist_ok=True)
        print("\n\033[1;32msigned & copied to dist/\033[0m")
        for p in signed:
            dest = DIST / p.name
            shutil.copy2(p, dest)
            print(f"  {dest.relative_to(ROOT)}  ({dest.stat().st_size:,} bytes)")
    else:
        collect_to_dist([outputs])  # nothing signed — leave the unsigned APK in dist/
    return rc


# --------------------------------------------------------------------------- #
# extension
# --------------------------------------------------------------------------- #

def extension_package(args):
    DIST.mkdir(exist_ok=True)
    # Name the zip with the same release label as the APK (the git tag on HEAD, else
    # a UTC datetime), so a tagged release produces chords-extension-<tag>.zip that
    # sits alongside chords-<tag>.apk on the GitHub Release. CI passes --label
    # explicitly (mirroring the APK step) rather than relying on git describe.
    label = getattr(args, "label", None) or _release_label()
    out = DIST / f"chords-extension-{label}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(EXT.rglob("*")):
            if path.is_file():
                z.write(path, path.relative_to(EXT))
    print(f"\033[1;32mwrote\033[0m {out.relative_to(ROOT)} ({out.stat().st_size:,} bytes)")
    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser():
    p = argparse.ArgumentParser(
        prog="butler.py",
        description="chords project butler — build apps, deploy/run the server, package the extension.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    components = p.add_subparsers(dest="component", required=True)

    # server
    sp = components.add_parser("server", help="backend / web service").add_subparsers(dest="action", required=True)
    sp.add_parser("run", help="local uvicorn --reload (no Docker)").set_defaults(func=server_run)
    sp.add_parser("dev", help="Docker dev stack (port 8000)").set_defaults(func=server_dev)
    sp.add_parser("build", help="Docker production stack").set_defaults(func=server_build)
    sp.add_parser("deploy", help="deploy server/ to the remote").set_defaults(func=server_deploy)
    sp.add_parser("backup", help="back up ~/.chords").set_defaults(func=server_backup)

    # app
    ap = components.add_parser("app", help="Tauri native app").add_subparsers(dest="action", required=True)
    ap.add_parser("dev", help="desktop dev window").set_defaults(func=app_dev)
    b = ap.add_parser("build", help="desktop bundles for this OS")
    b.add_argument("--debug", action="store_true", help="debug profile")
    b.add_argument("--no-bundle", action="store_true", help="compile only, skip packaging")
    b.add_argument("--bundles", nargs="*", metavar="KIND", help="e.g. deb appimage rpm nsis msi dmg")
    b.set_defaults(func=app_build)
    ap.add_parser("icon", help="regenerate icons").set_defaults(func=app_icon)
    a_andro = ap.add_parser("android", help="Android <init|dev|build|keygen>")
    a_andro.add_argument("action", choices=["init", "dev", "build", "keygen"])
    a_andro.add_argument("--debug", action="store_true",
                         help="build: debug profile (auto-signed, instantly sideloadable)")
    a_andro.add_argument("--no-sign", action="store_true",
                         help="build: skip signing the release APK (leaves it unsigned)")
    a_andro.add_argument("--password", help="keygen: keystore password (default: random)")
    a_andro.set_defaults(func=app_android)

    # extension
    ep = components.add_parser("extension", help="browser extension").add_subparsers(dest="action", required=True)
    ep_pkg = ep.add_parser("package", help="zip into dist/")
    ep_pkg.add_argument("--label", help="release label for the zip name "
                        "(default: git tag on HEAD, else a UTC datetime)")
    ep_pkg.set_defaults(func=extension_package)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
