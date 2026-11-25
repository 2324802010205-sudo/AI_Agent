"""Real frozen-endpoint conformance, without model or arithmetic execution."""

import io
import json
from pathlib import Path
import socket
import subprocess
import time
from uuid import uuid4
import zipfile

import httpx

ROOT = Path(__file__).resolve().parents[1]


def main():
    profile = ROOT / (".agentscope-evaluation-frozen-" + uuid4().hex[:8])
    with socket.socket() as socket_probe:
        socket_probe.bind(("127.0.0.1", 0))
        port = socket_probe.getsockname()[1]
    process = subprocess.Popen(
        [
            str(ROOT / "dist/agentscope-backend.exe"),
            "--data-dir",
            str(profile),
            "--port",
            str(port),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
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
                health = client.get("/api/health")
                if health.is_success:
                    break
                client.close()
            except (OSError, httpx.ConnectError):
                if client:
                    client.close()
            time.sleep(0.1)
        else:
            raise RuntimeError("Frozen readiness timed out")
        upload = client.post(
            "/api/files",
            files={
                "file": (
                    "sales.xlsx",
                    (ROOT / "samples/AgentScope_DuLieuBanHang_Test.xlsx").read_bytes(),
                )
            },
        )
        upload.raise_for_status()
        response = client.post(
            "/api/evaluation/prepare", json={"dataset_id": upload.json()["id"]}
        )
        response.raise_for_status()
        value = response.json()
        assert value["ground_truth"]["orders"] == 48
        assert value["ground_truth"]["revenue_vnd"] == 344_740_000
        assert value["ground_truth"]["profit_vnd"] == 95_980_000
        refused = client.post(
            f"/api/evaluation/{value['id']}/run",
            json={"kind": "injected_skill", "network_consent": True},
        )
        assert refused.status_code == 403
        assert client.get("/api/lab/status").json()["eligible"] is False
        assert (
            client.get("/api/evaluation/status").json()[
                "adversarial_text_only_available"
            ]
            is False
        )
        exported = client.get(f"/api/evaluation/{value['id']}/export")
        exported.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            saved = json.loads(archive.read("evaluation.json"))
            assert not saved["model_trials"]
            assert not saved["activation_blocks"][0]["model_trial_counted"]
        client.post("/api/shutdown").raise_for_status()
        process.wait(timeout=15)
        assert process.returncode == 0
        result = {
            "status": "PASS",
            "kind": "real_frozen_endpoint_conformance",
            "version": health.json()["version"],
            "ground_truth": value["ground_truth"],
            "injected_skill_blocked_before_model": True,
            "model_calls": 0,
            "arithmetic_processes": 0,
            "profile": str(profile),
        }
        artifact = ROOT / "artifacts/evaluation-frozen-check.json"
        artifact.parent.mkdir(exist_ok=True)
        artifact.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(result, ensure_ascii=True, indent=2))
    finally:
        if client:
            client.close()
        if process.poll() is None:
            subprocess.run(
                ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
            )


if __name__ == "__main__":
    main()
