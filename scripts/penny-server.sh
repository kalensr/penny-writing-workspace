#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

LABEL="org.penny-writing-workspace"
HOST="127.0.0.1"
PORT="4177"
if [[ "${PENNY_SERVER_TEST_MODE:-}" == "1" ]]; then
  PORT="${PENNY_SERVER_PORT:-$PORT}"
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "penny_server.error=unsafe_port" >&2
  exit 2
fi
PLIST="runtime/${LABEL}.plist"
PLIST_ABS="$(pwd)/${PLIST}"
LOG="runtime/penny-server.log"
ERR_LOG="runtime/penny-server.err.log"
DOMAIN="gui/$(id -u)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
PENNY_ALLOWED_HOSTS_SET="${PENNY_ALLOWED_HOSTS+x}"
PENNY_TAILSCALE_USERS_SET="${PENNY_TAILSCALE_USERS+x}"
PENNY_BASE_PATH_SET="${PENNY_BASE_PATH+x}"
PENNY_ALLOW_REMOTE_RUNTIME_CONTROL_SET="${PENNY_ALLOW_REMOTE_RUNTIME_CONTROL+x}"
PENNY_RUNTIME_SCRIPT_SET="${PENNY_RUNTIME_SCRIPT+x}"
PENNY_MODEL_BASE_URL_SET="${PENNY_MODEL_BASE_URL+x}"
PENNY_MODEL_MODE_SET="${PENNY_MODEL_MODE+x}"
PENNY_MODEL_CREDENTIAL_FILE_SET="${PENNY_MODEL_CREDENTIAL_FILE+x}"
PENNY_MODEL_TIMEOUT_MS_SET="${PENNY_MODEL_TIMEOUT_MS+x}"
PENNY_STATE_DIR_SET="${PENNY_STATE_DIR+x}"
PENNY_VOICE_PACK_DIR_SET="${PENNY_VOICE_PACK_DIR+x}"
WRITING_RUNTIME_HF_HOME_SET="${WRITING_RUNTIME_HF_HOME+x}"
WRITING_RUNTIME_SUPERVISOR_SET="${WRITING_RUNTIME_SUPERVISOR+x}"
PENNY_ALLOWED_HOSTS="${PENNY_ALLOWED_HOSTS:-}"
PENNY_TAILSCALE_USERS="${PENNY_TAILSCALE_USERS:-}"
PENNY_BASE_PATH="${PENNY_BASE_PATH:-}"
PENNY_ALLOW_REMOTE_RUNTIME_CONTROL="${PENNY_ALLOW_REMOTE_RUNTIME_CONTROL:-}"
PENNY_RUNTIME_SCRIPT="${PENNY_RUNTIME_SCRIPT:-}"
PENNY_MODEL_BASE_URL="${PENNY_MODEL_BASE_URL:-}"
PENNY_MODEL_MODE="${PENNY_MODEL_MODE:-}"
PENNY_MODEL_CREDENTIAL_FILE="${PENNY_MODEL_CREDENTIAL_FILE:-}"
PENNY_MODEL_TIMEOUT_MS="${PENNY_MODEL_TIMEOUT_MS:-}"
PENNY_STATE_DIR="${PENNY_STATE_DIR:-}"
PENNY_VOICE_PACK_DIR="${PENNY_VOICE_PACK_DIR:-}"
WRITING_RUNTIME_HF_HOME="${WRITING_RUNTIME_HF_HOME:-}"
WRITING_RUNTIME_SUPERVISOR="${WRITING_RUNTIME_SUPERVISOR:-}"
SETTINGS_RESOLVED=false

