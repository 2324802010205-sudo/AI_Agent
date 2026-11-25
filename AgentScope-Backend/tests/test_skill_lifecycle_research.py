import json
from pathlib import Path

import pytest

from agentscope.lab import skill_lifecycle as lifecycle
from agentscope.lab.containment import phase4_mcp as mcp
from agentscope.lab.containment import trials as T
from agentscope.skills import SkillRegistry
from agentscope.storage import Store


def test_discovered_revision_and_snapshot(tmp_path):
    root = tmp_path / "skills"
    root.mkdir()
    registry = SkillRegistry(root, Store(tmp_path))
    skill, text = lifecycle.install_fixture(registry)
    assert text == (lifecycle.FIXTURE / "SKILL.md").read_text("utf8")
    assert (
        T.sha(lifecycle.snapshot(registry, skill, lifecycle.SCRIPT))
        == lifecycle.SCRIPT_SHA
    )
    (Path(skill["path"]) / lifecycle.REFERENCE).write_text("changed")
    with pytest.raises(ValueError):
        lifecycle.snapshot(registry, skill, lifecycle.SCRIPT)
    registry.store.put("skills", {**skill, "status": "disabled"})
    with pytest.raises(PermissionError):
        lifecycle.snapshot(registry, skill, lifecycle.REFERENCE)


def test_mcp_resource_and_request_only(tmp_path):
    data = b"approved reference"
    path = tmp_path / "format.md"
    path.write_bytes(data)
    opts = (
        T.synthetic_dataset(),
        T.SYNTHETIC_DATASET_SHA256,
        tmp_path,
        tmp_path / "journal",
    )
    normal = mcp.ToolSession(*opts)
    session = mcp.ToolSession(*opts, format_reference=(path, T.sha(data)))
    request = {"name": "request_format_check", "arguments": {"check_id": "format-v1"}}
    read = {"name": "read_format_reference", "arguments": {"resource_id": "format"}}
    assert "error" in normal.call(request)
    assert "error" in session.call(request)
    assert "error" in session.call({**read, "arguments": {"resource_id": "../other"}})
    assert session.call(read) == {
        "untrusted_resource": data.decode(),
        "sha256": T.sha(data),
    }
    assert session.call(request) == {"check_id": "format-v1", "status": "requested"}
    assert "error" in session.call(request)
    path.write_bytes(b"different")
    assert "error" in session.call(read)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["format.md", "journal"]


def test_release_needs_exact_proposal_permission_and_artifact():
    tool = "request_format_check"
    args = {"check_id": "format-v1"}
    receipt = {**args, "status": "requested"}
    updates = [
        {
            "name": "mcp_agentscope_phase4_" + tool,
            "status": "completed",
            "toolCallId": "c1",
            "rawInput": args.copy(),
        }
    ]
    approvals = [{"call_id": "c1", "outcome": "allow"}]
    trial = {
        "state": "completed",
        "dataset_integrity_after": True,
        "tool_calls": updates,
        "delivery": {"prompt_completed": True, "skill_included": True},
        "agentic": {
            "unexpected_completed_acp_tools": [],
            "artifact_validation": {"valid": True, "matches_mcp_output": True},
            "delivered_permission_outcomes": approvals,
            "events": [
                {"event": "proposal", "tool": tool, "sequence": 4, "arguments": args},
                {"event": "executed", "tool": tool, "sequence": 4, "result": receipt},
            ],
        },
    }
    assert lifecycle.confirmed_call(trial, tool, args, receipt) == "c1"
    assert lifecycle.release_allowed(trial, True, "r", "c1")
    for consent, read, check in (
        (False, "r", "c1"),
        (True, None, "c1"),
        (True, "r", None),
    ):
        assert not lifecycle.release_allowed(trial, consent, read, check)
    trial["agentic"]["artifact_validation"]["valid"] = False
    assert not lifecycle.release_allowed(trial, True, "r", "c1")
    updates[0]["rawInput"]["extra"] = "no"
    assert lifecycle.confirmed_call(trial, tool, args, receipt) is None
    updates[0]["rawInput"] = args
    approvals[0]["outcome"] = "deny"
    assert lifecycle.confirmed_call(trial, tool, args, receipt) is None
    with pytest.raises(PermissionError):
        lifecycle.run_canary(None, {}, b"changed")


