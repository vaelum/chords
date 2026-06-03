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
            android    <init|dev|build>   Android (needs the SDK/NDK toolchain)

  extension package    Zip the browser extension into dist/ for distribution

Examples:
    python butler.py server dev
    python butler.py server deploy
    python butler.py app dev
    python butler.py app build --bundles deb appimage
    python butler.py app android build
    python butler.py extension package
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server"
APP = ROOT / "app"
EXT = ROOT / "extension"
DIST = ROOT / "dist"


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
        cands = sorted(p for p in (sdk / "ndk").iterdir() if p.is_dir()) if (sdk / "ndk").is_dir() else []
        if Path("/opt/android-ndk").is_dir():
            cands.append(Path("/opt/android-ndk"))
        if cands:
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


def app_android(args):
    if args.action == "build":
        rc = run(["cargo", "tauri", "android", "build", "--apk"], cwd=APP, extra_env=android_env())
        if rc == 0:
            collect_to_dist([APP / "src-tauri" / "gen" / "android" / "app" / "build" / "outputs"])
        return rc
    return run(["cargo", "tauri", "android", args.action], cwd=APP, extra_env=android_env())


# --------------------------------------------------------------------------- #
# extension
# --------------------------------------------------------------------------- #

def extension_package(_args):
    DIST.mkdir(exist_ok=True)
    version = json.loads((EXT / "manifest.json").read_text()).get("version", "0.0.0")
    out = DIST / f"chords-extension-{version}.zip"
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
    a_andro = ap.add_parser("android", help="Android <init|dev|build>")
    a_andro.add_argument("action", choices=["init", "dev", "build"])
    a_andro.set_defaults(func=app_android)

    # extension
    ep = components.add_parser("extension", help="browser extension").add_subparsers(dest="action", required=True)
    ep.add_parser("package", help="zip into dist/").set_defaults(func=extension_package)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
