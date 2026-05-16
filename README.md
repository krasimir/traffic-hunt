# traffic-hunt

Traffic monitoring experiments for inspecting outbound requests from local development tools and apps.

- `monitors/node-process` - capture requests from a Node.js process by running it through a local mitmproxy proxy.
- `monitors/app-vscode` - workspace for app-level capture, starting with VS Code and processes related to it.

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

### App / VS Code

Use this area for capturing traffic authored by an app and its related processes, starting with VS Code.

See [monitors/app-vscode/README.md](monitors/app-vscode/README.md).

## Security

Capture logs can contain API keys, auth headers, cookies, prompts, request bodies, and response bodies in plaintext. Do not commit generated logs or packet captures.