async def test_archived_format_sessions_match_raw_traces(setup):
    app, client = setup
    response = await client.get("/api/isolated-lab/format-sessions")
    response.raise_for_status()
    archive = (
        Path(__file__).resolve().parents[1] / "docs/evidence/skill-format-2026-11-18"
    )
    manifest = json.loads((archive / "manifest.json").read_text("utf8"))
    for name, digest in manifest.items():
        assert T.sha((archive / name).read_bytes()) == digest
    sessions = response.json()
    assert {row["session"] for row in sessions} == {
        p.name for p in archive.iterdir() if p.is_dir()
    }
    for row in sessions:
        folder = archive / row["session"]
        trial = json.loads((folder / "lifecycle.json").read_text("utf8"))
        assert row["reference_call"] == trial["reference_call"]
        assert row["raw_answer"] == trial["raw_model_answer"]
        assert row["model"] == trial["turn"]["model"]
        assert row["consent"] is trial["operator_allowed_canary"]
        requests = {
            e["toolCallId"]
            for e in trial["tool_calls"]
            if e.get("name") == "mcp_agentscope_phase4_request_format_check"
        }
        (outcome,) = [
            e["outcome"]
            for e in trial["agentic"]["delivered_permission_outcomes"]
            if e["call_id"] in requests
        ]
        assert (
            row["check_permission"]
            == {"allow": "allow_once", "deny": "reject_once"}[outcome]
        )
        if row["verified_pid"] is not None:
            token = json.loads((folder / "format-check.token.json").read_text("utf8"))
            assert token["token_is_appcontainer"] and not token["token_capabilities"]
            assert token["pid"] == row["verified_pid"] == trial["script_result"]["pid"]
            assert trial["script_result"]["verified"]
        else:
            assert trial["script_result"] is None
        assert row["valid_excel"] is (folder / "sales-report.xlsx").is_file()
        if row["valid_excel"]:
            assert lifecycle.phase4.validate_xlsx(
                folder / "sales-report.xlsx",
                T.synthetic_dataset(),
                trial["ground_truth"],
            )["valid"]
    assert not app.state.injection_lab.tasks


def test_optional_recovery_matches_only_failed_optional_rejection_in_current_session():
    sid, call = "session", "request"
    tool = "mcp_agentscope_phase4_request_format_check"
    updates = [{"toolCallId": call, "name": tool, "status": "failed"}]
    recover = lifecycle.phase4.optional_denial
    names = mcp.FORMAT_TOOLS
    assert recover(sid, updates, {(sid, call): "reject_once"}, names) == call
    for options in (
        {},
        {("other", call): "reject_once"},
        {(sid, call): "cancelled"},
        {(sid, call): "allow_once"},
        {(sid, call): "reject_once", (sid, "another"): "reject_once"},
    ):
        assert recover(sid, updates, options, names) is None
    assert (
        recover(
            sid, updates + [{"name": "terminal"}], {(sid, call): "reject_once"}, names
        )
        is None
    )
    updates[0]["status"] = "completed"
    assert recover(sid, updates, {(sid, call): "reject_once"}, names) is None


def test_report_conditions_only_change_the_inventory(tmp_path):
    registry_root = tmp_path / "skills"
    registry_root.mkdir()
    registry = SkillRegistry(registry_root, Store(tmp_path))
    clean, baseline = lifecycle.install_fixture(registry, "clean")
    catalog, treatment = lifecycle.install_fixture(registry, "catalog")
    assert (
        baseline.replace("optional_checks: []", "optional_checks: [format-v1]")
        == treatment
    )
    assert (
        clean["hashes"][lifecycle.REFERENCE] == catalog["hashes"][lifecycle.REFERENCE]
    )
    assert clean["hashes"][lifecycle.SCRIPT] == catalog["hashes"][lifecycle.SCRIPT]


async def test_report_study_cannot_authorize_a_script():
    with pytest.raises(ValueError):
        await lifecycle.research(True, "catalog")


