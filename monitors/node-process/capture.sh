#!/usr/bin/env bash
# traffic-hunt/monitors/node-process/capture.sh — capture Node process traffic and log to file
# Usage: ./capture.sh [options]
# Requires: tcpdump (built-in macOS) or tshark (brew install wireshark)
#           mitmproxy for HTTPS interception (brew install mitmproxy)

set -euo pipefail

MITM_PORT=19472
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP="$SCRIPT_DIR/bootstrap.js"

# ── check for -m/--mitm before sudo so we can skip root for that mode ─────────
MITM_MODE=true
for arg in "$@"; do
  [[ "$arg" == "--no-mitm" ]] && MITM_MODE=false && break
done

# ── sudo first, before anything shifts $@ (not needed for mitm mode) ──────────
if [[ $EUID -ne 0 ]] && [[ "$MITM_MODE" == false ]]; then
  echo "[$(date '+%H:%M:%S')] Packet capture requires root. Re-running with sudo..."
  exec sudo "$0" "$@"
fi

# ── defaults ──────────────────────────────────────────────────────────────────
PROTOCOL="all"
OUTPUT_FILE="traffic-$(date +%Y%m%d-%H%M%S).log"
INTERFACE=""   # auto-detected below
PORTS=""
RAW_PCAP=""
VERBOSE=false

# ── helpers ───────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  -p, --protocol  Protocol to capture: http | https | all  (default: all)
  -o, --output    Output log file                           (default: traffic-<timestamp>.log)
  -i, --interface Network interface                         (default: auto-detected)
  -P, --ports     Extra ports to include, comma-separated  (e.g. 3000,8080)
  -r, --raw       Also save raw .pcap file for Wireshark   (provide filename)
  -v, --verbose   Show full packet payloads (ASCII)
  --no-mitm       Disable mitmproxy mode, use tshark/tcpdump instead
  -h, --help      Show this help

Examples:
  $(basename "$0") -o llm.log                   # intercept HTTPS with mitmproxy
  $(basename "$0") --no-mitm -p http -o app.log # HTTP ports only
  $(basename "$0") --no-mitm -P 5000,9000 -o app.log
  $(basename "$0") --no-mitm -v -o debug.log    # verbose tcpdump fallback
  $(basename "$0") --no-mitm -r raw.pcap -o traffic.log
EOF
  exit 0
}

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
err()  { echo "[ERROR] $*" >&2; exit 1; }

# ── auto-detect active network interface ──────────────────────────────────────
detect_interface() {
  route get default 2>/dev/null | awk '/interface:/ {print $2; exit}'
}

# ── arg parsing ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--protocol)  PROTOCOL="$2";    shift 2 ;;
    -o|--output)    OUTPUT_FILE="$2"; shift 2 ;;
    -i|--interface) INTERFACE="$2";   shift 2 ;;
    -P|--ports)     PORTS="$2";       shift 2 ;;
    -r|--raw)       RAW_PCAP="$2";    shift 2 ;;
    -v|--verbose)   VERBOSE=true;     shift   ;;
    --no-mitm)      MITM_MODE=false;  shift   ;;
    -h|--help)      usage ;;
    *) err "Unknown option: $1. Use -h for help." ;;
  esac
done

# ── mitmproxy mode ────────────────────────────────────────────────────────────
if [[ "$MITM_MODE" == true ]]; then
  command -v mitmdump &>/dev/null || err "mitmproxy not found. Install it: brew install mitmproxy"

  log "Mode:      HTTPS interception (mitmproxy)"
  log "Port:      $MITM_PORT"
  log "Output:    $OUTPUT_FILE"
  log "Press Ctrl+C to stop."

  echo ""
  echo "████████████████████████████████████████████████████████████"
  echo "  ACTION REQUIRED — run your app with these env vars set:"
  echo ""
  echo "  GLOBAL_AGENT_HTTPS_PROXY=http://localhost:$MITM_PORT \\"
  echo "  NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem \\"
  echo "  NODE_OPTIONS=\"-r $BOOTSTRAP\" \\"
  echo "  npm run dev"
  echo ""
  echo "  First time? The cert is generated on first mitmdump run."
  echo "  If Node rejects the cert, run mitmdump once first, then"
  echo "  re-run your app."
  echo "████████████████████████████████████████████████████████████"
  echo ""

  mitmdump --listen-port "$MITM_PORT" --flow-detail 3 2>&1 | tee "$OUTPUT_FILE"
  exit 0
