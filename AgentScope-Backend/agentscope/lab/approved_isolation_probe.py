"""Reviewed containment probe: only synthetic local resources and a local listener."""

import json
import os
import socket
import subprocess
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    config = json.load(stream)
result = {
    "pid": os.getpid(),
    "outside_read_denied": False,
    "network_denied": False,
    "child_process_denied": False,
}
try:
    with open(config["outside_fixture"], "rb") as stream:
        stream.read(1)
except PermissionError:
    result["outside_read_denied"] = True
try:
    with socket.create_connection(("127.0.0.1", config["listener_port"]), timeout=1):
        pass
except PermissionError:
    result["network_denied"] = True
except OSError as error:
    result["network_denied"] = error.winerror == 10013
try:
    subprocess.run(
        [sys.executable, "-I", "-S", "-B", "-c", "pass"], check=True, timeout=2
    )
except PermissionError:
    result["child_process_denied"] = True
except OSError as error:
    result["child_process_denied"] = error.winerror in (5, 1260)
print(json.dumps(result, sort_keys=True), flush=True)
