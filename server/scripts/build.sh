#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-chords}"
TAG="${TAG:-latest}"

# Pre-create the data directory so Docker doesn't auto-create it as root when bind-mounting.
mkdir -p ~/.chords

# The chords service attaches to an external network shared with the reverse
# proxy — see the comment in docker/docker-compose.yml. It is external precisely
# because neither stack owns it, which means nothing creates it automatically.
ensure_edge_network() {
  docker network inspect edge >/dev/null 2>&1 || docker network create edge
}

usage() {
  echo "Usage: $0 [dev]"
  echo "  (no args)  Build image and start in production mode"
  echo "             Caddy listens on :80/:443. If ~/.chords/domain exists,"
  echo "             Caddy provisions a Let's Encrypt TLS cert for that domain."
  echo "             Example: echo 'chords.example.com' > ~/.chords/domain"
  echo "             (On the production host Caddy is a separate stack and this"
  echo "             overlay is unused — see docker/docker-compose.caddy.yml.)"
  echo "  dev        Build image and start in dev mode (source dirs mounted,"
  echo "             --reload, port 8000 exposed directly, no Caddy)"
  exit 1
}

case "${1:-}" in
  "")
    ensure_edge_network
    # Precompile frontend JSX -> JS so the image only COPYs ready-to-serve files.
    node scripts/build-frontend.js
    docker compose -f docker/docker-compose.yml -f docker/docker-compose.caddy.yml build
    docker compose -f docker/docker-compose.yml -f docker/docker-compose.caddy.yml up
    ;;
  dev)
    ensure_edge_network
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
