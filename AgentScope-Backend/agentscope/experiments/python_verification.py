"""Operator-initiated real Python check with a fixed fixture and a separate AppContainer."""

import json
import subprocess
from pathlib import Path
from uuid import uuid4

from ..lab.containment import ContainedLab, IsolationError
from ..lab.containment.lab import HERE
from ..models import now
from .workbook import sha256

PROFILE = "AgentScope.Research.PythonVerification"
SCRIPT = Path(__file__).with_name("approved_python_marker.py")
SCRIPT_SHA256 = "435f38274f45603e64e2ed4bd6637ba28aad980b03d71966cbf32698a074aa3d"
TIMEOUT_SECONDS = 15


def verify_python() -> dict:
    script = SCRIPT.read_text(encoding="utf-8").encode("utf-8")
    if sha256(script) != SCRIPT_SHA256:
        raise IsolationError("SHA-256 mismatch for the approved Python fixture")
    shared = ContainedLab()
    shared._compile(HERE / "AcLaunch.cs", shared.launcher)
    shared._ensure_python()
    lab = ContainedLab(shared.root / "python-verification", profile=PROFILE)
    lab.launcher = shared.launcher
    lab.python_dir = shared.python_dir
    lab.tools.mkdir(parents=True, exist_ok=True)
    sid = lab.sid()
    lab._grant(lab.python_dir, "(OI)(CI)(RX)", sid)
    run = lab.new_run("python-marker")
    inputs, workspace, evidence = (
        run["base"] / "input",
        run["workspace"],
        run["evidence"],
    )
    inputs.mkdir()
    payload = (uuid4().hex + "\n").encode("ascii")
    approved_script = inputs / SCRIPT.name
    with approved_script.open("xb") as snapshot:
        snapshot.write(script)
    input_file = inputs / "permitted.txt"
    input_file.write_bytes(payload)
    (evidence / "private-probe.txt").write_bytes(b"disposable verification sentinel")
    lab._grant(inputs, "(OI)(CI)(RX)", sid)
    token_path = evidence / "python.token.json"
    marker = workspace / "python-marker.txt"
    expected_marker = b"AgentScope Python verification: " + payload
    receipt = {
        "state": "failed",
        "started_at": now(),
        "run_id": run["id"],
        "profile": PROFILE,
        "authorized_by": "operator_confirmation_for_fixed_fixture",
        "script_sha256": SCRIPT_SHA256,
        "input_sha256": sha256(payload),
        "timeout_seconds": TIMEOUT_SECONDS,
        "receipt_path": str(evidence / "python-receipt.json"),
    }
    try:
        if sha256(approved_script.read_bytes()) != SCRIPT_SHA256:
            raise IsolationError("Python snapshot integrity check failed")
        result = lab.run(
            [lab.python_dir / "python.exe", "-I", "-S", "-B", approved_script],
            workspace,
            token_path,
            capabilities=(),
            timeout=TIMEOUT_SECONDS,
            proc_log=evidence / "python.processes.jsonl",
            env_extra={
                k: str(workspace)
                for k in (
                    "HOME",
                    "USERPROFILE",
                    "APPDATA",
                    "LOCALAPPDATA",
                    "TEMP",
                    "TMP",
                )
            },
        )
        token = lab.verify_token(token_path, ())
        if token["token_appcontainer_sid"] != sid or not token.get("job_kill_on_close"):
            raise IsolationError(
                "Python process did not use the dedicated verification boundary"
            )
        receipt.update(token=token, exit_code=result.returncode)
        if result.returncode:
            raise RuntimeError(
                result.stderr.strip()[-1000:] or "Python exited with an error"
            )
        observation = json.loads(result.stdout)
        if observation != {
            "pid": token["pid"],
            "input_sha256": receipt["input_sha256"],
        }:
            raise IsolationError(
                "The script receipt did not match the observed process or input"
            )
        if (
            not marker.is_file()
            or marker.read_bytes() != expected_marker
            or input_file.read_bytes() != payload
            or sha256(approved_script.read_bytes()) != SCRIPT_SHA256
            or (inputs / "unexpected.txt").exists()
        ):
            raise IsolationError("The marker or immutable input checks failed")
        receipt.update(
            state="verified",
            private_read_denied=True,
            input_write_denied=True,
            artifact={
                "name": marker.name,
                "size": marker.stat().st_size,
                "sha256": sha256(marker.read_bytes()),
            },
        )
    except subprocess.TimeoutExpired:
        receipt["error"] = f"Python verification exceeded {TIMEOUT_SECONDS} seconds"
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        receipt["error"] = str(error)
    finally:
        receipt["finished_at"] = now()
        (evidence / "python-receipt.json").write_text(
            json.dumps(receipt, indent=2), "utf-8"
        )
    return receipt
