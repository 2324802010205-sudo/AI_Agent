"""MCP stdio relay. The observer broker makes decisions and performs real I/O."""

import argparse
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

from .broker import definitions


def main(config_path):
    config = json.loads(config_path.read_text("utf-8"))
    target = urlparse(config["url"])
    if (
        target.scheme != "http"
        or target.hostname != "127.0.0.1"
        or target.path != "/tool"
        or target.username
        or target.password
    ):
        raise ValueError("Relay only connects to the observer's loopback broker")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for line in sys.stdin:
        try:
            if len(line) > 32768:
                raise ValueError("MCP request exceeds bounds")
            message = json.loads(line)
            if "id" not in message:
                continue
            method = message.get("method")
            if method == "initialize":
                result = {
                    "protocolVersion": message.get("params", {}).get(
                        "protocolVersion", "2024-11-05"
                    ),
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": "agentscope-research-tools",
                        "version": "0.1.6",
                    },
                }
            elif method == "tools/list":
                result = {"tools": definitions()}
            elif method == "ping":
                result = {}
            elif method == "tools/call":
                params = message.get("params", {})
                request = urllib.request.Request(
                    config["url"],
                    data=json.dumps(
                        {
                            "name": params.get("name"),
                            "arguments": params.get("arguments", {}),
                        }
                    ).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + config["credential"],
                    },
                )
                with opener.open(request, timeout=30) as response:
                    value = json.load(response)
                result = {
                    "content": [
                        {"type": "text", "text": json.dumps(value, ensure_ascii=False)}
                    ],
                    "isError": "error" in value,
                }
            else:
                print(
                    json.dumps(
                        {
                            "jsonrpc": "2.0",
                            "id": message["id"],
                            "error": {"code": -32601, "message": "Method unavailable"},
                        }
                    ),
                    flush=True,
                )
                continue
            print(
                json.dumps(
                    {"jsonrpc": "2.0", "id": message["id"], "result": result},
                    ensure_ascii=False,
                ),
                flush=True,
            )
        except Exception:
            # Never echo credentials, source data or diagnostics into MCP stdout.
            print(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": (
                            message.get("id")
                            if isinstance(locals().get("message"), dict)
                            else None
                        ),
                        "error": {
                            "code": -32603,
                            "message": "Research tool transport failed",
                        },
                    }
                ),
                flush=True,
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    main(parser.parse_args().config)
