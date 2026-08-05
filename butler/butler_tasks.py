"""chords-specific butler tasks.

Two things butler.toml can't express:

  * the OpenRouter API key that AI import runs on — it lives in the data
    directory's secrets.json (a mounted volume, so it survives redeploys) and
    can be set locally or on the remote, which is a small workflow of its own;
  * the import-pipeline test suite, which is two suites with a cost attached to
    one of them, not a single pytest invocation.

`server deploy` is wrapped rather than replaced: the built-in still runs
scripts/deploy.sh, this only ships the key first so the container that comes up
already has it.
"""

import os
import shlex
import subprocess
import sys

from butler import ButlerError, arg, proc, task, ui

# --------------------------------------------------------------------------- #
# OpenRouter API key
# --------------------------------------------------------------------------- #
# AI import (search / parse / vision) runs on OpenRouter, so the service needs an
# API key. It lives in the data directory's secrets.json — the same file as the
# JWT secret and admin passcode — which is a mounted volume, so it survives
# redeploys and image rebuilds. The backend re-reads it on every call, so setting
# or rotating it needs no restart.

# Merges the key read from stdin into <data dir>/secrets.json. Passed to the
# remote as `python3 -c <script>` with the key on STDIN, so the secret never
# appears in argv (visible in `ps`) or in a shell history.
_KEY_SCRIPT = """
import json, os, pathlib, sys
key = sys.stdin.read().strip()
p = pathlib.Path(os.environ.get("CHORDS_DATA_DIR") or os.path.expanduser("~/.chords"))
p.mkdir(parents=True, exist_ok=True)
f = p / "secrets.json"
try:
    data = json.loads(f.read_text())
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}
if key:
    data["openrouter_api_key"] = key
else:
    data.pop("openrouter_api_key", None)
f.write_text(json.dumps(data, indent=2))
f.chmod(0o600)
print("set" if key else "cleared", f)
"""

# Prints "yes"/"no" — used to warn on deploy when AI import would be dead.
_KEY_CHECK_SCRIPT = """
import json, os, pathlib
p = pathlib.Path(os.environ.get("CHORDS_DATA_DIR") or os.path.expanduser("~/.chords"))
try:
    data = json.loads((p / "secrets.json").read_text())
except Exception:
    data = {}
print("yes" if (data.get("openrouter_api_key") or "").strip() else "no")
"""


def _deploy_remote(ctx):
    """The ssh target from server/.deploy-target."""
    target = ctx.cfg.server.dir / ".deploy-target"
    if not target.is_file():
        raise ButlerError(
            f"{ctx.disp(target)} not found",
            hint="Create it with the deploy target, e.g.:\n"
                 "  echo 'user@example.com' > server/.deploy-target")
    remote = target.read_text().strip()
    if not remote:
        raise ButlerError(f"{ctx.disp(target)} is empty")
    return remote


def _mask(key):
    return f"{key[:8]}…{key[-4:]}" if len(key) > 16 else "…"


