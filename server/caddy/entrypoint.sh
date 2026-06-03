#!/bin/sh
set -e

DOMAIN_FILE=/chords-data/domain

if [ ! -f "$DOMAIN_FILE" ]; then
    echo "No domain file found at $DOMAIN_FILE, Caddy will not start."
    echo "Create the file with your domain to enable Caddy: echo 'example.com' > ~/.chords/domain"
    exit 0
fi

CHORDS_DOMAIN=$(cat "$DOMAIN_FILE" | tr -d '[:space:]')
echo "Starting Caddy with domain: $CHORDS_DOMAIN"
export CHORDS_DOMAIN

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
