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

This is the primary use case — your Node app makes requests to an external service (OpenAI, Anthropic, Stripe, etc.) and you want to see exactly what is sent and received.

Because these calls are HTTPS, the traffic is encrypted and tshark cannot decode it. The script uses mitmproxy as a local proxy that sits between your app and the API, decrypting and logging everything.

**Step 1** — start the capture:

```bash
./capture.sh -o ~/Desktop/llm.log
```

The script will print the proxy address and the exact env vars you need.

**Step 2** — in a separate terminal, run your Node app with:

```bash
GLOBAL_AGENT_HTTPS_PROXY=http://localhost:19472 \
NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem \
NODE_OPTIONS="-r /path/to/traffic-hunt/bootstrap.js" \
npm run dev
```

The script prints the exact command with the correct path filled in — just copy it from the terminal output.

`NODE_OPTIONS` is passed through by npm to every Node process it spawns, so this works regardless of how your start script is defined. `global-agent` patches Node's HTTP stack at startup so all outbound traffic is proxied — including calls from SDKs like OpenAI v4 and LangChain that use `undici` internally and ignore `HTTPS_PROXY`.

`NODE_EXTRA_CA_CERTS` tells Node to trust mitmproxy's certificate so it doesn't reject the intercepted TLS connection.

> First run: the mitmproxy CA cert is generated the first time `mitmdump` runs. If Node complains about an unknown certificate, start the script once, stop it, then re-run your app — the cert file will now exist at `~/.mitmproxy/mitmproxy-ca-cert.pem`.

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

**`~` doesn't expand in env vars** — use `$HOME` instead:

```bash
# Wrong
NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem node app.js

# Correct
NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem node app.js
```

**The proxy works but nothing appears from your Node app:**

Some HTTP clients inside Node (notably `undici` and native `fetch`, used by the OpenAI SDK v4, LangChain, and others) do not respect `HTTPS_PROXY`. The script handles this automatically via `bootstrap.js` and `global-agent` — make sure you are copying the exact command printed in the terminal after starting the script.

## Output format

**mitmproxy mode** (`-m`): human-readable flow log — method, URL, status code, response size, timing.

**tshark mode**: pipe-delimited with a header row:

```
frame.time | ip.src | ip.dst | tcp.srcport | tcp.dstport | http.request.method | http.request.uri | http.host | http.request.version | http.response.code | http.response.phrase | http.content_type | http.content_length
```
