"""Deterministic research infrastructure tests. The transport below is simulated."""

import asyncio
import io
import json
from zipfile import ZipFile

import pytest

from agentscope.experiments import workbook
from agentscope.experiments.functional import ASSET_SHA256, authorized_workbook
from test_chat_experiments import FakeAdapter, lab  # noqa: F401 (fixture)


def test_workbook_variation_preserves_sales_totals(tmp_path):
    original, reversed_rows = tmp_path / "original.xlsx", tmp_path / "reversed.xlsx"
    original.write_bytes(authorized_workbook("original"))
    reversed_rows.write_bytes(authorized_workbook("reversed_rows"))
    assert workbook.sha256(original.read_bytes()) == ASSET_SHA256
    assert workbook.sha256(reversed_rows.read_bytes()) != ASSET_SHA256
    original_truth = workbook.ground_truth(original)
    varied_truth = workbook.ground_truth(reversed_rows)
    assert original_truth.pop("source_sha256") != varied_truth.pop("source_sha256")
    assert original_truth == varied_truth
    original_sheets = workbook.snapshot(original)["sheets"]
    varied_sheets = workbook.snapshot(reversed_rows)["sheets"]
    assert original_sheets[0]["rows"] == list(reversed(varied_sheets[0]["rows"]))


@pytest.mark.parametrize(
    "extra",
    [
        {"content": "arbitrary"},
        {"skill_id": "foreign"},
        {"conditions": ["skillguard_off"]},
        {"attachment_id": "foreign"},
        {"repetitions": 5},
    ],
)
async def test_functional_endpoint_rejects_unbounded_or_caller_controlled_inputs(
    setup, extra
):
    app, client = setup
    response = await client.post(
        "/api/research/functional", json={"confirm": True, **extra}
    )
    assert response.status_code == 422
    assert app.state.functional.job is None


async def test_functional_plan_uses_independent_existing_experiments(lab):
    app, client = lab
    response = await client.post(
        "/api/research/functional", json={"confirm": True, "repetitions": 1}
    )
    assert response.status_code == 200, response.text
    plan = response.json()
    await asyncio.wait_for(app.state.functional.job, 40)
    result = (await client.get(f"/api/research/functional/{plan['id']}")).json()
    assert result["state"] == "finished"
    assert [r["id"] for r in result["runs"]] == [r["id"] for r in plan["runs"]]
    assert len(set(FakeAdapter.sessions)) == 2
    assert len({r["experiment_id"] for r in result["runs"]}) == 2
    assert result["workbook_sha256"] == ASSET_SHA256
    for run in result["runs"]:
        experiment = app.state.experiments.load(run["experiment_id"])
        record = experiment["conditions"][run["condition"]]
        assert experiment["evidence_type"] == "functional_acp"
        assert record["resolved"]["mcp_policy"] == "enforce"
        assert (
            run["state"] == "report_failed"
        )  # Mock transport lacks Windows child attestation.
        assert run["actions"]
    assert (await client.get("/api/experiments")).json() == []
    assert (await client.get("/api/experiments/evaluation")).json()["runs"] == []
    report = await client.get(f"/api/research/functional/{plan['id']}/export/md")
    assert "0/2" in report.text and "report_failed" in report.text


async def test_cancel_marks_unstarted_runs_and_keeps_stable_ids(lab):
    app, client = lab
    FakeAdapter.gate = asyncio.Event()
    started = (
        await client.post(
            "/api/research/functional", json={"confirm": True, "repetitions": 2}
        )
    ).json()
    cancelled = await client.post(f"/api/research/functional/{started['id']}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    await asyncio.wait_for(app.state.functional.job, 25)
    final = app.state.functional.load(started["id"])
    assert final["state"] == "cancelled"
    assert final["runs"][-1]["state"] == "cancelled"
    assert [r["id"] for r in final["runs"]] == [r["id"] for r in started["runs"]]
    assert [run["condition"] for run in final["runs"]] == [
        "baseline",
        "skillguard_on",
        "skillguard_on",
        "baseline",
    ]


async def test_timeout_preserves_both_planned_results(lab):
    app, client = lab
    FakeAdapter.gate = asyncio.Event()
    app.state.functional.timeout_seconds = 0.1
    plan = (
        await client.post("/api/research/functional", json={"confirm": True})
    ).json()
    await asyncio.wait_for(app.state.functional.job, 20)
    final = app.state.functional.load(plan["id"])
    assert final["state"] == "finished"
    assert [row["state"] for row in final["runs"]] == ["timed_out", "timed_out"]
    assert all(row["duration_ms"] >= 100 for row in final["runs"])


def archive_fixture(extra_name=None):
    output = io.BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "id": "a" * 32,
                    "model": "simulated-model",
                    "conditions": {
                        "baseline": {"state": "completed", "task_id": "sample"}
                    },
                }
            ),
        )
        archive.writestr(
            "baseline/evidence.json",
            json.dumps(
                {
                    "delivery": {
                        "model_exposure": "acknowledged",
                        "prompt_completed": True,
                    },
                    "mcp_journal": [
                        {"event": "proposal", "tool": "list_sheets", "sequence": 1}
                    ],
                    "workspace_artifacts": [],
                }
            ),
        )
        if extra_name:
            archive.writestr(extra_name, "inert fixture")
    return output.getvalue()


async def test_import_is_immutable_and_never_enqueues_runs(setup):
    app, client = setup
    data = archive_fixture()
    response = await client.post(
        "/api/research/evidence-imports",
        data={"evidence_type": "synthetic"},
        files={"file": ("experiment.zip", data)},
    )
    assert response.status_code == 200, response.text
    metadata = response.json()
    digest = workbook.sha256(data)
    assert metadata["id"] == digest
    stored = (
        app.state.experiments.config.root / "imported-evidence" / digest / "trace.zip"
    )
    assert stored.read_bytes() == data
    result = (await client.get(f"/api/research/evidence-imports/{digest}")).json()
    assert result["evidence_type"] == "synthetic"
    assert result["runs"][0]["actions"][0]["stage"] == "PROPOSED"
    assert (await client.get("/api/experiments/evaluation")).json()["runs"] == []
    assert not app.state.experiments.tasks and app.state.functional.job is None
    assert (
        await client.post(
            "/api/research/evidence-imports",
            data={"evidence_type": "historical_acp"},
            files={"file": ("copy.zip", data)},
        )
    ).status_code == 409
    assert (
        await client.post(
            "/api/research/evidence-imports",
            data={"evidence_type": "synthetic"},
            files={"file": ("bad.zip", archive_fixture("../outside.txt"))},
        )
    ).status_code == 400
    stored.write_bytes(b"tampered test archive")
    assert (
        await client.get(f"/api/research/evidence-imports/{digest}")
    ).status_code == 409


async def test_offline_checks_report_simulated_policy_and_clean_skill(setup):
    app, client = setup
    report = (await client.get("/api/research/offline-checks")).json()
    assert report["evidence_type"] == "synthetic"
    assert len(report["checks"]) == 6 and all(
        check["passed"] for check in report["checks"]
    )
    assert not app.state.experiments.tasks
