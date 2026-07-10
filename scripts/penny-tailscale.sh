#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

HOST="127.0.0.1"
PORT="4177"
TARGET="http://${HOST}:${PORT}"
TAILSCALE_BIN="${TAILSCALE_BIN:-$(command -v tailscale 2>/dev/null || true)}"
DRY_RUN="${PENNY_TAILSCALE_DRY_RUN:-0}"
OVERRIDE_HOST="${PENNY_TAILSCALE_HOST:-}"
OVERRIDE_USERS="${PENNY_TAILSCALE_USERS:-}"
SERVE_PATH="${PENNY_TAILSCALE_PATH:-}"
REMOTE_RUNTIME_CONTROL_SET="${PENNY_ALLOW_REMOTE_RUNTIME_CONTROL+x}"

usage() {
  cat <<USAGE
Usage: scripts/penny-tailscale.sh on|off|restart|status|smoke|url

Makes Penny available inside a private Tailscale tailnet.
Penny and the writing model remain bound to loopback; Tailscale Serve proxies to ${TARGET}.

Environment:
  PENNY_TAILSCALE_DRY_RUN=1  Print intended commands without changing local services.
  PENNY_TAILSCALE_HOST=...   Override detected MagicDNS host, mainly for tests.
  PENNY_TAILSCALE_USERS=...  Override trusted Tailscale login allowlist.
  PENNY_TAILSCALE_PATH=/penny  Serve Penny under a path prefix without changing root routes.
  PENNY_TAILSCALE_CONFIG_JSON=...  Override Serve config JSON, mainly for tests.
  PENNY_TAILSCALE_STATUS_JSON=...  Override Tailscale status JSON, mainly for tests.
  TAILSCALE_BIN=...          Override tailscale CLI path.

Tailscale maintenance changes only the network settings named by this script.
Other Penny launchd settings are preserved by penny-server.sh. Passing a
supported variable with an empty value is an explicit clear; `off` explicitly
clears only allowed hosts, trusted users, and the Penny base path.
USAGE
}

