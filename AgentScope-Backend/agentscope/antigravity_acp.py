"""Antigravity ACP v1 transport. Only visible text is delivered to clients.

The CLI owns its tools. AgentScope advertises no filesystem/terminal capability,
requests CLI sandbox restrictions and denies unregistered ACP permission requests.
This application policy is not an independently verified OS sandbox.
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Coroutine
from . import __version__
from .models import sanitize

FILTER_ANSWER = re.compile(
    r"This request was blocked by Gemini's filters\."
    r"(?: They can occasionally trigger by mistake[^\n]*)?"
)


def model_filter_answer(text: str) -> bool:
    # The provider may return its filter notice as text with stopReason=end_turn.
    return FILTER_ANSWER.fullmatch(text.strip()) is not None


class ProviderTurnIncomplete(ValueError):
    pass


def acp_error(error: Exception) -> ValueError:
    raw = str(sanitize(str(error))) or type(error).__name__
    lowered = raw.lower()
    if any(
        word in lowered
        for word in ("quota", "resource_exhausted", "rate limit", "429", "exhausted")
    ):
        prefix = "AI Provider đã hết hạn mức sử dụng."
    elif any(
        word in lowered
        for word in ("auth_required", "unauthenticated", "sign in", "login", "401")
    ):
        prefix = "Antigravity CLI cần xác thực. Hãy đăng nhập CLI trước."
    elif isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        prefix = "Antigravity ACP đã hết thời gian chờ."
    elif isinstance(error, FileNotFoundError):
        prefix = "Không thể kết nối Antigravity CLI: không tìm thấy agy.exe."
    else:
        prefix = "Phiên Antigravity ACP không hoàn tất."
    return ValueError(f"{prefix} {raw}")


class AntigravityAcpAdapter:
    _cached_models: list[dict[str, str]] = []
    _current_model: str | None = None
    _versions: dict[tuple, str | None] = {}
    _connection: dict = {
        "state": "not_tested",
        "authenticated": False,
        "message": "Chưa kiểm tra phiên ACP.",
    }

    def __init__(
        self,
        agy_path: str | Path | None = None,
        skill_guard: Any = None,
        on_permission_eval: (
            Callable[[dict, str, str], Coroutine[Any, Any, None]] | None
        ) = None,
        allowed_read_paths: set[str] | None = None,
    ):
        self.agy_path = Path(agy_path) if agy_path else self.detect_executable()
        self.skill_guard = skill_guard
        self.on_permission_eval = on_permission_eval
        self.allowed_read_paths = {
            str(Path(p).resolve()) for p in (allowed_read_paths or set())
        }
        self.proc = None
        self._reader_task = self._update_task = self._stderr_task = None
        self._pending_requests = {}
        self._next_id = 1
        self._session_callbacks = {}
        self._updates = asyncio.Queue()
        self._server_tasks = set()
        self._tools = {}
        # (sessionId, toolCallId) pairs that reached the permission callback.
        self.evaluated_calls: set = set()
        self.permission_outcomes: dict = {}
        self.delivered_permission_options: dict = {}
        self.session_modes: dict[str, dict] = {}
        self._callback_error = None
        self._closing = False
        self.initialization = {}

    @classmethod
    def detect_executable(cls):
        command = shutil.which("agy.exe") or shutil.which("agy")
        candidates = [Path(command)] if command else []
        candidates += [Path(os.environ.get("LOCALAPPDATA", "")) / "agy/bin/agy.exe"]
        return next((p.resolve() for p in candidates if p.is_file()), None)

    @classmethod
    def get_version(cls, path=None):
        exe = path or cls.detect_executable()
        if not exe or not exe.is_file():
            return None
        key = (str(exe), exe.stat().st_mtime_ns)
        if key not in cls._versions:
            try:
                result = subprocess.run(
                    [str(exe), "--version"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    creationflags=0x08000000 if os.name == "nt" else 0,
                )
                cls._versions[key] = (
                    result.stdout.strip() if result.returncode == 0 else None
                )
            except (OSError, subprocess.SubprocessError):
                cls._versions[key] = None
        return cls._versions[key]

    @classmethod
    def cli_settings_path(cls):
        return Path.home() / ".gemini" / "antigravity-cli" / "settings.json"

    @staticmethod
    def supports_isolated_skills():
        # CLI flags, a separate cwd and a separate data profile do not confine
        # host file/network/process access. No verified isolation exists yet.
        return False

    @classmethod
    def covering_trusted_workspace(cls, cwd):
        """The CLI's own trustedWorkspaces entry containing `cwd`, if any.

        Observed with CLI 1.5.10: file reads under a trusted workspace run without a
        session/request_permission call, so SkillGuard never sees them. Only the
        matching entry is returned, never the whole list.
        """
        try:
            data = json.loads(cls.cli_settings_path().read_text("utf-8"))
        except (OSError, ValueError):
            return None
        entries = data.get("trustedWorkspaces") if isinstance(data, dict) else None
        if not isinstance(entries, list):
            return None
        target = Path(os.path.normcase(str(Path(cwd).resolve())))
        for entry in entries:
            if isinstance(entry, str) and entry.strip():
                root = Path(os.path.normcase(str(Path(entry))))
                if target == root or root in target.parents:
                    return entry
        return None

    @classmethod
    def get_status(cls, path=None):
        exe = path or cls.detect_executable()
        installed = bool(exe and exe.is_file())
        return {
            "installed": installed,
            "path": str(exe) if installed else None,
            "version": cls.get_version(exe) if installed else None,
            "ready": installed and cls._connection["state"] == "connected",
            "connection_status": cls._connection["state"],
            "authenticated": cls._connection.get("authenticated", False),
            "message": (
                cls._connection["message"]
                if installed
                else "Không tìm thấy Antigravity CLI (agy.exe)."
            ),
            "models": cls._cached_models if installed else [],
            "current_model": cls._current_model if installed else None,
        }

    @classmethod
    def connection_result(cls, error=None, authenticated=None):
        authenticated = (
            False
            if error
            else (
                cls._connection.get("authenticated", False)
                if authenticated is None
                else authenticated
            )
        )
        cls._connection = {
            "state": "error" if error else "connected",
            "authenticated": authenticated,
            "message": (
                str(acp_error(error))
                if error
                else (
                    "Đã nhận phản hồi AI thực tế."
                    if authenticated
                    else "ACP đã kết nối; chưa kiểm tra phản hồi mô hình."
                )
            ),
        }

    @classmethod
    async def discover_models_async(cls, cwd=None):
        adapter = cls()
        try:
            await adapter.start()
            await adapter.initialize()
            await adapter.new_session(cwd or Path.cwd())
            cls.connection_result()
            return cls._cached_models
        except Exception as error:
            cls.connection_result(error)
            raise acp_error(error) from error
        finally:
            await adapter.close()

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, *_):
        await self.close()

    async def start(self):
        if not self.agy_path or not self.agy_path.is_file():
            raise FileNotFoundError("Antigravity CLI agy.exe")
        self.proc = await asyncio.create_subprocess_exec(
            str(self.agy_path),
            "acp",
            "--sandbox",
            "--include-default-customizations=false",
            "--disable-telemetry",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=2 * 1024 * 1024,
            creationflags=0x08000000 if os.name == "nt" else 0,
        )
        self._reader_task = asyncio.create_task(self._read_stdout())
        self._update_task = asyncio.create_task(self._dispatch_updates())
        self._stderr_task = asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self):
        # Drain the pipe, but never publish CLI diagnostics/credentials/private reasoning.
        while self.proc and self.proc.stderr:
            if not await self.proc.stderr.read(8192):
                return

    async def _send(self, message):
        if not self.proc or self.proc.returncode is not None:
            raise RuntimeError("Phiên ACP bị ngắt kết nối.")
        self.proc.stdin.write(
            (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
        )
        await self.proc.stdin.drain()

    async def request(self, method, params=None, timeout=60.0):
        identifier = self._next_id
        self._next_id += 1
        future = asyncio.get_running_loop().create_future()
        self._pending_requests[identifier] = future
        try:
            await self._send(
                {
                    "jsonrpc": "2.0",
                    "id": identifier,
                    "method": method,
                    "params": params or {},
                }
            )
            return await asyncio.wait_for(future, timeout)
        finally:
            self._pending_requests.pop(identifier, None)

    async def notify(self, method, params=None):
        await self._send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    async def _read_stdout(self):
        try:
            while not self._closing:
                line = await self.proc.stdout.readline()
                if not line:
                    break
                try:
                    data = json.loads(line)
                except (ValueError, UnicodeError):
                    continue
                if "id" in data and ("result" in data or "error" in data):
                    identifier = data["id"]
                    if isinstance(identifier, str) and identifier.isdigit():
                        identifier = int(identifier)
                    future = self._pending_requests.get(identifier)
                    if future and not future.done():
                        if "error" in data:
                            future.set_exception(
                                ValueError(str(sanitize(data["error"])))
                            )
                        else:
                            future.set_result(data.get("result", {}))
                elif "id" in data and "method" in data:
                    task = asyncio.create_task(self._handle_server_request(data))
                    self._server_tasks.add(task)
                    task.add_done_callback(self._server_tasks.discard)
                elif data.get("method") == "session/update":
                    await self._updates.put(data)
        except asyncio.CancelledError:
            pass
        except Exception as error:
            self._callback_error = error
        finally:
            for future in list(self._pending_requests.values()):
                if not future.done():
                    future.set_exception(RuntimeError("Phiên ACP bị ngắt kết nối."))

    async def _dispatch_updates(self):
        while True:
            notification = await self._updates.get()
            try:
                if self._callback_error:
                    continue
                await self._handle_server_notification(notification)
            except Exception as error:
                self._callback_error = error
                # Wake a pending prompt immediately so its owner closes the CLI.
                # Cancellation is best effort; it cannot undo an observed action.
                for future in list(self._pending_requests.values()):
                    if not future.done():
                        future.set_exception(error)
            finally:
                self._updates.task_done()

    async def _handle_server_notification(self, notification):
        params = notification.get("params", {})
        sid = params.get("sessionId")
        update = params.get("update", {})
        kind = update.get("sessionUpdate")
        if kind == "current_mode_update":
            previous = self.session_modes.get(sid, {})
            self.session_modes[sid] = {
                **previous,
                "current_mode_id": update.get("currentModeId"),
                "evidence": "current_mode_update",
            }
        elif kind == "config_option_update":
            self._remember_session_mode(sid, update)
        if kind == "agent_thought_chunk":
            return
        if kind in ("tool_call", "tool_call_update"):
            key = (sid, update.get("toolCallId"))
            previous = self._tools.get(key, {})
            update = {**previous, **{k: v for k, v in update.items() if v is not None}}
            self._tools[key] = update
        for callback in self._session_callbacks.get(sid, {}).get(kind, []):
            result = callback(update)
            if asyncio.iscoroutine(result):
                await result

    async def _handle_server_request(self, request):
        identifier = request.get("id")
        params = request.get("params", {})
        if request.get("method") == "session/request_permission":
            call = (
                params.get("sessionId"),
                params.get("toolCall", {}).get("toolCallId"),
            )
            # A prior callback or an attempted send is not a delivered approval.
            self.delivered_permission_options.pop(call, None)
            self.permission_outcomes[call] = "deny"
            decision = await self._evaluate_permission(params)
            kind = "allow_once" if decision == "allow" else "reject_once"
            option = next(
                (
                    o
                    for o in params.get("options", [])
                    if o.get("kind") == kind and isinstance(o.get("optionId"), str)
                ),
                None,
            )
            if decision == "allow" and not option and self.on_permission_eval:
                await self.on_permission_eval(
                    params.get("toolCall", {}),
                    "deny",
                    "ACP không cung cấp lựa chọn allow_once; đã hủy yêu cầu.",
                )
            outcome = (
                {"outcome": "selected", "optionId": option["optionId"]}
                if option
                else {"outcome": "cancelled"}
            )
            await self._send(
                {"jsonrpc": "2.0", "id": identifier, "result": {"outcome": outcome}}
            )
            self.delivered_permission_options[call] = kind if option else "cancelled"
            self.permission_outcomes[call] = (
                "allow" if option and decision == "allow" else "deny"
            )
        else:
            await self._send(
                {
                    "jsonrpc": "2.0",
                    "id": identifier,
                    "error": {
                        "code": -32601,
                        "message": "Client capability is not available",
                    },
                }
            )

    async def _evaluate_permission(self, params):
        tool = params.get("toolCall", {})
        sid = params.get("sessionId")
        tool = {**self._tools.get((sid, tool.get("toolCallId")), {}), **tool}
        raw_value, args_value = tool.get("rawInput"), tool.get("args")
        raw = raw_value if isinstance(raw_value, dict) else {}
        args = args_value if isinstance(args_value, dict) else {}
        paths = [
            value
            for source in (raw, args)
            for key, value in source.items()
            if key in {"path", "Path"}
        ]
        valid_paths = bool(paths) and all(
            isinstance(p, str) and p and Path(p).is_absolute() for p in paths
        )
        self.evaluated_calls.add((sid, tool.get("toolCallId")))
        outcome = "deny"
        reason = "SkillGuard từ chối công cụ ACP chưa được cấp quyền."
        if (
            self.skill_guard
            and tool.get("kind") == "read"
            and valid_paths
            and (raw_value is None or isinstance(raw_value, dict))
            and (args_value is None or isinstance(args_value, dict))
            and tool.get("name") == "read_file"
            and set(raw) <= {"path", "Path"}
            and set(args) <= {"path", "Path"}
        ):
            normalized = str(Path(paths[0]).resolve())
            if (
                all(str(Path(p).resolve()) == normalized for p in paths)
                and normalized in self.allowed_read_paths
            ):
                decision = self.skill_guard.evaluate(
                    "read", normalized, registered=True
                )
                outcome, reason = decision.outcome, decision.reason
        if self.on_permission_eval:
            await self.on_permission_eval(tool, outcome, reason)
        return "allow" if outcome == "allow" else "deny"

    def register_callback(self, session_id, event_type, callback):
        self._session_callbacks.setdefault(session_id, {}).setdefault(
            event_type, []
        ).append(callback)

    def unregister_callbacks(self, session_id):
        self._session_callbacks.pop(session_id, None)

    async def initialize(self):
        self.initialization = await self.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": {"readTextFile": False, "writeTextFile": False},
                    "terminal": False,
                },
                "clientInfo": {"name": "AgentScope", "version": __version__},
            },
            timeout=15,
        )
        if self.initialization.get("protocolVersion") != 1:
            raise ValueError("Phiên bản ACP không tương thích.")
        return self.initialization

    @classmethod
    def _remember_models(cls, result):
        models = result.get("models", {})
        available = models.get("availableModels", [])
        if "availableModels" in models:
            cls._cached_models = [
                {
                    "id": str(m.get("modelId") or m.get("id")),
                    "name": str(m.get("name") or m.get("modelId") or m.get("id")),
                }
                for m in available
            ]
        if models.get("currentModelId"):
            cls._current_model = models["currentModelId"]

    async def new_session(self, cwd):
        result = await self.request(
            "session/new",
            {"cwd": str(Path(cwd).resolve()), "mcpServers": []},
            timeout=25,
        )
        self._remember_models(result)
        self._remember_session_mode(result["sessionId"], result)
        return result

    async def load_session(self, cwd, session_id):
        result = await self.request(
            "session/load",
            {
                "cwd": str(Path(cwd).resolve()),
                "sessionId": session_id,
                "mcpServers": [],
            },
            timeout=25,
        )
        self._remember_models(result)
        self._remember_session_mode(session_id, result)
        return result

    def _remember_session_mode(self, session_id, result):
        modes = result.get("modes") or {}
        config = next(
            (c for c in result.get("configOptions", []) if c.get("id") == "mode"), {}
        )
        current = modes.get("currentModeId") or config.get("currentValue")
        available = modes.get("availableModes") or [
            {"id": c.get("value"), "name": c.get("name")}
            for c in config.get("options", [])
        ]
        if current or available:
            self.session_modes[session_id] = {
                "current_mode_id": current,
                "available_mode_ids": [m.get("id") for m in available],
                "evidence": "session_response" if modes else "config_options",
            }
        if (
            modes.get("currentModeId")
            and config.get("currentValue")
            and modes["currentModeId"] != config["currentValue"]
        ):
            raise PermissionError("ACP báo cáo execution mode không nhất quán.")

    async def ensure_default_mode(self, session_id):
        """Pin each session; an absent mode is unknown, never assumed safe.

        Default is a CLI permission preference, not a host isolation guarantee.
        No API or setting in AgentScope enables Auto for untrusted execution.
        """
        state = self.session_modes.get(session_id, {})
        if state.get("current_mode_id") != "default":
            if "default" not in state.get("available_mode_ids", []):
                raise PermissionError(
                    "Không xác minh được ACP Default Mode; không gửi prompt."
                )
            await self.request(
                "session/set_mode",
                {"sessionId": session_id, "modeId": "default"},
                timeout=15,
            )
            state = {
                **state,
                "current_mode_id": "default",
                "evidence": "set_mode_acknowledged",
            }
            self.session_modes[session_id] = state
        return dict(state)

    async def set_model(self, session_id, model_id):
        result = await self.request(
            "session/set_model",
            {"sessionId": session_id, "modelId": model_id},
            timeout=15,
        )
        type(self)._current_model = model_id
        return result

    async def cancel_session(self, session_id):
        await self.notify("session/cancel", {"sessionId": session_id})

    async def prompt(
        self,
        session_id,
        text,
        on_delta=None,
        on_thought=None,
        on_tool=None,
        on_mode=None,
        timeout=120.0,
    ):
        await self.ensure_default_mode(session_id)
        chunks = []
        self._callback_error = None

        async def message(update):
            chunk = update.get("content", {}).get("text", "")
            if chunk:
                chunks.append(chunk)
                if on_delta:
                    await on_delta(chunk)

        async def tool(update):
            if on_tool:
                await on_tool(update)

        async def mode_changed(update):
            if on_mode:
                await on_mode(dict(self.session_modes.get(session_id, {})))
            if (
                self.session_modes.get(session_id, {}).get("current_mode_id")
                != "default"
            ):
                await self.cancel_session(session_id)
                raise PermissionError(
                    "ACP rời Default Mode trong lúc thực thi; đã yêu cầu dừng phiên."
                )

        self.register_callback(session_id, "agent_message_chunk", message)
        self.register_callback(session_id, "tool_call", tool)
        self.register_callback(session_id, "tool_call_update", tool)
        self.register_callback(session_id, "current_mode_update", mode_changed)
        self.register_callback(session_id, "config_option_update", mode_changed)
        try:
            result = await self.request(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": text}]},
                timeout,
            )
            await asyncio.wait_for(self._updates.join(), timeout)
            if self._callback_error:
                raise self._callback_error
            self.connection_result(authenticated=bool(chunks))
            return {
                "text": "".join(chunks),
                "stopReason": result.get("stopReason"),
                "usage": result.get("usage", {}),
            }
        finally:
            self.unregister_callbacks(session_id)

    async def close(self):
        if self._closing:
            return
        self._closing = True
        if self.proc and self.proc.returncode is None:
            if self.proc.stdin:
                self.proc.stdin.close()
            try:
                await asyncio.wait_for(self.proc.wait(), 2)
            except (asyncio.TimeoutError, ProcessLookupError):
                if os.name == "nt" and self.proc.returncode is None:
                    killer = await asyncio.create_subprocess_exec(
                        str(Path(os.environ["SystemRoot"]) / "System32/taskkill.exe"),
                        "/PID",
                        str(self.proc.pid),
                        "/T",
                        "/F",
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                        creationflags=0x08000000,
                    )
                    await killer.wait()
                elif self.proc.returncode is None:
                    self.proc.kill()
                await self.proc.wait()
        for future in list(self._pending_requests.values()):
            if not future.done():
                future.cancel()
        tasks = [
            t
            for t in (
                self._reader_task,
                self._update_task,
                self._stderr_task,
                *self._server_tasks,
            )
            if t
        ]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.proc = None
