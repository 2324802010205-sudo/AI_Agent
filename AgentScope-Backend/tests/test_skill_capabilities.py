"""Skill metadata is descriptive; attached-file tools use the runtime policy."""

import io
import re
import tomllib
from pathlib import Path

import pytest
from openpyxl import load_workbook

import agentscope
from agentscope.runtime import RunControl
from agentscope.lab.broker import definitions as mcp_definitions
from agentscope.tools import ToolRegistry
from conftest import finish

ROOT = Path(__file__).parents[1]
SAMPLE_XLSX = ROOT / "samples/AgentScope_DuLieuBanHang_Test.xlsx"
VALID_SKILL = (ROOT / "samples/sales-report-helper/SKILL.md").read_text("utf-8")
# The user's original package: standard name/description, no capabilities.
INSTRUCTIONS_ONLY = re.sub(r"capabilities:\n(  - \w+\n)+", "", VALID_SKILL).encode()
MINIMAL_SKILL = b"---\nname: sales-summary\ndescription: Summarize sales by region.\n---\nUse the attached workbook and report recorded totals.\n"
WORKFLOW = ["read_spreadsheet", "analyze_spreadsheet", "generate_report"]


async def import_skill(client, filename, data, approve=False):
    response = await client.post(
        "/api/skills/import", files=[("files", (filename, data))]
    )
    assert response.status_code == 200, response.text
    skill = response.json()
    if approve:
        response = await client.post(f"/api/skills/{skill['id']}/approve")
        assert response.status_code == 200, response.text
        skill = response.json()
    return skill


