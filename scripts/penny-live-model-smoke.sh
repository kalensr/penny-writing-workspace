#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BASE_URL="${PENNY_BASE_URL:-http://127.0.0.1:4177}"
BASE_URL="${BASE_URL%/}"
COOKIE_JAR="$(mktemp)"

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

curl -fsS -c "$COOKIE_JAR" "${BASE_URL}/" >/dev/null

payload="$(/usr/bin/python3 - <<'PY'
import json

print(json.dumps({
    "modeId": "draft_from_notes",
    "styleProfileId": "executive",
    "writingType": "smoke test",
    "draft": "Penny is checking whether the local writing model is reachable through the workspace API.",
    "instruction": "Reply in one short sentence confirming Penny can reach the local writing model.",
}))
PY
)"

body="$(curl -fsS \
  -b "$COOKIE_JAR" \
  -H "content-type: application/json" \
  -X POST \
  --data-binary "$payload" \
  "${BASE_URL}/api/penny/respond")"

PENNY_LIVE_MODEL_BODY="$body" /usr/bin/python3 - <<'PY'
import json
import os
import sys

data = json.loads(os.environ["PENNY_LIVE_MODEL_BODY"])
if not data.get("ok"):
    print(f"penny_live_model_smoke.error={data.get('reason') or data.get('error') or 'not_ok'}", file=sys.stderr)
    raise SystemExit(1)
if not str(data.get("content") or "").strip():
    print("penny_live_model_smoke.error=empty_content", file=sys.stderr)
    raise SystemExit(1)
print("penny_live_model_smoke.status=passed")
print(f"penny_live_model_smoke.runtime_profile={data.get('runtimeProfile') or ''}")
PY
