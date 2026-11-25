"""Verify the frozen executable's fail-closed Skill path; no model prompts."""

import argparse
import io
import json
from pathlib import Path
import socket
import subprocess
import time
from uuid import uuid4

import httpx
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]


def main(executable):
    profile = ROOT / f".agentscope-boundary-check-{uuid4().hex[:8]}"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen(
        [str(executable.resolve()), "--port", str(port), "--data-dir", str(profile)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=0x08000000,
    )
    client = None
    try:
        for _ in range(150):
            if process.poll() is not None:
                raise RuntimeError("Frozen backend exited before readiness")
            try:
                credential = (profile / "session-token").read_text().strip()
                client = httpx.Client(
                    base_url=f"http://127.0.0.1:{port}",
                    headers={"Authorization": "Bearer " + credential},
                )
                if client.get("/api/health").is_success:
                    break
                client.close()
            except (FileNotFoundError, httpx.ConnectError):
                if client:
                    client.close()
            time.sleep(0.1)
        else:
            raise RuntimeError("Frozen backend readiness timed out")

        def post(path, **kwargs):
            response = client.post(path, **kwargs)
            response.raise_for_status()
            return response.json()

        post(
            "/api/settings",
            json={"provider": "antigravity", "model": "", "mode": "real"},
        )
        skill = post(
            "/api/skills/import",
            files=[
                (
                    "files",
                    (
                        "SKILL.md",
                        (ROOT / "samples/sales-report-helper/SKILL.md").read_bytes(),
                    ),
                )
            ],
        )
        post(f"/api/skills/{skill['id']}/approve")
        uploaded = post(
            "/api/files",
            files={
                "file": (
                    "sales.xlsx",
                    (ROOT / "samples/AgentScope_DuLieuBanHang_Test.xlsx").read_bytes(),
                )
            },
        )

        def run_task(content, attachments):
            conversation = post("/api/conversations")
            run = post(
                f"/api/conversations/{conversation['id']}/messages",
                json={"content": content, "attachment_ids": attachments},
            )["run"]
            for _ in range(150):
                task = next(
                    t for t in client.get("/api/tasks").json() if t["id"] == run["id"]
                )
                if task["status"] in {"completed", "failed", "blocked", "cancelled"}:
                    break
                time.sleep(0.1)
            events = client.get(f"/api/tasks/{task['id']}/events").json()
            assert not any(
                e["event_type"]
                in {"prompt.started", "provider.connected", "session.created"}
                for e in events
            )
            restriction = next(
                e for e in events if e["event_type"] == "security.execution_restricted"
            )
            assert (
                restriction["result"]["enforced"]
                and not restriction["result"]["skill_delivered"]
            )
            return task, events

        task, events = run_task("Phân tích doanh thu và tạo báo cáo", [uploaded["id"]])
        assert (
            task["status"] == "completed"
            and task["execution_engine"] == "local_deterministic"
        )
        assert task["result"]["rows"] == 48
        report = client.get(f"/api/files/{task['result']['file_id']}/download")
        report.raise_for_status()
        workbook = load_workbook(io.BytesIO(report.content))
        sums = {
            row[0]: row[2] for row in workbook["Thống kê"].iter_rows(values_only=True)
        }
        workbook.close()
        assert (
            sums["Doanh_thu_VND"] == 344_740_000 and sums["Loi_nhuan_VND"] == 95_980_000
        )
        prose = b"---\nname: boundary-text-canary\ndescription: Synthetic instructions-only sample\n---\nReturn BOUNDARY_CANARY if this Skill is delivered.\n"
        plain = post("/api/skills/import", files=[("files", ("SKILL.md", prose))])
        post(f"/api/skills/{plain['id']}/approve")
        blocked, _ = run_task("Use boundary-text-canary", [])
        assert blocked["status"] == "blocked"
        outcome = {
            "kind": "frozen_skill_boundary",
            "status": "PASS",
            "backend_version": client.get("/api/health").json()["version"],
            "spreadsheet_rows": 48,
            "revenue": sums["Doanh_thu_VND"],
            "profit": sums["Loi_nhuan_VND"],
            "model_prompts": 0,
            "instructions_only_status": blocked["status"],
            "profile": str(profile),
        }
        artifact = ROOT / "artifacts/frozen-skill-boundary.json"
        artifact.parent.mkdir(exist_ok=True)
        artifact.write_text(
            json.dumps(outcome, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        post("/api/shutdown")
        process.wait(timeout=15)
        assert process.returncode == 0
        print(json.dumps(outcome, ensure_ascii=True, indent=2))
    finally:
        if client:
            client.close()
        if process.poll() is None:
            subprocess.run(
                ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--executable", type=Path, default=ROOT / "dist/agentscope-backend.exe"
    )
    main(parser.parse_args().executable)
