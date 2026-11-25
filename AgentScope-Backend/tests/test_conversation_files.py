from io import BytesIO

import httpx
from openpyxl import Workbook, load_workbook

from agentscope.api import create_app
from agentscope.config import Config
from conftest import finish, send_file


def workbook_bytes(value):
    workbook = Workbook()
    workbook.active.append(["Revenue"])
    workbook.active.append([value])
    with BytesIO() as out:
        workbook.save(out)
        return out.getvalue()


async def test_conversation_workbooks_survive_restart_and_keep_report_sources(setup):
    app, client = setup
    conversation = (await client.post("/api/conversations")).json()["id"]
    base = f"/api/conversations/{conversation}"
    files = []
    for filename, value in (("hanoi.xlsx", 100), ("hue.xlsx", 230)):
        uploaded = await client.post(
            "/api/files",
            params={"conversation_id": conversation},
            files={"file": (filename, workbook_bytes(value))},
        )
        assert uploaded.status_code == 200, uploaded.text
        files.append(uploaded.json())
    ids = [file["id"] for file in files]
    assert (await client.get(f"{base}/attachments")).json() == {
        "files": files,
        "selected_ids": ids,
    }
    other = (await client.post("/api/conversations")).json()["id"]
    cross_chat = await client.post(
        f"/api/conversations/{other}/messages",
        json={"content": "Xuất Excel", "attachment_ids": ids},
    )
    assert cross_chat.status_code == 404

    first = (await client.post(f"{base}/messages", json={"content": "So sánh"})).json()
    assert first["run"]["attachment_ids"] == ids
    await finish(app)
    task = app.state.store.get("tasks", first["run"]["id"])
    assert task["status"] == "completed", task
    assert [report["source_file_id"] for report in task["reports"]] == ids

    restarted = create_app(Config(app.state.runtime.config.root, token="test-session"))
    restarted.state.runtime.secrets.get = lambda provider: None
    async with (
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted),
            base_url="http://testserver",
            headers={"Authorization": "Bearer test-session"},
        ) as reopened,
    ):
        state = (await reopened.get(f"{base}/attachments")).json()
        assert state["selected_ids"] == ids
        assert state["files"] == files
        for report, expect in zip(task["reports"], [100, 230]):
            result = await reopened.get(f"/api/files/{report['file_id']}/download")
            assert result.status_code == 200
            output = load_workbook(
                BytesIO(result.content), read_only=True, data_only=True
            )
            try:
                assert output["Thống kê"]["C2"].value == expect
            finally:
                output.close()
        subset = await reopened.post(
            f"{base}/messages", json={"content": "Chỉ Huế", "attachment_ids": ids[1:]}
        )
        assert subset.json()["run"]["attachment_ids"] == ids[1:]
        await finish(restarted)
        followup = await reopened.post(
            f"{base}/messages", json={"content": "Kiểm tra lại"}
        )
        assert followup.json()["run"]["attachment_ids"] == ids[1:]
        await finish(restarted)
        opt_out = await reopened.post(
            f"{base}/messages", json={"content": "Chào bạn", "attachment_ids": []}
        )
        assert opt_out.json()["run"]["attachment_ids"] == []
        await finish(restarted)
        assert (await reopened.get(f"{base}/attachments")).json() == {
            "files": files,
            "selected_ids": [],
        }


async def test_legacy_message_references_are_discoverable(setup):
    app, client = setup
    run, source = await send_file(client)
    await finish(app)
    conversation = run["conversation_id"]
    # Older versions stored attachment IDs in message snapshots only.
    app.state.store.delete("conversation_files", conversation)
    response = await client.get(f"/api/conversations/{conversation}/attachments")
    assert response.json() == {"files": [source], "selected_ids": [source["id"]]}
