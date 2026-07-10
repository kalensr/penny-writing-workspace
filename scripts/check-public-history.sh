#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pattern='(/Users/[A-Za-z0-9._-]+|/Volumes/[A-Za-z0-9._-]+|tail[0-9a-f]{6,}\.ts\.net|BEGIN [A-Z ]*PRIVATE KEY|kalen\.howell@gmail\.com|com\.kalen\.|Envoy_AI)'
failed=0
while read -r commit; do
  matches="$(git grep -n -I -E "$pattern" "$commit" -- . ':!scripts/check-public-tree.sh' ':!scripts/check-public-history.sh' || true)"
  if [[ -n "$matches" ]]; then
    printf '%s\n' "$matches" >&2
    failed=1
  fi
done < <(git rev-list --all)

if [[ "$failed" -ne 0 ]]; then
  echo "public_history_check=failed" >&2
  exit 1
fi

echo "public_history_check=passed"

