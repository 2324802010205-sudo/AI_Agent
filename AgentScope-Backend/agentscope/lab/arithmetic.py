"""Only two reviewed programs can launch, inside a zero-capability AppContainer.

This is an execution broker, not a Python/shell tool. Skill source is never run.
The isolation probe and arithmetic conformance are not model-initiated trials.
"""

import asyncio
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
from uuid import uuid4
import zipfile

from .environment import powershell
from .evidence import digest, file_state

APPROVED_HASHES = {
    "approved_arithmetic.py": "64ffa7da44f86136de8b75d328f15f9602fd1a257741bc8d1756d619b286f6c9",
    "approved_isolation_probe.py": "bc6b2faee94c6c06a346f667cc236847e657c16d940353784c2cedbc4abdd001",
}


def python_runtime():
    candidates = [Path(getattr(sys, "_base_executable", sys.executable))]
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Python"
    candidates += sorted(base.glob("Python3*/python.exe"), reverse=True)
    for executable in candidates:
        if executable.name.lower() != "python.exe" or not executable.is_file():
            continue
        directory = executable.parent
        libraries = [
            p
            for p in directory.glob("python3*.dll")
            if re.fullmatch(r"python\d{2,3}\.dll", p.name)
        ]
        if len(libraries) == 1 and (directory / "Lib/encodings").is_dir():
            return executable, libraries[0]
    raise PermissionError(
        "Không tìm thấy runtime Python có thể sao chép riêng; execution vẫn tắt"
    )


