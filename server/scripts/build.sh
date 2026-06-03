#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-chords}"
TAG="${TAG:-latest}"

# Pre-create the data directory so Docker doesn't auto-create it as root when bind-mounting.
mkdir -p ~/.chords

usage() {
  echo "Usage: $0 [dev]"
  echo "  (no args)  Build image and start in production mode"
  echo "             Caddy listens on :80/:443. If ~/.chords/domain exists,"
  echo "             Caddy provisions a Let's Encrypt TLS cert for that domain."
  echo "             Example: echo 'chords.example.com' > ~/.chords/domain"
  echo "  dev        Build image and start in dev mode (source dirs mounted,"
  echo "             --reload, port 8000 exposed directly, no Caddy)"
  exit 1
}

case "${1:-}" in
  "")
    # Precompile frontend JSX -> JS so the image only COPYs ready-to-serve files.
    node scripts/build-frontend.js
    docker compose -f docker/docker-compose.yml build
    docker compose -f docker/docker-compose.yml up
    ;;
  dev)
    node scripts/build-frontend.js
    docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml build
    docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up
    ;;
  -h|--help)
    usage
    ;;
  *)
    echo "Unknown argument: $1"
    usage
    ;;
esac
