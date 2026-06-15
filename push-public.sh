#!/usr/bin/env bash
# Push to the public GitHub remote.
#
# Usage:
#   ./push-public.sh            Push the main branch (default).
#   ./push-public.sh <tag>      Push a single tag (must be reachable from main).
#
# Only the main branch or a tag that lives in main's history may be pushed,
# so nothing outside the public release line ever reaches the public repo.
set -euo pipefail

PUBLIC_URL="git@github.com:vaelum/chords.git"
REMOTE="public"
BRANCH="main"

cd "$(dirname "$0")"

# Ensure the public remote exists and points at the right URL.
if git remote get-url "$REMOTE" >/dev/null 2>&1; then
  git remote set-url "$REMOTE" "$PUBLIC_URL"
else
  git remote add "$REMOTE" "$PUBLIC_URL"
fi

if [[ $# -eq 0 ]]; then
  # Default: push only main.
  git push "$REMOTE" "$BRANCH"
  exit 0
fi

if [[ $# -gt 1 ]]; then
  echo "error: expected at most one argument (a tag), got $#" >&2
  echo "usage: $0 [tag]" >&2
  exit 1
fi

TAG="$1"

# The tag must exist...
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "error: tag '$TAG' does not exist" >&2
  exit 1
fi

# ...and must be reachable from main, i.e. point at a commit in main's history.
if ! git merge-base --is-ancestor "$TAG^{commit}" "refs/heads/$BRANCH"; then
  echo "error: tag '$TAG' is not reachable from '$BRANCH'; refusing to push" >&2
  exit 1
fi

git push "$REMOTE" "refs/tags/$TAG"
