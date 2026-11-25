"""Build, launch and verify the AppContainer lab. Every isolation claim is a live probe."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
from uuid import uuid4

LAB_PROFILE = "AgentScope.Research.AgyLab"
CAPABILITY_SIDS = {"internetClient": "S-1-15-3-1"}
LOW_INTEGRITY = "S-1-16-4096"
NO_WINDOW = 0x08000000
HERE = Path(__file__).resolve().parent


class IsolationError(PermissionError):
    """A required isolation property was not observed; nothing may be sent to the model."""

    def __init__(self, message, checks=None):
        super().__init__(message)
        self.checks = checks or []


def sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _system(name: str) -> str:
    return str(Path(os.environ["SystemRoot"]) / "System32" / name)


class ContainedLab:
    def __init__(self, root: Path | None = None, profile: str = LAB_PROFILE):
        if os.name != "nt":
            raise IsolationError("Windows AppContainer is required")
        self.root = Path(root or Path.home() / "AgentScopeLab").resolve()
        self.profile = profile
        self.bin = self.root / "bin"
        self.home = self.root / "home"
        self.runs = self.root / "runs"
        self.tools = self.root / "tools"
        self.launcher = self.tools / "AcLaunch.exe"
        self.cred_probe = self.bin / "CredProbe.exe"
        self.agy = self.bin / "agy.exe"
        self.python_dir = self.bin / "python"
        self._sid = None

    # ----------------------------------------------------------------- build
    def _compile(self, source: Path, target: Path):
        stamp = target.with_suffix(".src.sha256")
        digest = sha256_file(source)
        if target.is_file() and stamp.is_file() and stamp.read_text().strip() == digest:
            return
        csc = (
            Path(os.environ["SystemRoot"])
            / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            [
                str(csc),
                "/nologo",
                "/optimize",
                "/platform:x64",
                f"/out:{target}",
                str(source),
            ],
            capture_output=True,
            text=True,
            creationflags=NO_WINDOW,
        )
        if result.returncode:
            raise RuntimeError("csc failed: " + result.stdout + result.stderr)
        stamp.write_text(digest)

    def ensure(self, agy_source: Path | None = None, with_python: bool = False):
        for path in (self.bin, self.home, self.runs, self.tools, self.home / "tmp"):
            path.mkdir(parents=True, exist_ok=True)
        for sub in ("AppData/Local", "AppData/Roaming"):
            (self.home / sub).mkdir(parents=True, exist_ok=True)
        self._compile(HERE / "AcLaunch.cs", self.launcher)
        self._compile(HERE / "CredProbe.cs", self.cred_probe)
        source = Path(
            agy_source or Path(os.environ["LOCALAPPDATA"]) / "agy/bin/agy.exe"
        )
        if not source.is_file():
            raise FileNotFoundError("agy.exe")
        if not self.agy.is_file() or sha256_file(self.agy) != sha256_file(source):
            shutil.copyfile(source, self.agy)
        settings = self.home / ".gemini/settings.json"
        if not settings.exists():
            # Only the non-secret auth *type*; tokens are never copied from the host.
            settings.parent.mkdir(parents=True, exist_ok=True)
            settings.write_text(
                json.dumps({"security": {"auth": {"selectedType": "oauth-personal"}}}),
                encoding="utf-8",
            )
        if with_python:
            self._ensure_python()
        sid = self.sid()
        self._grant(self.bin, "(OI)(CI)(RX)", sid)
        self._grant(self.home, "(OI)(CI)(M)", sid)
        return sid

    def _ensure_python(self):
        base = Path(getattr(sys, "_base_executable", sys.executable)).parent
        if (self.python_dir / "python.exe").is_file():
            return
        skip = {
            "site-packages",
            "test",
            "tests",
            "idlelib",
            "tkinter",
            "turtledemo",
            "ensurepip",
            "__pycache__",
            "lib2to3",
            "venv",
        }
        self.python_dir.mkdir(parents=True)
        for item in base.iterdir():
            if item.is_file() and item.suffix.lower() in {".exe", ".dll"}:
                shutil.copyfile(item, self.python_dir / item.name)
        shutil.copytree(base / "DLLs", self.python_dir / "DLLs")
        shutil.copytree(
            base / "Lib",
            self.python_dir / "Lib",
            ignore=lambda d, names: [n for n in names if n in skip],
        )

    def _grant(self, path: Path, rights: str, sid: str):
        result = subprocess.run(
            [_system("icacls.exe"), str(path), "/grant", f"*{sid}:{rights}", "/Q"],
            capture_output=True,
            text=True,
            creationflags=NO_WINDOW,
        )
        if result.returncode:
            raise IsolationError(
                f"icacls grant failed for {path}: {result.stdout}{result.stderr}"
            )

    # ---------------------------------------------------------------- launch
    def env(self, extra: dict | None = None) -> dict:
        root = os.environ["SystemRoot"]
        home = str(self.home)
        path = [
            str(Path(root) / "System32"),
            str(Path(root) / "System32/WindowsPowerShell/v1.0"),
            str(self.bin),
        ]
        if (self.python_dir / "python.exe").is_file():
            path.insert(0, str(self.python_dir))
        value = {
            "SystemRoot": root,
            "windir": root,
            "SystemDrive": os.environ.get("SystemDrive", "C:"),
            "ComSpec": _system("cmd.exe"),
            "ProgramData": os.environ.get("ProgramData", r"C:\ProgramData"),
            "PATH": ";".join(path),
            "PATHEXT": ".COM;.EXE;.BAT;.CMD;.PY",
            "USERPROFILE": home,
            "HOME": home,
            "APPDATA": home + r"\AppData\Roaming",
            "LOCALAPPDATA": home + r"\AppData\Local",
            "TEMP": home + r"\tmp",
            "TMP": home + r"\tmp",
            "USERNAME": "agentscope-lab",
            "COMPUTERNAME": "agentscope-lab",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        value.update(extra or {})
        return value

    def command(
        self,
        argv,
        cwd: Path,
        report: Path,
        proc_log: Path | None = None,
        capabilities=("internetClient",),
        env_extra=None,
        console=False,
    ):
        cmd = [
            str(self.launcher),
            "--profile",
            self.profile,
            "--cwd",
            str(cwd),
            "--report",
            str(report),
        ]
        if console:
            cmd.append("--console")
        for cap in capabilities:
            if cap not in CAPABILITY_SIDS:
                raise ValueError(cap)
            cmd += ["--cap", cap]
        if proc_log:
            cmd += ["--proc-log", str(proc_log)]
        for key, item in self.env(env_extra).items():
            cmd += ["--env", f"{key}={item}"]
        return cmd + ["--", *map(str, argv)]

    def run(self, argv, cwd: Path, report: Path, timeout=60, **kw):
        return subprocess.run(
            self.command(argv, cwd, report, **kw),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=NO_WINDOW,
        )

    def sid(self) -> str:
        if self._sid:
            return self._sid
        report = self.tools / "sid.token.json"
        result = self.run(
            [_system("cmd.exe"), "/c", "exit 0"], self.tools, report, capabilities=()
        )
        if result.returncode:
            raise IsolationError("Cannot create AppContainer: " + result.stderr[-500:])
        self._sid = self.verify_token(report, ())["token_appcontainer_sid"]
        return self._sid

    def verify_token(self, report: Path, capabilities=("internetClient",)) -> dict:
        data = json.loads(Path(report).read_text("utf-8"))
        expected = sorted(CAPABILITY_SIDS[c] for c in capabilities)
        if not (
            data.get("token_is_appcontainer") is True
            and data.get("token_appcontainer_sid")
            == data.get("expected_appcontainer_sid")
            and data.get("token_appcontainer_sid", "").startswith("S-1-15-2-")
            and sorted(data.get("token_capabilities", [])) == expected
            and data.get("token_integrity_sid") == LOW_INTEGRITY
            and data.get("environment_inherited") is False
        ):
            raise IsolationError(
                "Process token does not match the required AppContainer", [data]
            )
        return data

    def new_run(self, label: str) -> dict:
        run_id = f"{label}-{uuid4().hex[:12]}"
        base = self.runs / run_id
        workspace, evidence = base / "workspace", base / "evidence"
        workspace.mkdir(parents=True)
        evidence.mkdir()
        self._grant(workspace, "(OI)(CI)(M)", self.sid())
        return {
            "id": run_id,
            "base": base,
            "workspace": workspace,
            "evidence": evidence,
        }

    # ------------------------------------------------------------- preflight
    def preflight(self, run: dict, protected_paths=()) -> list[dict]:
        """Live allow/deny probes with the exact profile the CLI will use. Fails closed.

        ``protected_paths``: extra existing files or folders that must be unreadable
        (for example the AgentScope data folder and its session token)."""
        ws, ev = run["workspace"], run["evidence"]
        cmd = _system("cmd.exe")
        checks = []

        def probe(name, argv, expect, caps=("internetClient",), timeout=30):
            report = ev / f"preflight-{name}.token.json"
            try:
                result = self.run(argv, ws, report, capabilities=caps, timeout=timeout)
                token = self.verify_token(report, caps)
                observed = {
                    "exit": result.returncode,
                    "stdout": result.stdout.strip()[-400:],
                    "stderr": result.stderr.strip()[-400:],
                    "pid": token["pid"],
                }
            except subprocess.TimeoutExpired:
                observed = {"exit": None, "timeout": True}
            passed = bool(expect(observed))
            checks.append(
                {
                    "check": name,
                    "argv": [str(a) for a in argv],
                    "observed": observed,
                    "passed": passed,
                }
            )
            return observed

        denied = (
            lambda o: o["exit"] not in (0, None)
            and "denied" in (o["stdout"] + o["stderr"]).lower()
        )

        # Fresh private canary in the real profile; the container must not read it.
        canary = Path.home() / "Documents" / f"agentscope-canary-{uuid4().hex}.txt"
        canary.write_text("PRIVATE-CANARY-" + uuid4().hex, encoding="utf-8")
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(4)
        accepted = []
        stop = threading.Event()

        def accept():
            listener.settimeout(0.5)
            while not stop.is_set():
                try:
                    conn, _ = listener.accept()
                    accepted.append(True)
                    conn.close()
                except OSError:
                    pass

        thread = threading.Thread(target=accept, daemon=True)
        thread.start()
        port = listener.getsockname()[1]
        try:
            (ws / "inside.txt").write_text("inside", encoding="utf-8")
            probe(
                "workspace_read",
                [cmd, "/c", "type", str(ws / "inside.txt")],
                lambda o: o["exit"] == 0 and o["stdout"] == "inside",
            )
            probe(
                "workspace_write",
                [cmd, "/c", f"echo ok>{ws / 'written.txt'}"],
                lambda o: o["exit"] == 0 and (ws / "written.txt").is_file(),
            )
            probe(
                "private_canary_read",
                [cmd, "/c", "type", str(canary)],
                lambda o: denied(o) and "PRIVATE-CANARY" not in o["stdout"],
            )
            probe(
                "user_profile_list", [cmd, "/c", "dir", "/b", str(Path.home())], denied
            )
            probe(
                "host_cli_settings_read",
                [cmd, "/c", "type", str(Path.home() / ".gemini/settings.json")],
                denied,
            )
            desktop = (
                Path.home()
                / "Desktop"
                / f"agentscope-should-not-exist-{uuid4().hex}.txt"
            )
            probe(
                "desktop_write",
                [cmd, "/c", f"echo x>{desktop}"],
                lambda o: denied(o) and not desktop.exists(),
            )
            repo = Path(__file__).resolve().parents[3]
            if (
                repo / "pyproject.toml"
            ).is_file():  # source checkout, not a frozen build
                probe(
                    "repository_read",
                    [cmd, "/c", "type", str(repo / "pyproject.toml")],
                    denied,
                )
            for index, target in enumerate(Path(p) for p in protected_paths):
                if target.is_file():
                    argv = [cmd, "/c", "type", str(target)]
                elif target.is_dir():
                    argv = [cmd, "/c", "dir", "/b", str(target)]
                else:
                    continue
                probe(f"protected_{index}_{target.name}", argv, denied)
            probe(
                "evidence_write",
                [cmd, "/c", f"echo x>{ev / 'tamper.txt'}"],
                lambda o: denied(o) and not (ev / "tamper.txt").exists(),
            )
            programdata = (
                Path(os.environ.get("ProgramData", r"C:\ProgramData"))
                / f"agentscope-{uuid4().hex}.txt"
            )
            probe(
                "programdata_write",
                [cmd, "/c", f"echo x>{programdata}"],
                lambda o: denied(o) and not programdata.exists(),
            )
            for drive in _other_fixed_drives():
                probe(f"drive_{drive[0]}_list", [cmd, "/c", "dir", "/b", drive], denied)
            probe(
                "host_credential_manager",
                [self.cred_probe, "gemini:antigravity"],
                lambda o: '"cred_read_ok":false' in o["stdout"]
                and '"win32_error":5' in o["stdout"],
            )
            curl = _system("curl.exe")
            probe(
                "host_loopback_connect",
                [
                    curl,
                    "-s",
                    "-o",
                    "NUL",
                    "--max-time",
                    "5",
                    f"http://127.0.0.1:{port}/",
                ],
                lambda o: o["exit"] not in (0, None) and not accepted,
            )
            probe(
                "internet_without_capability",
                [
                    curl,
                    "-s",
                    "-o",
                    "NUL",
                    "-w",
                    "%{http_code}",
                    "--max-time",
                    "10",
                    "https://www.google.com/",
                ],
                lambda o: o["exit"] not in (0, None),
                caps=(),
            )
            probe(
                "internet_with_capability",
                [
                    curl,
                    "-s",
                    "-o",
                    "NUL",
                    "-w",
                    "%{http_code}",
                    "--max-time",
                    "15",
                    "https://www.google.com/",
                ],
                lambda o: o["exit"] == 0 and o["stdout"].startswith(("2", "3")),
            )
        finally:
            stop.set()
            thread.join(2)
            listener.close()
            canary.unlink(missing_ok=True)
        (ev / "preflight.json").write_text(
            json.dumps(checks, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        failed = [c for c in checks if not c["passed"]]
        if failed:
            raise IsolationError(
                "Isolation preflight failed: " + ", ".join(c["check"] for c in failed),
                checks,
            )
        return checks


def _other_fixed_drives():
    import ctypes

    system = os.environ.get("SystemDrive", "C:").upper()
    drives = []
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    for index in range(26):
        if mask & (1 << index):
            root = f"{chr(65 + index)}:\\"
            if ctypes.windll.kernel32.GetDriveTypeW(
                root
            ) == 3 and not root.upper().startswith(system):
                drives.append(root)
    return drives
