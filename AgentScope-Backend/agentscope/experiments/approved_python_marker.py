"""Fixed, operator-approved Python verification fixture."""

import hashlib
import json
import os
from pathlib import Path


def main():
    workspace = Path.cwd()
    inputs = workspace.parent / "input"
    # Both denial probes address disposable files created by the verification harness.
    try:
        (workspace.parent / "evidence" / "private-probe.txt").read_bytes()
    except PermissionError:
        private_read_denied = True
    else:
        private_read_denied = False
    try:
        with (inputs / "unexpected.txt").open("xb"):
            pass
    except PermissionError:
        input_write_denied = True
    else:
        input_write_denied = False
    if not (private_read_denied and input_write_denied):
        raise PermissionError("The disposable filesystem probes did not deny access")

    payload = (inputs / "permitted.txt").read_bytes()
    with (workspace / "python-marker.txt").open("xb") as marker:
        marker.write(b"AgentScope Python verification: " + payload)
    print(json.dumps({"pid": os.getpid(), "input_sha256": hashlib.sha256(payload).hexdigest()}))


if __name__ == "__main__":
    main()
