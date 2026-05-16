# App / VS Code Monitor

This monitor captures outbound HTTP and HTTPS payloads from a VS Code instance launched through a local mitmproxy proxy.

## Goal

Show the exact outbound request payloads for traffic leaving the machine from VS Code or VS Code-connected processes.

## Usage

```bash
./monitors/app-vscode/capture.sh --workspace /path/to/project -o vscode-traffic.jsonl
```

The script starts `mitmdump`, launches a VS Code instance through the proxy, and writes one JSON object per completed flow. Mitmproxy still requires a tiny Python bridge, but the payload logger itself is [payload_logger.js](payload_logger.js).

Each JSONL entry includes:

- request method, URL, HTTP version, headers, and body
- response status, headers, and body
- body encoding as `utf-8` or `base64`
- basic client and server connection metadata

## Why launch VS Code from the script?

The proxy environment needs to be inherited by VS Code, the extension host, and child processes. Launching from the script is the most reliable way to make that happen.

By default the script uses a temporary `--user-data-dir` so it starts an isolated VS Code window instead of attaching to an existing session. Pass `--user-data-dir` if you want a stable profile directory.

## Options

```text
./capture.sh [options]

Options:
  -o, --output          JSONL payload log file              (default: vscode-traffic-<timestamp>.jsonl)
  --mitm-log           mitmdump console log file            (default: <output>.mitm.log)
  --port               Local mitmproxy port                 (default: 19473)
  --workspace          Workspace folder/file to open
  --app-path           VS Code .app path                    (default: /Applications/Visual Studio Code.app)
  --user-data-dir      VS Code user data dir                (default: temporary isolated dir)
  --extensions-dir     VS Code extensions dir
  --no-launch          Start proxy only and print launch environment
  --strict-certs       Do not pass --ignore-certificate-errors to VS Code
  -h, --help           Show help
```

## Certificate behavior

`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` are set for common Node, Python, and curl-based child processes. The script also passes `--ignore-certificate-errors` to VS Code by default because Electron/Chromium traffic may not trust the mitmproxy CA.

Use `--strict-certs` if you want VS Code to enforce certificate validation. In that mode, you may need to install and trust the mitmproxy CA certificate in macOS Keychain.

## Limits

This captures traffic that honors the proxy settings inherited from the launched VS Code process. Extensions or child processes that ignore proxy environment variables, use certificate pinning, or use non-HTTP protocols may not produce readable payloads here.

Generated logs can contain API keys, cookies, prompts, request bodies, and response bodies in plaintext. Do not commit them.