async def send_workbook(
    client, content="Phân tích doanh thu và lợi nhuận, tạo báo cáo", *, skill_id=None
):
    uploaded = await client.post(
        "/api/files",
        files={"file": (SAMPLE_XLSX.name, SAMPLE_XLSX.read_bytes())},
    )
    assert uploaded.status_code == 200, uploaded.text
    conversation = (await client.post("/api/conversations")).json()["id"]
    response = await client.post(
        f"/api/conversations/{conversation}/messages",
        json={
            "content": content,
            "attachment_ids": [uploaded.json()["id"]],
            **({"skill_id": skill_id} if skill_id else {}),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["run"]


def assert_sample_figures(app, run, skill_name="sales-report-helper"):
    events = app.state.store.events(run["id"])
    completed = [e for e in events if e["event_type"] == "tool.completed"]
    assert [e["tool_name"] for e in completed] == WORKFLOW
    stats = completed[1]["result"]
    assert stats["row_count"] == 48
    sums = {c["column"]: c["sum"] for c in stats["numeric_columns"]}
    assert sums["Doanh_thu_VND"] == 344_740_000
    assert sums["Loi_nhuan_VND"] == 95_980_000
    permissions = [e for e in events if e["event_type"] == "permission.evaluated"]
    assert [p["permission_decision"] for p in permissions] == ["allow"] * 3
    assert [p["arguments"]["capability"] for p in permissions] == WORKFLOW
    assert {p["arguments"]["skill"] for p in permissions} == {skill_name}
    return events


async def test_instructions_only_skill_is_selected_without_approval(setup):
    app, client = setup
    skill = await import_skill(client, "SKILL.md", INSTRUCTIONS_ONLY, approve=False)
    assert skill["capabilities"] == []
    assert skill["status"] == "enabled" and not skill["findings"]
    run = await send_workbook(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "completed" and task["skill_id"] == skill["id"]
    events = assert_sample_figures(app, run)
    assert "skill.loaded" in [event["event_type"] for event in events]


async def test_minimal_standard_skill_discovers_workbook_from_instructions_and_runs_report(
    setup,
):
    app, client = setup
    skill = await import_skill(client, "sales-summary/SKILL.md", MINIMAL_SKILL)
    assert skill["status"] == "enabled"
    assert skill["capabilities"] == skill["security"]["requested_tools"] == []
    run = await send_workbook(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "completed" and task["skill_id"] == skill["id"]
    events = assert_sample_figures(app, run, skill_name="sales-summary")
    loaded = next(e for e in events if e["event_type"] == "skill.loaded")
    assert loaded["result"]["declared_capabilities"] == []
    assert loaded["result"]["requested_tools"] == []
    report = app.state.store.get("files", task["result"]["file_id"])
    write = next(
        e
        for e in events
        if e["event_type"] == "permission.evaluated"
        and e["tool_name"] == "generate_report"
    )
    assert Path(write["arguments"]["path"]) == Path(report["path"])
    result = await client.get(f"/api/files/{report['id']}/download")
    assert result.status_code == 200
    with io.BytesIO(result.content) as content:
        workbook = load_workbook(content, read_only=True)
        assert workbook["Dữ liệu"].max_row == 49
        workbook.close()


async def test_old_installation_gets_discovery_data_without_rewriting_its_snapshot(
    setup,
):
    app, client = setup
    skill = await import_skill(client, "SKILL.md", MINIMAL_SKILL)
    registry = app.state.runtime.skills
    snapshot = registry.archives / f"{skill['id']}.zip"
    previous = snapshot.read_bytes()
    assert "selection" not in skill
    skill = app.state.store.get("skills", skill["id"])
    del skill["selection"], skill["security"]["requested_tools"]
    app.state.store.put("skills", skill)

    selected = registry.discover("Summarize the workbook", spreadsheet=True)
    assert selected["id"] == skill["id"]
    assert selected["selection"]["spreadsheet"]
    assert selected["security"]["requested_tools"] == []
    assert snapshot.read_bytes() == previous


@pytest.mark.parametrize(
    "declaration",
    [
        "allowed-tools: Bash(curl -I *) read_spreadsheet UnregisteredTool",
        "allowed-tools: 'Bash(curl -I *), read_spreadsheet, UnregisteredTool'",
        "allowed-tools:\n  - Bash(curl -I *)\n  - read_spreadsheet\n  - UnregisteredTool",
    ],
)
async def test_allowed_tools_are_archived_and_cannot_grant_permissions(
    setup, declaration
):
    app, client = setup
    content = MINIMAL_SKILL.replace(
        b"\n---\nUse",
        f"\nlicense: MIT\ncompatibility: Requires a spreadsheet.\n{declaration}\n---\nUse".encode(),
    )
    skill = await import_skill(client, "SKILL.md", content)
    requested = ["Bash(curl -I *)", "read_spreadsheet", "UnregisteredTool"]
    assert skill["security"]["requested_tools"] == requested
    assert skill["security"]["assessment"] == "no_significant_findings"
    assert (
        skill["license"] == "MIT"
        and skill["compatibility"] == "Requires a spreadsheet."
    )
    evidence = (await client.get(f"/api/skills/{skill['id']}/evidence")).json()
    assert evidence["security"]["requested_tools"] == requested
    run = await send_workbook(client)
    await finish(app)
    events = assert_sample_figures(app, run, skill_name="sales-summary")
    assert (
        next(e for e in events if e["event_type"] == "skill.loaded")["result"][
            "requested_tools"
        ]
        == requested
    )
    assert [item["name"] for item in app.state.runtime.tools.definitions()] == WORKFLOW
    assert [
        item["name"]
        for item in mcp_definitions()
        if item["name"] in ToolRegistry.names()
    ] == WORKFLOW
    file_id = run["attachment_ids"][0]
    runtime = app.state.runtime
    direct = {
        "id": "tool-request-audit",
        "mode": "real",
        "attachment_ids": [],
        "skill_id": skill["id"],
    }
    # Exercise real registry and attachment decisions with an active per-run tool cache.
    runtime._run_tools[direct["id"]] = ToolRegistry(
        app.state.store, runtime.config.workspace
    )
    for name in ("Bash", "UnregisteredTool", "read_spreadsheet"):
        with pytest.raises(PermissionError):
            await runtime.call_tool(direct, name, {"file_id": file_id}, RunControl())
    events = app.state.store.events(direct["id"])
    assert [e["tool_name"] for e in events if e["permission_decision"] == "deny"] == [
        "Bash",
        "UnregisteredTool",
        "read_spreadsheet",
    ]
    assert not any(e["event_type"] == "tool.started" for e in events)


async def test_built_in_reporting_without_installed_skill(setup):
    app, client = setup
    run = await send_workbook(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "completed" and not task.get("skill_id")
    assert_sample_figures(app, run, skill_name=None)


async def test_metadata_cannot_expand_runtime_tools_or_file_scope(setup):
    app, client = setup
    partial = VALID_SKILL.replace("  - read_spreadsheet\n", "").replace(
        "  - generate_report\n", ""
    )
    skill = await import_skill(
        client,
        "SKILL.md",
        partial.replace(
            "  - analyze_spreadsheet\n",
            "  - analyze_spreadsheet\n  - unregistered_tool\n",
        ).encode(),
    )
    assert skill["capabilities"] == ["analyze_spreadsheet", "unregistered_tool"]
    assert skill["security"]["findings"][0]["code"] == "unregistered_capability"
    run = await send_workbook(client)
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "completed"
    assert_sample_figures(app, run)
    uploaded = (
        await client.post("/api/files", files={"file": ("a.csv", b"a,b\n1,2\n")})
    ).json()
    direct = {
        "id": "direct",
        "mode": "real",
        "attachment_ids": [],
        "skill_id": skill["id"],
    }
    for name in ("unregistered_tool", "read_spreadsheet"):
        with pytest.raises(PermissionError):
            await app.state.runtime.call_tool(
                direct, name, {"file_id": uploaded["id"]}, RunControl()
            )
        last = app.state.store.events("direct")[-1]
        assert last["permission_decision"] == "deny" and last["tool_name"] == name


async def test_disabled_skill_is_denied_at_call_time(setup):
    app, client = setup
    skill = await import_skill(client, "SKILL.md", VALID_SKILL.encode())
    await client.post(f"/api/skills/{skill['id']}/disable")
    uploaded = (
        await client.post("/api/files", files={"file": ("a.csv", b"a,b\n1,2\n")})
    ).json()
    run = {
        "id": "revoked",
        "mode": "real",
        "attachment_ids": [uploaded["id"]],
        "skill_id": skill["id"],
    }
    with pytest.raises(PermissionError):
        await app.state.runtime.call_tool(
            run, "read_spreadsheet", {"file_id": uploaded["id"]}, RunControl()
        )
    assert app.state.store.events("revoked")[-1]["permission_decision"] == "deny"


async def test_valid_sample_zip_runs_real_workflow_on_sample_workbook(setup):
    app, client = setup
    # Two distinct eligible packages can share a name and have independent toggles.
    old = await import_skill(client, "SKILL.md", INSTRUCTIONS_ONLY)
    zipped = (ROOT / "samples/sales-report-helper.zip").read_bytes()
    skill = await import_skill(client, "sales-report-helper.zip", zipped)
    assert skill["capabilities"] == WORKFLOW and skill["findings"] == []
    registry = app.state.runtime.skills
    assert {entry["id"] for entry in registry.available_skills()} == {old["id"], skill["id"]}
    assert (await client.post(f"/api/skills/{old['id']}/disable")).status_code == 200
    assert [entry["id"] for entry in registry.available_skills()] == [skill["id"]]
    assert (await client.post(f"/api/skills/{old['id']}/enable")).status_code == 200
    assert {entry["id"] for entry in registry.available_skills()} == {old["id"], skill["id"]}
    run = await send_workbook(client, skill_id=skill["id"])
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "completed", task
    assert task["skill_id"] == skill["id"]
    assert_sample_figures(app, run)
    report = await client.get(f"/api/files/{task['result']['file_id']}/download")
    workbook = load_workbook(io.BytesIO(report.content))
    totals = {r[0]: r[2] for r in workbook["Thống kê"].iter_rows(values_only=True)}
    assert totals["Doanh_thu_VND"] == 344_740_000
    assert totals["Loi_nhuan_VND"] == 95_980_000
    assert workbook["Dữ liệu"].max_row == 49
    workbook.close()


async def test_version_has_single_source(setup):
    _, client = setup
    project = tomllib.loads((ROOT / "pyproject.toml").read_text("utf-8"))
    assert agentscope.__version__ == project["project"]["version"]
    assert (await client.get("/api/health")).json()["version"] == agentscope.__version__
    settings = (await client.get("/api/settings")).json()
    assert settings["backend_version"] == agentscope.__version__
