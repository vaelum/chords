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

echo "==> Deploying to $REMOTE:$REMOTE_DIR"

# Precompile frontend JSX -> JS locally so the synced files are ready to serve
# (the remote needs no JS toolchain — it only runs Docker).
echo "==> Compiling frontend..."
node scripts/build-frontend.js

# Stop the running service on remote
echo "==> Stopping chords on remote..."
ssh "$REMOTE" "cd $REMOTE_DIR 2>/dev/null && docker compose -f docker/docker-compose.yml down || true"

# Run backup using the script from the previous deploy
echo "==> Running backup on remote..."
ssh "$REMOTE" "
    if [ -f $REMOTE_DIR/scripts/backup.sh ]; then
        bash $REMOTE_DIR/scripts/backup.sh
    else
        echo 'No backup.sh on remote (first deploy?), skipping backup.'
    fi
"

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

# Rebuild image and start detached
echo "==> Building and starting chords on remote..."
ssh "$REMOTE" "
    cd $REMOTE_DIR
    mkdir -p ~/.chords
    docker compose -f docker/docker-compose.yml build
    docker compose -f docker/docker-compose.yml up -d
"

echo "==> Deploy complete."

# Print the admin passcode from the remote data directory
ADMIN_PASS=$(ssh "$REMOTE" "python3 -c \"import json; d=json.load(open('$HOME/.chords/secrets.json')); print(d.get('admin_passcode','(not found)'))\"" 2>/dev/null || echo "(could not read)")
echo ""
echo "Admin login:  handle=admin  password=$ADMIN_PASS"
