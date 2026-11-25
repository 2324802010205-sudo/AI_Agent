"""Activation requires observed guest facts and a short-lived host signature.

No API flag, setting, environment variable or unchecked JSON `isolated=true`
can authorize execution. The normal production adapter is never reconfigured.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets


@dataclass(frozen=True)
class Permit:
    config: dict
    facts: dict
    expires_at: str

    def assert_fresh(self):
        if datetime.fromisoformat(
            self.expires_at.replace("Z", "+00:00")
        ) <= datetime.now(timezone.utc):
            raise PermissionError("Research VM attestation expired")


async def powershell(script: str, args: list[str], timeout=25):
    if os.name != "nt":
        raise PermissionError("The research runner requires a verified Windows guest")
    shell = str(
        Path(os.environ.get("SystemRoot", r"C:\Windows"))
        / "System32/WindowsPowerShell/v1.0/powershell.exe"
    )
    process = await asyncio.create_subprocess_exec(
        shell,
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(Path(__file__).with_name(script)),
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        creationflags=0x08000000,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
        if process.returncode:
            if script == "Sandbox-Program.ps1":
                diagnostic = stderr.decode("utf-8-sig", errors="replace")[:2500]
                (Path(args[1]).parent / "sandbox-host-diagnostic.txt").write_text(
                    diagnostic, encoding="utf-8"
                )
                raise PermissionError(
                    "AppContainer containment setup failed; arithmetic disabled. "
                    + diagnostic[:1000]
                )
            # Credential/config diagnostics must not leak through the app.
            raise PermissionError(
                f"Research environment check failed ({script}, exit {process.returncode})"
            )
        result = json.loads(stdout.decode("utf-8-sig"))
        if not isinstance(result, dict):
            raise ValueError("Unexpected verifier result")
        return result
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


class EnvironmentVerifier:
    def __init__(self, root: Path):
        self.root = root
        self.config_path = root / "guest-config.json"
        self.challenge_path = root / "challenge.json"

    def challenge(self):
        self.root.mkdir(parents=True, exist_ok=True)
        if self.challenge_path.exists():
            saved = json.loads(self.challenge_path.read_text("utf-8"))
            if (
                datetime.now(timezone.utc) - datetime.fromisoformat(saved["created_at"])
            ).total_seconds() < 900:
                return saved
        value = {
            "nonce": secrets.token_hex(32),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.challenge_path.write_text(json.dumps(value, indent=2), encoding="utf-8")
        return value

    async def inspect(self):
        challenge = self.challenge()
        requirements = [
            "Dedicated disposable Windows Hyper-V guest with a checkpoint",
            "Separate observer and non-administrator CLI identities",
            "Host-signed current guest attestation and independent CLI login",
            "Restricted egress, no host shares, NTFS ACLs and Windows access auditing",
            "Per-trial real allow/deny probes before sending model instructions",
        ]
        if not self.config_path.is_file():
            return {
                "state": "locked",
                "eligible": False,
                "reason": "Chưa có guest-config và VM được xác minh. Không khởi chạy CLI nghiên cứu.",
                "requirements": requirements,
                "challenge": challenge,
                "real_model_trials": 0,
            }
        try:
            facts = await powershell(
                "Verify-Guest.ps1",
                [
                    "-ConfigPath",
                    str(self.config_path),
                    "-ChallengePath",
                    str(self.challenge_path),
                ],
            )
            if facts.get("verified") is not True:
                raise PermissionError("Guest isolation checks did not pass")
            config = json.loads(self.config_path.read_text("utf-8"))
            # Only the verifier may produce the Permit consumed by the runner.
            permit = Permit(config, facts, facts["expires_at"])
            permit.assert_fresh()
            return {
                "state": "eligible_for_conformance",
                "eligible": True,
                "reason": "Host signature và kiểm tra guest đạt; mỗi lượt vẫn phải qua probe ACL/audit thật.",
                "requirements": requirements,
                "challenge": challenge,
                "guest_uuid": facts["guest_uuid"],
                "expires_at": permit.expires_at,
                "_permit": permit,
            }
        except Exception:
            return {
                "state": "locked",
                "eligible": False,
                "reason": "Không xác minh được VM, chữ ký, identity hoặc hạn chế OS. Lab vẫn khóa.",
                "requirements": requirements,
                "challenge": challenge,
            }

    async def require(self):
        state = await self.inspect()
        permit = state.pop("_permit", None)
        if not permit:
            raise PermissionError(state["reason"])
        return permit
