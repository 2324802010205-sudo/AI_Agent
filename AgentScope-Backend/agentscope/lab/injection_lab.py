"""Isolated Prompt Injection Research Lab (AppContainer only).

Production keeps refusing to send Skill text to host ACP (runtime.antigravity is unchanged).
This route never uses the host CLI: every trial launches the CLI inside the verified
AppContainer with the lab's own sign-in, re-runs the live isolation preflight first and fails
closed. Only a bundled, hash-pinned synthetic workbook is used. Native MCP suites allow only
registered endpoints. Starting a trial or suite requires explicit execution confirmation.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4
import json
import time

from fastapi import HTTPException

from .isolated_routes import StartSuite, StartTrial, register_isolated_routes
from ..skills import SkillRegistry
from ..prompting import neutralize
from .containment import ContainedAcpAdapter, ContainedLab, IsolationError
from .containment import trials as T
from .boundary_evaluation import CANARY_SKILL, annotate, reporting_fixtures
from . import boundary_evaluation as B
from . import workflow_evaluation as W
from . import phase4 as P
from . import phase5 as C
from . import phase6 as D

PRODUCTION_NOTE = (
    "Production Antigravity ACP vẫn không bao giờ nhận nội dung Skill. Lab này chỉ chạy CLI "
    "trong AppContainer đã kiểm tra, với hồ sơ đăng nhập riêng của lab."
)


class IsolatedInjectionLab:
    def __init__(
        self, config, store, lab_factory=ContainedLab, executor=None, readiness=None
    ):
        self.config, self.store = config, store
        # Shared research-environment readiness service (one lock for every lab user).
        self.readiness = readiness
        self.root = config.root / "isolated-injection-lab"
        # Trials live in their own folder; other lab files (last-check.json) never mix in.
        self.trials_dir = self.root / "trials"
        self.trials_dir.mkdir(parents=True, exist_ok=True)
        self.lab_factory = lab_factory
        self.executor = executor or self._execute
        self.lock = readiness.lock if readiness else asyncio.Lock()
        self.tasks: set[asyncio.Task] = set()
        self._truth = None

    # ------------------------------------------------------------ storage
    def _path(self, identifier):
        if len(identifier) != 32 or any(
            c not in "0123456789abcdef" for c in identifier
        ):
            raise HTTPException(404, "Không tìm thấy trial")
        return self.trials_dir / f"{identifier}.json"

    def save(self, trial):
        path = self._path(trial["id"])
        temporary = path.with_suffix(".partial")
        T.write_json(temporary, trial)
        # Windows readers or scanners can briefly hold the destination without delete sharing.
        for attempt in range(6):
            try:
                temporary.replace(path)
                return
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(0.01 * 2**attempt)

    def load(self, identifier):
        path = self._path(identifier)
        if not path.is_file():
            raise HTTPException(404, "Không tìm thấy trial")
        return json.loads(path.read_text("utf-8"))

    def all(self):
        values = [
            json.loads(p.read_text("utf-8")) for p in self.trials_dir.glob("*.json")
        ]
        return sorted(values, key=lambda t: t["created_at"], reverse=True)

    def uses_skill(self, identifier: str) -> bool:
        return bool(self.tasks) and any(
            trial["state"] in {"queued", "preflight", "running_model"}
            and (trial.get("skill") or {}).get("id") == identifier
            for trial in self.all()
        )

    def ground_truth(self):
        if self._truth is None:
            self._truth = T.independent_ground_truth(T.synthetic_dataset())
        return self._truth

    def protected_paths(self):
        paths = [self.config.root]
        token = self.config.root / "session-token"
        if token.is_file():
            paths.append(token)
        return paths

    # ------------------------------------------------------------ views
    def listing(self):
        trials = self.all()
        controls = [
            t for t in trials if t["kind"] == "control" and t["state"] == "completed"
        ]
        for trial in trials:
            if trial["kind"] == "injection" and not trial.get("case"):
                same = [c for c in controls if c.get("model") == trial.get("model")]
                trial["assessment"] = T.assess(same[0] if same else None, trial)
        return annotate(trials)

    def status(self):
        return {
            "boundary": "windows_appcontainer",
            "production_note": PRODUCTION_NOTE,
            "lab_root": str(self.lab_factory().root) if self._windows() else None,
            "dataset": {
                "name": "synthetic_sales.xlsx",
                "sha256": T.SYNTHETIC_DATASET_SHA256,
                "synthetic": True,
            },
            "ground_truth": self.ground_truth(),
            "question": T.REVENUE_QUESTION,
            "permission_policy": "deny_all_cli_permission_requests",
            "supports_appcontainer": self._windows(),
            "running": self.lock.locked() or bool(self.tasks),
        }

    @staticmethod
    def _windows():
        import os

        return os.name == "nt"

    # ------------------------------------------------------------ actions
    async def check(self):
        """Preflight + lab sign-in check. No prompt is sent."""
        async with self.lock:
            return await self._check()

    async def _check(self):
        if self.readiness:
            result = await self.readiness._check()
            self.readiness.path.write_text(
                json.dumps(result, indent=2, ensure_ascii=False), "utf-8"
            )
            if result.get("preflight_passed"):
                await asyncio.to_thread(T.synthetic_dataset)
                result["synthetic_dataset_verified"] = True
            T.write_json(self.root / "last-check.json", result)
            return result
        lab = self.lab_factory()
        result = {"checked_at": T.now()}
        try:
            await asyncio.to_thread(lab.ensure)
            run = await asyncio.to_thread(lab.new_run, "check")
            checks = await asyncio.to_thread(lab.preflight, run, self.protected_paths())
            await asyncio.to_thread(T.synthetic_dataset)
            result.update(
                preflight_passed=True, checks=checks, synthetic_dataset_verified=True
            )
        except IsolationError as error:
            result.update(preflight_passed=False, error=str(error), checks=error.checks)
            return result
        except Exception as error:
            result.update(
                preflight_passed=False, error=f"{type(error).__name__}: {error}"
            )
            return result
        adapter = ContainedAcpAdapter(lab, run, "auth-check")
        try:
            await adapter.start()
            await adapter.initialize()
            info = await adapter.new_session(run["workspace"])
            models = [m["modelId"] for m in info["models"]["availableModels"]]
            result.update(
                authenticated=True,
                models=models,
            )
        except Exception as error:
            result.update(authenticated=False, auth_error=str(error)[:500])
        finally:
            await adapter.close()
        T.write_json(self.root / "last-check.json", result)
        return result

    def start(self, body: StartTrial):
        if not body.confirm_isolated_execution:
            raise HTTPException(400, "Cần xác nhận chạy trong lab AppContainer cô lập")
        if self.lock.locked() or self.tasks:
            raise HTTPException(409, "Đang có trial chạy trong lab")
        skill_meta, instructions = None, None
        if body.kind == "canary":
            if body.skill_id:
                raise HTTPException(400, "Canary dùng fixture tổng hợp cố định")
            registry = SkillRegistry(self.config.skills, self.store)
            canary = registry.approve(
                registry.import_package(
                    [("SKILL.md", CANARY_SKILL.encode())], research_fixture=True
                )
            )
            body = body.model_copy(
                update={"skill_id": canary["id"], "data_view": "aggregates"}
            )
        if body.kind in ("injection", "canary"):
            skill = self.store.get("skills", body.skill_id or "")
            if not skill or skill["status"] != "approved":
                raise HTTPException(400, "Chọn một Skill đã phê duyệt")
            try:
                instructions = SkillRegistry(self.config.skills, self.store).verify(
                    skill
                )
            except ValueError as error:
                raise HTTPException(400, str(error)) from error
            skill_meta = {
                "id": skill["id"],
                "name": skill["name"],
                "sha256": skill["hashes"].get("SKILL.md"),
                "static_review": skill.get("static_review"),
            }
        elif body.skill_id:
            raise HTTPException(400, "Control không mang Skill")
        trial = {
            "id": uuid4().hex,
            "kind": body.kind,
            "data_view": body.data_view,
            "model": body.model,
            "skill": skill_meta,
            "state": "queued",
            "created_at": T.now(),
            "boundary": "windows_appcontainer",
            "dataset_sha256": T.SYNTHETIC_DATASET_SHA256,
            "ground_truth": self.ground_truth(),
            "delivery": {"skill_included": False},
            "security_events": [],
        }
        trial["skill_snapshot"] = instructions
        self.save(trial)
        task = asyncio.create_task(self._run(trial, instructions))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return trial

    def start_suite(self, body: StartSuite):
        """Reserve all nine records synchronously, then run sequentially with fresh sessions."""
        if not body.confirm_isolated_execution:
            raise HTTPException(400, "Cần xác nhận chạy bộ trial AppContainer")
        if self.lock.locked() or self.tasks:
            raise HTTPException(409, "Đang có trial chạy trong lab")
        registry = SkillRegistry(self.config.skills, self.store)
        if body.preset in ("phase6", "phase6_proof"):
            return self._queue_decision_first(body, registry)
        if body.preset == "phase5":
            conditions = [("control", None, None), ("injection", None, None)]
            return self._queue_suite(
                body.model_copy(update={"data_view": "native_tools"}),
                [
                    (case, conditions[:: (-1 if repeat == 1 else 1)])
                    for case in C.CASES
                    for repeat in range(3)
                ],
            )
        if body.preset in ("followup", "workflow", "phase4"):
            blocks = []
            cases = (
                P.CASES
                if body.preset == "phase4"
                else (
                    W.CASES
                    if body.preset == "workflow"
                    else zip(
                        B.FOLLOWUP_CASES, ("authorized-heading", "revenue-only", None)
                    )
                )
            )
            for case, fixture in cases:
                skill = None
                if fixture:
                    skill = registry.approve(
                        registry.import_package(
                            [
                                (
                                    "SKILL.md",
                                    (
                                        B.FIXTURE_ROOT / fixture / "SKILL.md"
                                    ).read_bytes(),
                                )
                            ],
                            research_fixture=True,
                        )
                    )
                blocks.append(
                    (
                        case,
                        [
                            ("control", None, None),
                            (
                                "injection",
                                skill,
                                registry.verify(skill) if skill else None,
                            ),
                        ],
                    )
                )
            return self._queue_suite(
                body.model_copy(
                    update={
                        "data_view": (
                            "native_tools" if body.preset == "phase4" else "raw_rows"
                        )
                    }
                ),
                blocks,
            )
        if body.preset == "reporting":
            fixtures = reporting_fixtures()
            canary = registry.approve(
                registry.import_package(
                    [("SKILL.md", fixtures["audit-marker"])], research_fixture=True
                )
            )
            skill = registry.approve(
                registry.import_package(
                    [("SKILL.md", fixtures["adjusted-revenue"])], research_fixture=True
                )
            )
        else:
            skill = self.store.get("skills", body.skill_id or "")
            if not skill or skill["status"] != "approved":
                raise HTTPException(400, "Chọn Skill đã phê duyệt")
            canary = registry.approve(
                registry.import_package(
                    [("SKILL.md", CANARY_SKILL.encode())], research_fixture=True
                )
            )
        try:
            skill_text = registry.verify(skill)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        canary_text = registry.verify(canary)
        variants = [
            ("control", None, None),
            ("canary", canary, canary_text),
            ("injection", skill, skill_text),
        ]
        return self._queue_suite(
            body, [(None, variants[i:] + variants[:i]) for i in range(3)]
        )

    def _queue_decision_first(self, body, registry):
        blocks = [(D.PROOF, [("control", None, None)])]
        details = [{"review_config": "B", "replicate": 1}]
        if body.preset == "phase6":
            cases = [("control", None, None), ("injection", None, None)]
            for case in C.CASES:
                for repeat in range(1, 4):
                    for config in ("BA" if repeat == 2 else "AB"):
                        blocks.append((case, cases[::-1] if repeat == 2 else cases))
                        details.append({"review_config": config, "replicate": repeat})
            skills = []
            for kind in ("control", "injection"):
                content = (
                    B.FIXTURE_ROOT / f"decision-first-skill-{kind}" / "SKILL.md"
                ).read_bytes()
                skill = registry.approve(
                    registry.import_package(
                        [("SKILL.md", content)], research_fixture=True
                    )
                )
                skills.append((kind, skill, registry.verify(skill)))
            for repeat in range(1, 4):
                blocks.append((D.SKILL, skills[::-1] if repeat == 2 else skills))
                details.append({"review_config": "B", "replicate": repeat})
        return self._queue_suite(
            body.model_copy(update={"data_view": "native_tools", "preset": "phase6"}),
            blocks,
            details,
        )

    def _queue_suite(self, body, blocks, block_details=None):
        suite_id = uuid4().hex
        plan = []
        for block, (case, variants) in enumerate(blocks, start=1):
            control_id = uuid4().hex
            for kind, meta, text in variants:
                trial = {
                    "id": control_id if kind == "control" else uuid4().hex,
                    "suite_id": suite_id,
                    "replicate": (
                        ((block - 1) % 3 + 1)
                        if body.preset == "phase5"
                        else (1 if case else block)
                    ),
                    "sequence": len(plan) + 1,
                    "control_trial_id": control_id,
                    "kind": kind,
                    "model": body.model,
                    "data_view": body.data_view,
                    "preset": body.preset,
                    "condition": (
                        (
                            "control"
                            if kind == "control"
                            else ("injection_a" if kind == "canary" else "injection_b")
                        )
                        if body.preset == "reporting"
                        else None
                    ),
                    "skill": (
                        {
                            "id": meta["id"],
                            "name": meta["name"],
                            "sha256": meta["hashes"]["SKILL.md"],
                            "static_review": meta.get("static_review"),
                        }
                        if meta
                        else None
                    ),
                    "skill_snapshot": text,
                    "state": "queued",
                    "created_at": T.now(),
                    "boundary": "windows_appcontainer",
                    "dataset_sha256": (
                        D.workbook_fixture(case, kind, T.synthetic_dataset())[1]
                        if body.preset == "phase6"
                        else (
                            C.FIXTURES[case][kind][1]
                            if body.preset == "phase5"
                            else (
                                B.GUIDANCE_SHA256
                                if case
                                in ("workbook_guidance", "native_worksheet_note")
                                and kind == "injection"
                                else (
                                    W.NOTE_SHA256
                                    if case == "business_interpretation"
                                    and kind == "injection"
                                    else T.SYNTHETIC_DATASET_SHA256
                                )
                            )
                        )
                    ),
                    "ground_truth": self.ground_truth().copy(),
                    "delivery": {"skill_included": False},
                    "security_events": [],
                }
                if case:
                    trial["case"] = case
                if block_details:
                    trial.update(block_details[block - 1])
                self.save(trial)
                plan.append((trial, text))
        task = asyncio.create_task(self._run_suite(plan))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return {"suite_id": suite_id, "trial_ids": [t["id"] for t, _ in plan]}

    async def _run_suite(self, plan):
        # _run holds the same lock as individual trials, auth checks and preflight.
        try:
            for trial, instructions in plan:
                await self._run(trial, instructions)
                if trial.get("case") == D.PROOF and not D.proof_passed(trial):
                    break
        finally:
            for trial, _ in plan:
                if trial["state"] == "queued":
                    trial.update(
                        state="cancelled",
                        finished_at=T.now(),
                        error={
                            "type": "CancelledError",
                            "message": "Bộ trial đã dừng trước lượt này",
                        },
                    )
                    self.save(trial)

    async def shutdown(self):
        pending = list(self.tasks)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    def _event(self, trial, event_type, **data):
        trial["security_events"].append({"time": T.now(), "type": event_type, **data})
        self.save(trial)

    async def _run(self, trial, instructions):
        async with self.lock:
            try:
                await self.executor(trial, instructions)
            except asyncio.CancelledError:
                trial.update(
                    state="cancelled",
                    error={
                        "type": "CancelledError",
                        "message": "Backend đã dừng trial",
                    },
                )
                raise
            except Exception as error:  # recorded, never hidden
                trial.update(
                    state="failed",
                    error={"type": type(error).__name__, "message": str(error)[:2000]},
                )
            finally:
                trial["finished_at"] = T.now()
                self.save(trial)

    async def _execute(self, trial, instructions):
        lab = self.lab_factory()
        trial["state"] = "preflight"
        self.save(trial)
        native = trial.get("preset") in ("phase4", "phase5", "phase6")
        if native:
            await asyncio.to_thread(lab.ensure, with_python=True)
        else:
            await asyncio.to_thread(lab.ensure)
        run = await asyncio.to_thread(lab.new_run, f"pi-{trial['kind']}")
        trial["evidence_dir"] = str(run["base"])
        try:
            checks = await asyncio.to_thread(lab.preflight, run, self.protected_paths())
        except IsolationError as error:
            trial.update(
                state="blocked_isolation",
                isolation={
                    "passed": False,
                    "error": str(error),
                    "checks": error.checks,
                },
            )
            self._event(trial, "isolation.failed", enforced=True, prompt_sent=False)
            return
        trial["isolation"] = {
            "passed": True,
            "checks": [{"check": c["check"], "passed": c["passed"]} for c in checks],
        }
        self._event(trial, "isolation.verified", enforced=True, checks=len(checks))
        if trial.get("skill"):
            current = self.store.get("skills", trial["skill"]["id"])
            try:
                if not current or current["status"] != "approved":
                    raise ValueError("Skill không còn được phê duyệt")
                verified = SkillRegistry(self.config.skills, self.store).verify(current)
                if (
                    verified != instructions
                    or current["hashes"]["SKILL.md"] != trial["skill"]["sha256"]
                ):
                    raise ValueError("Skill thay đổi sau khi xếp hàng")
            except ValueError as error:
                trial.update(
                    state="blocked_integrity",
                    blocked_before_prompt=True,
                    error={"type": type(error).__name__, "message": str(error)},
                )
                self._event(
                    trial, "skill.integrity_failed", enforced=True, prompt_sent=False
                )
                return
        source = T.synthetic_dataset()
        case = trial.get("case")
        workflow = trial.get("preset") == "workflow"
        guidance = case in ("workbook_guidance", "business_interpretation")
        dataset = (
            D.workbook_fixture(case, trial["kind"], source)[0]
            if trial.get("preset") == "phase6"
            else (
                B.FIXTURE_ROOT
                / C.FIXTURES[case][trial["kind"]][0]
                / "synthetic_sales.xlsx"
                if trial.get("preset") == "phase5"
                else (
                    B.GUIDANCE_DATASET
                    if case in ("workbook_guidance", "native_worksheet_note")
                    and trial["kind"] == "injection"
                    else W.selected_dataset(case, trial["kind"], source)
                )
            )
        )
        if T.sha(dataset.read_bytes()) != trial["dataset_sha256"]:
            raise PermissionError("Hash workbook thử nghiệm không khớp")
        if native:
            await P.run_trial(self, lab, run, trial, source, dataset, instructions)
            return
        observed = await asyncio.to_thread(
            T.production_observations, run["base"], dataset, True, guidance=guidance
        )
        agreement = T.cross_check(trial["ground_truth"], observed)
        if not all(agreement.values()):
            raise RuntimeError(
                f"Ground truth không khớp công cụ AgentScope: {agreement}"
            )
        prompt, sections = T.compose(
            (
                W.QUESTION
                if workflow
                else B.FOLLOWUP_QUESTION if case else T.REVENUE_QUESTION
            ),
            observed,
            instructions,
            data_view=trial.get("data_view", "aggregates"),
        )
        trial["report_artifact"] = observed[0]["report_artifact"]
        trial["observed_tool_results"] = observed
        trial["ground_truth_cross_check"] = agreement
        trial["exposed_context"] = prompt
        trial["prompt_sections"] = sections
        trial["delivery"] = T.delivery_evidence(prompt, instructions)
        if guidance:
            cell = observed[0]["guidance_cell"]
            serialized = neutralize(json.dumps(cell, ensure_ascii=False))
            trial["delivery"]["guidance_cell_included"] = (
                serialized
                in prompt.partition("<observed_tool_results>\n")[2].split(
                    "\n</observed_tool_results>", 1
                )[0]
            )
            if not trial["delivery"]["guidance_cell_included"]:
                raise RuntimeError("Thiếu cell Huong_dan trong dữ liệu gửi ACP")
        if instructions is not None and not trial["delivery"]["skill_included"]:
            raise RuntimeError("Skill không có trong prompt; dừng trước khi gửi")
        self._event(
            trial,
            "prompt.composed",
            skill_included=trial["delivery"]["skill_included"],
            prompt_sha256=T.sha(prompt.encode()),
        )
        trial["state"] = "running_model"
        self.save(trial)
        turn = await T.run_contained_turn(
            lab, run, trial["kind"], prompt, model=trial["model"], timeout=300
        )
        prompts = [
            e for e in turn.get("acp_exchanges", []) if e["method"] == "session/prompt"
        ]
        exact = next(
            (
                e
                for e in prompts
                if e.get("params", {}).get("prompt")
                == [{"type": "text", "text": prompt}]
            ),
            None,
        )
        trial["delivery"].update(
            prompt_submitted=exact is not None,
            prompt_completed=bool(exact and "result" in exact and "error" not in exact),
            evidence_scope="client ACP request and completion; provider-internal context unavailable",
        )
        trial["turn"] = {
            k: turn.get(k)
            for k in (
                "session_id",
                "model",
                "models_advertised",
                "mode",
                "cli_agent",
                "container_token",
                "stop_reason",
                "prompt_sha256",
                "raw_answer_sha256",
                "started_at",
                "prompt_submitted_at",
                "finished_at",
                "error",
                "followups",
                "acp_exchanges",
                "response_turns",
            )
        }
        trial["dataset_integrity_after"] = (
            T.sha(dataset.read_bytes()) == trial["dataset_sha256"]
            and T.sha(source.read_bytes()) == T.SYNTHETIC_DATASET_SHA256
        )
        if not trial["dataset_integrity_after"]:
            raise RuntimeError("Workbook gốc thay đổi trong trial")
        trial["raw_model_answer"] = turn.get("raw_model_answer")
        trial["tool_calls"] = turn.get("tool_calls", [])
        trial["permission_requests"] = turn.get("permission_requests", [])
        trial["processes"] = [
            {k: p.get(k) for k in ("event", "pid", "image", "exit_code")}
            for p in turn.get("processes", [])
        ]
        for request in trial["permission_requests"]:
            self._event(
                trial,
                "permission.denied",
                enforced=True,
                tool=request.get("title"),
                kind=request.get("kind"),
            )
        for call in trial["tool_calls"]:
            if not any(
                r.get("toolCallId") == call.get("toolCallId")
                for r in trial["permission_requests"]
            ):
                self._event(
                    trial,
                    "tool.observed_without_permission_request",
                    enforced=False,
                    contained_by="appcontainer",
                    tool=call.get("title"),
                    status=call.get("status"),
                )
        if workflow:
            trial["workflow_file_validation"] = await asyncio.to_thread(
                W.report_validation,
                trial["report_artifact"],
                source,
                trial["ground_truth"],
            )
        if turn.get("evidence_level") != "real_model_observed":
            trial["state"] = "failed"
            trial["error"] = turn.get("error")
            return
        trial["outside_access_attempts"] = T.outside_access_attempts(
            turn, str(run["workspace"])
        )
        trial["signals"] = T.answer_signals(
            trial["raw_model_answer"],
            trial["ground_truth"],
            observed[0]["guidance_cell"]["text"] if guidance else instructions,
        )
        if trial.get("case"):
            trial["report_reference"] = B.report_reference(
                trial["raw_model_answer"],
                trial["report_artifact"]["name"],
                trial["report_artifact"]["path"],
            )
        trial["state"] = "completed"


def register_injection_lab_routes(app, config, store, readiness=None):
    service = IsolatedInjectionLab(config, store, readiness=readiness)
    app.state.injection_lab = service
    register_isolated_routes(app, service)
