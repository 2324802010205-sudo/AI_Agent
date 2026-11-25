import asyncio
import json

import httpx
import pytest

from agentscope.providers import CloudAdapter, Completion, Secrets
from conftest import approved, finish, send_file


class FakeResponse:
    is_success = True
    status_code = 200

    def __init__(self, events):
        self.events = events

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def aiter_lines(self):
        for event in self.events:
            yield "data: " + json.dumps(event)


class FakeClient:
    events = []
    bodies = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def stream(self, method, url, headers, json):
        self.bodies.append(json)
        return FakeResponse(self.events)


@pytest.mark.parametrize("provider", ["openai", "gemini"])
async def test_openai_compatible_stream_and_tool_arguments(monkeypatch, provider):
    FakeClient.events = [
        {"choices": [{"delta": {"content": "Chào "}}]},
        {
            "choices": [
                {
                    "delta": {
                        "content": "bạn",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call-1",
                                "function": {
                                    "name": "read_spreadsheet",
                                    "arguments": '{"file_id":',
                                },
                            }
                        ],
                    }
                }
            ]
        },
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "function": {
                                    "arguments": '"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'
                                },
                            }
                        ]
                    }
                }
            ]
        },
    ]
    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    chunks = []

    async def delta(text):
        chunks.append(text)

    result = await CloudAdapter(provider, "test-model", "test-secret").complete(
        [{"role": "user", "content": "hello"}], "system", [], delta
    )
    assert result.text == "Chào bạn"
    assert chunks == ["Chào ", "bạn"]
    assert result.tools[0].name == "read_spreadsheet"
    assert (
        result.tools[0].arguments["file_id"] == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    )
    assert result.native["tool_calls"][0]["id"] == "call-1"


async def test_claude_visible_text_and_tool_stream(monkeypatch):
    FakeClient.events = [
        {
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "text", "text": ""},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "Đã nhận"},
        },
        {
            "type": "content_block_start",
            "index": 1,
            "content_block": {
                "type": "tool_use",
                "id": "tool-1",
                "name": "analyze_spreadsheet",
                "input": {},
            },
        },
        {
            "type": "content_block_delta",
            "index": 1,
            "delta": {
                "type": "input_json_delta",
                "partial_json": '{"file_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}',
            },
        },
    ]
    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    adapter = CloudAdapter("anthropic", "test-model", "test-secret")
    result = await adapter.complete(
        [{"role": "user", "content": "hello"}], "system", []
    )
    assert result.text == "Đã nhận"
    assert result.tools[0].name == "analyze_spreadsheet"
    assert (
        adapter.tool_result(result.tools[0], {"observed": True})["content"][0]["type"]
        == "tool_result"
    )


async def test_http_error_does_not_echo_provider_body():
    response = httpx.Response(401, content=b"api_key=should-never-appear")
    with pytest.raises(ValueError, match="HTTP 401") as error:
        await CloudAdapter("openai", "test", "secret")._check(response)
    assert "should-never-appear" not in str(error.value)


def test_plaintext_secret_backend_rejected(monkeypatch):
    class Plaintext:
        __module__ = "keyrings.alt.file"

    import keyring

    monkeypatch.setattr(keyring, "get_keyring", lambda: Plaintext())
    with pytest.raises(ValueError):
        Secrets().set("openai", "secret")


async def test_model_checks_draft_provider_and_model_without_saving(setup, monkeypatch):
    app, client = setup
    runtime = app.state.runtime
    saved = runtime.configuration()
    key_reads = []
    key_writes = []
    calls = []

    def stored_key(provider):
        key_reads.append(provider)
        return "existing-gemini-test-key"

    async def complete(adapter, messages, system, tools):
        calls.append((adapter.provider, adapter.model, adapter.key))
        assert messages == [{"role": "user", "content": "Reply with OK only."}]
        assert tools == []
        return Completion(text=f"OK {adapter.key}")

    monkeypatch.setattr(runtime.secrets, "get", stored_key)
    monkeypatch.setattr(runtime.secrets, "set", lambda *args: key_writes.append(args))
    monkeypatch.setattr(CloudAdapter, "complete", complete)
    draft_key = "temporary-test-key"
    body = {"provider": "gemini", "model": " draft-model ", "api_key": f" {draft_key} "}
    response = await client.post("/api/settings/test-model", json=body)
    assert response.status_code == 200
    assert response.json()["response"] == "OK [REDACTED]"
    assert response.json()["model"] == "draft-model"
    assert response.json()["duration_ms"] >= 0
    assert calls == [("gemini", "draft-model", draft_key)]
    assert key_reads == []

    response = await client.post(
        "/api/settings/test-model", json={**body, "api_key": None}
    )
    assert response.status_code == 200
    assert calls[-1] == ("gemini", "draft-model", "existing-gemini-test-key")
    assert key_reads == ["gemini"]
    assert key_writes == []
    assert runtime.configuration() == saved
    assert draft_key not in (await client.get("/api/audit")).text


@pytest.mark.parametrize("path", ["/api/settings", "/api/settings/test-model"])
async def test_settings_validation_does_not_return_keys(setup, path):
    _, client = setup
    secret = "oversized-test-key" * 50
    response = await client.post(
        path, json={"provider": "gemini", "model": "model-a", "api_key": secret}
    )
    assert response.status_code == 422
    assert "oversized-test-key" not in response.text


async def test_model_check_surfaces_redacted_error(setup, monkeypatch):
    _, client = setup
    key = "temporary-test-key"

    async def complete(adapter, messages, system, tools):
        raise ValueError(f"Provider API trả HTTP 401 ({adapter.key})")

    monkeypatch.setattr(CloudAdapter, "complete", complete)
    response = await client.post(
        "/api/settings/test-model",
        json={"provider": "openai", "model": "model-a", "api_key": key},
    )
    assert response.status_code == 400
    assert "HTTP 401" in response.json()["detail"]
    assert key not in response.text
    audit = await client.get("/api/audit")
    assert "provider.failed" in audit.text
    assert key not in audit.text


async def test_cancellation_interrupts_stalled_provider(
    setup, sample_skill, monkeypatch
):
    app, client = setup
    await approved(client, sample_skill)
    app.state.runtime.secrets.get = lambda p: "test-key"
    await client.post("/api/settings", json={"model": "test-model"})
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def complete(*args, **kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(CloudAdapter, "complete", complete)
    run, _ = await send_file(client)
    for _ in range(100):
        approvals = app.state.store.all("approvals")
        if approvals:
            break
        await asyncio.sleep(0.01)
    await client.post(f"/api/approvals/{approvals[0]['id']}", json={"allowed": True})
    await asyncio.wait_for(started.wait(), 1)
    await client.post(f"/api/tasks/{run['id']}/control", json={"action": "cancel"})
    await asyncio.wait_for(cancelled.wait(), 1)
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "cancelled"
    assert any(
        e["event_type"] == "provider.cancelled"
        for e in app.state.store.events(run["id"])
    )
