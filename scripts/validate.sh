#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

git diff --check
npm test
python3 -m unittest tests.test_penny_tailscale tests.test_penny_parity_smoke -v
npm run build
npm run browser-smoke
scripts/penny-parity-smoke.sh --dry-run
scripts/check-public-tree.sh