usage() {
  cat <<USAGE
Usage: scripts/penny-server.sh on|off|restart|status|plist

Controls the local-only Penny backend on http://${HOST}:${PORT}.

Environment:
  PENNY_ALLOWED_HOSTS    Optional comma-separated tailnet hostnames Penny API should trust.
  PENNY_TAILSCALE_USERS  Optional comma-separated Tailscale user logins trusted over tailnet hosts.
  PENNY_BASE_PATH        Optional URL path prefix such as /penny for path-scoped Tailscale Serve.
  PENNY_ALLOW_REMOTE_RUNTIME_CONTROL=1  Allow tailnet clients to call /api/runtime/action.
  PENNY_RUNTIME_SCRIPT   Optional absolute writing-runtime control script for start/stop/swap/status.
  PENNY_MODEL_BASE_URL   Optional OpenAI-compatible HTTP loopback endpoint, default http://127.0.0.1:8091/v1.
  PENNY_MODEL_MODE       local (default) or shared. Shared mode never controls the local model runtime.
  PENNY_MODEL_CREDENTIAL_FILE  Credential file path required by shared mode; secret values are never persisted.
  PENNY_MODEL_TIMEOUT_MS Model request timeout. Shared mode recommendation: 420000.
  PENNY_STATE_DIR        Optional workspace storage directory, default runtime/penny.
  PENNY_VOICE_PACK_DIR   Optional directory containing private data-only voice packs.
  WRITING_RUNTIME_HF_HOME       Optional external Hugging Face cache root for runtime actions.
  WRITING_RUNTIME_SUPERVISOR    Optional writing runtime supervisor, usually process on a dedicated host.

Unspecified settings are preserved from the loaded launchd service, or from
the existing plist when the service is not loaded. Set a supported variable to
an empty string explicitly to clear that setting on on/restart/plist.
USAGE
}

xml_escape() {
  /usr/bin/python3 -c 'import html,sys; print(html.escape(sys.stdin.read(), quote=True), end="")'
}

