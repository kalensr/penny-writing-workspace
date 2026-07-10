#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
TAILNET=0
LIVE_MODEL=0

usage() {
  cat <<USAGE
Usage: scripts/penny-parity-smoke.sh [--dry-run] [--tailnet] [--live-model]

Runs the Penny-focused parity lane for local app/runtime confidence.

Environment:
  PENNY_BASE_URL       Optional browser-smoke target, for example https://writer-server.example-tailnet.ts.net/penny.
  PENNY_TAILSCALE_PATH Optional path mode for scripts/penny-tailscale.sh, for example /penny.
  --live-model         Also call Penny's /api/penny/respond route through PENNY_BASE_URL.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --tailnet)
      TAILNET=1
      shift
      ;;
    --live-model)
      LIVE_MODEL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

run_step() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "+ $*"
  else
    "$@"
  fi
}

run_step node --test tests/penny_server.test.mjs tests/penny_api_client.test.mjs
run_step npm run build
if [[ -n "${PENNY_RUNTIME_SCRIPT:-}" ]]; then
  run_step scripts/penny-runtime-preflight.sh
else
  echo "penny_parity_smoke.runtime_control=unavailable"
fi
run_step scripts/penny-server.sh status

if [[ "$TAILNET" == "1" ]]; then
  run_step scripts/penny-tailscale.sh status
  run_step scripts/penny-tailscale.sh smoke
fi

if [[ -n "${PENNY_BASE_URL:-}" ]]; then
  run_step npm run browser-smoke
fi

if [[ "$LIVE_MODEL" == "1" ]]; then
  run_step scripts/penny-live-model-smoke.sh
fi

echo "penny_parity_smoke.status=$([[ "$DRY_RUN" == "1" ]] && echo would_run || echo passed)"
