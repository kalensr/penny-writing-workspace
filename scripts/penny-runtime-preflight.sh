#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${PENNY_RUNTIME_SCRIPT:-}"

if [[ -z "$SCRIPT" ]]; then
  echo "penny_runtime_preflight.status=unavailable"
  echo "penny_runtime_preflight.error=PENNY_RUNTIME_SCRIPT is not set" >&2
  exit 1
fi

if [[ "$SCRIPT" != /* ]]; then
  echo "penny_runtime_preflight.status=unavailable"
  echo "penny_runtime_preflight.error=PENNY_RUNTIME_SCRIPT must be an absolute path" >&2
  exit 1
fi

if [[ ! -x "$SCRIPT" ]]; then
  echo "penny_runtime_preflight.status=unavailable"
  echo "penny_runtime_preflight.error=PENNY_RUNTIME_SCRIPT is not executable: $SCRIPT" >&2
  exit 1
fi

"$SCRIPT" status >/dev/null
echo "penny_runtime_preflight.status=passed"
echo "penny_runtime_preflight.script=$SCRIPT"