class ArithmeticSandbox:
    def __init__(self, root):
        self.root = root.resolve()

    def prepare(self):
        if os.name != "nt":
            raise PermissionError("Windows AppContainer is required")
        executable, library = python_runtime()
        case = self.root / uuid4().hex
        runtime, output = case / "runtime", case / "output"
        runtime.mkdir(parents=True)
        output.mkdir()
        copied = []
        for source in (executable, *executable.parent.glob("*.dll")):
            destination = runtime / source.name
            shutil.copyfile(source, destination)
            copied.append(
                {"name": source.name, "sha256": digest(destination.read_bytes())}
            )
        binary_root = executable.parent / "DLLs"
        (runtime / "DLLs").mkdir()
        for source in binary_root.iterdir():
            if source.suffix.lower() in {".pyd", ".dll"}:
                shutil.copyfile(source, runtime / "DLLs" / source.name)
        standard_library = executable.parent / "Lib"
        with zipfile.ZipFile(
            runtime / (library.stem + ".zip"), "w", compression=zipfile.ZIP_STORED
        ) as archive:
            for path in standard_library.rglob("*.py"):
                relative = path.relative_to(standard_library)
                if any(
                    part
                    in {
                        "site-packages",
                        "test",
                        "tests",
                        "__pycache__",
                        "ensurepip",
                        "idlelib",
                        "tkinter",
                        "turtledemo",
                    }
                    for part in relative.parts
                ):
                    continue
                archive.write(path, relative.as_posix())
        (runtime / (library.stem + "._pth")).write_text(
            library.stem + ".zip\nDLLs\n.\n", encoding="utf-8"
        )
        for name, expected in APPROVED_HASHES.items():
            source = Path(__file__).with_name(name)
            payload = source.read_bytes()
            if digest(payload) != expected:
                raise PermissionError("Reviewed program source hash mismatch")
            (runtime / name).write_bytes(payload)
        return case, runtime, output, copied

    async def _run(self, case, runtime, output, program, extra=()):
        path = runtime / program
        if (
            program not in APPROVED_HASHES
            or digest(path.read_bytes()) != APPROVED_HASHES[program]
        ):
            raise PermissionError("Only the approved program identity/hash can launch")
        request = {
            "case_root": str(case),
            "runtime_root": str(runtime),
            "output_root": str(output),
            "profile_name": "AgentScope.Arithmetic." + case.name,
            "executable": str(runtime / "python.exe"),
            "program": str(path),
            "command_line": subprocess.list2cmdline(
                [
                    str(runtime / "python.exe"),
                    "-I",
                    "-S",
                    "-B",
                    str(path),
                    *map(str, extra),
                ]
            ),
            "stdout_path": str(case / (program + ".stdout")),
            "stderr_path": str(case / (program + ".stderr")),
        }
        request_path = case / (program + ".request.json")
        request_path.write_text(json.dumps(request), encoding="utf-8")
        result = await powershell(
            "Sandbox-Program.ps1", ["-RequestPath", str(request_path)], timeout=45
        )
        result.update(
            stdout=Path(request["stdout_path"]).read_text("utf-8", errors="replace")[
                :8192
            ],
            stderr=Path(request["stderr_path"]).read_text("utf-8", errors="replace")[
                :4096
            ],
            program_id=(
                "arithmetic-v1"
                if program == "approved_arithmetic.py"
                else "isolation-conformance-v1"
            ),
            program_sha256=APPROVED_HASHES[program],
        )
        (case / (program + ".process-result.json")).write_text(
            json.dumps(result, indent=2), encoding="utf-8"
        )
        return result

    async def conformance(self):
        """Real, explicitly requested execution of reviewed code; no LLM involved."""
        case, runtime, output, copied = await asyncio.to_thread(self.prepare)
        outside = case.parent / (case.name + "-outside-fixture.txt")
        outside.write_text(
            "Non-sensitive user-owned negative-access fixture.\n", encoding="utf-8"
        )
        outcome = {
            "evidence_level": "real_process_conformance",
            "model_initiated": False,
            "case": str(case),
            "runtime": copied,
            "program_sha256": APPROVED_HASHES["approved_arithmetic.py"],
            "execution_enabled": False,
        }
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            listener.settimeout(0.05)
            config = runtime / "probe-config.json"
            config.write_text(
                json.dumps(
                    {
                        "outside_fixture": str(outside),
                        "listener_port": listener.getsockname()[1],
                    }
                ),
                encoding="utf-8",
            )
            probe = await self._run(
                case, runtime, output, "approved_isolation_probe.py", [config]
            )
            outcome["isolation_probe"] = probe
            if probe["exit_code"] != 0:
                raise PermissionError(
                    "AppContainer probe failed; arithmetic execution remains disabled: "
                    + probe["stderr"][:200]
                )
            checks = json.loads(probe["stdout"])
            connected = False
            try:
                connection, _ = listener.accept()
                connection.close()
                connected = True
            except TimeoutError:
                pass
            if connected or not all(
                checks.get(k) is True
                for k in (
                    "outside_read_denied",
                    "network_denied",
                    "child_process_denied",
                )
            ):
                raise PermissionError(
                    "Independent containment probes failed; arithmetic execution remains disabled"
                )
            outcome["isolation_checks"] = checks
        execution = await self._run(case, runtime, output, "approved_arithmetic.py")
        outcome["process"] = execution
        marker = output / "execution-marker.json"
        if execution["exit_code"] != 0 or not marker.is_file():
            raise PermissionError(
                "Approved arithmetic did not complete with a real marker"
            )
        actual = json.loads(marker.read_text("utf-8"))
        if (
            actual != json.loads(execution["stdout"])
            or actual.get("pid") != execution["pid"]
            or actual.get("result") != 444
        ):
            raise PermissionError("Process output/marker/PID mismatch")
        outcome.update(
            execution_enabled=True,
            marker=actual,
            marker_state=file_state(marker),
            outside_fixture_unchanged=outside.read_text()
            == "Non-sensitive user-owned negative-access fixture.\n",
        )
        (case / "conformance-result.json").write_text(
            json.dumps(outcome, indent=2), encoding="utf-8"
        )
        return outcome


class ArithmeticBroker:
    def __init__(self, sandbox):
        self.sandbox = sandbox

    async def request(self, name, arguments, *, execution_authorized=False):
        if name != "run_approved_arithmetic" or arguments != {
            "program_id": "arithmetic-v1",
            "program_sha256": APPROVED_HASHES["approved_arithmetic.py"],
        }:
            raise PermissionError(
                "Restricted tool capability: program/path/arguments are not allowlisted"
            )
        if not execution_authorized:
            return {
                "decision": "deny",
                "enforced": True,
                "protection": "skillguard",
                "execution_started": False,
                "pid": None,
                "reason": "The legitimate task did not authorize program execution",
            }
        return {"decision": "allow", "conformance": await self.sandbox.conformance()}
