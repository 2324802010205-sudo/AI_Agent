import asyncio
from pathlib import Path

import httpx
import pytest

from agentscope.api import create_app
from agentscope.config import Config


@pytest.fixture
async def setup(tmp_path):
    app = create_app(Config(tmp_path, token="test-session"))
    # Tests never touch the user's credential store or make paid API requests.
    app.state.runtime.secrets.get = lambda provider: None
    app.state.store.put(
        "settings", {"id": "main", "provider": "openai", "model": "", "mode": "real"}
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers={"Authorization": "Bearer test-session"},
        ) as client:
            yield app, client


@pytest.fixture
def sample_skill():
    return (
        Path(__file__).parents[1] / "samples/spreadsheet-analysis/SKILL.md"
    ).read_bytes()


async def finish(app):
    if app.state.runtime.background:
        await asyncio.wait_for(
            asyncio.gather(*list(app.state.runtime.background.values())), timeout=15
        )


async def approved(client, sample_skill):
    response = await client.post(
        "/api/skills/import",
        files=[("files", ("SKILL.md", sample_skill, "text/markdown"))],
    )
    assert response.status_code == 200, response.text
    skill = response.json()
    response = await client.post(f"/api/skills/{skill['id']}/approve")
    assert response.status_code == 200, response.text
    return response.json()


async def send_file(
    client, content=b"region,revenue,cost\nHanoi,100,30\nDanang,200,70\n", mode="real"
):
    uploaded = await client.post(
        "/api/files", files={"file": ("sample.csv", content, "text/csv")}
    )
    assert uploaded.status_code == 200, uploaded.text
    conversation = (await client.post("/api/conversations")).json()
    response = await client.post(
        f"/api/conversations/{conversation['id']}/messages",
        json={
            "content": "Phân tích dữ liệu doanh thu và tạo báo cáo Excel",
            "attachment_ids": [uploaded.json()["id"]],
            "mode": mode,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["run"], uploaded.json()