write_plist() {
  preserve_unspecified_settings
  mkdir -p runtime
  local base_path_xml=""
  if [[ -n "$PENNY_BASE_PATH" ]]; then
    base_path_xml="$(printf '%s' "$PENNY_BASE_PATH" | xml_escape)"
  fi
  local allowed_hosts_xml=""
  if [[ -n "$PENNY_ALLOWED_HOSTS" ]]; then
    allowed_hosts_xml="$(printf '%s' "$PENNY_ALLOWED_HOSTS" | xml_escape)"
  fi
  local tailscale_users_xml=""
  if [[ -n "$PENNY_TAILSCALE_USERS" ]]; then
    tailscale_users_xml="$(printf '%s' "$PENNY_TAILSCALE_USERS" | xml_escape)"
  fi
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>server/server.mjs</string>
    <string>--port</string>
    <string>${PORT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(pwd)</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
PLIST
  if [[ -n "$base_path_xml" ]]; then
    cat >> "$PLIST" <<PLIST
    <key>PENNY_BASE_PATH</key>
    <string>${base_path_xml}</string>
PLIST
  fi
  if [[ -n "$allowed_hosts_xml" ]]; then
    cat >> "$PLIST" <<PLIST
    <key>PENNY_ALLOWED_HOSTS</key>
    <string>${allowed_hosts_xml}</string>
PLIST
  fi
  if [[ -n "$tailscale_users_xml" ]]; then
    cat >> "$PLIST" <<PLIST
    <key>PENNY_TAILSCALE_USERS</key>
    <string>${tailscale_users_xml}</string>
PLIST
  fi
  if [[ -n "$PENNY_ALLOW_REMOTE_RUNTIME_CONTROL" ]]; then
    cat >> "$PLIST" <<PLIST
    <key>PENNY_ALLOW_REMOTE_RUNTIME_CONTROL</key>
    <string>${PENNY_ALLOW_REMOTE_RUNTIME_CONTROL}</string>
PLIST
  fi
  if [[ -n "$PENNY_RUNTIME_SCRIPT" ]]; then
    local penny_runtime_script_xml
    penny_runtime_script_xml="$(printf '%s' "$PENNY_RUNTIME_SCRIPT" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>PENNY_RUNTIME_SCRIPT</key>
    <string>${penny_runtime_script_xml}</string>
PLIST
  fi
  if [[ -n "$PENNY_MODEL_BASE_URL" ]]; then
    local penny_model_base_url_xml
    penny_model_base_url_xml="$(printf '%s' "$PENNY_MODEL_BASE_URL" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>PENNY_MODEL_BASE_URL</key>
    <string>${penny_model_base_url_xml}</string>
PLIST
  fi
  if [[ -n "$PENNY_MODEL_MODE" ]]; then
    local penny_model_mode_xml
    penny_model_mode_xml="$(printf '%s' "$PENNY_MODEL_MODE" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>PENNY_MODEL_MODE</key>
    <string>${penny_model_mode_xml}</string>
PLIST
  fi
  if [[ -n "$PENNY_MODEL_CREDENTIAL_FILE" ]]; then
    local penny_model_credential_file_xml
    penny_model_credential_file_xml="$(printf '%s' "$PENNY_MODEL_CREDENTIAL_FILE" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>PENNY_MODEL_CREDENTIAL_FILE</key>
    <string>${penny_model_credential_file_xml}</string>
PLIST
  fi
  if [[ -n "$PENNY_MODEL_TIMEOUT_MS" ]]; then
    local penny_model_timeout_ms_xml
    penny_model_timeout_ms_xml="$(printf '%s' "$PENNY_MODEL_TIMEOUT_MS" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>PENNY_MODEL_TIMEOUT_MS</key>
    <string>${penny_model_timeout_ms_xml}</string>
PLIST
  fi
  if [[ -n "$PENNY_STATE_DIR" ]]; then
    local penny_state_dir_xml
    penny_state_dir_xml="$(printf '%s' "$PENNY_STATE_DIR" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>PENNY_STATE_DIR</key>
    <string>${penny_state_dir_xml}</string>
PLIST
  fi
  if [[ -n "$PENNY_VOICE_PACK_DIR" ]]; then
    local penny_voice_pack_dir_xml
    penny_voice_pack_dir_xml="$(printf '%s' "$PENNY_VOICE_PACK_DIR" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>PENNY_VOICE_PACK_DIR</key>
    <string>${penny_voice_pack_dir_xml}</string>
PLIST
  fi
  if [[ -n "$WRITING_RUNTIME_HF_HOME" ]]; then
    local writing_runtime_hf_home_xml
    writing_runtime_hf_home_xml="$(printf '%s' "$WRITING_RUNTIME_HF_HOME" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>WRITING_RUNTIME_HF_HOME</key>
    <string>${writing_runtime_hf_home_xml}</string>
PLIST
  fi
  if [[ -n "$WRITING_RUNTIME_SUPERVISOR" ]]; then
    local writing_runtime_supervisor_xml
    writing_runtime_supervisor_xml="$(printf '%s' "$WRITING_RUNTIME_SUPERVISOR" | xml_escape)"
    cat >> "$PLIST" <<PLIST
    <key>WRITING_RUNTIME_SUPERVISOR</key>
    <string>${writing_runtime_supervisor_xml}</string>
PLIST
  fi
  cat >> "$PLIST" <<PLIST
  </dict>
  <key>StandardOutPath</key>
  <string>$(pwd)/${LOG}</string>
  <key>StandardErrorPath</key>
  <string>$(pwd)/${ERR_LOG}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
PLIST
}

plist_env_value() {
  local key="$1"
  if [[ ! -f "$PLIST" ]]; then
    return 0
  fi
  /usr/bin/python3 - "$PLIST" "$key" <<'PY'
import plistlib
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
try:
    data = plistlib.loads(path.read_bytes())
except Exception:
    raise SystemExit(0)
value = (data.get("EnvironmentVariables") or {}).get(key, "")
if value:
    print(value)
PY
}

launchctl_env_value() {
  local key="$1"
  { launchctl print "${DOMAIN}/${LABEL}" 2>/dev/null || true; } | /usr/bin/python3 -c '
import re
import sys

key = sys.argv[1]
inside_environment = False
for line in sys.stdin:
    stripped = line.strip()
    if stripped == "environment = {":
        inside_environment = True
        continue
    if inside_environment and stripped == "}":
        break
    if not inside_environment:
        continue
    match = re.match(r"([^=]+)=>\s*(.*)$", stripped)
    if not match:
        continue
    current_key = match.group(1).strip()
    value = match.group(2).strip()
    if current_key == key and value:
        print(value)
        break
' "$key" || true
}

status_env_value() {
  local env_value="$1"
  local key="$2"
  if [[ -n "$env_value" ]]; then
    printf '%s\n' "$env_value"
    return
  fi
  if [[ "${PENNY_SERVER_STATUS_SOURCE:-}" != "plist" ]]; then
    if launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
      launchctl_env_value "$key"
      return
    fi
  fi
  plist_env_value "$key"
}

preserve_setting() {
  local variable="$1"
  local marker="$2"
  local key="$3"
  local value=""
  if [[ "${!marker:-}" == "x" ]]; then
    return
  fi
  if [[ "${PENNY_SERVER_STATUS_SOURCE:-}" != "plist" ]] && service_loaded; then
    value="$(launchctl_env_value "$key")"
  else
    value="$(plist_env_value "$key")"
  fi
  printf -v "$variable" '%s' "$value"
}

preserve_unspecified_settings() {
  if [[ "$SETTINGS_RESOLVED" == "true" ]]; then
    return
  fi
  preserve_setting PENNY_ALLOWED_HOSTS PENNY_ALLOWED_HOSTS_SET PENNY_ALLOWED_HOSTS
  preserve_setting PENNY_TAILSCALE_USERS PENNY_TAILSCALE_USERS_SET PENNY_TAILSCALE_USERS
  preserve_setting PENNY_BASE_PATH PENNY_BASE_PATH_SET PENNY_BASE_PATH
  preserve_setting PENNY_ALLOW_REMOTE_RUNTIME_CONTROL PENNY_ALLOW_REMOTE_RUNTIME_CONTROL_SET PENNY_ALLOW_REMOTE_RUNTIME_CONTROL
  preserve_setting PENNY_RUNTIME_SCRIPT PENNY_RUNTIME_SCRIPT_SET PENNY_RUNTIME_SCRIPT
  preserve_setting PENNY_MODEL_BASE_URL PENNY_MODEL_BASE_URL_SET PENNY_MODEL_BASE_URL
  preserve_setting PENNY_MODEL_MODE PENNY_MODEL_MODE_SET PENNY_MODEL_MODE
  preserve_setting PENNY_MODEL_CREDENTIAL_FILE PENNY_MODEL_CREDENTIAL_FILE_SET PENNY_MODEL_CREDENTIAL_FILE
  preserve_setting PENNY_MODEL_TIMEOUT_MS PENNY_MODEL_TIMEOUT_MS_SET PENNY_MODEL_TIMEOUT_MS
  preserve_setting PENNY_STATE_DIR PENNY_STATE_DIR_SET PENNY_STATE_DIR
  preserve_setting PENNY_VOICE_PACK_DIR PENNY_VOICE_PACK_DIR_SET PENNY_VOICE_PACK_DIR
  preserve_setting WRITING_RUNTIME_HF_HOME WRITING_RUNTIME_HF_HOME_SET WRITING_RUNTIME_HF_HOME
  preserve_setting WRITING_RUNTIME_SUPERVISOR WRITING_RUNTIME_SUPERVISOR_SET WRITING_RUNTIME_SUPERVISOR
  SETTINGS_RESOLVED=true
}

is_listening() {
  /usr/bin/python3 - <<PY
import socket
with socket.socket() as sock:
    sock.settimeout(0.5)
    raise SystemExit(0 if sock.connect_ex(("${HOST}", ${PORT})) == 0 else 1)
PY
}

listener_pids() {
  /usr/sbin/lsof -nP -a -t -iTCP@"${HOST}:${PORT}" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

service_loaded() {
  launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1
}

service_pid() {
  launchctl print "${DOMAIN}/${LABEL}" 2>/dev/null | /usr/bin/python3 -c '
import re
import sys

for line in sys.stdin:
    match = re.match(r"\s*pid\s*=\s*([0-9]+)\s*$", line)
    if match:
        print(match.group(1))
        break
' || true
}

process_identity_matches() {
  local pid="$1"
  local command cwd
  command="$(/bin/ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ -n "$command" ]] || return 1
  cwd="$(/usr/sbin/lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [[ "$cwd" == "$(pwd)" ]] || return 1
  printf '%s' "$command" | /usr/bin/python3 -c '
import os
import shlex
import sys

node, script, port = sys.argv[1:]
try:
    actual = shlex.split(sys.stdin.read())
except ValueError:
    raise SystemExit(1)
expected_tail = [script, "--port", port]
valid = (
    len(actual) == 4
    and os.path.realpath(actual[0]) == os.path.realpath(node)
    and actual[1:] == expected_tail
)
raise SystemExit(0 if valid else 1)
' "$NODE_BIN" "server/server.mjs" "$PORT"
}

listener_owned_by() {
  local pid="$1" owners
  owners="$(listener_pids)"
  [[ -n "$owners" && "$owners" == "$pid" ]]
}

managed_listener_pid() {
  local pid
  service_loaded || return 1
  pid="$(service_pid)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  process_identity_matches "$pid" || return 1
  listener_owned_by "$pid" || return 1
  printf '%s\n' "$pid"
}

wait_for_port_close() {
  for _ in $(seq 1 20); do
    if ! is_listening; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

wait_for_managed_listen() {
  for _ in $(seq 1 20); do
    if managed_listener_pid >/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

cmd_on() {
  local pid=""
  preserve_unspecified_settings
  if service_loaded; then
    pid="$(service_pid)"
    if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! process_identity_matches "$pid"; then
      echo "penny_server.error=unverified_loaded_service" >&2
      echo "Refusing to replace a loaded Penny label whose exact PID, executable, arguments, and working directory cannot be proved." >&2
      exit 1
    fi
    if is_listening && ! listener_owned_by "$pid"; then
      echo "penny_server.error=unmanaged_listener" >&2
      echo "Refusing to replace a listener on ${HOST}:${PORT} that is not owned by the verified Penny service." >&2
      exit 1
    fi
    launchctl bootout "${DOMAIN}/${LABEL}"
    if ! wait_for_port_close; then
      echo "penny_server.error=listener_did_not_close" >&2
      exit 1
    fi
  elif is_listening; then
    echo "penny_server.error=unmanaged_listener" >&2
    echo "Refusing to start Penny while an unmanaged process owns ${HOST}:${PORT}." >&2
    exit 1
  fi
  write_plist
  launchctl bootstrap "$DOMAIN" "$PLIST_ABS"
  launchctl kickstart -k "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  if ! wait_for_managed_listen; then
    launchctl bootout "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
    echo "penny_server.error=managed_identity_not_ready" >&2
    echo "Penny backend did not establish a verified managed listener at http://${HOST}:${PORT}" >&2
    exit 1
  fi
  echo "penny_server.status=running"
  echo "penny_server.url=http://${HOST}:${PORT}"
  if [[ -n "$PENNY_BASE_PATH" ]]; then
    echo "penny_server.base_path=${PENNY_BASE_PATH}"
  fi
  if [[ -n "$PENNY_ALLOWED_HOSTS" ]]; then
    echo "penny_server.allowed_hosts=${PENNY_ALLOWED_HOSTS}"
  fi
  if [[ -n "$PENNY_TAILSCALE_USERS" ]]; then
    echo "penny_server.tailscale_users=${PENNY_TAILSCALE_USERS}"
  fi
}

cmd_off() {
  local pid=""
  if ! service_loaded; then
    if is_listening; then
      echo "penny_server.error=unmanaged_listener" >&2
      echo "Refusing to stop a listener on ${HOST}:${PORT} without a verified Penny launchd service." >&2
      exit 1
    fi
    echo "penny_server.status=already_stopped"
    return
  fi
  pid="$(service_pid)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! process_identity_matches "$pid"; then
    echo "penny_server.error=unverified_loaded_service" >&2
    echo "Refusing to stop a loaded Penny label whose exact process identity cannot be proved." >&2
    exit 1
  fi
  if is_listening && ! listener_owned_by "$pid"; then
    echo "penny_server.error=unmanaged_listener" >&2
    echo "Refusing to stop because ${HOST}:${PORT} is not owned by the verified Penny process." >&2
    exit 1
  fi
  launchctl bootout "${DOMAIN}/${LABEL}"
  if ! wait_for_port_close; then
    echo "penny_server.error=listener_did_not_close" >&2
    exit 1
  fi
  echo "penny_server.status=stopped"
}

cmd_restart() {
  # Snapshot the loaded environment before cmd_off removes the launchd service.
  preserve_unspecified_settings
  cmd_off
  cmd_on
}

cmd_status() {
  local effective_base_path effective_allowed_hosts effective_tailscale_users effective_runtime_script effective_model_base_url effective_model_mode effective_model_credential_file effective_model_timeout_ms effective_state_dir effective_voice_pack_dir
  effective_base_path="$(status_env_value "$PENNY_BASE_PATH" "PENNY_BASE_PATH")"
  effective_allowed_hosts="$(status_env_value "$PENNY_ALLOWED_HOSTS" "PENNY_ALLOWED_HOSTS")"
  effective_tailscale_users="$(status_env_value "$PENNY_TAILSCALE_USERS" "PENNY_TAILSCALE_USERS")"
  effective_runtime_script="$(status_env_value "$PENNY_RUNTIME_SCRIPT" "PENNY_RUNTIME_SCRIPT")"
  effective_model_base_url="$(status_env_value "$PENNY_MODEL_BASE_URL" "PENNY_MODEL_BASE_URL")"
  effective_model_mode="$(status_env_value "$PENNY_MODEL_MODE" "PENNY_MODEL_MODE")"
  effective_model_credential_file="$(status_env_value "$PENNY_MODEL_CREDENTIAL_FILE" "PENNY_MODEL_CREDENTIAL_FILE")"
  effective_model_timeout_ms="$(status_env_value "$PENNY_MODEL_TIMEOUT_MS" "PENNY_MODEL_TIMEOUT_MS")"
  effective_state_dir="$(status_env_value "$PENNY_STATE_DIR" "PENNY_STATE_DIR")"
  effective_voice_pack_dir="$(status_env_value "$PENNY_VOICE_PACK_DIR" "PENNY_VOICE_PACK_DIR")"
  if launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
    echo "penny_server.service=loaded"
  else
    echo "penny_server.service=not_loaded"
  fi
  if is_listening; then
    echo "penny_server.listener=true"
    echo "penny_server.url=http://${HOST}:${PORT}"
    if managed_listener_pid >/dev/null; then
      echo "penny_server.identity=managed"
    else
      echo "penny_server.identity=unmanaged"
    fi
  else
    echo "penny_server.listener=false"
    echo "penny_server.identity=none"
  fi
  if [[ -n "$effective_base_path" ]]; then
    echo "penny_server.base_path=${effective_base_path}"
  fi
  if [[ -n "$effective_allowed_hosts" ]]; then
    echo "penny_server.allowed_hosts=${effective_allowed_hosts}"
  fi
  if [[ -n "$effective_tailscale_users" ]]; then
    echo "penny_server.tailscale_users=${effective_tailscale_users}"
  fi
  if [[ -n "$effective_runtime_script" ]]; then
    echo "penny_server.runtime_script=${effective_runtime_script}"
  fi
  if [[ -n "$effective_model_base_url" ]]; then
    echo "penny_server.model_base_url=${effective_model_base_url}"
  fi
  if [[ -n "$effective_model_mode" ]]; then
    echo "penny_server.model_mode=${effective_model_mode}"
  fi
  if [[ -n "$effective_model_credential_file" ]]; then
    echo "penny_server.model_credential_file=configured"
  fi
  if [[ -n "$effective_model_timeout_ms" ]]; then
    echo "penny_server.model_timeout_ms=${effective_model_timeout_ms}"
  fi
  if [[ -n "$effective_state_dir" ]]; then
    echo "penny_server.state_dir=${effective_state_dir}"
  fi
  if [[ -n "$effective_voice_pack_dir" ]]; then
    echo "penny_server.voice_pack_dir=${effective_voice_pack_dir}"
  fi
}

cmd_plist() {
  write_plist
  echo "penny_server.plist=${PLIST_ABS}"
}

case "${1:-}" in
  on) cmd_on ;;
  off) cmd_off ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  plist) cmd_plist ;;
  *) usage; exit 2 ;;
esac
