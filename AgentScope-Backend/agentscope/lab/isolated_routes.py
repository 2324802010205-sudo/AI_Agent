"""HTTP contract and artifact downloads for the isolated research lab."""

import asyncio
import json
from pathlib import Path
from typing import Literal

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .boundary_evaluation import report_vi
from .containment import trials as T


class StartTrial(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["control", "injection", "canary"]
    skill_id: str | None = None
    model: str = Field(default=T.DEFAULT_MODEL, pattern=r"^[A-Za-z0-9._-]{1,80}$")
    confirm_isolated_execution: bool = False
    data_view: Literal["aggregates", "raw_rows"] = "aggregates"


class StartSuite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skill_id: str | None = None
    preset: Literal[
        "boundary",
        "reporting",
        "followup",
        "workflow",
        "phase4",
        "phase5",
        "phase6",
        "phase6_proof",
    ] = "reporting"
    data_view: Literal["aggregates", "raw_rows"] = "aggregates"
    model: str = Field(default=T.DEFAULT_MODEL, pattern=r"^[A-Za-z0-9._-]{1,80}$")
    confirm_isolated_execution: bool = False


def register_isolated_routes(app, service):

    @app.get("/api/isolated-lab/status")
    async def status():
        return await asyncio.to_thread(service.status)

    @app.get("/api/isolated-lab/skill-lifecycle-audit")
    async def skill_lifecycle_audit():
        return FileResponse(
            Path(T.__file__).with_name("skill-lifecycle-audit.json"),
            media_type="application/json",
        )

    @app.get("/api/isolated-lab/format-sessions")
    async def format_sessions():
        return FileResponse(
            Path(T.__file__).with_name("format-sessions.json"),
            media_type="application/json",
        )

    @app.post("/api/isolated-lab/check")
    async def check():
        if service.lock.locked():
            raise HTTPException(409, "Đang có trial chạy trong lab")
        return await service.check()

    @app.get("/api/isolated-lab/trials")
    async def trials():
        return await asyncio.to_thread(service.listing)

    @app.post("/api/isolated-lab/trials")
    async def start(body: StartTrial):
        return service.start(body)

    @app.get("/api/isolated-lab/trials/{identifier}")
    async def one(identifier: str):
        return service.load(identifier)

    @app.get("/api/isolated-lab/trials/{identifier}/report")
    async def report(identifier: str):
        trial = service.load(identifier)
        artifact = trial.get("report_artifact")
        if not artifact:
            raise HTTPException(404, "Trial chưa có báo cáo Excel")
        if trial.get("preset") in ("phase4", "phase5", "phase6"):
            validation = trial.get("agentic", {}).get("artifact_validation", {})
            if not (validation.get("valid") and validation.get("matches_mcp_output")):
                raise HTTPException(409, "Tệp Excel chưa đạt kiểm tra độc lập")
        base = Path(trial["evidence_dir"]).resolve()
        path = Path(artifact["path"]).resolve()
        runs = service.lab_factory().runs.resolve()
        if (
            not base.is_relative_to(runs)
            or path.parent != base / "agentscope"
            or path.name != artifact["name"]
            or not path.is_file()
            or T.sha(path.read_bytes()) != artifact["sha256"]
        ):
            raise HTTPException(409, "Đường dẫn hoặc hash báo cáo không hợp lệ")
        return FileResponse(path, filename=artifact["name"])

    @app.post("/api/isolated-lab/suites")
    async def start_suite(body: StartSuite):
        return service.start_suite(body)

    @app.get("/api/isolated-lab/export")
    async def export(
        suite_id: str | None = None, format: Literal["markdown", "json"] = "markdown"
    ):
        if suite_id is not None:
            service._path(suite_id)  # reuse strict identifier validation
        values = service.listing()
        if suite_id:
            values = [t for t in values if t.get("suite_id") == suite_id]
        if suite_id and not values:
            raise HTTPException(404, "Không tìm thấy bộ trial")
        values.sort(
            key=lambda t: (t.get("suite_id", ""), t.get("sequence", 0), t["created_at"])
        )
        content = (
            report_vi(values)
            if format == "markdown"
            else json.dumps(values, ensure_ascii=False, indent=2)
        )
        suffix = "md" if format == "markdown" else "json"
        return Response(
            content,
            media_type="text/markdown" if format == "markdown" else "application/json",
            headers={
                "Content-Disposition": f'attachment; filename="agentscope-boundary.{suffix}"'
            },
        )
