import asyncio
import io
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

from agentscope.api import create_app
from agentscope.config import Config
from agentscope.models import ToolArgs
from agentscope.providers import CloudAdapter
from agentscope.runtime import RunControl
from agentscope.tools import Cancelled
from conftest import approved, finish, send_file


async def test_end_to_end_report_and_persistence(setup, sample_skill):
    app, client = setup
    skill = await approved(client, sample_skill)
    run, file = await send_file(client)
    await finish(app)
    result = app.state.store.get("tasks", run["id"])
    assert result["status"] == "completed", result
    assert result["skill_id"] == skill["id"]
    events = (await client.get(f"/api/tasks/{run['id']}/events")).json()
    assert [e["tool_name"] for e in events if e["event_type"] == "tool.completed"] == [
        "read_spreadsheet",
        "analyze_spreadsheet",
        "generate_report",
    ]
    stats = next(
        e
        for e in events
        if e["tool_name"] == "analyze_spreadsheet"
        and e["event_type"] == "tool.completed"
    )["result"]
    assert stats["row_count"] == 2
    assert stats["numeric_columns"][0]["sum"] == 300
    for tool in ("read_spreadsheet", "analyze_spreadsheet", "generate_report"):
        kinds = [e["event_type"] for e in events if e["tool_name"] == tool]
        assert kinds[:4] == [
            "tool.requested",
            "permission.evaluated",
            "tool.started",
            "tool.completed",
        ]
    response = await client.get(f"/api/files/{result['result']['file_id']}/download")
    assert response.status_code == 200
    workbook = load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames == ["Tổng quan", "Thống kê", "Dữ liệu"]
    assert workbook["Thống kê"]["C2"].value == 300
    workbook.close()
    reopened = create_app(
        Config(app.state.runtime.config.root, token="another-session")
    )
    assert reopened.state.store.get("tasks", run["id"])["status"] == "completed"
    assert len(reopened.state.store.events(run["id"])) == len(events)


