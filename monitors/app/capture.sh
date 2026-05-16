#!/usr/bin/env bash
# Capture HTTPS payloads from an app launched through mitmproxy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MITM_ADDON="$SCRIPT_DIR/mitm_bridge.py"
NODE_LOGGER="$SCRIPT_DIR/payload_logger.js"

MITM_PORT=19473
OUTPUT_FILE="app-traffic-$(date +%Y%m%d-%H%M%S).json"
MITM_LOG=""
APP_PATH=""
APP_ARGS=()
LAUNCH=true
IGNORE_CERT_ERRORS=true
ELECTRON_FLAGS=false
ELECTRON_USER_DATA_DIR=""
EXCLUDED_HOSTS=()

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  -o, --output          JSON payload log file               (default: app-traffic-<timestamp>.json)
  --mitm-log           mitmdump console log file            (default: <output>.mitm.log)
  --port               Local mitmproxy port                 (default: 19473)
  --app                App executable or macOS .app bundle to launch
  --app-arg            Argument to pass to the app; repeat as needed
  --electron           Add Electron/Chromium proxy flags to the app launch
  --electron-user-data-dir
                       Add --user-data-dir for Electron/Chromium apps.
                       Use "temp" to create a temporary isolated profile.
  --exclude-host       Host to omit from output; repeat or comma-separate
  --no-launch          Start proxy only and print launch environment
  --strict-certs       With --electron, do not pass --ignore-certificate-errors
  -h, --help           Show this help

Any arguments after -- are also passed to the app.

Examples:
  $(basename "$0") --app /path/to/app --app-arg /path/to/project -o app.json
  $(basename "$0") --app "/Applications/Visual Studio Code.app" --electron --electron-user-data-dir temp -- /path/to/project
  $(basename "$0") --exclude-host '*.example.com,api.example.com' --no-launch -o app.json
EOF
  exit 0
}

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[ERROR] $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) OUTPUT_FILE="$2"; shift 2 ;;
    --mitm-log) MITM_LOG="$2"; shift 2 ;;
    --port) MITM_PORT="$2"; shift 2 ;;
    --app) APP_PATH="$2"; shift 2 ;;
    --app-arg) APP_ARGS+=("$2"); shift 2 ;;
    --electron) ELECTRON_FLAGS=true; shift ;;
    --electron-user-data-dir) ELECTRON_USER_DATA_DIR="$2"; shift 2 ;;
    --exclude-host)
      IFS=',' read -r -a HOST_PARTS <<< "$2"
      EXCLUDED_HOSTS+=("${HOST_PARTS[@]}")
      shift 2
      ;;
    --no-launch) LAUNCH=false; shift ;;
    --strict-certs) IGNORE_CERT_ERRORS=false; shift ;;
    -h|--help) usage ;;
    --)
      shift
      APP_ARGS+=("$@")
      break
      ;;
    *) err "Unknown option: $1. Use -h for help." ;;
  esac
done

command -v mitmdump &>/dev/null || err "mitmdump not found. Install it with: brew install mitmproxy"
command -v node &>/dev/null || err "node not found. Install Node.js before using this monitor."

if [[ -z "$MITM_LOG" ]]; then
  MITM_LOG="$OUTPUT_FILE.mitm.log"
fi

PROXY_URL="http://127.0.0.1:$MITM_PORT"
MITM_CA="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"

resolve_app_executable() {
  local path="$1"

  if [[ "$path" == *.app ]]; then
    local info_plist="$path/Contents/Info.plist"
    local executable_name=""

    if [[ -f "$info_plist" && -x /usr/libexec/PlistBuddy ]]; then
      executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$info_plist" 2>/dev/null || true)"
    fi

    [[ -n "$executable_name" ]] || executable_name="$(basename "$path" .app)"
    echo "$path/Contents/MacOS/$executable_name"
    return
  fi

  echo "$path"
}

APP_BIN=""
if [[ "$LAUNCH" == true ]]; then
  [[ -n "$APP_PATH" ]] || err "Missing --app. Pass an app executable or macOS .app bundle, or use --no-launch."
  APP_BIN="$(resolve_app_executable "$APP_PATH")"
  [[ -x "$APP_BIN" ]] || err "App executable not found or not executable: $APP_BIN"
fi