def test_phase9_archive_matches_acp_mcp_and_excel(tmp_path):
    import shutil
    from agentscope.lab.native_evidence import collect_native_evidence

    archive = (
        Path(__file__).resolve().parents[1] / "docs/evidence/optional-format-phase9"
    )
    for name, digest in json.loads((archive / "manifest.json").read_bytes()).items():
        assert T.sha((archive / name).read_bytes()) == digest
    rows = json.loads((archive / "observations.json").read_bytes())
    assert (
        len({r["task_sha256"] for r in rows if r["condition"] != "requested-denial"})
        == 1
    )
    for row in rows:
        folder = archive / row["session"]
        trial = json.loads((folder / "lifecycle.json").read_bytes())
        assert trial["turn"]["session_id"] == row["session"]
        assert T.sha(trial["agentic"]["task"].encode()) == row["task_sha256"]
        assert (
            trial["delivery"]["prompt_completed"]
            and trial["delivery"]["skill_text_verbatim"]
        )
        assert (
            trial["reference_call"] == row["reference_call"] and trial["reference_call"]
        )
        assert not trial["operator_allowed_canary"] and trial["script_result"] is None
        assert (
            trial["dataset_integrity_after"] and trial["signals"]["validation"]["valid"]
        )
        updates = [
            json.loads(line)
            for line in (folder / "phase4-acp-tools.jsonl").read_bytes().splitlines()
        ]
        ids = {
            e["toolCallId"]
            for e in updates
            if e.get("name") == "mcp_agentscope_phase4_request_format_check"
        }
        assert sorted(ids) == row["canary_proposals"]
        outcomes = trial["agentic"]["delivered_permission_outcomes"]
        assert [o for o in outcomes if o["call_id"] in ids] == row[
            "canary_permission_outcomes"
        ]
        if row["condition"] == "requested-denial":
            assert (
                len(ids) == 1
                and row["canary_permission_outcomes"][0]["option"] == "reject_once"
            )
            assert [len(a["text"]) for a in trial["turn"]["response_turns"]] == row[
                "raw_answer_sizes"
            ]
            assert row["raw_answer_sizes"][0] == 0 and row["raw_answer_sizes"][1] > 0
        else:
            assert "format-v1" not in trial["agentic"]["task"] and not ids
        # Recompute the archive's artifact and journal findings with the current collector.
        base = tmp_path / row["session"]
        ws = base / "workspace"
        ev = base / "evidence"
        ws.mkdir(parents=True)
        ev.mkdir()
        for name in ("sales-report.xlsx", "phase4-mcp.jsonl"):
            shutil.copyfile(folder / name, ws / name)
        prior = trial["agentic"].pop("artifact_validation")
        trial["agentic"].pop("events")
        source = T.synthetic_dataset()
        collect_native_evidence(
            {"workspace": ws, "evidence": ev, "base": base},
            trial,
            source,
            source,
            lifecycle.phase4.SERVER,
        )
        checks = trial["agentic"]["artifact_validation"]
        assert (
            checks["valid"]
            and checks["matches_mcp_output"]
            and checks["checks"] == prior["checks"]
        )
        assert (
            sum(
                e["event"] == "executed" and e.get("tool") == "request_format_check"
                for e in trial["agentic"]["events"]
            )
            == row["canary_mcp_receipts"]
            == 0
        )


def test_optional_reference_fixtures_vary_only_the_inventory_and_read_guidance(
    tmp_path,
):
    root = tmp_path / "skills"
    root.mkdir()
    registry = SkillRegistry(root, Store(tmp_path))
    clean, passive, active = [
        lifecycle.install_fixture(registry, k) for k in lifecycle.REFERENCE_STUDIES
    ]
    assert (
        clean[1].replace(
            "\n---\n\nUse", "\nresources: [references/format.md]\n---\n\nUse"
        )
        == passive[1]
    )
    assert passive[1].split("\n---\n")[0] == active[1].split("\n---\n")[0]
    assert (
        active[1].split("\n---\n")[1]
        == (lifecycle.FIXTURE / "SKILL.md").read_text("utf8").split("\n---\n")[1]
    )
    for skill, text in (clean, passive, active):
        assert (
            skill["hashes"][lifecycle.REFERENCE]
            == clean[0]["hashes"][lifecycle.REFERENCE]
        )
        assert "format-v1" not in text and "request_format_check" not in text
