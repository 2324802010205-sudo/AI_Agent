"""Explicit live latency probe. Uses an isolated profile, never user conversations."""

import argparse
import asyncio
import json
import time
from pathlib import Path
from uuid import uuid4
import httpx
from agentscope.api import create_app
from agentscope.antigravity_acp import AntigravityAcpAdapter
from agentscope.config import Config


async def profile(args):
    root = Path(__file__).resolve().parents[1]
    app = create_app(
        Config(root / f".agentscope-latency-{uuid4()}", token="latency-probe")
    )
    app.state.store.put(
        "settings",
        {"id": "main", "provider": "antigravity", "model": args.model, "mode": "real"},
    )
    report = {
        "cli_version": AntigravityAcpAdapter.get_version(),
        "configured_model": args.model,
        "profile": str(app.state.runtime.config.root),
        "turns": [],
    }
    current = None
    original_request = AntigravityAcpAdapter.request
    original_start = AntigravityAcpAdapter.start
    originals = {}

    async def request(adapter, method, params=None, timeout=60):
        start = time.perf_counter()
        try:
            return await original_request(adapter, method, params, timeout)
        finally:
            if current is not None:
                current["rpc"].append(
                    {
                        "method": method,
                        "duration_ms": round((time.perf_counter() - start) * 1000, 3),
                    }
                )

    class Updates(asyncio.Queue):
        async def put(self, item):
            update = item.get("params", {}).get("update", {})
            if (
                current is not None
                and update.get("sessionUpdate") == "agent_message_chunk"
            ):
                current["visible_chunks_received"] += 1
                current.setdefault(
                    "first_visible_received_ms",
                    round((time.perf_counter() - current["start"]) * 1000, 3),
                )
            return await super().put(item)

    async def start(adapter):
        await original_start(adapter)
        adapter._updates = Updates()

    AntigravityAcpAdapter.request, AntigravityAcpAdapter.start = request, start
    for name in ("put", "event", "get", "all"):
        original = getattr(app.state.store, name)
        originals[name] = original

        def measure(*values, _original=original, _name=name, **kwargs):
            begin = time.perf_counter()
            try:
                return _original(*values, **kwargs)
            finally:
                if current is not None:
                    current["sqlite_calls"] += 1
                    current["sqlite_ms"] += (time.perf_counter() - begin) * 1000

        setattr(app.state.store, name, measure)
    try:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
                headers={"Authorization": "Bearer latency-probe"},
            ) as client:
                conv = (await client.post("/api/conversations")).json()["id"]
                for index in range(args.turns):
                    current = {
                        "turn": index + 1,
                        "start": time.perf_counter(),
                        "rpc": [],
                        "sqlite_calls": 0,
                        "sqlite_ms": 0,
                        "visible_chunks_received": 0,
                    }
                    preflight = time.perf_counter()
                    (await client.get("/api/settings")).raise_for_status()
                    current["settings_preflight_ms"] = round(
                        (time.perf_counter() - preflight) * 1000, 3
                    )
                    current["start"] = time.perf_counter()
                    response = await client.post(
                        f"/api/conversations/{conv}/messages",
                        json={"content": "chào. Trả lời ngắn gọn trong một câu."},
                    )
                    response.raise_for_status()
                    run = response.json()["run"]
                    current["submit_ms"] = round(
                        (time.perf_counter() - current["start"]) * 1000, 3
                    )
                    operation = app.state.runtime.background.get(run["id"])
                    if operation:
                        await asyncio.wait_for(asyncio.shield(operation), 150)
                    current["total_ms"] = round(
                        (time.perf_counter() - current["start"]) * 1000, 3
                    )
                    task = app.state.store.get("tasks", run["id"])
                    events = app.state.store.events(run["id"])
                    current.update(
                        status=task["status"],
                        model=task["model"],
                        timings=task.get("timings"),
                        error=task.get("error"),
                        stream_updates=sum(
                            e["event_type"] == "provider.response.streaming"
                            for e in events
                        ),
                        session_id=task.get("session_id"),
                    )
                    current["sqlite_ms"] = round(current["sqlite_ms"], 3)
                    current.pop("start")
                    report["turns"].append(current)
                    print(json.dumps(current, ensure_ascii=True), flush=True)
                    if task["status"] != "completed":
                        break
                    current = None
    finally:
        AntigravityAcpAdapter.request, AntigravityAcpAdapter.start = (
            original_request,
            original_start,
        )
        for name, method in originals.items():
            setattr(app.state.store, name, method)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live",
        action="store_true",
        help="Explicitly allow real authenticated requests that consume quota",
    )
    parser.add_argument("--turns", type=int, choices=range(1, 5), default=2)
    parser.add_argument(
        "--model",
        default="",
        help="Keep empty for the actual CLI session model; never switches thinking level",
    )
    parser.add_argument(
        "--output", type=Path, default=Path("artifacts/acp-latency.json")
    )
    args = parser.parse_args()
    if not args.live:
        parser.error("Pass --live to explicitly allow paid authenticated prompts")
    asyncio.run(profile(args))
