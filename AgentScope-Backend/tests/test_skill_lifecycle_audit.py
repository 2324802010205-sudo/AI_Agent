import asyncio
import hashlib
import io
from pathlib import Path
import subprocess
from unittest.mock import AsyncMock, Mock
from zipfile import ZipFile

from openpyxl import load_workbook

from agentscope.antigravity_acp import AntigravityAcpAdapter
from agentscope.lab.containment.trials import synthetic_dataset

from conftest import finish


async def test_lifecycle_api_returns_offline_evidence_without_queueing_a_trial(setup):
    app, client = setup
    response = await client.get("/api/isolated-lab/skill-lifecycle-audit")
    assert response.status_code == 200
    audit = response.json()
    assert audit["model_driven_trials"] == 0
    assert audit["first_observed_stop"] == "UNTRUSTED_CONTENT_NOT_EXPOSED"
    assert audit["offline_trace"]["restriction"]["skill_delivered"] is False
    assert audit["offline_trace"]["process_launch_attempts"] == 0
    assert not app.state.injection_lab.tasks


async def test_installed_skill_keeps_companion_files_unexecuted(setup, monkeypatch):
    app, client = setup
    runtime = app.state.runtime
    acp = AsyncMock(side_effect=AssertionError("Production ACP must not be reached"))
    spawn = Mock(side_effect=AssertionError("Unexpected process launch"))
    async_spawn = AsyncMock(side_effect=AssertionError("Unexpected process launch"))
    monkeypatch.setattr(runtime, "controlled_acp", acp)
    monkeypatch.setattr(subprocess, "Popen", spawn)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", async_spawn)
    fixture = {
        "SKILL.md": (
            b"---\nname: sales-lifecycle-audit\ndescription: Analyze a synthetic sales workbook and create an accurate financial report.\n"
            b"capabilities:\n  - read_spreadsheet\n  - analyze_spreadsheet\n  - generate_report\n---\n\n"
            b"Read the sales workbook, compute recorded totals, and report them accurately.\n"
        ),
        "references/format.md": b"Synthetic reference for lifecycle audit.\n",
        "scripts/companion.py": b"# Inert file used to check package storage and exposure.\n",
    }
    archive = io.BytesIO()
    with ZipFile(archive, "w") as bundle:
        for name, data in fixture.items():
            bundle.writestr(f"sales-lifecycle-audit/{name}", data)
    imported = await client.post(
        "/api/skills/import", files=[("files", ("audit.zip", archive.getvalue()))]
    )
    assert imported.status_code == 200
    skill = imported.json()
    assert skill["status"] == "quarantine" and not runtime.skills.approved()
    assert skill["hashes"] == {
        name: hashlib.sha256(data).hexdigest() for name, data in fixture.items()
    }
    package = Path(skill["path"])
    assert {name: (package / name).read_bytes() for name in fixture} == fixture
    assert skill["security"]["assessment"] == "untrusted_executable"
    assert skill["security"]["executable_files"] == ["scripts/companion.py"]
    enable = await client.post(f"/api/skills/{skill['id']}/enable")
    assert (
        enable.status_code == 200
        and enable.json()["status"] == "quarantine"
        and enable.json()["eligible"] is True
    )
    spawn.assert_not_called()
    async_spawn.assert_not_awaited()
    # Reset back to off so the subsequent control request runs without it.
    disable = await client.post(f"/api/skills/{skill['id']}/disable")
    assert disable.status_code == 200 and disable.json()["eligible"] is False

    dataset = synthetic_dataset()
    upload = await client.post(
        "/api/files", files={"file": (dataset.name, dataset.read_bytes())}
    )
    assert upload.status_code == 200
    conversation = (await client.post("/api/conversations")).json()["id"]
    response = await client.post(
        f"/api/conversations/{conversation}/messages",
        json={
            "content": "Analyze the synthetic Excel sales workbook and create an accurate financial report.",
            "attachment_ids": [upload.json()["id"]],
        },
    )
    assert response.status_code == 200
    run_id = response.json()["run"]["id"]
    await finish(app)
    task = app.state.store.get("tasks", run_id)
    events = app.state.store.events(run_id)
    kinds = [event["event_type"] for event in events]
    assert task["status"] == "completed" and "skill_id" not in task
    assert task["execution_engine"] == "local_deterministic"
    assert "skill.loaded" not in kinds and "prompt.started" not in kinds
    assert "workflow.selected" in kinds and "prompt.submitted" not in kinds
    finished_tools = [e for e in events if e["event_type"] == "tool.completed"]
    assert [e["tool_name"] for e in finished_tools] == [
        "read_spreadsheet",
        "analyze_spreadsheet",
        "generate_report",
    ]
    stats = finished_tools[1]["result"]
    sums = {column["column"]: column["sum"] for column in stats["numeric_columns"]}
    assert (stats["row_count"], sums["Doanh_thu_VND"], sums["Loi_nhuan_VND"]) == (
        48,
        344740000,
        95980000,
    )
    download = await client.get(f"/api/files/{task['result']['file_id']}/download")
    assert download.status_code == 200
    report = load_workbook(io.BytesIO(download.content), read_only=True)
    try:
        totals = {r[0]: r[2] for r in report["Thống kê"].values}
        assert totals["Doanh_thu_VND"] == 344740000
        assert totals["Loi_nhuan_VND"] == 95980000
        assert report["Dữ liệu"].max_row == 49
    finally:
        report.close()
    assert not list(runtime.config.workspace.rglob("companion.py"))
    assert not AntigravityAcpAdapter.supports_isolated_skills()
    acp.assert_not_awaited()
    spawn.assert_not_called()
    async_spawn.assert_not_awaited()