normalize_serve_path() {
  local path="$1"
  if [[ -z "$path" || "$path" == "/" ]]; then
    printf '\n'
    return
  fi
  if [[ "$path" != /* ]]; then
    path="/${path}"
  fi
  path="${path%/}"
  if [[ "$path" == "/api" || "$path" == "/assets" || "$path" == *" "* ]]; then
    echo "penny_tailscale.error=invalid_serve_path path=${path}" >&2
    exit 1
  fi
  printf '%s\n' "$path"
}

require_tailscale() {
  if [[ -z "$TAILSCALE_BIN" || ! -x "$TAILSCALE_BIN" ]]; then
    echo "penny_tailscale.error=tailscale_cli_missing" >&2
    exit 1
  fi
}

tailscale_json() {
  if [[ -n "${PENNY_TAILSCALE_STATUS_JSON:-}" ]]; then
    printf '%s\n' "$PENNY_TAILSCALE_STATUS_JSON"
    return
  fi
  require_tailscale
  "$TAILSCALE_BIN" status --json
}

tailnet_host() {
  if [[ -n "$OVERRIDE_HOST" ]]; then
    printf '%s\n' "${OVERRIDE_HOST%.}"
    return
  fi
  tailscale_json | /usr/bin/python3 -c '
import json, sys
data = json.load(sys.stdin)
self_node = data.get("Self") or {}
dns = (self_node.get("DNSName") or "").rstrip(".")
state = data.get("BackendState") or ""
if state != "Running":
    raise SystemExit("tailscale is not running")
if not dns:
    raise SystemExit("tailscale MagicDNS hostname is unavailable")
print(dns)
'
}

tailnet_users() {
  if [[ -n "$OVERRIDE_USERS" ]]; then
    printf '%s\n' "$OVERRIDE_USERS"
    return
  fi
  tailscale_json | /usr/bin/python3 -c '
import json, sys
data = json.load(sys.stdin)
self_node = data.get("Self") or {}
user_id = str(self_node.get("UserID") or "")
users = data.get("User") or {}
login = ((users.get(user_id) or {}).get("LoginName") or "").strip()
print(login)
'
}

truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

validate_tailnet_host() {
  local host="$1"
  if [[ "$host" != *.ts.net ]]; then
    echo "penny_tailscale.error=invalid_tailnet_host host=${host}" >&2
    exit 1
  fi
}

tailnet_url() {
  local host
  host="$(tailnet_host)"
  validate_tailnet_host "$host"
  local path
  path="$(normalize_serve_path "$SERVE_PATH")"
  printf 'https://%s%s\n' "$host" "$path"
}

serve_status_json() {
  if [[ -n "${PENNY_TAILSCALE_STATUS_JSON:-}" ]]; then
    printf '%s\n' "$PENNY_TAILSCALE_STATUS_JSON"
    return
  fi
  require_tailscale
  "$TAILSCALE_BIN" serve status --json 2>/dev/null || printf '{}\n'
}

serve_declared_config_json() {
  if [[ -n "${PENNY_TAILSCALE_CONFIG_JSON:-}" ]]; then
    printf '%s\n' "$PENNY_TAILSCALE_CONFIG_JSON"
    return
  fi
  require_tailscale
  "$TAILSCALE_BIN" serve get-config --all 2>/dev/null || serve_status_json
}

cmd_url() {
  echo "penny_tailscale.url=$(tailnet_url)"
}

cmd_status() {
  local host url path
  host="$(tailnet_host)"
  validate_tailnet_host "$host"
  path="$(normalize_serve_path "$SERVE_PATH")"
  url="https://${host}${path}"
  echo "penny_tailscale.host=${host}"
  if [[ -n "$path" ]]; then
    echo "penny_tailscale.path=${path}"
  fi
  echo "penny_tailscale.url=${url}"
  scripts/penny-server.sh status
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "penny_tailscale.serve_status=dry_run"
  else
    echo "penny_tailscale.serve_status_begin"
    "$TAILSCALE_BIN" serve status || true
    echo "penny_tailscale.serve_status_end"
  fi
}

cmd_on() {
  local host url users config classification path error_name serve_args server_env remote_runtime_control
  host="$(tailnet_host)"
  validate_tailnet_host "$host"
  path="$(normalize_serve_path "$SERVE_PATH")"
  url="https://${host}${path}"
  users="$(tailnet_users)"
  remote_runtime_control="${PENNY_ALLOW_REMOTE_RUNTIME_CONTROL:-}"
  if [[ -z "$users" ]]; then
    echo "penny_tailscale.error=missing_tailscale_user_allowlist" >&2
    echo "Refusing to expose Penny over Tailscale without a Tailscale user allowlist." >&2
    exit 1
  fi
  config="$(serve_config_json)"
  classification="$(printf '%s' "$config" | serve_config_looks_penny_only)"
  error_name="serve_config_not_penny_only"
  if [[ -n "$path" ]]; then
    error_name="serve_config_not_penny_path"
  fi
  case "$classification" in
    empty|penny) ;;
    *)
      echo "penny_tailscale.error=${error_name}" >&2
      echo "Refusing to overwrite Tailscale Serve because non-Penny config may exist." >&2
      exit 1
      ;;
  esac
  serve_args=("${TAILSCALE_BIN:-tailscale}" serve --bg --yes --https=443)
  if [[ -n "$path" ]]; then
    serve_args+=(--set-path="$path")
  fi
  serve_args+=("$TARGET")
  # Tailscale Serve owns the external prefix and forwards to Penny's root.
  # Clear any stale application base path explicitly; all private model and
  # workspace settings remain unspecified and are merged by penny-server.sh.
  server_env=("PENNY_BASE_PATH=")
  server_env+=("PENNY_ALLOWED_HOSTS=$host")
  server_env+=("PENNY_TAILSCALE_USERS=$users")
  if [[ "$REMOTE_RUNTIME_CONTROL_SET" == "x" ]]; then
    server_env+=("PENNY_ALLOW_REMOTE_RUNTIME_CONTROL=$remote_runtime_control")
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "penny_tailscale.status=would_start"
    echo "+ ${server_env[*]} scripts/penny-server.sh restart"
    echo "+ ${serve_args[*]}"
  else
    env "${server_env[@]}" scripts/penny-server.sh restart
    if [[ -n "$path" ]]; then
      "$TAILSCALE_BIN" serve --bg --yes --https=443 --set-path="$path" "$TARGET"
    else
      "$TAILSCALE_BIN" serve --bg --yes --https=443 "$TARGET"
    fi
    echo "penny_tailscale.status=running"
  fi
  echo "penny_tailscale.url=${url}"
  if [[ -n "$users" ]]; then
    echo "penny_tailscale.users=${users}"
  fi
}

serve_config_looks_penny_only() {
  /usr/bin/python3 -c '
import json
import sys

target = sys.argv[1]
path = sys.argv[2]
try:
    data = json.load(sys.stdin)
except Exception:
    print("invalid")
    raise SystemExit(0)

urls = []
has_funnel = False

def walk(value, key=""):
    global has_funnel
    lower_key = str(key).lower()
    if lower_key == "funnel" and value:
        has_funnel = True
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            walk(child_value, child_key)
    elif isinstance(value, list):
        for child in value:
            walk(child)
    elif isinstance(value, str):
        lowered = value.lower().rstrip("/")
        if lowered.startswith("http://") or lowered.startswith("https://"):
            urls.append(lowered)

walk(data)
target = target.rstrip("/")
if has_funnel:
    print("other")
    raise SystemExit(0)
if path:
    handlers = []
    def find_handlers(value):
        if isinstance(value, dict):
            maybe = value.get("Handlers")
            if isinstance(maybe, dict):
                handlers.append(maybe)
            for child in value.values():
                find_handlers(child)
        elif isinstance(value, list):
            for child in value:
                find_handlers(child)
    find_handlers(data)
    proxies = []
    for handler in handlers:
        value = handler.get(path)
        if isinstance(value, dict):
            proxy = value.get("Proxy") or value.get("proxy")
            if isinstance(proxy, str):
                proxies.append(proxy.lower().rstrip("/"))
            else:
                proxies.append("")
    if not proxies:
        print("empty")
    elif all(proxy == target for proxy in proxies):
        print("penny")
    else:
        print("other")
    raise SystemExit(0)

if not urls:
    print("empty")
elif urls and all(url == target for url in urls):
    print("penny")
else:
    print("other")
' "$TARGET" "$(normalize_serve_path "$SERVE_PATH")"
}

serve_config_json() {
  local declared status declared_class status_class
  declared="$(serve_declared_config_json)"
  declared_class="$(printf '%s' "$declared" | serve_config_looks_penny_only)"
  if [[ "$declared_class" != "empty" ]]; then
    printf '%s\n' "$declared"
    return
  fi

  status="$(serve_status_json)"
  status_class="$(printf '%s' "$status" | serve_config_looks_penny_only)"
  if [[ "$status_class" != "empty" ]]; then
    printf '%s\n' "$status"
    return
  fi

  printf '%s\n' "$declared"
}

cmd_off() {
  local config classification path error_name
  path="$(normalize_serve_path "$SERVE_PATH")"
  config="$(serve_config_json)"
  classification="$(printf '%s' "$config" | serve_config_looks_penny_only)"
  error_name="serve_config_not_penny_only"
  if [[ -n "$path" ]]; then
    error_name="serve_config_not_penny_path"
  fi
  case "$classification" in
    empty)
      echo "penny_tailscale.status=already_off"
      ;;
    penny)
      if [[ "$DRY_RUN" == "1" ]]; then
        echo "penny_tailscale.status=would_stop"
        if [[ -n "$path" ]]; then
          echo "+ ${TAILSCALE_BIN:-tailscale} serve --https=443 --set-path=${path} off"
        else
          echo "+ ${TAILSCALE_BIN:-tailscale} serve reset"
        fi
        echo "+ PENNY_ALLOWED_HOSTS= PENNY_TAILSCALE_USERS= PENNY_BASE_PATH= scripts/penny-server.sh restart"
      else
        if [[ -n "$path" ]]; then
          "$TAILSCALE_BIN" serve --https=443 --set-path="$path" off
        else
          "$TAILSCALE_BIN" serve reset
        fi
        PENNY_ALLOWED_HOSTS="" PENNY_TAILSCALE_USERS="" PENNY_BASE_PATH="" scripts/penny-server.sh restart
        echo "penny_tailscale.status=stopped"
      fi
      ;;
    *)
      echo "penny_tailscale.error=${error_name}" >&2
      echo "Refusing to reset Tailscale Serve because non-Penny config may exist." >&2
      exit 1
      ;;
  esac
}

cmd_smoke() {
  local url cookie_jar body root_url config_url
  url="$(tailnet_url)"
  root_url="${url%/}/"
  config_url="${url%/}/api/penny/config"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "penny_tailscale.status=would_smoke"
    echo "+ curl -fsS -c <cookie_jar> ${root_url}"
    echo "+ curl -fsS -b <cookie_jar> ${config_url}"
    return
  fi
  cookie_jar="$(mktemp)"
  trap 'rm -f "$cookie_jar"' RETURN
  curl -fsS -c "$cookie_jar" "${root_url}" >/dev/null
  body="$(curl -fsS -b "$cookie_jar" "${config_url}")"
  /usr/bin/python3 -c 'import json,sys; data=json.load(sys.stdin); raise SystemExit(0 if data.get("ok") else 1)' <<<"$body"
  echo "penny_tailscale.smoke=passed"
  echo "penny_tailscale.url=${url}"
}

case "${1:-}" in
  on) cmd_on ;;
  off) cmd_off ;;
  restart) cmd_off; cmd_on ;;
  status) cmd_status ;;
  smoke) cmd_smoke ;;
  url) cmd_url ;;
  *) usage; exit 2 ;;
esac
