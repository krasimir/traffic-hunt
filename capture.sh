#!/usr/bin/env bash
# traffic-hunt/capture.sh — capture network traffic and log to file
# Usage: ./capture.sh [options]
# Requires: tcpdump (built-in macOS) or tshark (brew install wireshark)

set -euo pipefail

# ── defaults ──────────────────────────────────────────────────────────────────
PROTOCOL="http"
OUTPUT_FILE="traffic-$(date +%Y%m%d-%H%M%S).log"
INTERFACE="any"
PORTS=""
RAW_PCAP=""
VERBOSE=false

# ── helpers ───────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  -p, --protocol  Protocol to capture: http | https | all  (default: http)
  -o, --output    Output log file                           (default: traffic-<timestamp>.log)
  -i, --interface Network interface                         (default: any)
  -P, --ports     Extra ports to include, comma-separated  (e.g. 3000,8080)
  -r, --raw       Also save raw .pcap file for Wireshark   (provide filename)
  -v, --verbose   Show full packet payloads (ASCII)
  -h, --help      Show this help

Examples:
  $(basename "$0")                              # capture HTTP (ports 80,8080,3000,4000)
  $(basename "$0") -p all -o full.log           # all TCP traffic
  $(basename "$0") -P 5000,9000 -o app.log      # HTTP + extra ports
  $(basename "$0") -v -o debug.log              # verbose: full ASCII payloads
  $(basename "$0") -r raw.pcap -o traffic.log   # also save .pcap for Wireshark
EOF
  exit 0
}

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
err()  { echo "[ERROR] $*" >&2; exit 1; }

# ── arg parsing ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--protocol)  PROTOCOL="$2";    shift 2 ;;
    -o|--output)    OUTPUT_FILE="$2"; shift 2 ;;
    -i|--interface) INTERFACE="$2";   shift 2 ;;
    -P|--ports)     PORTS="$2";       shift 2 ;;
    -r|--raw)       RAW_PCAP="$2";    shift 2 ;;
    -v|--verbose)   VERBOSE=true;     shift   ;;
    -h|--help)      usage ;;
    *) err "Unknown option: $1. Use -h for help." ;;
  esac
done

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

  # append user-supplied extra ports
  if [[ -n "$PORTS" ]]; then
    base_ports="$base_ports ${PORTS//,/ }"
  fi

  if [[ -z "$base_ports" ]]; then
    echo "tcp"   # capture all TCP
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

# ── check for root/sudo (tcpdump needs it on macOS) ──────────────────────────
if [[ "$TOOL" == "tcpdump" ]] && [[ $EUID -ne 0 ]]; then
  log "tcpdump requires root. Re-running with sudo..."
  exec sudo "$0" "$@"
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
  # tshark: rich protocol dissection, HTTP fields decoded
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
    -T fields
    -E header=y
    -E separator="|"
    -E quote=d
    -E occurrence=f
    "${TSHARK_FIELDS[@]}"
  )

  if [[ -n "$RAW_PCAP" ]]; then
    TSHARK_ARGS+=(-w "$RAW_PCAP")
    # tshark can't write fields + pcap simultaneously, so run two processes
    log "Note: running two captures (fields log + pcap) simultaneously."
    tshark -i "$INTERFACE" -f "$FILTER" -w "$RAW_PCAP" &>/dev/null &
    PCAP_PID=$!
  fi

  tshark "${TSHARK_ARGS[@]}" 2>/dev/null | tee "$OUTPUT_FILE"

  [[ -n "$RAW_PCAP" ]] && kill "$PCAP_PID" 2>/dev/null || true

else
  # tcpdump fallback
  TCPDUMP_ARGS=(
    -i "$INTERFACE"
    -nn          # don't resolve hostnames/ports
    -q           # quiet: less protocol info
    -s 0         # full packet snaplen
  )

  $VERBOSE && TCPDUMP_ARGS+=(-A)   # ASCII payload
  [[ -n "$RAW_PCAP" ]] && TCPDUMP_ARGS+=(-w "$RAW_PCAP")

  tcpdump "${TCPDUMP_ARGS[@]}" "$FILTER" 2>/dev/null | tee "$OUTPUT_FILE"
fi
