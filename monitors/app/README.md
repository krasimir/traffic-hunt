# App Monitor

This monitor captures outbound HTTP and HTTPS payloads from an app launched through a local mitmproxy proxy.

## Goal

Show the exact outbound request payloads for traffic leaving the machine from a local app or processes that inherit its proxy environment.

## Usage

```bash
./monitors/app/capture.sh --app /path/to/app --app-arg /path/to/project -o app-traffic.json
```

The script starts `mitmdump`, launches the app through the proxy environment, and writes a JSON array of captured flows. Mitmproxy still requires a tiny Python bridge, but the payload logger itself is [payload_logger.js](payload_logger.js).

Each entry includes:

- request method, URL, HTTP version, headers, and body
- response status, headers, and body
- body encoding as `utf-8` or `base64`
- basic client and server connection metadata

## VS Code Example

VS Code is an Electron app, so pass `--electron` to add Chromium proxy flags:

```bash
./monitors/app/capture.sh \
  --app "/Applications/Visual Studio Code.app" \
  --electron \
  --electron-user-data-dir temp \
  --exclude-host update.code.visualstudio.com \
  -o vscode-traffic.json \
  -- /path/to/project
```

Arguments after `--` are passed to the app. You can also repeat `--app-arg` instead.

For VS Code, the isolated user data directory matters. If a normal VS Code instance is already running, a new launch can hand the request to that existing process, which did not inherit the proxy environment. In that case mitmproxy will show no client connections and the JSON file will stay as `[]`. Use `--electron-user-data-dir temp` or close all existing VS Code windows before launching.

## Options

```text
./capture.sh [options]

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
  -h, --help           Show help
```

## Host Filtering

Use `--exclude-host` to keep noisy hosts out of the JSON output:

```bash
./monitors/app/capture.sh \
  --app /path/to/app \
  --exclude-host update.code.visualstudio.com \
  --exclude-host '*.example.com,api.example.com' \
  -o app-traffic.json
```

Host filters are applied inside the Node logger. Exact host names match only that host. Wildcards of the form `*.example.com` match subdomains such as `api.example.com`.

## Certificate Behavior

`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` are set for common Node, Python, and curl-based child processes.

For Electron/Chromium apps, pass `--electron`. By default that also passes `--ignore-certificate-errors`, because Electron/Chromium traffic may not trust the mitmproxy CA. Use `--strict-certs` if you want certificate validation enforced.

Some Electron apps reuse an existing process when launched a second time. If that happens, the already-running process will not have this script's proxy environment. Use `--electron-user-data-dir temp` to force an isolated profile, or close the existing app first.

## Limits

This captures traffic that honors the proxy settings inherited from the launched app. Apps or child processes that ignore proxy environment variables, use certificate pinning, or use non-HTTP protocols may not produce readable payloads here.

Generated logs can contain API keys, cookies, prompts, request bodies, and response bodies in plaintext. Do not commit them.

## Troubleshooting

If the JSON file stays as `[]` and the mitmproxy log only shows startup lines like `HTTP(S) proxy listening`, no traffic reached the proxy. For VS Code, the usual cause is an already-running VS Code process. Run with `--electron-user-data-dir temp`, or fully quit VS Code before starting capture.

If you use a temporary VS Code profile, extensions from your normal profile may not be available. Either install the extension into that temporary profile, pass a dedicated stable profile path with `--electron-user-data-dir /path/to/profile`, or fully quit normal VS Code and launch without a separate profile.
