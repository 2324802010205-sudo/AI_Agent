"""One reusable research-environment readiness service.

Audit result (see docs/CHAT_RESEARCH_WORKFLOW_VI.md):

* Text-only Skill experiments need exactly one boundary: the Windows AppContainer lab
  (live preflight + the lab's own Antigravity sign-in + an advertised Gemini Flash model).
  Native MCP tool use inside that boundary was verified in Phases 4-7.
* Bundled Skill scripts are never executed by experiments. Running reviewed code is a
  separate, explicitly approved path (zero-capability AppContainer; Skill lifecycle study).
* The Hyper-V guest required by the legacy "Lab nghiên cứu" is not a dependency of text-only
  Skill research. It is unavailable on Windows 11 Home and stays an Advanced Research option.
* The host-CLI evaluation page refuses adversarial Skills because the *host* CLI has no
  verified zero-tool contract. That limitation does not apply inside the AppContainer.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from ..lab.containment import ContainedAcpAdapter, ContainedLab, IsolationError

FRESH_SECONDS = 30 * 60
CREATE_NEW_CONSOLE = 0x00000010

REQUIREMENTS = {
    "text_skill": [
        "Windows AppContainer (Low IL, Job Object, chỉ internetClient)",
        "Kiểm tra cô lập trực tiếp đạt trước mỗi phiên",
        "Hồ sơ Antigravity riêng của lab đã đăng nhập (không dùng token của máy chủ)",
        "Ít nhất một model được Antigravity ACP quảng bá trong phiên",
    ],
    "executable_skill": (
        "Script đi kèm Skill không bao giờ được chạy trong thí nghiệm Chat. Chạy mã đã duyệt "
        "là quy trình riêng, cần phê duyệt rõ ràng và AppContainer không capability."
    ),
    "not_required": (
        "VM Hyper-V của Lab nghiên cứu không cần cho thí nghiệm Skill văn bản "
        "(Windows 11 Home không có Hyper-V)."
    ),
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def flash_models(models: list[str]) -> list[str]:
    return [m for m in models if "gemini" in m.casefold() and "flash" in m.casefold()]


class ResearchReadiness:
    def __init__(
        self, config, lab_factory=ContainedLab, adapter_factory=ContainedAcpAdapter
    ):
        self.config = config
        self.lab_factory = lab_factory
        self.adapter_factory = adapter_factory
        self.path = config.root / "research-readiness.json"
        # One AppContainer lab at a time across experiments, legacy trials and checks.
        self.lock = asyncio.Lock()
        self.checking = False

    def protected_paths(self) -> list[Path]:
        paths = [self.config.root]
        token = self.config.root / "session-token"
        if token.is_file():
            paths.append(token)
        return paths

    def last(self) -> dict | None:
        try:
            return json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            return None

    def record_models(self, models: list[str]) -> None:
        """Keep cached readiness models synchronized with live ACP sessions."""
        if not models:
            return
        current = self.last()
        if not isinstance(current, dict) or current.get("models") == models:
            return
        updated = {
            **current,
            "models": list(models),
            "flash_models": flash_models(models),
        }
        try:
            self.path.write_text(
                json.dumps(updated, indent=2, ensure_ascii=False), "utf-8"
            )
        except OSError:
            pass

    # ------------------------------------------------------------------ check
    async def check(self) -> dict:
        async with self.lock:
            self.checking = True
            try:
                result = await self._check()
            finally:
                self.checking = False
        self.path.write_text(json.dumps(result, indent=2, ensure_ascii=False), "utf-8")
        return result

    async def _check(self) -> dict:
        result: dict = {"checked_at": now(), "steps": []}

        def step(identifier, label, passed, detail=""):
            result["steps"].append(
                {"id": identifier, "label": label, "passed": passed, "detail": detail}
            )
            return passed

        if os.name != "nt":
            step("platform", "Windows AppContainer", False, "Chỉ khả dụng trên Windows")
            result["preflight_passed"] = False
            return result
        step("platform", "Windows AppContainer", True)
        try:
            lab = self.lab_factory()
            await asyncio.to_thread(lab.ensure, with_python=True)
            step("lab_build", "Công cụ lab (AcLaunch, agy.exe, Python cô lập)", True)
        except FileNotFoundError:
            step(
                "lab_build",
                "Công cụ lab",
                False,
                "Chưa tìm thấy Antigravity CLI (agy.exe)",
            )
            result["preflight_passed"] = False
            return result
        except Exception as error:
            step(
                "lab_build",
                "Công cụ lab",
                False,
                f"{type(error).__name__}: {error}"[:400],
            )
            result["preflight_passed"] = False
            return result
        try:
            run = await asyncio.to_thread(lab.new_run, "readiness")
            checks = await asyncio.to_thread(lab.preflight, run, self.protected_paths())
            result["checks"] = checks
            result["preflight_passed"] = True
            step(
                "isolation",
                "Kiểm tra cô lập trực tiếp",
                True,
                f"{len(checks)}/{len(checks)} phép thử đạt",
            )
        except IsolationError as error:
            result.update(preflight_passed=False, checks=error.checks, error=str(error))
            failed = [c["check"] for c in error.checks if not c.get("passed")]
            step(
                "isolation",
                "Kiểm tra cô lập trực tiếp",
                False,
                ", ".join(failed) or str(error),
            )
            return result
        except Exception as error:
            result.update(
                preflight_passed=False, error=f"{type(error).__name__}: {error}"
            )
            step("isolation", "Kiểm tra cô lập trực tiếp", False, result["error"][:400])
            return result
        adapter = self.adapter_factory(lab, run, "readiness")
        try:
            await adapter.start()
            init = await adapter.initialize()
            info = await adapter.new_session(run["workspace"])
            models = [m["modelId"] for m in info["models"]["availableModels"]]
            result.update(
                authenticated=True, models=models, cli_agent=init.get("agentInfo")
            )
            step("signin", "Đăng nhập Antigravity của lab", True)
        except Exception as error:
            result.update(authenticated=False, auth_error=str(error)[:500])
            step("signin", "Đăng nhập Antigravity của lab", False, str(error)[:300])
            return result
        finally:
            await adapter.close()
        flash = flash_models(result["models"])
        result["flash_models"] = flash
        advertised = result["models"]
        preview = ", ".join(advertised[:4]) + (
            f" (+{len(advertised) - 4})" if len(advertised) > 4 else ""
        )
        step(
            "model",
            "Model ACP khả dụng",
            bool(advertised),
            preview or "ACP không quảng bá model nào trong phiên",
        )
        return result

    # ---------------------------------------------------------------- summary
    def summary(self, result: dict | None = None) -> dict:
        result = result if result is not None else self.last()
        isolation = next(
            (
                step
                for step in (result or {}).get("steps", [])
                if step["id"] == "isolation"
            ),
            None,
        )
        base = {
            "requirements": REQUIREMENTS,
            "checking": self.checking or self.lock.locked(),
            "supported": os.name == "nt",
            "appcontainer": {
                "mode": "on",
                "required": True,
                "verification": (
                    ("verified" if isolation["passed"] else "failed")
                    if isolation
                    else "unchecked"
                ),
            },
        }
        if not result:
            return {
                **base,
                "state": "unchecked",
                "headline": "Chưa kiểm tra môi trường nghiên cứu",
                "blocker": "Cần một lần kiểm tra cô lập và đăng nhập lab trước khi chạy thí nghiệm.",
                "action": "check",
                "steps": [],
            }
        failed = next((s for s in result.get("steps", []) if not s["passed"]), None)
        age = (
            datetime.now(timezone.utc) - datetime.fromisoformat(result["checked_at"])
        ).total_seconds()
        public = {
            **base,
            "checked_at": result["checked_at"],
            "steps": result.get("steps", []),
            "models": result.get("models", []),
            "flash_models": result.get("flash_models", []),
            "stale": age > FRESH_SECONDS,
        }
        if failed is None and (result.get("models") or result.get("flash_models")):
            return {
                **public,
                "state": "ready",
                "headline": "Môi trường nghiên cứu sẵn sàng",
                "blocker": None,
                "action": "check" if public["stale"] else None,
            }
        actions = {
            "platform": None,
            "lab_build": "install_cli",
            "isolation": "check",
            "signin": "signin",
            "model": "check",
        }
        step_id = failed["id"] if failed else "model"
        return {
            **public,
            "state": "unavailable",
            "headline": "Môi trường nghiên cứu chưa sẵn sàng",
            "blocker": (
                f"{failed['label']}: {failed['detail']}"
                if failed
                else "ACP không quảng bá model nào trong phiên"
            ),
            "action": actions.get(step_id),
        }

    def ready(self) -> bool:
        return self.summary()["state"] == "ready"

    # ----------------------------------------------------------------- signin
    @staticmethod
    def _clear_lab_auth(lab) -> None:
        """Remove cached Lab OAuth/model state inside lab.home only (never touches host CLI)."""
        files = [
            lab.home / ".gemini" / "antigravity-cli" / "antigravity-oauth-token",
            lab.home / ".gemini" / "antigravity-cli" / "jetski_state.pbtxt",
            lab.home / ".gemini" / "oauth_creds.json",
            lab.home / ".gemini" / "google_accounts.json",
            lab.home / "AppData" / "Roaming" / "antigravity" / "credential-user-scope",
        ]
        for target in files:
            try:
                if target.is_file():
                    target.unlink()
            except OSError:
                pass
        cache_dir = lab.home / ".gemini" / "antigravity-cli" / "cache"
        if cache_dir.is_dir():
            import shutil

            shutil.rmtree(cache_dir, ignore_errors=True)

    def open_signin(self, *, reset: bool = False) -> dict:
        """Open the contained interactive sign-in in a new console (explicit operator action)."""
        if os.name != "nt":
            raise ValueError("Đăng nhập lab chỉ khả dụng trên Windows.")
        lab = self.lab_factory()
        lab.ensure()
        if reset:
            self._clear_lab_auth(lab)
            try:
                self.path.unlink(missing_ok=True)
            except OSError:
                pass
        report = lab.tools / "signin.token.json"
        command = lab.command(
            [lab.agy],
            lab.home,
            report,
            console=True,
            env_extra={
                "SSH_CONNECTION": "127.0.0.1 0 127.0.0.1 22",
                "TERM": "xterm-256color",
            },
        )
        subprocess.Popen(command, creationflags=CREATE_NEW_CONSOLE, close_fds=True)
        return {
            "status": "opened",
            "reset": reset,
            "message": (
                "Đã xóa phiên đăng nhập Lab cũ để tránh xung đột và mở cửa sổ đăng nhập mới. "
                "Hãy đăng nhập đúng tài khoản Google có đầy đủ model (Gemini 4…), "
                "gõ /quit khi xong rồi bấm Kiểm tra lại. Hồ sơ CLI máy chính không bị thay đổi."
                if reset
                else "Đã mở cửa sổ đăng nhập riêng của lab. Đăng nhập Google, dán mã xác thực nếu được hỏi, "
                "gõ /quit khi xong rồi bấm Kiểm tra lại. Hồ sơ CLI thường của bạn không bị thay đổi."
            ),
        }
