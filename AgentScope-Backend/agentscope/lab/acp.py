"""Guest-only ACP transport. Mode selection never changes the production adapter."""

import asyncio
import json
import os
from pathlib import Path
import subprocess

from ..antigravity_acp import AntigravityAcpAdapter


class ResearchAcpAdapter(AntigravityAcpAdapter):
    def __init__(self, permit, verifier, root, mode, on_permission):
        super().__init__(agy_path=permit.config["agy_path"])
        self.permit, self.verifier, self.root = permit, verifier, root
        self.research_mode, self.permission_hook = mode, on_permission
        self.launch_path = root / "observer/actor-launch.json"
        self.prompt_submitted = False
        self.on_prompt_submitted = None

    async def _send(self, message):
        await super()._send(message)
        if message.get("method") == "session/prompt":
            self.prompt_submitted = True
            if self.on_prompt_submitted:
                self.on_prompt_submitted()

    def launch_document(self, executable, arguments, name):
        return {
            "executable": str(executable),
            "arguments": subprocess.list2cmdline(arguments),
            "cwd": str(self.root),
            "credential_path": self.permit.config["agent_credential_path"],
            "pid_path": str(self.root / f"observer/{name}-pid.json"),
            "config_path": str(self.verifier.config_path),
            "challenge_path": str(self.verifier.challenge_path),
        }

    async def start(self):
        self.permit.assert_fresh()
        # Recheck live guest facts rather than trusting a Permit from a previous run.
        await self.verifier.require()
        config = self.permit.config
        document = self.launch_document(
            config["agy_path"],
            [
                "acp",
                "--sandbox",
                "--include-default-customizations=false",
                "--disable-telemetry",
                "--gemini-dir",
                config["cli_profile_root"],
                "--app-data-dir",
                "antigravity-cli",
            ],
            "acp",
        )
        self.launch_path.write_text(json.dumps(document), encoding="utf-8")
        self.proc = await asyncio.create_subprocess_exec(
            str(
                Path(os.environ["SystemRoot"])
                / "System32/WindowsPowerShell/v1.0/powershell.exe"
            ),
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(Path(__file__).with_name("Actor-Bridge.ps1")),
            "-LaunchPath",
            str(self.launch_path),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=2 * 1024 * 1024,
            creationflags=0x08000000,
        )
        self._reader_task = asyncio.create_task(self._read_stdout())
        self._update_task = asyncio.create_task(self._dispatch_updates())
        self._stderr_task = asyncio.create_task(self._drain_stderr())

    async def new_research_session(self, relay_config):
        result = await self.request(
            "session/new",
            {
                "cwd": str(self.root),
                "mcpServers": [
                    {
                        "name": "agentscope_research",
                        "command": self.permit.config["runtime_python"],
                        "args": [
                            "-I",
                            "-m",
                            "agentscope.lab.relay",
                            "--config",
                            str(relay_config),
                        ],
                        "env": [],
                    }
                ],
            },
            timeout=30,
        )
        self._remember_models(result)
        self._remember_session_mode(result["sessionId"], result)
        return result

    async def select_observed_mode(self, sid):
        state = self.session_modes.get(sid, {})
        if self.research_mode not in state.get("available_mode_ids", []):
            raise PermissionError(
                "Requested research mode was not advertised by this CLI session"
            )
        if state.get("current_mode_id") != self.research_mode:
            await self.request(
                "session/set_mode",
                {"sessionId": sid, "modeId": self.research_mode},
                timeout=15,
            )
            # ACK alone is insufficient for an observed Default/Auto comparison.
            for _ in range(40):
                await asyncio.sleep(0.05)
                if (
                    self.session_modes.get(sid, {}).get("current_mode_id")
                    == self.research_mode
                ):
                    break
            else:
                raise PermissionError(
                    "CLI acknowledged mode selection but did not report the requested mode; no model prompt sent"
                )
        return dict(self.session_modes[sid])

    async def _evaluate_permission(self, params):
        tool = params.get("toolCall", {})
        sid = params.get("sessionId")
        tool = {**self._tools.get((sid, tool.get("toolCallId")), {}), **tool}
        self.evaluated_calls.add((sid, tool.get("toolCallId")))
        return await self.permission_hook(tool)

    async def research_prompt(self, sid, text, on_tool, on_delta, on_mode):
        await self.select_observed_mode(sid)
        self._callback_error = None
        chunks = []

        async def message(update):
            value = update.get("content", {}).get("text", "")
            if value:
                chunks.append(value)
                await on_delta(value)

        async def tool(update):
            await on_tool(update)

        async def mode(update):
            state = self.session_modes.get(sid, {})
            await on_mode(state)
            if state.get("current_mode_id") != self.research_mode:
                await self.cancel_session(sid)
                raise PermissionError(
                    "Research execution mode changed during the trial"
                )

        for kind, callback in [
            ("agent_message_chunk", message),
            ("tool_call", tool),
            ("tool_call_update", tool),
            ("current_mode_update", mode),
            ("config_option_update", mode),
        ]:
            self.register_callback(sid, kind, callback)
        try:
            result = await self.request(
                "session/prompt",
                {"sessionId": sid, "prompt": [{"type": "text", "text": text}]},
                timeout=120,
            )
            await asyncio.wait_for(self._updates.join(), 5)
            if self._callback_error:
                raise self._callback_error
            return {"text": "".join(chunks), "stopReason": result.get("stopReason")}
        finally:
            self.unregister_callbacks(sid)
