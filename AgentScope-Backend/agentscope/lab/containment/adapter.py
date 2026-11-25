"""The production ACP adapter, launched through AcLaunch. Protocol handling is inherited."""

import asyncio
import json
from datetime import datetime, timezone

from ...antigravity_acp import AntigravityAcpAdapter
from .lab import ContainedLab, NO_WINDOW


class ContainedAcpAdapter(AntigravityAcpAdapter):
    """Same ACP flags and message handling as production; only the process boundary differs.

    ``permission_policy(tool) -> (decision, reason)`` replaces SkillGuard for research runs.
    Without a policy every permission request is denied (the production default).
    """

    def __init__(self, lab: ContainedLab, run: dict, name: str, permission_policy=None):
        super().__init__(agy_path=lab.agy)
        self.lab, self.run, self.name = lab, run, name
        self.permission_policy = permission_policy
        self.permission_log = []
        self.token_report = run["evidence"] / f"{name}.token.json"
        self.proc_log = run["evidence"] / f"{name}.processes.jsonl"
        self.exchange_log = run["evidence"] / f"{name}.acp.jsonl"
        self.exchanges = []

    async def _send(self, message):
        entry = (
            next(
                (
                    item
                    for item in reversed(self.exchanges)
                    if item["method"] == "session/prompt"
                    and message.get("method") == item["method"]
                    and message.get("params") is item["params"]
                ),
                None,
            )
            if message.get("method") == "session/prompt"
            else None
        )
        await super()._send(message)
        if entry is not None:
            entry["pipe_written"] = True

    async def request(self, method, params=None, timeout=60.0):
        # Authentication secrets and private thought updates are outside this log.
        recorded = method in {
            "initialize",
            "session/new",
            "session/set_model",
            "session/set_mode",
            "session/prompt",
        }
        entry = {
            "method": method,
            "params": params,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        }
        if recorded:
            self.exchanges.append(entry)
            with self.exchange_log.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
        try:
            result = await super().request(method, params, timeout)
            if recorded:
                entry["result"] = result
            return result
        except Exception as error:
            if recorded:
                entry["error"] = {
                    "type": type(error).__name__,
                    "message": str(error)[:2000],
                }
            raise
        finally:
            if recorded:
                entry["finished_at"] = datetime.now(timezone.utc).isoformat()
                with self.exchange_log.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(entry, ensure_ascii=False) + "\n")

    async def start(self):
        command = self.lab.command(
            [
                self.lab.agy,
                "acp",
                "--sandbox",
                "--include-default-customizations=false",
                "--disable-telemetry",
            ],
            self.run["workspace"],
            self.token_report,
            self.proc_log,
        )
        self.proc = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=2 * 1024 * 1024,
            creationflags=NO_WINDOW,
        )
        for _ in range(100):
            if self.token_report.is_file() or self.proc.returncode is not None:
                break
            await asyncio.sleep(0.05)
        try:
            self.token = self.lab.verify_token(self.token_report)
        except Exception:
            self.proc.kill()
            raise
        self._reader_task = asyncio.create_task(self._read_stdout())
        self._update_task = asyncio.create_task(self._dispatch_updates())
        self._stderr_task = asyncio.create_task(self._drain_stderr())

    async def _evaluate_permission(self, params):
        tool = params.get("toolCall", {})
        sid = params.get("sessionId")
        merged = {**self._tools.get((sid, tool.get("toolCallId")), {}), **tool}
        self.evaluated_calls.add((sid, merged.get("toolCallId")))
        if self.permission_policy:
            decision, reason = self.permission_policy(merged)
        else:
            decision, reason = (
                "deny",
                "research default: every CLI permission request is denied",
            )
        self.permission_log.append(
            {
                "toolCallId": merged.get("toolCallId"),
                "name": merged.get("name"),
                "title": merged.get("title"),
                "kind": merged.get("kind"),
                "rawInput": merged.get("rawInput"),
                "options": [o.get("kind") for o in params.get("options", [])],
                "decision": decision,
                "reason": reason,
            }
        )
        if self.on_permission_eval:
            await self.on_permission_eval(merged, decision, reason)
        return decision
