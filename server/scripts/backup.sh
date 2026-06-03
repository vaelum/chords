#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="$HOME/.chords"
BACKUP_DIR="$HOME/.chords-backup"

if [[ ! -d "$DATA_DIR" ]]; then
    echo "No $DATA_DIR directory found, skipping backup."
    exit 0
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE="$BACKUP_DIR/chords_$TIMESTAMP.zip"

echo "Backing up $DATA_DIR -> $ARCHIVE"
cd "$HOME"
zip -r "$ARCHIVE" .chords
echo "Backup complete: $ARCHIVE"
