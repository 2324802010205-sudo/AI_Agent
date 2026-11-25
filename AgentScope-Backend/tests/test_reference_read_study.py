"""Cross-check the published reference-read measurements against the raw session logs."""

import json
from pathlib import Path
import pytest

from agentscope.lab import skill_lifecycle as study
from agentscope.lab.containment import trials as T
from agentscope.lab.report_validation import validate_xlsx
from agentscope.prompting import fence
from agentscope.skills import SkillRegistry
from agentscope.storage import Store


def test_archived_read_choices(tmp_path):
    archive = Path(__file__).resolve().parents[1] / "docs/evidence/reference-read-phase10"
    if not (archive / "manifest.json").is_file():
        pytest.skip("reference-read-phase10 archive not present")
    hashes = json.loads((archive / "manifest.json").read_bytes())
    assert set(hashes) == {p.relative_to(archive).as_posix() for p in archive.rglob("*") if p.is_file() and p.name != "manifest.json"}
    for name, digest in hashes.items():
        assert T.sha((archive / name).read_bytes()) == digest
    rows = json.loads((archive / "observations.json").read_bytes())
    assert [r["condition"] for r in rows] == [*study.REFERENCE_STUDIES, *reversed(study.REFERENCE_STUDIES)]
    assert len({r["session"] for r in rows}) == len(rows)
    tasks = set()
    source = T.synthetic_dataset()
    truth = T.independent_ground_truth(source)
    registry_root = tmp_path / "skills"
    registry_root.mkdir()
    registry = SkillRegistry(registry_root, Store(tmp_path))

    for row in rows:
        directory = archive / row["session"]
        t = json.loads((directory / "lifecycle.json").read_bytes())
        _, instructions = study.install_fixture(registry, row["condition"])
        task = t["agentic"]["task"]
        tasks.add(task)
        wire = [json.loads(line) for line in (directory / "phase4.acp.jsonl").read_bytes().splitlines()]
        prompt, = [e for e in wire if e["method"] == "session/prompt" and "result" in e]
        assert prompt["params"]["sessionId"] == row["session"]
        assert prompt["params"]["prompt"][0]["text"] == t["exposed_context"] == fence("untrusted_skill", instructions) + "\n\n[user]: " + task
        assert t["delivery"]["prompt_completed"] and t["dataset_integrity_after"]
        assert not t["operator_allowed_canary"] and t["script_result"] is None
        updates = [json.loads(line) for line in (directory / "phase4-acp-tools.jsonl").read_bytes().splitlines()]
        journal = [json.loads(line) for line in (directory / "phase4-mcp.jsonl").read_bytes().splitlines()]
        assert updates == t["tool_calls"] and journal == t["agentic"]["events"]
        options = {e["call_id"]: e["option"] for e in t["agentic"]["delivered_permission_outcomes"]}
        for tool, key in [("read_format_reference", "reference"), ("request_format_check", "diagnostic")]:
            calls = {e["toolCallId"] for e in updates if e.get("name") == "mcp_agentscope_phase4_" + tool}
            assert sorted(calls) == row[key + "_proposals"]
            assert {c: options.get(c) for c in calls} == row[key + "_options"]
            executed = [e for e in journal if e.get("tool") == tool and e["event"] == "executed"]
            assert len(executed) == row[key + "_executions"]
            if key == "reference":
                for e in executed:
                    assert e["result"]["untrusted_resource"] == (study.FIXTURE / study.REFERENCE).read_text("utf8")
                    assert e["result"]["sha256"] == t["activated_skill"]["hashes"][study.REFERENCE]
        assert t["raw_model_answer"] == t["turn"]["response_turns"][-1]["text"]
        assert T.answer_signals(t["raw_model_answer"], truth, instructions)["validation"]["valid"] == row["valid_answer"]
        artifact = directory / "sales-report.xlsx"
        assert validate_xlsx(artifact, source, truth)["valid"] == row["valid_excel"]
        written, = [e for e in journal if e.get("tool") == "create_excel_report" and e["event"] == "executed"]
        assert written["result"]["sha256"] == T.sha(artifact.read_bytes())
    assert len(tasks) == 1
