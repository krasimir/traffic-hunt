import base64
import json
import subprocess

from mitmproxy import ctx, http


def _headers(headers):
    return [[name, value] for name, value in headers.items(multi=True)]


def _body(message):
    raw = message.raw_content or b""
    return {
        "content_type": message.headers.get("content-type", ""),
        "size_bytes": len(raw),
        "body_base64": base64.b64encode(raw).decode("ascii"),
    }


def _request(flow):
    if not flow.request:
        return None

    return {
        "method": flow.request.method,
        "scheme": flow.request.scheme,
        "host": flow.request.host,
        "port": flow.request.port,
        "path": flow.request.path,
        "url": flow.request.pretty_url,
        "http_version": flow.request.http_version,
        "headers": _headers(flow.request.headers),
        **_body(flow.request),
    }


def _response(flow):
    if not flow.response:
        return None

    return {
        "status_code": flow.response.status_code,
        "reason": flow.response.reason,
        "http_version": flow.response.http_version,
        "headers": _headers(flow.response.headers),
        **_body(flow.response),
    }


class NodeBridge:
    def load(self, loader):
        loader.add_option(
            name="payload_log",
            typespec=str,
            default="app-traffic.json",
            help="Path where the Node payload logger writes JSON output.",
        )
        loader.add_option(
            name="node_logger",
            typespec=str,
            default="",
            help="Path to payload_logger.js.",
        )
        loader.add_option(
            name="excluded_hosts",
            typespec=str,
            default="",
            help="Comma-separated hosts passed through to the Node payload logger.",
        )

    def running(self):
        if not ctx.options.node_logger:
            raise RuntimeError("node_logger option is required")

        self.process = subprocess.Popen(
            ["node", ctx.options.node_logger, ctx.options.payload_log, ctx.options.excluded_hosts],
            stdin=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )

    def done(self):
        if getattr(self, "process", None) and self.process.stdin:
            self.process.stdin.close()
            self.process.wait(timeout=5)

    def response(self, flow: http.HTTPFlow):
        self._send(
            {
                "type": "response",
                "client": {
                    "peername": flow.client_conn.peername,
                    "sockname": flow.client_conn.sockname,
                },
                "server": {
                    "address": flow.server_conn.address,
                },
                "request": _request(flow),
                "response": _response(flow),
            }
        )

    def error(self, flow: http.HTTPFlow):
        self._send(
            {
                "type": "error",
                "error": str(flow.error),
                "client": {
                    "peername": flow.client_conn.peername,
                    "sockname": flow.client_conn.sockname,
                },
                "server": {
                    "address": flow.server_conn.address,
                },
                "request": _request(flow),
                "response": _response(flow),
            }
        )

    def _send(self, event):
        if not getattr(self, "process", None) or self.process.poll() is not None:
            raise RuntimeError("Node payload logger is not running")

        self.process.stdin.write(json.dumps(event, ensure_ascii=False) + "\n")
        self.process.stdin.flush()


addons = [NodeBridge()]
