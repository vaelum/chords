#!/usr/bin/env bash
# Push only the main branch to the GitHub remote.
set -euo pipefail

GITHUB_URL="git@github.com:vaelum/chords.git"
REMOTE="github"
BRANCH="main"

cd "$(dirname "$0")"

# Ensure the github remote exists and points at the right URL.
if git remote get-url "$REMOTE" >/dev/null 2>&1; then
  git remote set-url "$REMOTE" "$GITHUB_URL"
else
  git remote add "$REMOTE" "$GITHUB_URL"
fi

# Push only main, plus any annotated tags reachable from it (so version tags
# like v0.1.0 reach GitHub and trigger the release workflow). Use annotated
# tags: git tag -a v0.1.0 -m v0.1.0
git push --follow-tags "$REMOTE" "$BRANCH"