cleanup() {
  if [[ -n "${MITM_PID:-}" ]]; then
    kill "$MITM_PID" 2>/dev/null || true
    wait "$MITM_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

log "Mode:       App HTTPS interception"
log "Proxy:      $PROXY_URL"
log "Payloads:   $OUTPUT_FILE"
log "mitmdump:   $MITM_LOG"
if [[ "$LAUNCH" == true ]]; then
  log "App:        $APP_BIN"
fi

EXCLUDED_HOSTS_CSV=""
if [[ ${#EXCLUDED_HOSTS[@]} -gt 0 ]]; then
  EXCLUDED_HOSTS_CSV="$(IFS=','; echo "${EXCLUDED_HOSTS[*]}")"
  log "Excluding:  $EXCLUDED_HOSTS_CSV"
fi

mitmdump \
  --listen-host 127.0.0.1 \
  --listen-port "$MITM_PORT" \
  --set "payload_log=$OUTPUT_FILE" \
  --set "node_logger=$NODE_LOGGER" \
  --set "excluded_hosts=$EXCLUDED_HOSTS_CSV" \
  -s "$MITM_ADDON" \
  --flow-detail 1 \
  >"$MITM_LOG" 2>&1 &
MITM_PID=$!

sleep 1
if ! kill -0 "$MITM_PID" 2>/dev/null; then
  err "mitmdump failed to start. Check: $MITM_LOG"
fi

echo ""
echo "Proxy environment:"
echo "  HTTP_PROXY=$PROXY_URL"
echo "  HTTPS_PROXY=$PROXY_URL"
echo "  ALL_PROXY=$PROXY_URL"
echo "  NODE_EXTRA_CA_CERTS=$MITM_CA"
echo "  SSL_CERT_FILE=$MITM_CA"
echo "  REQUESTS_CA_BUNDLE=$MITM_CA"
echo "  CURL_CA_BUNDLE=$MITM_CA"
echo ""

if [[ ! -f "$MITM_CA" ]]; then
  log "mitmproxy CA not found yet at $MITM_CA. It should be generated by this run."
fi

if [[ "$LAUNCH" == false ]]; then
  log "Proxy is running. Launch an app or child process with the environment above."
  log "Press Ctrl+C to stop."
  wait "$MITM_PID"
  exit 0
fi

APP_LAUNCH_ARGS=()

if [[ "$ELECTRON_FLAGS" == true ]]; then
  if [[ "$ELECTRON_USER_DATA_DIR" == "temp" ]]; then
    ELECTRON_USER_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/traffic-hunt-app.XXXXXX")"
  fi

  APP_LAUNCH_ARGS+=("--proxy-server=$PROXY_URL")
  if [[ -n "$ELECTRON_USER_DATA_DIR" ]]; then
    APP_LAUNCH_ARGS+=("--user-data-dir=$ELECTRON_USER_DATA_DIR")
    log "Profile:    $ELECTRON_USER_DATA_DIR"
  fi

  if [[ "$IGNORE_CERT_ERRORS" == true ]]; then
    APP_LAUNCH_ARGS+=("--ignore-certificate-errors")
  fi
fi

APP_LAUNCH_ARGS+=("${APP_ARGS[@]}")

log "Launching: $APP_BIN ${APP_LAUNCH_ARGS[*]}"

HTTP_PROXY="$PROXY_URL" \
HTTPS_PROXY="$PROXY_URL" \
ALL_PROXY="$PROXY_URL" \
http_proxy="$PROXY_URL" \
https_proxy="$PROXY_URL" \
all_proxy="$PROXY_URL" \
NODE_EXTRA_CA_CERTS="$MITM_CA" \
SSL_CERT_FILE="$MITM_CA" \
REQUESTS_CA_BUNDLE="$MITM_CA" \
CURL_CA_BUNDLE="$MITM_CA" \
GLOBAL_AGENT_HTTP_PROXY="$PROXY_URL" \
GLOBAL_AGENT_HTTPS_PROXY="$PROXY_URL" \
npm_config_proxy="$PROXY_URL" \
npm_config_https_proxy="$PROXY_URL" \
"$APP_BIN" "${APP_LAUNCH_ARGS[@]}" &
APP_PID=$!

log "App PID: $APP_PID"
sleep 2
if ! kill -0 "$APP_PID" 2>/dev/null; then
  log "App process exited quickly. If the app was already running, it may have handed this launch to the existing unproxied instance."
  log "For Electron apps, close existing instances or use --electron-user-data-dir temp."
fi
log "Press Ctrl+C to stop capture."
wait "$MITM_PID"
