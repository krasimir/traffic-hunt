# traffic-hunt

A script for monitoring network traffic from locally running apps — particularly useful for inspecting what a Node.js app sends to third-party APIs (LLMs, payment providers, external services, etc.).

## Install dependencies

Both tools are required:

```bash
brew install wireshark    # provides tshark — for plain TCP/HTTP capture
brew install mitmproxy    # for HTTPS interception (decrypts TLS)
```

Verify both are available:

```bash
tshark --version
mitmdump --version
```

## Monitoring a Node app that calls a third-party HTTPS API

This is the primary use case — your Node app makes requests to an external service (OpenAI, Anthropic, Stripe, etc.) and you want to see exactly what is sent and received.

Because these calls are HTTPS, the traffic is encrypted and tshark cannot decode it. The script uses mitmproxy as a local proxy that sits between your app and the API, decrypting and logging everything.

**Step 1** — start the capture:

```bash
./capture.sh -o ~/Desktop/llm.log
```

The script will print the proxy address and the exact env vars you need.

**Step 2** — in a separate terminal, run your Node app with those env vars:

```bash
HTTPS_PROXY=http://localhost:19472 \
NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem \
node your-app.js
```

`HTTPS_PROXY` routes all outbound HTTPS calls through mitmproxy. `NODE_EXTRA_CA_CERTS` tells Node to trust mitmproxy's certificate so it doesn't reject the intercepted TLS connection.

> First run: the mitmproxy CA cert is generated the first time `mitmdump` runs. If Node complains about an unknown certificate, start the script once, let it run for a second, then stop it and try again — the cert file will now exist.

All requests and responses appear live in the terminal and are written to the log file.

## General TCP/HTTP capture

For plain HTTP traffic or low-level TCP inspection (no HTTPS decoding):

```bash
./capture.sh -o traffic.log
```

The script auto-detects your active network interface and requires root — it will prompt for your password via `sudo`.

```
./capture.sh [options]

Options:
  -p, --protocol  Protocol filter: http | https | all  (default: all)
  -o, --output    Output log file                      (default: traffic-<timestamp>.log)
  -i, --interface Network interface                    (default: auto-detected)
  -P, --ports     Extra ports to watch, comma-separated
  -r, --raw       Also write a .pcap file (openable in Wireshark GUI)
  -v, --verbose   Show full ASCII payloads (tcpdump fallback only)
  --no-mitm       Disable mitmproxy, use tshark/tcpdump instead
  -h, --help      Show help
```

Filter to HTTP ports only:

```bash
./capture.sh -p http -o app.log
```

Your app runs on a non-standard port:

```bash
./capture.sh -P 5000 -o app.log
```

Also save a raw `.pcap` file to open in the Wireshark GUI:

```bash
./capture.sh -r session.pcap -o traffic.log
```

Stop any capture with `Ctrl+C`.

## Output format

**mitmproxy mode** (`-m`): human-readable flow log — method, URL, status code, response size, timing.

**tshark mode**: pipe-delimited with a header row:

```
frame.time | ip.src | ip.dst | tcp.srcport | tcp.dstport | http.request.method | http.request.uri | http.host | http.request.version | http.response.code | http.response.phrase | http.content_type | http.content_length
```
