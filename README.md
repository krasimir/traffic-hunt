# traffic-hunt

A script for monitoring network traffic from locally running apps — particularly useful for inspecting what a Node.js app sends to third-party APIs (LLMs, payment providers, external services, etc.). Or at least that's what I've built it for :smile:.

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

This is the primary use case — your Node app makes requests to an external service (OpenAI, Anthropic, Stripe, etc.) and you want to see exactly what is sent and received, including full request and response bodies.

Because these calls are HTTPS, the traffic is encrypted and tshark cannot decode it. The script uses mitmproxy as a local proxy that sits between your app and the API, decrypting and logging everything.

**Step 1** — start the capture:

```bash
./capture.sh -o ~/Desktop/llm.log
```

The script will print the proxy address and the exact env vars you need — copy them from the terminal output.

**Step 2** — in a separate terminal, run your Node app with those env vars:

```bash
GLOBAL_AGENT_HTTPS_PROXY=http://localhost:19472 \
NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem \
NODE_OPTIONS="-r /Users/you/traffic-hunt/bootstrap.js" \
npm run dev
```

`NODE_OPTIONS` is passed through by npm to every Node process it spawns. The `bootstrap.js` patches both Node's `http`/`https` modules and `undici` (used by OpenAI SDK v4, LangChain, and Node 18+ native fetch), so all outbound traffic is proxied regardless of which HTTP client the SDK uses internally.

`NODE_EXTRA_CA_CERTS` tells Node to trust mitmproxy's certificate so it doesn't reject the intercepted TLS connection. Note: use `$HOME` not `~` — the tilde does not expand inside env var assignments.

> First run: the mitmproxy CA cert is generated the first time `mitmdump` runs. If Node complains about an unknown certificate, start the script once, stop it, then re-run your app — the cert file will now exist at `~/.mitmproxy/mitmproxy-ca-cert.pem`.

All requests and responses — including full JSON bodies — appear live in the terminal and are written to the log file.

> **Security:** log files contain your API keys in plaintext (in the `Authorization` header). Do not commit them. Add `*.log` to `.gitignore`.

## General TCP/HTTP capture

For plain HTTP traffic or low-level TCP inspection without HTTPS decoding, pass `--no-mitm`:

```bash
./capture.sh --no-mitm -o traffic.log
```

This uses tshark (or tcpdump as fallback) and requires root — the script will prompt for your password via `sudo`.

```
./capture.sh [options]

Options:
  -p, --protocol  Protocol filter: http | https | all  (default: all)
  -o, --output    Output log file                      (default: traffic-<timestamp>.log)
  -i, --interface Network interface                    (default: auto-detected)
  -P, --ports     Extra ports to watch, comma-separated
  -r, --raw       Also write a .pcap file (openable in Wireshark GUI)
  -v, --verbose   Show full ASCII payloads (tcpdump fallback only)
  --no-mitm       Use tshark/tcpdump instead of mitmproxy
  -h, --help      Show help
```

Filter to HTTP ports only:

```bash
./capture.sh --no-mitm -p http -o app.log
```

Also save a raw `.pcap` file to open in the Wireshark GUI later:

```bash
./capture.sh --no-mitm -r session.pcap -o traffic.log
```

Stop any capture with `Ctrl+C`.

## Troubleshooting

**Verify the proxy is running:**

```bash
lsof -i :19472
```

You should see `mitmdump` listed. If not, the script isn't running.

**Test the proxy directly with curl:**

```bash
curl --cacert ~/.mitmproxy/mitmproxy-ca-cert.pem \
     -x http://localhost:19472 \
     https://httpbin.org/get
```

If this returns JSON, the proxy is working correctly. Without `--cacert`, curl will reject mitmproxy's certificate — that's expected.

**The proxy works but nothing appears from your Node app:**

Make sure you are using the exact command printed by the script (with the correct absolute path to `bootstrap.js`). The `bootstrap.js` patches both `http`/`https` and `undici` — without it, SDKs like OpenAI v4 and LangChain will silently bypass the proxy.

## Output format

**mitmproxy mode** (default): human-readable flow log with full headers and bodies — method, URL, status code, request/response JSON, timing.

**tshark mode** (`--no-mitm`): pipe-delimited with a header row:

```
frame.time | ip.src | ip.dst | tcp.srcport | tcp.dstport | http.request.method | http.request.uri | http.host | http.request.version | http.response.code | http.response.phrase | http.content_type | http.content_length
```
