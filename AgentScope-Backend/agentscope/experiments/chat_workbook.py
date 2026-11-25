"""Run Normal Chat workbook requests with the contained ACP/MCP pipeline."""

import asyncio
import json
import re
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from ..conversation_files import can_use_file
from ..models import now
from ..policy import contained
from .. import skill_context as bundle
from ..tools import Cancelled, ToolRegistry
from . import conditions, skillguard, workbook
from .service import task_frame, validate_written_report
from .trial import run_condition, run_contained_text


class ContainedWorkbookChat:
    def __init__(self, config, store, readiness):
        self.config, self.store, self.readiness = config, store, readiness

    async def skill_context(self, runtime, run, skill_sources, request=""):
        if run["model"]:
            known_models = set(self.readiness.summary().get("models") or [])
            valid_model = (
                run["model"] in known_models
                or bool(re.match(r"^(?:gemini|claude|gpt)-", run["model"]))
            )
            if not valid_model:
                raise ValueError(
                    "Hãy chọn model khả dụng cho Google Antigravity trong Cài đặt. "
                    "Bạn cũng có thể dùng Tự chọn từ phiên ACP."
                )
        policy = conditions.resolve("skillguard_on", "quarantine")
        runtime_policy = conditions.resolve("skillguard_on", "runtime_only")
        # An explicitly chosen Skill still stops the task. With all enabled Skills, one
        # blocked Skill is withheld and reported while the others stay available.
        strict = run.get("skill_selection_mode") != "all_enabled"
        snapshot = run.get("skill_snapshot") or {}
        withheld = list(snapshot.get("withheld", []))
        allowed = []
        for skill, instructions in skill_sources:
            skill_policy = (
                runtime_policy if skill.get("quarantine_enabled") else policy
            )
            decision = skillguard.decide(skill_policy, skill, instructions)
            if decision["decision"] == "quarantined_before_exposure":
                message = (
                    f"SkillGuard đã chặn Skill {skill['name']} ({skill['id']}) "
                    "trước khi gửi."
                )
                await runtime.emit(
                    run,
                    "skillguard.quarantined",
                    message,
                    source="skillguard",
                    status="blocked",
                    result={
                        "skill_id": skill["id"],
                        "skill_name": skill["name"],
                        "sha256": skill["hashes"]["SKILL.md"],
                        "scan_verdict": skill["security"]["assessment"],
                        "decision": decision["decision"],
                        "reason": decision["reason"],
                        "skill_exposure": "blocked_before_submission",
                    },
                )
                if strict:
                    raise PermissionError(message)
                withheld.append(
                    {
                        "skill_id": skill["id"],
                        "skill_name": skill["name"],
                        "reason": "skillguard_blocked",
                        "message": f"{message} {decision['reason']}",
                    }
                )
                continue
            allowed.append((skill, decision["delivered_text"]))
        result = bundle.plan(
            allowed,
            request,
            registered=set(ToolRegistry.names()),
            withheld=withheld,
            total_enabled=len(skill_sources) + len(snapshot.get("withheld", [])),
        )
        facts = bundle.receipt_facts(result)
        facts["decision"] = "bundle_delivered" if result["exposed"] else "no_skill"
        run["skill_exposure_plan"] = {
            "exposed": [
                {"id": e["skill_id"], "sha256": e["sha256"]}
                for e in facts["skills"]
                if e["exposed"]
            ],
            **{key: facts[key]
            for key in (
                "skill_count",
                "skills_withheld",
                "skill_limitations",
                "skill_limits",
                "skill_bundle_sha256",
            )},
        }
        if result["limitations"]:
            await runtime.emit(
                run,
                "skill.exposure_limited",
                f"{len(result['limitations'])} giới hạn khi nạp Skill cho tác vụ này",
                source="skill-registry",
                status="completed",
                result={
                    "limitations": result["limitations"],
                    "withheld": result["withheld"],
                    "limits": result["limits"],
                    "exposed": result["exposed"],
                },
            )
            runtime.message(
                run,
                "**Giới hạn khi nạp Skill**\n\n"
                + "\n".join(
                    f"- {item['message']} · "
                    + ", ".join(f"`{i[:8]}`" for i in item["skill_ids"])
                    for item in result["limitations"]
                ),
            )
        return (
            policy,
            result["text"],
            ("prompt.submitted", "Đã gửi yêu cầu tới Antigravity ACP", facts),
        )

    def confirm_snapshot(self, runtime, run):
        """Fail closed if an exposed Skill was disabled, removed or altered while waiting."""
        pinned = [
            {"id": item["id"], "sha256": item["sha256"]}
            for item in (run.get("skill_exposure_plan") or {}).get("exposed", [])
        ]
        changed = runtime.skills.revalidate(pinned)
        if changed:
            raise PermissionError(
                "Skill đã bị tắt, gỡ hoặc thay đổi trong lúc chờ phê duyệt "
                f"({', '.join(item['id'][:8] for item in changed)}). Chưa gửi yêu cầu nào tới Gemini."
            )

    def accept_session(self, run, output):
        session = output.get("session")
        if session:
            run.update(
                execution_engine="acp_appcontainer",
                session_id=session["session_id"],
                model=session["model"],
                lab_run=output["lab_run"],
            )
            self.store.put("tasks", run)
        if output["state"] == "cancelled":
            raise Cancelled()
        if output["state"] == "blocked_isolation":
            failed = ", ".join(output["isolation"].get("failed", []))
            raise PermissionError(
                f"AppContainer không đạt kiểm tra cách ly. {failed}".strip()
            )
        if output["state"] == "model_filter_blocked":
            raise PermissionError("Gemini đã chặn yêu cầu qua bộ lọc của nhà cung cấp.")
        if output["state"] != "completed":
            error = (output.get("error") or {}).get("message") or output["state"]
            raise RuntimeError(f"Phiên Gemini ACP chưa hoàn tất. {error}")

    async def execute_text(self, runtime, run, content, skill_sources, control):
        _, prefix, submission = await self.skill_context(
            runtime, run, skill_sources, content
        )
        prompt = f"{prefix}[user]: {content.strip()}"
        await runtime.approve_provider_request(
            run,
            control,
            "Google Antigravity (Gemini ACP)",
            "Cho phép gửi yêu cầu và hướng dẫn Skill đã kiểm tra tới Gemini?",
        )
        self.confirm_snapshot(runtime, run)

        async def emit(event_type, message, **kwargs):
            await runtime.emit(run, event_type, message, **kwargs)

        async with self.readiness.lock:
            await control.checkpoint()
            output = await run_contained_text(
                lab=self.readiness.lab_factory(),
                readiness=self.readiness,
                prompt=prompt,
                model=run["model"] or None,
                emit=emit,
                cancel=control.async_cancel,
                submission=submission,
            )
        self.accept_session(run, output)
        answer = (output.get("answer") or "").strip()
        if not answer:
            raise RuntimeError("Gemini ACP kết thúc lượt mà không trả nội dung.")
        runtime.message(run, answer)

    def prepare(self, conversation_id, file_ids, folder):
        prepared = []
        for file_id in file_ids:
            record = self.store.get("files", file_id)
            if not record or not can_use_file(record, conversation_id):
                raise PermissionError("Workbook không thuộc yêu cầu hiện tại.")
            source = Path(record["path"])
            if not contained(source, self.config.uploads) or not source.is_file():
                raise PermissionError("Workbook không còn trong thư mục tải lên.")
            snapshot = workbook.snapshot(source)
            truth = workbook.ground_truth(source)
            if not truth["available"]:
                raise ValueError(f"{record['name']}: {truth['reason']}")
            snapshot_bytes = json.dumps(
                snapshot, ensure_ascii=False, sort_keys=True
            ).encode()
            snapshot_path = folder / f"{file_id}.json"
            snapshot_path.write_bytes(snapshot_bytes)
            prepared.append(
                (
                    record,
                    source,
                    snapshot,
                    truth,
                    snapshot_path,
                    workbook.sha256(snapshot_bytes),
                )
            )
        return prepared

    async def execute(self, runtime, run, content, file_ids, skill_sources, control):
        policy, prefix, submission = await self.skill_context(
            runtime, run, skill_sources, content
        )
        with TemporaryDirectory(
            prefix="chat-workbook-", dir=self.config.root
        ) as folder:
            prepared = await asyncio.to_thread(
                self.prepare, run["conversation_id"], file_ids, Path(folder)
            )
            await control.checkpoint()
            await runtime.approve_provider_request(
                run,
                control,
                "Google Antigravity (Gemini ACP)",
                "Cho phép gửi yêu cầu, Skill đã kiểm tra và dữ liệu bảng tính do công cụ đọc tới Gemini?",
            )
            self.confirm_snapshot(runtime, run)
            async with self.readiness.lock:
                for record, source, snapshot, truth, path, digest in prepared:
                    await control.checkpoint()
                    prompt = prefix + task_frame(content, record["name"])

                    async def emit(event_type, message, status="completed", **kwargs):
                        result = kwargs.pop("result", {})
                        await runtime.emit(
                            run,
                            event_type,
                            message,
                            status=status,
                            result={**result, "source_file_id": record["id"]},
                            **kwargs,
                        )

                    output = await run_condition(
                        lab=self.readiness.lab_factory(),
                        readiness=self.readiness,
                        snapshot_path=path,
                        snapshot_sha=digest,
                        resolved=policy,
                        prompt=prompt,
                        model=run["model"] or None,
                        emit=emit,
                        cancel=control.async_cancel,
                        submit_event=submission,
                        adapter_factory=self.readiness.adapter_factory,
                    )
                    self.accept_session(run, output)
                    if not output.get("report_path"):
                        raise RuntimeError(
                            "Gemini đã kết thúc phiên mà chưa tạo tệp Excel qua MCP."
                        )
                    if not output["isolation"].get("mcp_process", {}).get("verified"):
                        raise PermissionError(
                            "Không xác minh được tiến trình MCP trong AppContainer."
                        )
                    report = Path(output["report_path"])
                    report_sha, validation = await asyncio.to_thread(
                        validate_written_report,
                        report,
                        snapshot,
                        truth,
                        output["mcp_journal"],
                    )
                    if not validation["valid"] or not validation["matches_mcp_receipt"]:
                        raise ValueError(
                            "Excel do MCP tạo không khớp dữ liệu gốc hoặc biên nhận công cụ."
                        )
                    source_bytes = await asyncio.to_thread(source.read_bytes)
                    if workbook.sha256(source_bytes) != snapshot["source_sha256"]:
                        raise ValueError(
                            "Workbook gốc đã thay đổi khi Gemini đang xử lý."
                        )
                    await control.checkpoint()
                    destination = runtime.tools.report_output()
                    if (
                        runtime.policy.evaluate("write", str(destination.path)).outcome
                        != "allow"
                    ):
                        raise PermissionError(
                            "Đích lưu báo cáo nằm ngoài workspace được cấp quyền."
                        )
                    result = {
                        "file_id": destination.id,
                        "name": destination.path.name,
                        "source_file_id": record["id"],
                        "source_name": record["name"],
                        "rows": sum(len(sheet["rows"]) for sheet in snapshot["sheets"]),
                        "validation": {
                            "status": "verified",
                            "sha256": report_sha,
                            **validation,
                        },
                        "execution_engine": "acp_appcontainer",
                    }
                    updated = {
                        **run,
                        "result": result,
                        "reports": [*run.get("reports", []), result],
                    }
                    try:
                        shutil.copyfile(report, destination.path)
                        if workbook.sha256(destination.path.read_bytes()) != report_sha:
                            raise ValueError(
                                "Bản lưu báo cáo chưa khớp tệp đã xác minh."
                            )
                        with self.store.write_transaction() as db:
                            self.store.put_many(
                                "files",
                                [
                                    {
                                        "id": destination.id,
                                        "name": destination.path.name,
                                        "type": "xlsx",
                                        "size": destination.path.stat().st_size,
                                        "path": str(destination.path),
                                        "created_at": now(),
                                        "output": True,
                                    }
                                ],
                                connection=db,
                            )
                            self.store.put_many("tasks", [updated], connection=db)
                    except Exception:
                        destination.path.unlink(missing_ok=True)
                        raise
                    run.update(updated)
                    await emit(
                        "report.created",
                        "Đã xác minh Excel do Gemini tạo qua MCP",
                        source="mcp",
                        result=result,
                    )
                    runtime.message(
                        run,
                        f"**Gemini ACP · {record['name']}**\n\n{output.get('answer') or 'Đã tạo và xác minh báo cáo Excel.'}",
                    )
