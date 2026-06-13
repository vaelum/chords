#!/usr/bin/env bash
set -euo pipefail

# Run from the server/ root (this script lives in server/scripts/). Everything
# the deployed service needs — backend/, frontend/, docker/, caddy/ — lives
# under server/, so only this folder is synced to the remote (the Tauri app/
# and the browser extension/ at the repo root are intentionally left out).
cd "$(dirname "$0")/.."

DEPLOY_TARGET_FILE=".deploy-target"
REMOTE_DIR="~/chords"

if [[ ! -f "$DEPLOY_TARGET_FILE" ]]; then
    echo "Error: $DEPLOY_TARGET_FILE not found."
    echo "Create it with the deploy target, e.g.: echo 'user@example.com' > .deploy-target"
    exit 1
fi

REMOTE=$(tr -d '[:space:]' < "$DEPLOY_TARGET_FILE")

if [[ -z "$REMOTE" ]]; then
    echo "Error: $DEPLOY_TARGET_FILE is empty."
    exit 1
fi

# Optional fast Debian mirror for the in-image apt steps (Node deps + Playwright
# system libs). Empty by default = the image's stock deb.debian.org, which always
# works. Set it to a mirror THIS server can actually reach, for speed:
#   APT_MIRROR=mirror.hetzner.com python butler.py server deploy
# Hetzner's internal mirror is fast + free but reachable only from some Hetzner
# networks (not Hetzner Cloud / firewalled hosts). Confirm reachability first:
#   ssh <remote> 'curl -fsI http://mirror.hetzner.com/debian/packages/dists/trixie/InRelease'
APT_MIRROR="${APT_MIRROR-}"

echo "==> Deploying to $REMOTE:$REMOTE_DIR"

# Precompile frontend JSX -> JS locally so the synced files are ready to serve
# (the remote needs no JS toolchain — it only runs Docker).
echo "==> Compiling frontend..."
node scripts/build-frontend.js

# Sync the server folder to remote (excludes data dir, local env, temp files).
# `./` is the server/ root (we cd'd there above), so only server contents go up;
# --delete prunes anything stale on the remote (e.g. leftovers from old layouts).
echo "==> Copying files to remote..."
rsync -av --delete \
    --exclude='.git/' \
    --exclude='.venv/' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='.deploy-target' \
    ./ "$REMOTE:$REMOTE_DIR/"

# Build the new image while the OLD container keeps serving. The build is the
# slow part (Node + Playwright Chromium), and the production image COPYs the
# source in (no bind mounts), so rebuilding doesn't disturb the running service.
# APT_MIRROR points the in-image apt at a fast Debian mirror (see top of script).
echo "==> Building new image on remote (service stays up)..."
ssh "$REMOTE" "
    cd $REMOTE_DIR
    mkdir -p ~/.chords
    APT_MIRROR='$APT_MIRROR' docker compose -f docker/docker-compose.yml build
"

# Swap: stop the old container, back up the data dir while nothing is writing to
# it (a consistent snapshot, using the just-synced backup.sh), then start the new
# container. This stop -> backup -> start window is the only downtime.
echo "==> Swapping to the new build (stop, backup, start)..."
ssh "$REMOTE" "
    cd $REMOTE_DIR
    docker compose -f docker/docker-compose.yml down
    if [ -f $REMOTE_DIR/scripts/backup.sh ]; then
        bash $REMOTE_DIR/scripts/backup.sh
    else
        echo 'No backup.sh on remote (first deploy?), skipping backup.'
    fi
    docker compose -f docker/docker-compose.yml up -d
"

echo "==> Deploy complete."

# Print the admin passcode from the remote data directory
ADMIN_PASS=$(ssh "$REMOTE" "python3 -c \"import json; d=json.load(open('$HOME/.chords/secrets.json')); print(d.get('admin_passcode','(not found)'))\"" 2>/dev/null || echo "(could not read)")
echo ""
echo "Admin login:  handle=admin  password=$ADMIN_PASS"