fi

# ── resolve interface ─────────────────────────────────────────────────────────
if [[ -z "$INTERFACE" ]]; then
  INTERFACE="$(detect_interface)"
  [[ -z "$INTERFACE" ]] && err "Could not detect active network interface. Specify one with -i (e.g. -i en0)"
fi

# ── build port filter ─────────────────────────────────────────────────────────
build_filter() {
  local base_ports=""

  case "$PROTOCOL" in
    http)
      base_ports="80 8080 3000 4000 5173 4321 1234 8000 8888"
      ;;
    https)
      base_ports="443 8443"
      ;;
    all)
      base_ports=""
      ;;
    *)
      err "Unknown protocol '$PROTOCOL'. Use: http | https | all"
      ;;
  esac

  if [[ -n "$PORTS" ]]; then
    base_ports="$base_ports ${PORTS//,/ }"
  fi

  if [[ -z "$base_ports" ]]; then
    echo "tcp"
    return
  fi

  local filter="tcp and ("
  local first=true
  for port in $base_ports; do
    if $first; then
      filter+="port $port"
      first=false
    else
      filter+=" or port $port"
    fi
  done
  filter+=")"
  echo "$filter"
}

# ── detect available tool ─────────────────────────────────────────────────────
TOOL=""
if command -v tshark &>/dev/null; then
  TOOL="tshark"
elif command -v tcpdump &>/dev/null; then
  TOOL="tcpdump"
else
  err "Neither tshark nor tcpdump found. Install one:
  brew install wireshark   # for tshark (recommended, richer HTTP decoding)
  tcpdump ships with macOS (may need: sudo)"
fi

# ── build capture command ─────────────────────────────────────────────────────
FILTER="$(build_filter)"

log "Tool:      $TOOL"
log "Protocol:  $PROTOCOL"
log "Interface: $INTERFACE"
log "Filter:    $FILTER"
log "Output:    $OUTPUT_FILE"
[[ -n "$RAW_PCAP" ]] && log "PCAP:      $RAW_PCAP"
log "Press Ctrl+C to stop."
echo "──────────────────────────────────────────────────────"

# ── run capture ───────────────────────────────────────────────────────────────
if [[ "$TOOL" == "tshark" ]]; then
  TSHARK_FIELDS=(
    -e frame.time
    -e ip.src
    -e ip.dst
    -e tcp.srcport
    -e tcp.dstport
    -e http.request.method
    -e http.request.uri
    -e http.host
    -e http.request.version
    -e http.response.code
    -e http.response.phrase
    -e http.content_type
    -e http.content_length
  )

  TSHARK_ARGS=(
    -i "$INTERFACE"
    -f "$FILTER"
    -l                # flush output after every packet — prevents empty log on Ctrl+C
    -T fields
    -E header=y
    -E separator="|"
    -E quote=d
    -E occurrence=f
    "${TSHARK_FIELDS[@]}"
  )

  if [[ -n "$RAW_PCAP" ]]; then
    log "Note: running two captures (fields log + pcap) simultaneously."
    tshark -i "$INTERFACE" -f "$FILTER" -w "$RAW_PCAP" &>/dev/null &
    PCAP_PID=$!
  fi

  tshark "${TSHARK_ARGS[@]}" 2>&1 | tee "$OUTPUT_FILE"

  [[ -n "$RAW_PCAP" ]] && kill "$PCAP_PID" 2>/dev/null || true

else
  TCPDUMP_ARGS=(
    -i "$INTERFACE"
    -nn
    -q
    -s 0
  )

  $VERBOSE && TCPDUMP_ARGS+=(-A)
  [[ -n "$RAW_PCAP" ]] && TCPDUMP_ARGS+=(-w "$RAW_PCAP")

  tcpdump "${TCPDUMP_ARGS[@]}" "$FILTER" 2>&1 | tee "$OUTPUT_FILE"
fi
