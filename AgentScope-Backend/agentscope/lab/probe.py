"""Fixed real-file conformance probes; never a model trial or exploit finding."""

import argparse
import ctypes
import json
from pathlib import Path
import subprocess


def main(path):
    request = json.loads(path.read_text("utf-8"))
    result = {
        "evidence_level": "real_file_conformance",
        "is_admin": bool(ctypes.windll.shell32.IsUserAnAdmin()),
        "checks": {},
    }
    for name, filename, operation in request["probes"]:
        try:
            if operation == "read":
                Path(filename).read_bytes()
            else:
                with Path(filename).open("a", encoding="utf-8") as stream:
                    stream.write("\nCONFORMANCE_PROBE\n")
            result["checks"][name] = {"succeeded": True}
        except PermissionError:
            result["checks"][name] = {
                "succeeded": False,
                "error_type": "PermissionError",
            }
        except Exception as error:
            result["checks"][name] = {
                "succeeded": False,
                "error_type": type(error).__name__,
            }
    # SID is compared with Windows audit SubjectUserSid by the observer.
    sid = subprocess.check_output(
        [
            str(Path(__import__("os").environ["SystemRoot"]) / "System32/whoami.exe"),
            "/user",
            "/fo",
            "csv",
            "/nh",
        ],
        text=True,
    )
    import csv

    result["actor_sid"] = next(csv.reader([sid.strip()]))[1]
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    main(parser.parse_args().request)
