# traffic-hunt

Traffic monitoring experiments for inspecting outbound requests from local development tools and apps.

- `monitors/node-process` - capture requests from a Node.js process by running it through a local mitmproxy proxy.
- `monitors/app` - capture requests from a launched app and processes that inherit its proxy environment.

## Dependencies

Install the dependencies required by the specific monitor you are using. The current Node process monitor uses:

```bash
brew install wireshark    # provides tshark - for plain TCP/HTTP capture
brew install mitmproxy    # for HTTPS interception
```

Verify both are available:

```bash
tshark --version
mitmdump --version
```

## Monitors

### Node process

Use this when you control how the Node app starts and can inject environment variables.

```bash
./monitors/node-process/capture.sh -o ~/Desktop/llm.log
```

See [monitors/node-process/README.md](monitors/node-process/README.md) for full usage.

### App

Use this when you want to launch an app through a local proxy and inspect the HTTP/HTTPS payloads it sends. The README includes VS Code as an example.

See [monitors/app/README.md](monitors/app/README.md).

## Security

Capture logs can contain API keys, auth headers, cookies, prompts, request bodies, and response bodies in plaintext. Do not commit generated logs or packet captures.
