# traffic-hunt

A shell script that captures and logs network traffic from your machine — useful for inspecting what a locally running web app actually sends and receives.

## Requirements

Install [Wireshark](https://www.wireshark.org/) via Homebrew (provides `tshark`, the CLI tool used by the script):

```bash
brew install wireshark
```

> If `tshark` is not found, the script falls back to `tcpdump` which ships with macOS, but the output is less readable. `tshark` is strongly recommended.

After installing, verify `tshark` is available:

```bash
tshark --version
```

## Usage

```
./capture.sh [options]

Options:
  -p, --protocol  Protocol filter: http | https | all  (default: http)
  -o, --output    Output log file                      (default: traffic-<timestamp>.log)
  -i, --interface Network interface                    (default: any)
  -P, --ports     Extra ports to watch, comma-separated
  -r, --raw       Also write a .pcap file (openable in Wireshark GUI)
  -v, --verbose   Show full ASCII payloads (tcpdump fallback only)
  -h, --help      Show help
```

## Examples

Capture HTTP traffic using all default ports (80, 8080, 3000, 4000, 5173, 4321, 8000, 8888…):

```bash
./capture.sh
```

Write to a specific file:

```bash
./capture.sh -o myapp.log
```

Your app runs on a non-standard port (e.g. 5000):

```bash
./capture.sh -P 5000 -o myapp.log
```

Capture everything (all TCP, not just HTTP ports):

```bash
./capture.sh -p all -o full.log
```

Also save a raw `.pcap` file so you can open it in the Wireshark GUI later:

```bash
./capture.sh -r session.pcap -o traffic.log
```

Stop the capture at any time with `Ctrl+C`.

## Output format

When using `tshark` the log is pipe-delimited with a header row:

```
frame.time | ip.src | ip.dst | tcp.srcport | tcp.dstport | http.request.method | http.request.uri | http.host | http.request.version | http.response.code | http.response.phrase | http.content_type | http.content_length
```

Each row represents one HTTP request or response captured on the wire.
