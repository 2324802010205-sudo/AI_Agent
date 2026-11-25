"""Exercise the actual frozen executable without exposing its session token."""

import io
import socket
import subprocess
import time
from pathlib import Path

import httpx
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "dist/agentscope-backend.exe"
DATA = ROOT / ".agentscope-frozen-check"


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen(
        [str(EXE), "--port", str(port), "--data-dir", str(DATA)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=0x08000000,
    )
    client = None
    try:
        for _ in range(150):
            if process.poll() is not None:
                raise RuntimeError(process.stderr.read().decode(errors="replace"))
            try:
                token = (DATA / "session-token").read_text().strip()
                client = httpx.Client(
                    base_url=f"http://127.0.0.1:{port}",
                    headers={"Authorization": f"Bearer {token}"},
                )
                if client.get("/api/health").is_success:
                    break
            except (FileNotFoundError, httpx.ConnectError):
                pass
            time.sleep(0.1)
        else:
            raise RuntimeError("Frozen backend failed readiness check")
        research = client.get("/api/research/policy").json()
        assert research["mcp_server_sha256"], "workbook MCP server missing from bundle"
        assert client.get("/api/research/readiness").json()["state"] in (
            "unchecked",
            "ready",
            "unavailable",
        )
        print("research policy ok; mcp_server_sha256", research["mcp_server_sha256"])
        # Verify local spreadsheet tools without making a paid AI request.
        client.post(
            "/api/settings", json={"provider": "openai", "model": "", "mode": "real"}
        ).raise_for_status()
        skill = client.post(
            "/api/skills/import",
            files=[
                (
                    "files",
                    (
                        "SKILL.md",
                        (ROOT / "samples/spreadsheet-analysis/SKILL.md").read_bytes(),
                    ),
                )
            ],
        )
        skill.raise_for_status()
        client.post(f"/api/skills/{skill.json()['id']}/approve").raise_for_status()
        uploaded = client.post(
            "/api/files",
            files={
                "file": (
                    "revenue.csv",
                    (ROOT / "samples/doanh-thu.csv").read_bytes(),
                )
            },
        )
        uploaded.raise_for_status()
        conversation = client.post("/api/conversations").json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages",
            json={
                "content": "Phân tích doanh thu",
                "attachment_ids": [uploaded.json()["id"]],
                "mode": "real",
            },
        )
        response.raise_for_status()
        run_id = response.json()["run"]["id"]
        for _ in range(100):
            run = next(r for r in client.get("/api/tasks").json() if r["id"] == run_id)
            if run["status"] in {"completed", "failed", "blocked"}:
                break
            time.sleep(0.1)
        assert run["status"] == "completed", run
        response = client.get(f"/api/files/{run['result']['file_id']}/download")
        response.raise_for_status()
        workbook = load_workbook(io.BytesIO(response.content))
        assert workbook["Dữ liệu"].max_row == 10
        workbook.close()
        client.post("/api/shutdown").raise_for_status()
        process.wait(timeout=15)
        assert process.returncode == 0, process.returncode
        print(
            "Frozen backend: readiness, Skill review, real CSV analysis, Excel download and clean shutdown PASS"
        )
    finally:
        if client:
            client.close()
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
