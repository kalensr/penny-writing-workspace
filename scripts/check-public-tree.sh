#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pattern='(/Users/[A-Za-z0-9._-]+|/Volumes/[A-Za-z0-9._-]+|tail[0-9a-f]{6,}\.ts\.net|BEGIN [A-Z ]*PRIVATE KEY|kalen\.howell@gmail\.com|com\.kalen\.|Envoy_AI)'

matches="$(git grep -n -I -E "$pattern" -- . ':!scripts/check-public-tree.sh' ':!scripts/check-public-history.sh' || true)"
if [[ -n "$matches" ]]; then
  printf '%s\n' "$matches" >&2
  echo "public_tree_check=failed" >&2
  exit 1
fi

echo "public_tree_check=passed"

