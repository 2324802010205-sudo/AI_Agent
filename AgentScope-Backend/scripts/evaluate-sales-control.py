"""One ordinary authenticated ACP sales control; no adversarial Skill delivery."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from agentscope.api import create_app  # noqa: E402
from agentscope.config import Config  # noqa: E402
from agentscope.antigravity_acp import AntigravityAcpAdapter  # noqa: E402


async def main(args):
    if not args.live:
        raise SystemExit(
            "Use --live for one paid/authenticated benign control; injected Skill delivery remains locked"
        )
    profile = ROOT / (".agentscope-answer-control-" + uuid4().hex[:8])
    app = create_app(Config(profile, token="local-evaluation-check"))
    settings_path = AntigravityAcpAdapter.cli_settings_path()
    settings_before = hashlib.sha256(settings_path.read_bytes()).hexdigest()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers={"Authorization": "Bearer local-evaluation-check"},
            timeout=180,
        ) as client:
            upload = await client.post(
                "/api/files",
                files={
                    "file": (
                        "sales.xlsx",
                        (
                            ROOT / "samples/AgentScope_DuLieuBanHang_Test.xlsx"
                        ).read_bytes(),
                    )
                },
            )
            upload.raise_for_status()
            skill = await client.post(
                "/api/skills/import",
                files=[
                    (
                        "files",
                        (
                            "SKILL.md",
                            (
                                ROOT
                                / "samples/evaluation-skills/revenue-contamination/SKILL.md"
                            ).read_bytes(),
                        ),
                    )
                ],
            )
            skill.raise_for_status()
            approved = await client.post(f"/api/skills/{skill.json()['id']}/approve")
            approved.raise_for_status()
            prepared = await client.post(
                "/api/evaluation/prepare",
                json={
                    "dataset_id": upload.json()["id"],
                    "skill_id": skill.json()["id"],
                },
            )
            prepared.raise_for_status()
            identifier = prepared.json()["id"]
            denied = await client.post(
                f"/api/evaluation/{identifier}/run",
                json={"kind": "injected_skill", "network_consent": True},
            )
            assert denied.status_code == 403
            observed = await client.post(
                f"/api/evaluation/{identifier}/run",
                json={
                    "kind": "benign_control",
                    "model": args.model,
                    "publication_mode": "enforce",
                    "network_consent": True,
                },
            )
            observed.raise_for_status()
            value = observed.json()
            evidence = await client.get(f"/api/evaluation/{identifier}/export")
            evidence.raise_for_status()
    report = {
        "profile": str(profile),
        "evaluation": value,
        "global_cli_settings_unchanged": hashlib.sha256(
            settings_path.read_bytes()
        ).hexdigest()
        == settings_before,
    }
    target = ROOT / "artifacts/answer-control-observation.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    target.with_suffix(".zip").write_bytes(evidence.content)
    trial = value["model_trials"][0]
    print(
        json.dumps(
            {
                "artifact": str(target),
                "ground_truth": value["ground_truth"],
                "kind": trial["kind"],
                "evidence_level": trial["evidence_level"],
                "mode": trial.get("mode"),
                "raw_model_answer": trial.get("raw_model_answer"),
                "validation": trial.get("integrity_validation"),
                "error": trial.get("error"),
                "injected_skill_delivered": trial["skill_delivered"],
                "global_cli_settings_unchanged": report[
                    "global_cli_settings_unchanged"
                ],
            },
            ensure_ascii=True,
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--model", default="gemini-3.8-flash-high")
    asyncio.run(main(parser.parse_args()))
