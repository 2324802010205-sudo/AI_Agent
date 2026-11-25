"""Isolated ACP transport regressions. Real model calls are opt-in."""

import asyncio
import json
import os
from types import SimpleNamespace
import pytest
from agentscope.antigravity_acp import AntigravityAcpAdapter
from agentscope.policy import SkillGuard
from conftest import approved, finish, send_file


@pytest.fixture
async def transport(monkeypatch, tmp_path):
    state = SimpleNamespace(
        calls=[],
        prompts=[],
        opened=[],
        closed=[],
        failure=None,
        delay=False,
        started=asyncio.Event(),
        sessions=0,
        load_error=False,
        response=None,
    )
    exe = tmp_path / "agy.exe"
    exe.touch()
    monkeypatch.setattr(
        AntigravityAcpAdapter, "detect_executable", classmethod(lambda cls: exe)
    )
    monkeypatch.setattr(
        AntigravityAcpAdapter,
        "get_version",
        classmethod(lambda cls, path=None: "test-version"),
    )
    monkeypatch.setattr(AntigravityAcpAdapter, "_cached_models", [])
    monkeypatch.setattr(AntigravityAcpAdapter, "_current_model", None)
    monkeypatch.setattr(
        AntigravityAcpAdapter,
        "_connection",
        {"state": "not_tested", "authenticated": False, "message": "not tested"},
    )

    async def start(self):
        self.proc = SimpleNamespace(returncode=None)
        self._update_task = asyncio.create_task(self._dispatch_updates())
        state.opened.append(self)

    async def close(self):
        if self._update_task:
            self._update_task.cancel()
            await asyncio.gather(self._update_task, return_exceptions=True)
        self.proc = None
        state.closed.append(self)

    async def request(self, method, params=None, timeout=60):
        state.calls.append((method, params))
        if method == "initialize":
            return {
                "protocolVersion": 1,
                "agentCapabilities": {"loadSession": True},
                "agentInfo": {"name": "test agent"},
            }
        if method in {"session/new", "session/load"}:
            if method == "session/load" and state.load_error:
                raise ValueError("session no longer exists")
            state.sessions += 1
            return {
                "sessionId": params.get("sessionId", f"session-{state.sessions}"),
                "modes": {
                    "currentModeId": getattr(state, "execution_mode", "default"),
                    "availableModes": [{"id": "default"}, {"id": "auto"}],
                },
                "models": {
                    "currentModelId": "discovered-model",
                    "availableModels": [
                        {"modelId": "discovered-model", "name": "Actual model"}
                    ],
                },
            }
        if method == "session/set_model":
            if params["modelId"] != "discovered-model":
                raise ValueError("Model unavailable")
            return {}
        if method == "session/prompt":
            state.started.set()
            state.prompts.append(params)
            if state.delay:
                await asyncio.Event().wait()
            if state.failure:
                raise state.failure
            visible = (
                [state.response]
                if state.response is not None
                else ["Visible ", params["sessionId"]]
            )
            for kind, text in [
                ("agent_thought_chunk", "PRIVATE_REASONING_NEVER_PERSIST"),
                *(("agent_message_chunk", text) for text in visible),
            ]:
                await self._updates.put(
                    {
                        "params": {
                            "sessionId": params["sessionId"],
                            "update": {
                                "sessionUpdate": kind,
                                "content": {"type": "text", "text": text},
                            },
                        }
                    }
                )
            return {"stopReason": "end_turn"}
        return {}

    async def notify(self, method, params=None):
        state.calls.append((method, params))

    monkeypatch.setattr(AntigravityAcpAdapter, "start", start)
    monkeypatch.setattr(AntigravityAcpAdapter, "close", close)
    monkeypatch.setattr(AntigravityAcpAdapter, "request", request)
    monkeypatch.setattr(AntigravityAcpAdapter, "notify", notify)
    yield state
    for adapter in state.opened:
        await close(adapter)


async def configure(client, **settings):
    result = await client.post(
        "/api/settings",
        json={
            "provider": "antigravity",
            "model": "discovered-model",
            "mode": "real",
            **settings,
        },
    )
    assert result.status_code == 200
    return result.json()


async def send(client, conversation=None, content="chào", **body):
    if conversation is None:
        conversation = (await client.post("/api/conversations")).json()["id"]
    result = await client.post(
        f"/api/conversations/{conversation}/messages", json={"content": content, **body}
    )
    assert result.status_code == 200, result.text
    return conversation, result.json()["run"]