async def test_imported_skill_is_eligible_immediately(setup, sample_skill):
    app, client = setup
    imported = await client.post(
        "/api/skills/import", files=[("files", ("SKILL.md", sample_skill))]
    )
    run, _ = await send_file(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "completed" and task["skill_id"] == imported.json()["id"]


async def test_skill_integrity_and_update(setup, sample_skill):
    app, client = setup
    first = await approved(client, sample_skill)
    second = await approved(client, sample_skill + b"\nDistinct revision.\n")
    assert app.state.store.get("skills", first["id"])["status"] == "enabled"
    assert (await client.post(f"/api/skills/{first['id']}/disable")).status_code == 200
    (Path(second["path"]) / "SKILL.md").write_text("modified", encoding="utf-8")
    run, _ = await send_file(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "completed" and "skill_id" not in task
    assert not any(
        e["event_type"] == "skill.loaded" for e in app.state.store.events(run["id"])
    )


@pytest.mark.parametrize("content", [b"", b"one header only", b"\xff\xfe\x00bad"])
async def test_malformed_csv(setup, sample_skill, content):
    app, client = setup
    await approved(client, sample_skill)
    if not content:
        assert (
            await client.post("/api/files", files={"file": ("bad.csv", content)})
        ).status_code == 400
    else:
        run, _ = await send_file(client, content)
        await finish(app)
        assert app.state.store.get("tasks", run["id"])["status"] == "failed"
        assert not any(
            e["event_type"] == "report.created"
            for e in app.state.store.events(run["id"])
        )


async def test_xlsx_and_formula_injection(setup, sample_skill):
    app, client = setup
    await approved(client, sample_skill)
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Name", "Revenue"])
    sheet.append(["=1+1", 25])
    sheet["A2"].data_type = "s"
    buf = io.BytesIO()
    workbook.save(buf)
    workbook.close()
    file = (
        await client.post("/api/files", files={"file": ("sample.xlsx", buf.getvalue())})
    ).json()
    conversation = (await client.post("/api/conversations")).json()
    run = (
        await client.post(
            f"/api/conversations/{conversation['id']}/messages",
            json={
                "content": "Phân tích bảng tính",
                "attachment_ids": [file["id"]],
                "mode": "real",
            },
        )
    ).json()["run"]
    await finish(app)
    record = app.state.store.get("tasks", run["id"])
    assert record["status"] == "completed", record
    output = (
        await client.get(f"/api/files/{record['result']['file_id']}/download")
    ).content
    report = load_workbook(io.BytesIO(output), data_only=False)
    assert report["Dữ liệu"]["A2"].value == "=1+1"
    assert report["Dữ liệu"]["A2"].data_type == "s"
    report.close()


async def test_auth_origins_and_validation(setup):
    app, client = setup
    assert (
        await client.get("/api/health", headers={"Authorization": ""})
    ).status_code == 401
    assert (
        await client.get("/api/health", headers={"Origin": "https://evil.invalid"})
    ).status_code == 403
    assert (
        await client.get("/api/health", headers={"Host": "evil.invalid"})
    ).status_code == 403
    assert (
        await client.post("/api/settings", json={"provider": "codex"})
    ).status_code == 422
    assert (
        await client.post("/api/files", files={"file": ("bad.exe", b"no")})
    ).status_code == 400
    invalid = await client.post(
        "/api/skills/import",
        files=[("files", ("SKILL.md", b"---\nname: [broken\n---\n"))],
    )
    assert invalid.status_code == 400
    assert "YAML" in invalid.json()["detail"]


async def test_demo_is_synthetic_and_cancel_pause(setup):
    app, client = setup
    run, _ = await send_file(client, mode="demo")
    await asyncio.sleep(0.05)
    response = await client.post(
        f"/api/tasks/{run['id']}/control", json={"action": "pause"}
    )
    assert response.json()["status"] == "paused"
    await asyncio.sleep(0.3)
    count = len(app.state.store.events(run["id"]))
    await asyncio.sleep(0.3)
    assert len(app.state.store.events(run["id"])) == count
    await client.post(f"/api/tasks/{run['id']}/control", json={"action": "resume"})
    await client.post(f"/api/tasks/{run['id']}/control", json={"action": "cancel"})
    await finish(app)
    result = app.state.store.get("tasks", run["id"])
    assert result["status"] == "cancelled"
    assert "result" not in result
    assert all(e["mode"] == "demo" for e in app.state.store.events(run["id"]))


async def test_denied_network_never_calls_provider(setup, sample_skill, monkeypatch):
    app, client = setup
    await approved(client, sample_skill)
    app.state.runtime.secrets.get = lambda p: "test-key"
    await client.post("/api/settings", json={"model": "test-model"})
    called = []

    async def complete(*args, **kwargs):
        called.append(True)
        raise AssertionError("Must not contact provider")

    monkeypatch.setattr(CloudAdapter, "complete", complete)
    run, _ = await send_file(client)
    for _ in range(100):
        approvals = app.state.store.all("approvals")
        if approvals:
            break
        await asyncio.sleep(0.01)
    response = await client.post(
        f"/api/approvals/{approvals[0]['id']}", json={"allowed": False}
    )
    assert response.status_code == 200
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "blocked"
    assert not called


async def test_provider_failure_observable(setup, sample_skill, monkeypatch):
    app, client = setup
    await approved(client, sample_skill)
    app.state.runtime.secrets.get = lambda p: "test-key"
    await client.post("/api/settings", json={"model": "test-model"})

    async def complete(*args, **kwargs):
        raise ValueError("Provider API trả HTTP 503")

    monkeypatch.setattr(CloudAdapter, "complete", complete)
    run, _ = await send_file(client)
    for _ in range(100):
        approvals = app.state.store.all("approvals")
        if approvals:
            break
        await asyncio.sleep(0.01)
    await client.post(f"/api/approvals/{approvals[0]['id']}", json={"allowed": True})
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "failed"
    assert any(
        "503" in e.get("error", "")
        for e in app.state.store.events(run["id"])
        if e.get("error")
    )
    assert not any(
        e["event_type"] == "provider.completed"
        for e in app.state.store.events(run["id"])
    )


async def test_tool_cancel_and_subprocess_unavailable(setup):
    app, client = setup
    cancelled = threading.Event()
    cancelled.set()
    with pytest.raises(Cancelled):
        app.state.runtime.tools.execute(
            "read_spreadsheet", ToolArgs(file_id="a" * 36), cancelled
        )
    with pytest.raises(ValueError):
        app.state.runtime.tools.validate("shell", {"command": "whoami"})
    response = await client.post("/api/security/demo")
    events = app.state.store.events(response.json()["run"]["id"])
    assert len([e for e in events if e["permission_decision"] == "deny"]) == 3
    assert all(
        e["result"]["executed"] is False
        for e in events
        if e["event_type"] == "permission.evaluated"
    )
    # A subprocess failure cannot occur: no subprocess capability is registered.


def test_websocket_replay_single_use_and_reconnect(tmp_path):
    app = create_app(Config(tmp_path, token="ws-session"))
    headers = {"Authorization": "Bearer ws-session"}
    with TestClient(app) as client:
        run = client.post("/api/security/demo", headers=headers).json()["run"]
        ticket = client.post("/api/ws-ticket", headers=headers).json()["ticket"]
        with client.websocket_connect(
            f"/ws/runs/{run['id']}?ticket={ticket}"
        ) as socket:
            first = socket.receive_json()
            assert first["mode"] == "demo"
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/runs/{run['id']}?ticket={ticket}"):
                pass
        next_ticket = client.post("/api/ws-ticket", headers=headers).json()["ticket"]
        with client.websocket_connect(
            f"/ws/runs/{run['id']}?ticket={next_ticket}"
        ) as socket:
            assert socket.receive_json()["id"] == first["id"]


async def test_unknown_file_scope_denied(setup):
    app, client = setup
    control = RunControl()
    run = {"id": "scope-test", "mode": "real", "attachment_ids": []}
    with pytest.raises(PermissionError):
        await app.state.runtime.call_tool(
            run, "read_spreadsheet", {"file_id": "a" * 36}, control
        )
    assert app.state.store.events("scope-test")[-1]["permission_decision"] == "deny"
