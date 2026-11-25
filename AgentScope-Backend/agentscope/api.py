import asyncio
import hmac
import secrets
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict

from . import __version__
from .antigravity_acp import AntigravityAcpAdapter, acp_error
from .conversation_files import (
    MAX_SELECTED,
    attachment_state,
    can_use_file,
    public_file,
    save_selection,
)
from .config import Config
from .models import (
    Event,
    ProviderModelTest,
    ProviderSettings,
    SendMessage,
    now,
    sanitize,
    uid,
)
from .skill_routes import register_skill_routes
from .providers import CloudAdapter
from .runtime import Orchestrator
from .storage import Store
from .lab.service import register_lab_routes
from .lab.evaluation import register_evaluation_routes
from .lab.injection_lab import register_injection_lab_routes
from .experiments.chat_workbook import ContainedWorkbookChat
from .experiments.readiness import ResearchReadiness
from .experiments.research_routes import register_research_runner_routes
from .experiments.service import register_experiment_routes


def create_app(config: Config | None = None) -> FastAPI:
    config = config or Config()
    store = Store(config.root)
    readiness = ResearchReadiness(config)
    runtime = Orchestrator(
        config, store, ContainedWorkbookChat(config, store, readiness)
    )
    tickets: dict[str, float] = {}

    @asynccontextmanager
    async def lifespan(app):
        for task in store.all("tasks"):
            if task["status"] in {"running", "pending", "paused", "awaiting_approval"}:
                task.update(
                    status="failed",
                    updated_at=now(),
                    error="Backend đã dừng trước khi tác vụ hoàn tất. Không tự chạy lại.",
                )
                store.put("tasks", task)
                store.event(
                    Event(
                        run_id=task["id"],
                        event_type="runtime.recovered",
                        status="failed",
                        message=task["error"],
                        mode=task["mode"],
                    )
                )
        for message in store.all("messages"):
            if message.get("streaming"):
                message.update(
                    streaming=False,
                    incomplete=True,
                    revision=message.get("revision", 0) + 1,
                )
                store.put("messages", message)
        yield
        await app.state.functional.shutdown()
        await app.state.experiments.shutdown()
        await app.state.injection_lab.shutdown()
        await app.state.research_lab.shutdown()
        try:
            await asyncio.wait_for(runtime.shutdown(), timeout=12)
        except asyncio.TimeoutError:
            for task in list(runtime.background.values()):
                task.cancel()

    app = FastAPI(
        title="AgentScope Backend",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.runtime = runtime
    app.state.store = store
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def protect(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in config.origins:
            return JSONResponse(
                {"detail": "Nguồn yêu cầu không được phép."}, status_code=403
            )
        if request.headers.get("host", "").split(":")[0] not in {
            "127.0.0.1",
            "localhost",
            "testserver",
        }:
            return JSONResponse({"detail": "Host không hợp lệ."}, status_code=403)
        if request.method != "OPTIONS":
            if not hmac.compare_digest(
                request.headers.get("authorization", ""), f"Bearer {config.token}"
            ):
                return JSONResponse(
                    {"detail": "Mã phiên không hợp lệ hoặc thiếu xác thực."},
                    status_code=401,
                )
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > 22 * 1024 * 1024):
            return JSONResponse(
                {"detail": "Yêu cầu vượt giới hạn 22 MB."}, status_code=413
            )
        return await call_next(request)

    @app.exception_handler(ValueError)
    async def value_error(request, error):
        return JSONResponse({"detail": str(sanitize(str(error)))}, status_code=400)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        if request.url.path in {"/api/settings", "/api/settings/test-model"}:
            return JSONResponse(
                {
                    "detail": "Cấu hình không hợp lệ. Kiểm tra dịch vụ, Model ID và API key."
                },
                status_code=422,
            )
        return await request_validation_exception_handler(request, error)

    @app.exception_handler(zipfile.BadZipFile)
    async def zip_error(request, error):
        return JSONResponse(
            {"detail": "Tệp ZIP hoặc Excel không hợp lệ."}, status_code=400
        )

    def require(table, id):
        value = store.get(table, id)
        if not value:
            raise HTTPException(404, "Không tìm thấy tài nguyên.")
        return value

    @app.get("/api/health")
    async def health():
        return {
            "status": "ready",
            "version": __version__,
            "policy": "application-level",
            "local_models": False,
        }

    @app.post("/api/shutdown")
    async def shutdown():
        config.stop.set()
        return {"status": "stopping"}

    @app.get("/api/conversations")
    async def conversations():
        return store.all("conversations")

    @app.post("/api/conversations")
    async def create_conversation():
        return store.put(
            "conversations",
            {
                "id": runtime.reserve_conversation_id(),
                "title": "Cuộc trò chuyện mới",
                "created_at": now(),
            },
        )

    @app.get("/api/conversations/{id}/messages")
    async def messages(id: str):
        require("conversations", id)
        return sorted(
            store.conversation_messages(id),
            key=lambda m: m["created_at"],
        )

    @app.get("/api/conversations/{id}/attachments")
    async def conversation_attachments(id: str):
        require("conversations", id)
        return attachment_state(store, id)

    @app.post("/api/conversations/{id}/messages")
    async def send(id: str, body: SendMessage):
        conversation = require("conversations", id)
        explicit_skill = "skill_id" in body.model_fields_set
        # Omitting both fields offers every enabled Skill. Opt out with auto_skill=false
        # or skill_id=null; pass skill_id to restrict the task to one installed Skill.
        opted_out = "auto_skill" in body.model_fields_set and not body.auto_skill
        if body.auto_skill and explicit_skill:
            raise HTTPException(422, "Chọn tự động hoặc chỉ định Skill cho lượt này.")
        if not body.content.strip():
            raise ValueError("Tin nhắn không được để trống.")
        if any(
            r["conversation_id"] == id
            and r["status"] in {"running", "paused", "awaiting_approval", "pending"}
            for r in store.all("tasks")
        ):
            raise HTTPException(409, "Cuộc trò chuyện đang có một tác vụ hoạt động.")
        if len(runtime.background) >= 4:
            raise HTTPException(429, "Tối đa 4 tác vụ đồng thời.")
        with store.write_transaction() as db:
            ids = body.attachment_ids
            if ids is None:
                ids = attachment_state(store, id, connection=db)["selected_ids"]
            if len(set(ids)) != len(ids):
                raise ValueError("Tệp đính kèm bị trùng.")
            attached = []
            for file_id in ids:
                file = store.get("files", file_id, connection=db)
                if not file or not can_use_file(file, id):
                    raise HTTPException(
                        404, "Không tìm thấy tệp trong cuộc trò chuyện."
                    )
                attached.append(public_file(file))
            message = {
                "id": uid(),
                "conversation_id": id,
                "role": "user",
                "content": body.content.strip(),
                "attachments": attached,
                "created_at": now(),
            }
            store.put_many("messages", [message], connection=db)
            save_selection(store, id, ids, connection=db)
            title_changed = conversation["title"] == "Cuộc trò chuyện mới"
            if title_changed:
                conversation["title"] = body.content.strip()[:70]
            if explicit_skill:
                conversation["selected_skill_id"] = body.skill_id
            if body.auto_skill:
                conversation.pop("selected_skill_id", None)
            if title_changed or explicit_skill or body.auto_skill:
                store.put_many(
                    "conversations",
                    [conversation],
                    connection=db,
                )
        run = runtime.create(
            id,
            body.content,
            ids,
            body.mode,
            message["id"],
            body.skill_id,
            discover_skill=(
                True if body.auto_skill else False if explicit_skill or opted_out else None
            ),
        )
        message.update(task_id=run["id"], mode=run["mode"], provider=run["provider"])
        store.put("messages", message)
        return {"run": run, "message": message}

    @app.get("/api/tasks")
    async def tasks():
        return store.all("tasks")

    @app.get("/api/tasks/{id}/events")
    async def task_events(id: str):
        require("tasks", id)
        return store.events(id)

    class ControlBody(BaseModel):
        model_config = ConfigDict(extra="forbid")
        action: Literal["pause", "resume", "cancel"]

    @app.post("/api/tasks/{id}/control")
    async def control(id: str, body: ControlBody):
        return await runtime.control(id, body.action)

    class ApprovalBody(BaseModel):
        model_config = ConfigDict(extra="forbid")
        allowed: bool

    @app.post("/api/approvals/{id}")
    async def approval(id: str, body: ApprovalBody):
        record = require("approvals", id)
        control = runtime.controls.get(record["run_id"])
        future = control.approvals.get(id) if control else None
        if not future or future.done():
            raise HTTPException(409, "Yêu cầu phê duyệt không còn hiệu lực.")
        record.update(decision="allow" if body.allowed else "deny", resolved_at=now())
        store.put("approvals", record)
        future.set_result(body.allowed)
        return {"status": "resolved"}

    @app.post("/api/files")
    async def upload(file: UploadFile = File(...), conversation_id: str | None = None):
        if conversation_id is not None:
            require("conversations", conversation_id)
        name = Path((file.filename or "").replace("\\", "/")).name
        suffix = Path(name).suffix.lower()
        if suffix not in {".csv", ".xlsx", ".xls"}:
            raise ValueError("Chỉ hỗ trợ CSV, XLSX và XLS.")
        id = uid()
        path = config.uploads / (id + suffix)
        total = 0
        try:
            with path.open("xb") as dest:
                while chunk := await file.read(1024 * 1024):
                    total += len(chunk)
                    if total > 20 * 1024 * 1024:
                        raise ValueError("Tệp vượt giới hạn 20 MB.")
                    dest.write(chunk)
            if not total:
                raise ValueError("Tệp trống.")
            value = {
                "id": id,
                "name": name[:240],
                "size": total,
                "type": suffix[1:],
                "path": str(path),
                "output": False,
                "created_at": now(),
            }
            if conversation_id is None:
                store.put("files", value)
            else:
                value["conversation_id"] = conversation_id
                with store.write_transaction() as db:
                    selected = attachment_state(store, conversation_id, connection=db)[
                        "selected_ids"
                    ]
                    store.put_many("files", [value], connection=db)
                    save_selection(
                        store,
                        conversation_id,
                        [*selected, id][:MAX_SELECTED],
                        connection=db,
                        new_file=id,
                    )
            return public_file(value)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    @app.get("/api/files/{id}/download")
    async def download(id: str):
        file = require("files", id)
        path = Path(file["path"])
        decision = runtime.policy.evaluate("read", str(path), registered=True)
        if decision.outcome != "allow" or not path.is_file():
            raise HTTPException(403, "Không được truy cập tệp này.")
        return FileResponse(
            path,
            filename=file["name"],
            media_type=(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                if file["type"] == "xlsx"
                else "application/octet-stream"
            ),
        )

    register_skill_routes(app, runtime)

    @app.get("/api/settings")
    async def settings():
        return runtime.settings()

    @app.post("/api/settings")
    async def save_settings(body: ProviderSettings):
        saved = store.get("settings", "main") or runtime.default_settings()
        update = body.model_dump(exclude_none=True)
        key = update.pop("api_key", None)
        saved.update(update)
        if key:
            try:
                runtime.secrets.set(saved["provider"], key)
            except Exception as error:
                raise ValueError(
                    "Không lưu được vào kho bí mật hệ điều hành. API key chưa được lưu."
                ) from error
        store.put("settings", saved)
        return runtime.settings()

    @app.post("/api/antigravity/prepare")
    async def prepare_antigravity():
        return await runtime.prepare_antigravity()

    @app.get("/api/antigravity/status")
    async def antigravity_status():
        return AntigravityAcpAdapter.get_status()

    @app.get("/api/antigravity/models")
    async def antigravity_models():
        models = await AntigravityAcpAdapter.discover_models_async(config.workspace)
        return {"models": models, "current_model": AntigravityAcpAdapter._current_model}

    class ProviderTestBody(BaseModel):
        model_config = ConfigDict(extra="forbid")
        model: str | None = None

    @app.post("/api/settings/test")
    async def test_provider(body: ProviderTestBody | None = None):
        settings = runtime.configuration()
        if settings.get("provider") == "antigravity":
            status = AntigravityAcpAdapter.get_status()
            if not status["installed"]:
                raise ValueError(status["message"])
            run = {
                "id": uid(),
                "conversation_id": "",
                "title": "Kiểm tra kết nối Antigravity ACP",
                "mode": "real",
                "status": "running",
                "created_at": now(),
                "updated_at": now(),
            }
            store.put("tasks", run)
            await runtime.emit(
                run,
                "permission.resolved",
                "Người dùng chủ động yêu cầu kiểm tra Antigravity ACP",
                status="completed",
                tool_name="antigravity.test",
                permission_decision="allow",
                arguments={
                    "destination": "Antigravity ACP (agy.exe)",
                    "operation": "handshake & test prompt",
                },
            )
            started = time.monotonic()
            adapter = AntigravityAcpAdapter(skill_guard=runtime.policy)
            try:
                await adapter.start()
                init_res = await adapter.initialize()
                agent_info = init_res.get("agentInfo", {})
                session_res = await adapter.new_session(config.workspace)
                session_id = session_res.get("sessionId")
                requested_model = (
                    body.model.strip()
                    if body is not None and body.model is not None
                    else settings.get("model")
                )
                if requested_model:
                    await adapter.set_model(session_id, requested_model)
                active_model = requested_model or AntigravityAcpAdapter._current_model or ""
                prompt_res = await adapter.prompt(
                    session_id, "Reply with OK only.", timeout=120.0
                )
                if not prompt_res.get("text"):
                    raise ValueError("Antigravity ACP không trả phản hồi kiểm tra.")
                duration_ms = round((time.monotonic() - started) * 1000)
                await runtime.emit(
                    run,
                    "provider.completed",
                    f"Đã nhận phản hồi thực tế từ Antigravity (v{status.get('version') or 'không rõ'})",
                    status="completed",
                    tool_name="antigravity.test",
                    duration_ms=duration_ms,
                    result={
                        "observed": True,
                        "response_completed": True,
                        "agent": agent_info,
                        "model": active_model,
                    },
                )
                await runtime.state(run, "completed")
                return {
                    "message": (
                        f"Kết nối Antigravity thành công (v{status.get('version') or 'không rõ'}"
                        + (f" · {active_model}" if active_model else "")
                        + f"). Phản hồi thực tế trong {duration_ms}ms."
                    ),
                    "provider": "antigravity",
                    "model": active_model,
                    "models": AntigravityAcpAdapter._cached_models,
                    "duration_ms": duration_ms,
                    "response": str(sanitize(prompt_res["text"].strip()))[:240],
                }
            except Exception as error:
                AntigravityAcpAdapter.connection_result(error)
                error = acp_error(error)
                await runtime.emit(
                    run,
                    "provider.failed",
                    "Kiểm tra kết nối Antigravity thất bại",
                    status="failed",
                    tool_name="antigravity.test",
                    error=str(error),
                    duration_ms=round((time.monotonic() - started) * 1000),
                    result={"observed": True, "response_completed": False},
                )
                await runtime.state(run, "failed", error=str(sanitize(str(error))))
                raise ValueError(str(error)) from error
            finally:
                await adapter.close()

        return await check_cloud_model(settings["provider"], settings["model"])

    @app.post("/api/settings/test-model")
    async def test_model(body: ProviderModelTest):
        key = body.api_key.get_secret_value().strip() if body.api_key else None
        return await check_cloud_model(body.provider, body.model, key)

    async def check_cloud_model(provider: str, model: str, key: str | None = None):
        if not key:
            try:
                key = runtime.secrets.get(provider)
            except Exception as error:
                raise ValueError("Kho bí mật hệ điều hành chưa khả dụng.") from error
        if not key:
            raise ValueError("Nhập API key cho dịch vụ đã chọn để kiểm tra model.")
        adapter = CloudAdapter(provider, model, key)

        def redact(text: str) -> str:
            return sanitize(text.replace(adapter.key, "[REDACTED]"))

        run = {
            "id": uid(),
            "conversation_id": "",
            "title": "Kiểm tra kết nối AI",
            "mode": "real",
            "status": "running",
            "created_at": now(),
            "updated_at": now(),
        }
        store.put("tasks", run)
        await runtime.emit(
            run,
            "permission.resolved",
            "Người dùng chủ động yêu cầu kiểm tra provider",
            status="completed",
            tool_name="provider.test",
            permission_decision="allow",
            arguments={
                "destination": adapter.HOSTS[adapter.provider],
                "operation": "test message; no attachments",
            },
        )
        started = time.monotonic()
        try:
            result = await asyncio.wait_for(
                adapter.complete(
                    [{"role": "user", "content": "Reply with OK only."}],
                    "This is a model connectivity test.",
                    [],
                ),
                timeout=60,
            )
            if not result.text.strip():
                raise ValueError("Provider không trả nội dung kiểm tra.")
            duration_ms = round((time.monotonic() - started) * 1000)
            await runtime.emit(
                run,
                "provider.completed",
                "Đã nhận phản hồi kiểm tra thực tế",
                status="completed",
                tool_name="provider.test",
                duration_ms=duration_ms,
                result={"observed": True, "response_completed": True},
            )
            await runtime.state(run, "completed")
            return {
                "message": "Kết nối thành công. Đã nhận phản hồi thực tế từ provider.",
                "provider": provider,
                "model": redact(model),
                "duration_ms": duration_ms,
                "response": redact(result.text.strip())[:240],
            }
        except Exception as error:
            if isinstance(error, (TimeoutError, httpx.TimeoutException)):
                detail = "Hết thời gian chờ model phản hồi."
            elif isinstance(error, httpx.RequestError):
                detail = "Không kết nối được tới API của dịch vụ AI."
            else:
                detail = redact(str(error) or "Kiểm tra model thất bại.")
            await runtime.emit(
                run,
                "provider.failed",
                "Kiểm tra kết nối thất bại",
                status="failed",
                tool_name="provider.test",
                error=detail,
                duration_ms=round((time.monotonic() - started) * 1000),
                result={"observed": True, "response_completed": False},
            )
            await runtime.state(run, "failed", error=detail)
            raise ValueError(detail) from error

    @app.get("/api/audit")
    async def audit():
        return store.events()

    @app.post("/api/security/demo")
    async def security_demo():
        run = {
            "id": uid(),
            "conversation_id": "",
            "title": "DEMO · Kiểm thử SkillGuard",
            "mode": "demo",
            "status": "running",
            "created_at": now(),
            "updated_at": now(),
        }
        store.put("tasks", run)
        scenarios = [
            (
                "read",
                str(config.root.parent / "unauthorized-test.txt"),
                None,
                "file.read",
            ),
            ("process", "harmless-test.exe", None, "process.start"),
            ("network", "", "test.invalid", "network.connect"),
        ]
        for operation, target, destination, tool in scenarios:
            decision = runtime.policy.evaluate(
                operation, target, destination=destination
            )
            await runtime.emit(
                run,
                "permission.evaluated",
                "DEMO · " + decision.reason,
                tool_name=tool,
                status="blocked",
                permission_decision=decision.outcome,
                arguments={
                    "path": target,
                    "operation": operation,
                    "destination": destination,
                },
                result={"synthetic": True, "observed": False, "executed": False},
            )
        await runtime.state(run, "completed")
        return {"run": run}

    @app.post("/api/ws-ticket")
    async def ws_ticket():
        current = time.monotonic()
        for ticket, expiry in list(tickets.items()):
            if expiry < current:
                tickets.pop(ticket, None)
        if len(tickets) > 1000:
            raise HTTPException(429, "Quá nhiều yêu cầu kết nối.")
        value = secrets.token_urlsafe(32)
        tickets[value] = current + 30
        return {"ticket": value}

    @app.websocket("/ws/runs/{id}")
    async def websocket(ws: WebSocket, id: str):
        expiry = tickets.pop(ws.query_params.get("ticket", ""), 0)
        origin = ws.headers.get("origin")
        if (
            expiry < time.monotonic()
            or origin
            and origin not in config.origins
            or not store.get("tasks", id)
        ):
            await ws.close(code=1008)
            return
        await ws.accept()
        queue = asyncio.Queue(maxsize=1000)
        runtime.listeners.setdefault(id, set()).add(queue)
        try:
            # Subscribe first, replay persisted history, then drain live queue (client deduplicates IDs).
            for event in store.events(id):
                await ws.send_json(event)
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    await ws.send_json(event)
                except asyncio.TimeoutError:
                    if queue not in runtime.listeners.get(id, set()):
                        await ws.close(code=1013)
                        return
                    await ws.send_json({"type": "heartbeat"})
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            runtime.listeners.get(id, set()).discard(queue)

    register_lab_routes(app, config, store)
    register_evaluation_routes(app, config, store)
    app.state.readiness = readiness
    register_injection_lab_routes(app, config, store, readiness)
    experiments = register_experiment_routes(app, config, store, runtime, readiness)
    register_research_runner_routes(app, experiments)
    return app
