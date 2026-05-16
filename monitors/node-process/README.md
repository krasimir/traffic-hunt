# Node Process Monitor

This monitor captures network traffic from a Node.js app that calls third-party APIs such as OpenAI, Anthropic, Stripe, or other external services.

## How it works

HTTPS traffic is encrypted, so packet capture tools cannot decode request bodies by themselves. This monitor runs `mitmproxy` locally and gives you the environment variables needed to run your Node app through that proxy.

`bootstrap.js` patches both Node's `http`/`https` modules and `undici`, which is used by OpenAI SDK v4, LangChain, and Node 18+ native `fetch`.

## Start capture

```bash
./monitors/node-process/capture.sh -o ~/Desktop/llm.log
```

The script prints the proxy address and the exact environment variables you need.

## Run your Node app through the proxy

In a separate terminal, run your Node app with the environment variables printed by the capture script:

```bash
GLOBAL_AGENT_HTTPS_PROXY=http://localhost:19472 \
NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem \
NODE_OPTIONS="-r /Users/you/traffic-hunt/monitors/node-process/bootstrap.js" \
npm run dev
```

`NODE_EXTRA_CA_CERTS` tells Node to trust mitmproxy's certificate so it does not reject the intercepted TLS connection. Use `$HOME`, not `~`, because the tilde does not expand inside environment variable assignments.

First run: the mitmproxy CA certificate is generated the first time `mitmdump` runs. If Node complains about an unknown certificate, start the capture once, stop it, then run your app again.

## General TCP/HTTP capture

For plain HTTP traffic or low-level TCP inspection without HTTPS decoding, pass `--no-mitm`:

```bash
./monitors/node-process/capture.sh --no-mitm -o traffic.log
```

This uses `tshark`, or `tcpdump` as fallback, and requires root. The script will prompt for your password via `sudo`.

```text
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

Examples:

```bash
./monitors/node-process/capture.sh --no-mitm -p http -o app.log
./monitors/node-process/capture.sh --no-mitm -r session.pcap -o traffic.log
```

Stop any capture with `Ctrl+C`.

## Troubleshooting

Verify the proxy is running:

```bash
lsof -i :19472
```

Test the proxy directly with curl:

```bash
curl --cacert ~/.mitmproxy/mitmproxy-ca-cert.pem \
     -x http://localhost:19472 \
     https://httpbin.org/get
```

If the proxy works but nothing appears from your Node app, make sure you are using the exact command printed by the script with the absolute path to `bootstrap.js`.

## Output format

mitmproxy mode, which is the default, writes a human-readable flow log with method, URL, status code, headers, bodies, and timing.

`tshark` mode, enabled with `--no-mitm`, writes pipe-delimited fields:

```text
frame.time | ip.src | ip.dst | tcp.srcport | tcp.dstport | http.request.method | http.request.uri | http.host | http.request.version | http.response.code | http.response.phrase | http.content_type | http.content_length
```
