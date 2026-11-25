"""Research plans are safe on the host; real execution is guest-gated separately."""

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Literal
from uuid import uuid4
import zipfile

from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from ..models import Event
from .. import __version__
from ..skills import SkillRegistry
from ..policy import contained
from .environment import EnvironmentVerifier
from .evidence import digest
from .runner import run_trial
from .scenarios import SCENARIOS, TASK, catalog


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workspace: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$")
    model: str = Field(pattern=r"^[A-Za-z0-9._-]{1,100}$")
    execution_mode: Literal["default", "auto"] = "default"
    scenario: Literal[
        "benign-control",
        "supplemental-document",
        "report-synchronization",
        "imported-skill",
    ]
    skill_id: str | None = None
    dataset_id: str
    hypothesis: Literal["none", "read-separate-document", "write-separate-report"] = (
        "none"
    )


class TrialRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["baseline", "protected"]
    disposable_vm_consent: bool = False


def utc():
    return datetime.now(timezone.utc).isoformat()


class LabService:
    def __init__(self, config, store):
        self.config, self.store = config, store
        self.root = config.root / "research-lab"
        self.verifier = EnvironmentVerifier(self.root)
        self.active = {}

    def plan_path(self, identifier):
        if (
            not isinstance(identifier, str)
            or len(identifier) != 32
            or any(c not in "0123456789abcdef" for c in identifier)
        ):
            raise HTTPException(404, "Không tìm thấy kế hoạch lab")
        return self.root / "plans" / identifier

    def load(self, identifier):
        path = self.plan_path(identifier) / "plan.json"
        if not path.is_file():
            raise HTTPException(404, "Không tìm thấy kế hoạch lab")
        return json.loads(path.read_text("utf-8"))

    def save(self, plan):
        path = self.plan_path(plan["id"]) / "plan.json"
        temporary = path.with_suffix(".partial")
        temporary.write_text(
            json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        temporary.replace(path)

    @staticmethod
    def public(plan):
        # Full Skill/data are exportable; never returned accidentally in list views.
        return {k: v for k, v in plan.items() if k != "skill_text"}

    def list(self):
        folder = self.root / "plans"
        if not folder.exists():
            return []
        return [
            self.public(json.loads(p.read_text("utf-8")))
            for p in sorted(folder.glob("*/plan.json"), reverse=True)
        ]

    async def status(self):
        result = await self.verifier.inspect()
        result.pop("_permit", None)
        result.update(
            production_skill_guard_unchanged=True,
            guest_runner_validation="not_guest_qualified_in_this_release",
            scenarios=catalog(),
            supported_requested_modes=["default", "auto"],
            mode_limitation="Mode chỉ chạy nếu session guest quảng bá và báo lại đúng lựa chọn. Không kế thừa Auto từ terminal host.",
            config_path=str(self.verifier.config_path),
        )
        return result

    def prepare(self, body: PlanRequest):
        record = self.store.get("files", body.dataset_id)
        if (
            not record
            or record.get("output")
            or Path(record["name"]).suffix.lower() != ".xlsx"
        ):
            raise ValueError(
                "Chọn một workbook .xlsx đã upload và được phép dùng cho nghiên cứu"
            )
        source = Path(record["path"])
        if (
            not contained(source, self.config.uploads)
            or not source.is_file()
            or source.stat().st_size > 20 * 1024 * 1024
        ):
            raise ValueError("Dataset không tồn tại hoặc vượt giới hạn")
        if body.scenario == "imported-skill":
            skill = self.store.get("skills", body.skill_id or "")
            if not skill or skill["status"] != "approved":
                raise ValueError(
                    "Skill nghiên cứu phải được nhập, review và phê duyệt trước"
                )
            SkillRegistry(self.config.skills, self.store).verify(skill)
            skill_bytes = (Path(skill["path"]) / "SKILL.md").read_bytes()
            origin = {
                "kind": "approved_registry",
                "id": skill["id"],
                "name": skill["name"],
            }
            injection = body.hypothesis != "none"
        else:
            scenario = SCENARIOS[body.scenario]
            skill_bytes = scenario["skill"].encode()
            origin = {"kind": "fixed_research_fixture", "id": body.scenario}
            injection = scenario["injection_present"]
        identifier = uuid4().hex
        folder = self.plan_path(identifier)
        folder.mkdir(parents=True)
        dataset = source.read_bytes()
        (folder / "input.xlsx").write_bytes(dataset)
        (folder / "SKILL.md").write_bytes(skill_bytes)
        plan = {
            "id": identifier,
            "created_at": utc(),
            "state": "planned_not_run",
            "evidence_level": "not_run",
            "workspace": body.workspace,
            "model": body.model,
            "execution_mode": body.execution_mode,
            "scenario": body.scenario,
            "hypothesis": body.hypothesis,
            "injection_present": injection,
            "task": TASK,
            "task_sha256": digest(TASK.encode()),
            "skill_origin": origin,
            "skill_text": skill_bytes.decode("utf-8"),
            "skill_sha256": digest(skill_bytes),
            "dataset_name": record["name"],
            "dataset_sha256": digest(dataset),
            "trials": {},
            "backend_version": __version__,
            "comparison_limits": [
                "Separate fresh directories have different absolute paths",
                "Model sampling is nondeterministic",
                "VM checkpoint restore is an external operator step; this UI does not automate or attest rollback",
                "CLI caches/login refresh may differ; no equivalence claim without guest qualification",
            ],
        }
        self.save(plan)
        self.store.event(
            Event(
                run_id="lab-" + identifier,
                event_type="lab.plan.created",
                source="research-lab",
                status="completed",
                message="Đã lưu kế hoạch lab; chưa chạy mô hình hoặc thao tác tấn công",
                result={
                    "evidence_level": "not_run",
                    "skill_sha256": plan["skill_sha256"],
                    "dataset_sha256": plan["dataset_sha256"],
                },
            )
        )
        return self.public(plan)

    async def start(self, identifier, body):
        plan = self.load(identifier)
        if plan.get("backend_version") != __version__:
            raise HTTPException(
                409,
                "Tạo kế hoạch mới sau khi đổi phiên bản backend; bằng chứng cũ vẫn được giữ",
            )
        if not body.disposable_vm_consent:
            raise HTTPException(
                400,
                "Cần xác nhận phạm vi VM disposable; xác nhận này không thay thế kiểm tra isolation",
            )
        if self.active:
            raise HTTPException(409, "Chỉ chạy một lượt nghiên cứu tại một thời điểm")
        if body.role in plan["trials"]:
            raise HTTPException(
                409,
                "Vai trò này đã có lượt chạy. Tạo kế hoạch mới để lặp, không ghi đè bằng chứng",
            )
        try:
            permit = await self.verifier.require()
        except PermissionError as error:
            self.store.event(
                Event(
                    run_id="lab-" + identifier,
                    event_type="lab.environment.locked",
                    source="research-lab",
                    status="blocked",
                    message=str(error),
                    result={
                        "trial_counted": False,
                        "protection": "environment_gate",
                        "defense_success": False,
                    },
                )
            )
            raise HTTPException(403, str(error)) from error
        if plan["scenario"] != "benign-control":
            controls = [
                p
                for p in self.list()
                if p["scenario"] == "benign-control"
                and p["model"] == plan["model"]
                and p["execution_mode"] == plan["execution_mode"]
                and p["dataset_sha256"] == plan["dataset_sha256"]
            ]
            qualified = any(
                (t := control["trials"].get(body.role, {})).get("evidence_level")
                == "real_model_observed"
                and t.get("environment", {}).get("guest_uuid")
                == permit.facts["guest_uuid"]
                and t.get("environment", {}).get("snapshot_id")
                == permit.facts["snapshot_id"]
                and t.get("audit_complete")
                and t.get("generated_reports")
                and {"read_spreadsheet", "analyze_spreadsheet", "generate_report"}
                <= set(t.get("legitimate_tools_completed", []))
                for control in controls
            )
            if not qualified:
                raise HTTPException(
                    409,
                    "Chạy đối chứng benign với đủ ba tool, cùng guest/snapshot/model/mode/dataset trước khi thử injection",
                )
        # Bytes are re-verified at the last host/guest boundary before any actor starts.
        folder = self.plan_path(identifier)
        if (
            digest((folder / "input.xlsx").read_bytes()) != plan["dataset_sha256"]
            or digest((folder / "SKILL.md").read_bytes()) != plan["skill_sha256"]
        ):
            raise HTTPException(409, "Dataset hoặc Skill của kế hoạch đã thay đổi")
        plan["state"] = "running"
        plan["trials"][body.role] = {
            "state": "environment_conformance_pending",
            "evidence_level": "not_run",
        }
        self.save(plan)

        async def execute():
            try:
                trial = await run_trial(self.verifier, plan, body.role, folder)
                plan["trials"][body.role] = trial
                plan["state"] = (
                    "review_required"
                    if trial.get("stopped_after_operation")
                    else "finished"
                )
            except BaseException as error:
                plan["trials"][body.role] = {
                    "evidence_level": "not_run",
                    "error": type(error).__name__,
                    "state": "setup_failed_no_model_claim",
                }
                plan["state"] = "failed"
            finally:
                self.save(plan)
                self.active.pop(identifier, None)

        operation = asyncio.create_task(execute())
        self.active[identifier] = operation
        return self.public(plan)

    async def shutdown(self):
        for task in list(self.active.values()):
            task.cancel()
        await asyncio.gather(*list(self.active.values()), return_exceptions=True)

    def uses_skill(self, identifier: str) -> bool:
        return any(
            (origin := self.load(plan_id)["skill_origin"])["kind"]
            == "approved_registry"
            and origin["id"] == identifier
            for plan_id in self.active
        )

    def export(self, identifier):
        plan = self.load(identifier)
        folder = self.plan_path(identifier)
        output = folder / "security-evidence.zip"
        report = [
            "# AgentScope Security Research Lab",
            "",
            "Evidence labels are separate: not_run, real_file_conformance, real_model_observed, independent Windows witness.",
            "Printed strings are never exploit evidence. Model noncompliance is never SkillGuard prevention.",
            "",
            f"Plan: {identifier}",
            f"Model: {plan['model']}; requested mode: {plan['execution_mode']}",
            f"Skill SHA-256: {plan['skill_sha256']}",
            f"Dataset SHA-256: {plan['dataset_sha256']}",
            "",
            "| Role | Evidence | Outcome |",
            "| --- | --- | --- |",
        ]
        real_trials = 0
        for role in ("baseline", "protected"):
            trial = plan["trials"].get(role, {})
            counted = trial.get(
                "evidence_level"
            ) == "real_model_observed" and trial.get("prompt_delivered")
            real_trials += int(bool(counted))
            report.append(
                f"| {role} | {trial.get('evidence_level', 'not_run')} | {trial.get('outcome', {}).get('classification', 'not_run')} |"
            )
        report += [
            "",
            f"Real model trials with submitted prompts: {real_trials}",
            "",
            "Comparison limits:",
            *["- " + s for s in plan["comparison_limits"]],
        ]
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(folder / "plan.json", "plan.json")
            archive.write(folder / "SKILL.md", "SKILL.md")
            archive.write(folder / "input.xlsx", "input.xlsx")
            archive.writestr("REPORT.md", "\n".join(report))
            for role, trial in plan["trials"].items():
                archive.writestr(
                    f"trials/{role}/result.json",
                    json.dumps(trial, ensure_ascii=False, indent=2),
                )
                # Only copy known observer artifacts inside the configured guest root.
                if trial.get("root") and self.verifier.config_path.exists():
                    config = json.loads(self.verifier.config_path.read_text("utf-8"))
                    trial_root = Path(trial["root"]).resolve()
                    allowed = (Path(config["lab_root"]) / "trials").resolve()
                    if allowed in trial_root.parents:
                        for name in ("events.jsonl", "submitted-prompt.json"):
                            source = trial_root / "observer" / name
                            if source.is_file():
                                archive.write(source, f"trials/{role}/{name}")
        return output


def register_lab_routes(app, config, store):
    service = LabService(config, store)
    app.state.research_lab = service

    @app.get("/api/lab/status")
    async def status():
        return await service.status()

    @app.get("/api/lab/plans")
    async def plans():
        return service.list()

    @app.post("/api/lab/plans")
    async def prepare(body: PlanRequest):
        return service.prepare(body)

    @app.get("/api/lab/plans/{identifier}")
    async def plan(identifier: str):
        return service.public(service.load(identifier))

    @app.post("/api/lab/plans/{identifier}/run")
    async def run(identifier: str, body: TrialRequest):
        return await service.start(identifier, body)

    @app.get("/api/lab/plans/{identifier}/export")
    async def export(identifier: str):
        return FileResponse(
            service.export(identifier),
            filename=f"agentscope-lab-{identifier[:8]}.zip",
            media_type="application/zip",
        )
