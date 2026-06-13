#!/usr/bin/env bash
set -euo pipefail

branch=$(git branch --show-current)

if [[ -z "$branch" ]]; then
    echo "Error: not on a named branch (detached HEAD?)" >&2
    exit 1
fi

if [[ "$branch" != "main" ]]; then
    echo "Error: refusing to push '$branch'; only the 'main' branch may be pushed." >&2
    exit 1
fi

echo "Pushing branch 'main' to github (vaelum/yeet)..."
git push github main