def _prompt_key():
    import getpass

    try:
        return getpass.getpass("OpenRouter API key (input hidden): ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return ""


def _resolve_key(value):
    """Turn the --openrouter-key argument into an actual key.

      None      -> not requested (falls back to $OPENROUTER_API_KEY if set)
      "-" / ""  -> prompt for it
      anything  -> use it verbatim
    """
    if value is None:
        env = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
        if env:
            ui.ok("using", f"OPENROUTER_API_KEY from the environment ({_mask(env)})")
        return env
    if value in ("-", ""):
        return _prompt_key()
    return value.strip()


def _write_key(ctx, key, remote=None):
    """Write (or, with an empty key, remove) the OpenRouter key in secrets.json —
    on `remote` over ssh, or in the local data directory."""
    cmd = (["ssh", remote, f"python3 -c {shlex.quote(_KEY_SCRIPT)}"] if remote
           else [sys.executable, "-c", _KEY_SCRIPT])
    where = remote or "this machine"
    if ctx.would(f"write the OpenRouter key on {where}"):
        return 0
    try:
        r = subprocess.run(cmd, input=key + "\n", text=True, capture_output=True)
    except FileNotFoundError as e:
        raise ButlerError(str(e), code=127) from e
    if r.returncode != 0:
        raise ButlerError(f"could not write the key on {where}",
                          hint=r.stderr.strip(), code=r.returncode)
    action = "cleared" if not key else f"set ({_mask(key)})"
    ui.ok(f"OpenRouter key {action}", f"on {where} — {r.stdout.strip().split(' ', 1)[-1]}")
    ui.plain("The backend re-reads it per request, so no restart is needed.")
    return 0


def _remote_has_key(remote):
    r = proc.capture(["ssh", remote, f"python3 -c {shlex.quote(_KEY_CHECK_SCRIPT)}"])
    # Can't tell (ssh failed) — don't nag.
    return not r.ok or r.out.strip() == "yes"


@task("server.key", help="set the OpenRouter API key for AI import",
      args=[
          arg("--openrouter-key", nargs="?", const="-", metavar="KEY",
              help="the key (default: prompt with hidden input)"),
          arg("--local", action="store_true",
              help="write to this machine's data dir instead of the remote"),
          arg("--clear", action="store_true", help="remove the stored key"),
      ])
def server_key(ctx, args):
    # Bare `server key` takes $OPENROUTER_API_KEY when set, else prompts —
    # the same resolution order as deploy.
    key = "" if args.clear else (_resolve_key(args.openrouter_key) or _prompt_key())
    if not key and not args.clear:
        ui.warn("aborted:", "no key entered.")
        return 1
    if args.local:
        return _write_key(ctx, key)
    return _write_key(ctx, key, _deploy_remote(ctx))


@task("server.deploy", wraps=True,
      args=[arg("--openrouter-key", nargs="?", const="-", metavar="KEY",
                help="set the OpenRouter API key on the remote before deploying; "
                     "pass no value (or '-') to be prompted. Defaults to "
                     "$OPENROUTER_API_KEY when that is set.")])
def server_deploy(ctx, args, inner):
    """Ship the key first, so the container that comes up already has it."""
    key = _resolve_key(args.openrouter_key)
    remote = _deploy_remote(ctx)
    if key:
        _write_key(ctx, key, remote)
    elif not _remote_has_key(remote):
        ui.plain()
        ui.note("no OpenRouter API key is set on the remote — AI import will be "
                "unavailable.")
        if sys.stdin.isatty():
            entered = _prompt_key()
            if entered:
                _write_key(ctx, entered, remote)
        else:
            ui.plain("      Set one with: python butler.py server key")
    return inner()


# --------------------------------------------------------------------------- #
# import-pipeline tests
# --------------------------------------------------------------------------- #

@task("server.test", help="run the import-pipeline tests",
      args=[
          arg("--live", action="store_true",
              help="also run the real-API suite (~$0.01 of OpenRouter credit)"),
          arg("--live-only", action="store_true",
              help="skip the offline suite and run only the live one"),
          arg("--only", metavar="NAMES",
              help="live suite: comma-separated subset "
                   "(catalog,parse,scan,auto,search,vision)"),
      ])
def server_test(ctx, args):
    """Offline by default: a stub OpenRouter server, no key and no cost.

    `--live` additionally runs the real-API suite, which reads the key from
    .secrets / $OPENROUTER_API_KEY / ~/.chords/secrets.json and skips if there
    is none.
    """
    tests = ctx.cfg.server.dir / "tests"
    if not args.live_only:
        rc = ctx.run([sys.executable, str(tests / "test_pipeline.py")], cwd=tests)
        if rc != 0:
            return rc
    if args.live or args.live_only:
        cmd = [sys.executable, str(tests / "test_live.py")]
        if args.only:
            cmd += ["--only", args.only]
        return ctx.run(cmd, cwd=tests)
    return 0
