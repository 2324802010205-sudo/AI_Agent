"""Authenticated Skill registry routes mounted on the application's loopback API."""

import asyncio
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from . import skill_context
from .skills import MAX_FILES, MAX_PACKAGE, SkillLifecycleError, SkillRegistry
from .tools import ToolRegistry


class LocalSkillTest(BaseModel):
    task: str = Field(default="", max_length=1000)
    spreadsheet: bool = False


class IsolatedReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_read_only: StrictBool
    expected_package_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    conversation_id: str | None = Field(default=None, max_length=64)


def register_skill_routes(app: FastAPI, runtime):
    registry = runtime.skills

    def lifecycle_error(error: SkillLifecycleError) -> HTTPException:
        return HTTPException(error.status, {"code": error.code, "message": str(error)})

    def public_skill(skill: dict) -> dict:
        return {
            **{key: value for key, value in skill.items() if key != "selection"},
            **SkillRegistry.skill_state(skill),
        }

    def runtime_summary() -> dict:
        selection = registry.resolve_enabled()
        plan = skill_context.plan(
            selection["sources"],
            "",
            registered=set(ToolRegistry.names()),
            withheld=selection["withheld"],
        )
        return {
            **registry.summary(),
            "exposure": {
                "mode": "all_enabled",
                "exposed": [
                    {
                        "id": entry["skill_id"],
                        "name": entry["skill_name"],
                        "sha256": entry["sha256"],
                        "chars": entry["chars"],
                    }
                    for entry in plan["entries"]
                    if entry["exposed"]
                ],
                "withheld": plan["withheld"],
                "limitations": plan["limitations"],
                "limits": plan["limits"],
            },
        }

    @app.get("/api/skills")
    async def skills():
        return [
            public_skill(skill)
            for skill in await asyncio.to_thread(registry.list_library)
        ]

    @app.get("/api/skills/runtime-summary")
    async def skills_runtime_summary():
        return JSONResponse(
            await asyncio.to_thread(runtime_summary),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/skills/import")
    async def import_skill(files: list[UploadFile] = File(...)):
        uploaded = []
        total = 0
        try:
            if len(files) > MAX_FILES:
                raise ValueError("Tối đa 200 tệp trong một gói Skill.")
            for file in files:
                data = await file.read(MAX_PACKAGE + 1)
                total += len(data)
                if total > MAX_PACKAGE:
                    raise ValueError("Gói vượt giới hạn 20 MB.")
                uploaded.append((file.filename or "", data))
            return public_skill(
                await asyncio.to_thread(registry.import_package, uploaded)
            )
        finally:
            for file in files:
                await file.close()

    @app.post("/api/skills/{id}/local-test")
    async def test_skill_locally(id: str, body: LocalSkillTest):
        try:
            return await asyncio.to_thread(
                registry.test_local, id, body.task, body.spreadsheet
            )
        except SkillLifecycleError as error:
            raise lifecycle_error(error) from error

    @app.get("/api/skills/{id}/source")
    async def skill_source(id: str):
        try:
            content = await asyncio.to_thread(registry.preview_source, id)
        except SkillLifecycleError as error:
            raise lifecycle_error(error) from error
        return JSONResponse({"content": content}, headers={"Cache-Control": "no-store"})

    @app.post("/api/skills/{id}/isolated-reviews")
    async def review_quarantined(id: str, body: IsolatedReview):
        if not body.confirm_read_only:
            raise HTTPException(422, "Cần xác nhận rà soát chỉ đọc cho lần này.")
        try:
            record = await asyncio.to_thread(
                registry.review_quarantined,
                id,
                body.expected_package_sha256,
                body.conversation_id,
            )
        except SkillLifecycleError as error:
            raise lifecycle_error(error) from error
        return JSONResponse(record, headers={"Cache-Control": "no-store"})

    @app.get("/api/skills/{id}/isolated-reviews/{review_id}")
    async def get_isolated_review(id: str, review_id: str):
        record = registry.store.get("skill_reviews", review_id)
        if not record or record["skill_id"] != id:
            raise HTTPException(404, "Không tìm thấy biên nhận đánh giá.")
        return JSONResponse(record, headers={"Cache-Control": "no-store"})

    @app.post("/api/skills/{id}/{action}")
    async def skill_action(id: str, action: Literal["enable", "disable", "approve"]):
        # Keep older desktop clients functional. This alias only changes availability.
        try:
            return public_skill(registry.set_enabled(id, action != "disable"))
        except SkillLifecycleError as error:
            raise lifecycle_error(error) from error

    @app.get("/api/skills/{id}/evidence")
    async def evidence(id: str):
        try:
            manifest = await asyncio.to_thread(registry.archived_manifest, id)
        except SkillLifecycleError as error:
            raise lifecycle_error(error) from error
        return {
            key: manifest[key]
            for key in ("id", "name", "created_at", "hashes", "security")
            if key in manifest
        }

    @app.delete("/api/skills/{id}")
    async def remove_skill(id: str):
        normal_run = any(
            id in (run.get("skill_id"), run.get("requested_skill_id"))
            or any(skill["id"] == id for skill in run.get("loaded_skills", []))
            or any(
                skill["id"] == id
                for skill in (run.get("skill_snapshot") or {}).get("skills", [])
            )
            for run in runtime.live_runs.values()
        )
        if (
            normal_run
            or app.state.injection_lab.uses_skill(id)
            or app.state.research_lab.uses_skill(id)
        ):
            raise lifecycle_error(
                SkillLifecycleError(
                    "skill_in_use",
                    409,
                    "Skill đang được dùng. Hãy chờ hoặc hủy tác vụ trước khi gỡ.",
                )
            )
        try:
            # No suspension between checking active sessions and removing from the index.
            return registry.remove(id)
        except SkillLifecycleError as error:
            raise lifecycle_error(error) from error