async def test_gemini_filter_is_attributed_to_provider(setup, transport):
    app, client = setup
    await configure(client)
    transport.response = "This request was blocked by Gemini's filters."
    conversation, run = await send(client)
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "failed"
    events = (await client.get(f"/api/tasks/{run['id']}/events")).json()
    assert any(event["event_type"] == "provider.filtered" for event in events)
    assert not any(event["permission_decision"] == "deny" for event in events)
    assert "PRIVATE_REASONING_NEVER_PERSIST" not in json.dumps(events)
    messages = (await client.get(f"/api/conversations/{conversation}/messages")).json()
    assert any(message.get("incomplete") is True for message in messages)


async def test_fresh_defaults_and_existing_preferences(setup, transport):
    app, client = setup
    app.state.store.delete("settings", "main")
    settings = (await client.get("/api/settings")).json()
    assert (settings["provider"], settings["mode"], settings["model"]) == (
        "antigravity",
        "real",
        "",
    )
    assert not settings["antigravity"]["ready"]
    await configure(client, mode="demo")
    assert (await client.get("/api/settings")).json()["mode"] == "demo"
    await client.post("/api/settings", json={"provider": "openai"})
    assert (await client.get("/api/settings")).json()["mode"] == "demo"


async def test_greeting_streams_without_skill_or_spreadsheet(setup, transport):
    app, client = setup
    await configure(client)
    conv, run = await send(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "completed", task
    assert task["provider"] == "antigravity" and task["mode"] == "real"
    assert task["model"] == "discovered-model"
    # The new session already reports the selected model as current, so no redundant
    # switch is sent (a differing selection is covered by the invalid-model test).
    assert not any(method == "session/set_model" for method, _ in transport.calls)
    assert len(transport.prompts) == 1
    assert "[user]: chào" in transport.prompts[0]["prompt"][0]["text"]
    events = app.state.store.events(run["id"])
    kinds = {e["event_type"] for e in events}
    assert {
        "provider.connected",
        "session.created",
        "prompt.started",
        "provider.response.streaming",
        "prompt.completed",
    } <= kinds
    assert not any(
        e["event_type"].startswith(("tool.", "report.", "skill.")) for e in events
    )
    assert not any(e.get("permission_decision") for e in events)
    messages = (await client.get(f"/api/conversations/{conv}/messages")).json()
    assistant = [m for m in messages if m["role"] == "assistant"]
    assert len(assistant) == 1 and assistant[0]["content"] == "Visible session-1"
    assert assistant[0]["streaming"] is False and "run_id" not in assistant[0]
    streams = [
        e["result"]["message"]
        for e in events
        if e["event_type"] == "provider.response.streaming"
    ]
    # Stream writes are coalesced: the first chunk is shown immediately, later
    # snapshots are monotonic prefixes and the final snapshot carries the full text.
    assert streams and streams[0]["content"] == "Visible "
    assert all("Visible session-1".startswith(m["content"]) for m in streams)
    revisions = [m["revision"] for m in streams]
    assert revisions == sorted(revisions)
    final = [
        e["result"]["message"]
        for e in events
        if e["event_type"] == "message.created" and e["result"].get("message")
    ]
    assert final[-1]["content"] == "Visible session-1"
    assert final[-1]["streaming"] is False
    assert final[-1]["revision"] > revisions[-1]
    assert "PRIVATE_REASONING" not in json.dumps(events + messages)
    assert "DEMO" not in json.dumps(events + messages)


async def test_multiturn_reuses_session_and_repeated_text(setup, transport):
    app, client = setup
    await configure(client)
    conv, first = await send(client)
    await finish(app)
    _, second = await send(client, conv)
    await finish(app)
    assert (
        app.state.store.get("tasks", first["id"])["session_id"]
        == app.state.store.get("tasks", second["id"])["session_id"]
    )
    assert len(transport.opened) == 1
    assert len(transport.prompts) == 2 and all(
        "[user]: chào" in p["prompt"][0]["text"] for p in transport.prompts
    )
    assert "Visible session-1" not in transport.prompts[1]["prompt"][0]["text"]


async def test_restart_restores_persisted_session(setup, transport):
    app, client = setup
    await configure(client)
    conv, _ = await send(client)
    await finish(app)
    await app.state.runtime.shutdown()
    _, run = await send(client, conv, content="follow up")
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "completed"
    assert any(m == "session/load" for m, _ in transport.calls)
    assert "session.restored" in {
        e["event_type"] for e in app.state.store.events(run["id"])
    }


async def test_unavailable_restore_replays_real_history(setup, transport):
    app, client = setup
    await configure(client)
    conv, _ = await send(client)
    await finish(app)
    await app.state.runtime.shutdown()
    transport.load_error = True
    _, run = await send(client, conv)
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "completed"
    prompt = transport.prompts[-1]["prompt"][0]["text"]
    assert (
        prompt.count("[user]: chào") == 2 and "[assistant]: Visible session-1" in prompt
    )
    assert "session.recreated" in {
        e["event_type"] for e in app.state.store.events(run["id"])
    }


async def test_concurrent_conversations_do_not_mix(setup, transport):
    app, client = setup
    await configure(client)
    a, ra = await send(client, content="conversation A")
    b, rb = await send(client, content="conversation B")
    await finish(app)
    ma = (await client.get(f"/api/conversations/{a}/messages")).json()
    mb = (await client.get(f"/api/conversations/{b}/messages")).json()
    sa = app.state.store.get("tasks", ra["id"])["session_id"]
    sb = app.state.store.get("tasks", rb["id"])["session_id"]
    assert sa != sb
    assert any(m["content"] == f"Visible {sa}" for m in ma)
    assert any(m["content"] == f"Visible {sb}" for m in mb)
    assert not any(m["content"] == f"Visible {sb}" for m in ma)


@pytest.mark.parametrize(
    "failure",
    [
        ValueError("RESOURCE_EXHAUSTED quota 429"),
        FileNotFoundError("agy.exe"),
        ValueError("AUTH_REQUIRED login"),
        RuntimeError("ACP disconnected"),
        TimeoutError(),
    ],
)
async def test_provider_errors_fail_without_demo(setup, transport, failure):
    app, client = setup
    await configure(client)
    transport.failure = failure
    conv, run = await send(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "failed" and task["mode"] == "real"
    messages = (await client.get(f"/api/conversations/{conv}/messages")).json()
    assert "DEMO" not in json.dumps(messages)
    assert task["error"] in [m["content"] for m in messages]
    assert not app.state.runtime.acp_sessions and transport.closed


async def test_invalid_model_is_not_silently_ignored(setup, transport):
    app, client = setup
    await configure(client, model="unavailable-model")
    _, run = await send(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "failed" and "Model unavailable" in task["error"]
    assert not transport.prompts


async def test_settings_snapshot_and_explicit_demo(setup, transport):
    app, client = setup
    await configure(client)
    _, run = await send(client)
    await client.post("/api/settings", json={"provider": "openai", "mode": "demo"})
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["provider"] == "antigravity"
    count = len(transport.prompts)
    conv, demo = await send(client)
    await finish(app)
    assert app.state.store.get("tasks", demo["id"])["mode"] == "demo"
    assert len(transport.prompts) == count
    assert any(
        "DEMO" in m["content"]
        for m in (await client.get(f"/api/conversations/{conv}/messages")).json()
    )


async def test_cancel_and_shutdown_close_owned_sessions(setup, transport):
    app, client = setup
    await configure(client)
    transport.delay = True
    _, run = await send(client)
    await asyncio.wait_for(transport.started.wait(), 2)
    response = await client.post(
        f"/api/tasks/{run['id']}/control", json={"action": "cancel"}
    )
    assert response.status_code == 200
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "cancelled"
    assert any(m == "session/cancel" for m, _ in transport.calls)
    assert not app.state.runtime.acp_sessions
    assert all(a.proc is None for a in transport.opened)


async def test_discovery_and_connection_status_are_observed(setup, transport):
    _, client = setup
    before = (await client.get("/api/antigravity/status")).json()
    assert before["installed"] and not before["ready"]
    response = (await client.get("/api/antigravity/models")).json()
    assert response["models"] == [{"id": "discovered-model", "name": "Actual model"}]
    status = (await client.get("/api/antigravity/status")).json()
    assert status["ready"] and not status["authenticated"]
    await configure(client)
    result = await client.post("/api/settings/test")
    assert result.status_code == 200
    assert (await client.get("/api/settings")).json()["antigravity"]["authenticated"]


async def test_permissions_deny_default_and_use_offered_option(tmp_path):
    uploads, workspace = tmp_path / "uploads", tmp_path / "workspace"
    uploads.mkdir()
    workspace.mkdir()
    target = uploads / "allowed.csv"
    target.write_text("a,b\n1,2")
    adapter = AntigravityAcpAdapter(
        skill_guard=SkillGuard(uploads, workspace), allowed_read_paths={str(target)}
    )
    allowed = {"name": "read_file", "kind": "read", "rawInput": {"path": str(target)}}
    assert await adapter._evaluate_permission({"toolCall": allowed}) == "allow"
    for call in [
        dict(allowed, kind="execute"),
        dict(allowed, kind="edit"),
        dict(allowed, rawInput={"path": str(uploads / "other.csv")}),
        {"kind": "read", "name": "unknown"},
    ]:
        assert await adapter._evaluate_permission({"toolCall": call}) == "deny"
    sent = []

    async def capture(message):
        sent.append(message)

    adapter._send = capture
    await adapter._handle_server_request(
        {
            "id": 99,
            "method": "session/request_permission",
            "params": {
                "toolCall": {"kind": "execute"},
                "options": [
                    {"kind": "allow_once", "optionId": "permit"},
                    {"kind": "reject_once", "optionId": "reject-this"},
                ],
            },
        }
    )
    assert sent[0]["result"]["outcome"] == {
        "outcome": "selected",
        "optionId": "reject-this",
    }


async def test_acp_reports_workbook_without_supported_columns_before_submission(
    setup, sample_skill, transport
):
    app, client = setup
    await configure(client, model="gemini-3.8-flash-high")
    await approved(client, sample_skill)
    run, _ = await send_file(client, content=b"region,cost\nHanoi,30\nDanang,70\n")
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "failed" and "cột doanh thu" in task["error"]
    assert not task.get("reports") and not transport.prompts
    assert not app.state.store.all("approvals")


@pytest.mark.skipif(
    os.environ.get("AGENTSCOPE_LIVE_ACP") != "1",
    reason="Real authenticated paid ACP request requires explicit opt-in",
)
async def test_live_authenticated_acp(tmp_path):
    adapter = AntigravityAcpAdapter()
    try:
        await adapter.start()
        await adapter.initialize()
        info = await adapter.new_session(tmp_path)
        chunks = []

        async def delta(chunk):
            chunks.append(chunk)

        result = await adapter.prompt(
            info["sessionId"], "chào. Trả lời ngắn bằng tiếng Việt.", on_delta=delta
        )
        assert result["text"] and chunks
        follow = await adapter.prompt(
            info["sessionId"], "Tôi vừa chào bạn bằng ngôn ngữ nào? Trả lời ngắn."
        )
        assert follow["text"]
    finally:
        await adapter.close()


async def test_missing_cli_at_start_is_a_real_error(setup, transport, monkeypatch):
    app, client = setup
    await configure(client)

    async def missing(self):
        raise FileNotFoundError("agy.exe missing")

    monkeypatch.setattr(AntigravityAcpAdapter, "start", missing)
    conv, run = await send(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "failed" and "agy.exe" in task["error"]
    assert not transport.prompts
    assert all(
        "DEMO" not in m["content"]
        for m in (await client.get(f"/api/conversations/{conv}/messages")).json()
    )


async def test_cancel_during_initialize_closes_transport(setup, transport, monkeypatch):
    app, client = setup
    await configure(client)
    initializing = asyncio.Event()

    async def waiting(self):
        initializing.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(AntigravityAcpAdapter, "initialize", waiting)
    _, run = await send(client)
    await asyncio.wait_for(initializing.wait(), 2)
    await client.post(f"/api/tasks/{run['id']}/control", json={"action": "cancel"})
    await finish(app)
    assert app.state.store.get("tasks", run["id"])["status"] == "cancelled"
    assert all(a.proc is None for a in transport.opened)


async def test_rpc_utf8_framing_response_and_eof():
    adapter = AntigravityAcpAdapter()
    reader = asyncio.StreamReader()

    class Writer:
        def __init__(self):
            self.messages = []

        def write(self, value):
            self.messages.append(value)

        async def drain(self):
            pass

    writer = Writer()
    adapter.proc = SimpleNamespace(returncode=None, stdin=writer, stdout=reader)
    reading = asyncio.create_task(adapter._read_stdout())
    try:
        pending = asyncio.create_task(adapter.request("sample", {"text": "chào"}))
        await asyncio.sleep(0)
        assert writer.messages[0].endswith(b"\n")
        wire = json.loads(writer.messages[0])
        assert wire["params"]["text"] == "chào"
        reader.feed_data(
            json.dumps(
                {"jsonrpc": "2.0", "id": str(wire["id"]), "result": {"ok": True}}
            ).encode()
            + b"\n"
        )
        assert await pending == {"ok": True}
        disconnected = asyncio.create_task(adapter.request("next"))
        await asyncio.sleep(0)
        reader.feed_eof()
        with pytest.raises(RuntimeError, match="ACP"):
            await disconnected
        assert not adapter._pending_requests
    finally:
        reading.cancel()
        await asyncio.gather(reading, return_exceptions=True)


async def test_restart_finalizes_interrupted_streams(setup):
    from agentscope.api import create_app
    from agentscope.config import Config

    app, _ = setup
    partial = {
        "id": "partial",
        "conversation_id": "old",
        "role": "assistant",
        "content": "Actual partial",
        "streaming": True,
        "revision": 4,
        "created_at": "2026-11-17T00:00:00Z",
    }
    app.state.store.put("messages", partial)
    restarted = create_app(Config(app.state.runtime.config.root, token="test-session"))
    async with restarted.router.lifespan_context(restarted):
        saved = restarted.state.store.get("messages", "partial")
        assert saved["content"] == partial["content"]
        assert (
            saved["streaming"] is False
            and saved["incomplete"]
            and saved["revision"] == 5
        )


async def test_legacy_real_history_is_replayed_without_demo(setup, transport):
    app, client = setup
    await configure(client)
    conv, run = await send(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    task.pop("user_message_id")
    app.state.store.put("tasks", task)
    for message in app.state.store.all("messages"):
        for key in ["task_id", "mode", "provider"]:
            message.pop(key, None)
        app.state.store.put("messages", message)
    await app.state.runtime.shutdown()
    transport.load_error = True
    await send(client, conv, content="follow up")
    await finish(app)
    assert (
        "[assistant]: Visible session-1" in transport.prompts[-1]["prompt"][0]["text"]
    )


def test_model_discovery_does_not_erase_observed_authentication(monkeypatch):
    monkeypatch.setattr(
        AntigravityAcpAdapter,
        "_connection",
        {"state": "connected", "authenticated": True, "message": "observed AI"},
    )
    AntigravityAcpAdapter.connection_result()
    assert AntigravityAcpAdapter._connection["authenticated"] is True
    AntigravityAcpAdapter.connection_result(ValueError("quota exhausted"))
    assert AntigravityAcpAdapter._connection["state"] == "error"


async def test_prepared_session_is_claimed_by_exactly_one_conversation(
    setup, transport
):
    app, client = setup
    await configure(client)
    runtime = app.state.runtime
    assert (await client.post("/api/antigravity/prepare")).json()["status"] in {
        "preparing",
        "ready",
    }
    await runtime.prepared_acp["task"]
    # Preparation sends no prompt and no user content.
    assert not transport.prompts
    assert (await client.post("/api/antigravity/prepare")).json()["status"] == "ready"
    conv, run = await send(client)
    await finish(app)
    task = app.state.store.get("tasks", run["id"])
    assert task["status"] == "completed" and task["session_id"] == "session-1"
    events = app.state.store.events(run["id"])
    assert any(
        e["event_type"] == "session.created" and e["result"].get("prepared")
        for e in events
    )
    conversation = app.state.store.get("conversations", conv)
    assert conversation["acp_session"]["id"] == "session-1"
    # A second conversation never reuses the claimed session.
    _, other = await send(client)
    await finish(app)
    assert app.state.store.get("tasks", other["id"])["session_id"] != "session-1"
    assert len(transport.opened) == 2


async def test_prepare_is_inactive_in_demo_and_shutdown_closes_unclaimed(
    setup, transport
):
    app, client = setup
    await configure(client, mode="demo")
    assert (await client.post("/api/antigravity/prepare")).json() == {
        "status": "inactive"
    }
    assert not transport.opened
    await configure(client)
    await client.post("/api/antigravity/prepare")
    await app.state.runtime.prepared_acp["task"]
    assert len(transport.opened) == 1
    await app.state.runtime.shutdown()
    assert app.state.runtime.prepared_acp is None
    assert all(adapter.proc is None for adapter in transport.opened)
    assert transport.closed


async def test_demo_trace_is_labeled_and_never_reaches_acp(setup, transport):
    app, client = setup
    await configure(client, mode="demo")
    conv, run = await send(client)
    await finish(app)
    assert not transport.opened and not transport.prompts
    events = app.state.store.events(run["id"])
    assert events and all(e["mode"] == "demo" for e in events)
    assert not any(e["result"].get("observed") for e in events)
    assert not any(e["event_type"].startswith(("tool.", "report.")) for e in events)
    messages = (await client.get(f"/api/conversations/{conv}/messages")).json()
    reply = [m for m in messages if m["role"] == "assistant"]
    assert len(reply) == 1 and reply[0]["content"].startswith("**DEMO")
    # Switching back to Real routes the next message to ACP in the same conversation.
    await configure(client)
    _, real = await send(client, conv)
    await finish(app)
    task = app.state.store.get("tasks", real["id"])
    assert task["mode"] == "real" and task["status"] == "completed"
    assert len(transport.prompts) == 1
