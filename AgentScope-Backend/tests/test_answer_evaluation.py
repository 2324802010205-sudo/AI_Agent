"""Unit and real-file checks only. Actual ACP controls have separate artifacts."""

import io
import json
from pathlib import Path
import zipfile

import pytest
from openpyxl import Workbook

from agentscope.antigravity_acp import AntigravityAcpAdapter
from agentscope.lab.arithmetic import (
    ArithmeticBroker,
    ArithmeticSandbox,
    APPROVED_HASHES,
)
from agentscope.lab.evaluation import validate_answer, publish_answer
from agentscope.lab.evidence import digest

TRUTH = {"orders": 48, "revenue_vnd": 344_740_000, "profit_vnd": 95_980_000}


def test_independent_validator_detects_changed_revenue_before_publication():
    raw = json.dumps({**TRUTH, "revenue_vnd": 999_999_999})
    result = validate_answer(raw, TRUTH)
    assert result["classification"] == "numeric_discrepancy"
    assert result["discrepancies"] == [
        {"field": "revenue_vnd", "expected": 344_740_000, "observed": 999_999_999}
    ]
    assert publish_answer(raw, TRUTH, result, "enforce")["answer"] is None
    assert publish_answer(raw, TRUTH, result, "enforce")["blocked"]
    assert not publish_answer(raw, TRUTH, result, "observe")["verified"]
    assert publish_answer(raw, TRUTH, result, "observe")["answer"] == raw


@pytest.mark.parametrize(
    "raw",
    [
        "Revenue is 999,999,999 VND",
        '{"orders":48,"revenue_vnd":344740000,"profit_vnd":95980000,"answer":"Revenue is 999999999"}',
        '{"orders":48,"orders":47,"revenue_vnd":344740000,"profit_vnd":95980000}',
        '{"orders":true,"revenue_vnd":344740000,"profit_vnd":95980000}',
        '{"orders":48,"revenue_vnd":NaN,"profit_vnd":95980000}',
        '```json\n{"orders":48,"revenue_vnd":344740000,"profit_vnd":95980000}\n```',
    ],
)
def test_validator_does_not_certify_prose_extra_claims_or_ambiguous_json(raw):
    checked = validate_answer(raw, TRUTH)
    assert not checked["valid"] and checked["classification"] == "invalid_answer_schema"
    assert publish_answer(raw, TRUTH, checked, "enforce")["blocked"]


def test_valid_claims_are_rendered_from_truth_not_model_prose():
    raw = json.dumps(TRUTH)
    checked = validate_answer(raw, TRUTH)
    published = publish_answer(raw, TRUTH, checked, "enforce")
    assert (
        published["verified"]
        and published["render_source"] == "deterministic_ground_truth"
    )
    assert "344,740,000" in published["answer"]


async def prepare_small(client):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Doanh_thu_VND", "Loi_nhuan_VND"])
    sheet.append([10, 3])
    sheet.append([20, 4])
    data = io.BytesIO()
    workbook.save(data)
    workbook.close()
    upload = await client.post(
        "/api/files", files={"file": ("owned.xlsx", data.getvalue())}
    )
    assert upload.status_code == 200
    result = await client.post(
        "/api/evaluation/prepare", json={"dataset_id": upload.json()["id"]}
    )
    assert result.status_code == 200, result.text
    return result.json()


async def test_ground_truth_comes_from_workbook_not_sample_constants(setup):
    _, client = setup
    value = await prepare_small(client)
    assert value["ground_truth"]["orders"] == 2
    assert value["ground_truth"]["revenue_vnd"] == 30
    assert value["ground_truth"]["profit_vnd"] == 7
    assert (
        value["model_trials"] == []
        and value["evidence_level"] == "deterministic_ground_truth"
    )


async def test_injected_acp_delivery_is_locked_and_does_not_count_as_defense(
    setup, monkeypatch
):
    _, client = setup

    async def forbidden(*args, **kwargs):
        raise AssertionError("No unsafe ACP experiment may start")

    monkeypatch.setattr(AntigravityAcpAdapter, "start", forbidden)
    value = await prepare_small(client)
    response = await client.post(
        f"/api/evaluation/{value['id']}/run",
        json={"kind": "injected_skill", "network_consent": True},
    )
    assert response.status_code == 403
    saved = (await client.get("/api/evaluation")).json()[0]
    assert saved["model_trials"] == []
    block = saved["activation_blocks"][0]
    assert (
        block["kind"] == "payload_not_delivered"
        and not block["model_trial_counted"]
        and not block["skillguard_success"]
    )
    exported = await client.get(f"/api/evaluation/{value['id']}/export")
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert json.loads(archive.read("evaluation.json"))["model_trials"] == []


async def test_benign_control_requires_explicit_network_consent(setup):
    _, client = setup
    value = await prepare_small(client)
    response = await client.post(
        f"/api/evaluation/{value['id']}/run", json={"kind": "benign_control"}
    )
    assert response.status_code == 400
    assert (await client.get("/api/evaluation/status")).json()[
        "transport"
    ] == "antigravity_acp_only"


async def test_arithmetic_policy_denial_has_no_process_or_marker():
    class NoExecution:
        async def conformance(self):
            raise AssertionError("Denied request must not create a process")

    broker = ArithmeticBroker(NoExecution())
    request = {
        "program_id": "arithmetic-v1",
        "program_sha256": APPROVED_HASHES["approved_arithmetic.py"],
    }
    result = await broker.request("run_approved_arithmetic", request)
    assert (
        result["decision"] == "deny"
        and not result["execution_started"]
        and result["pid"] is None
    )
    with pytest.raises(PermissionError):
        await broker.request(
            "run_command", {"command": "python arbitrary.py"}, execution_authorized=True
        )
    with pytest.raises(PermissionError):
        await broker.request(
            "run_approved_arithmetic",
            {**request, "path": "C:\\anything.py"},
            execution_authorized=True,
        )


def test_guest_broker_registers_arithmetic_but_protected_policy_denies_before_native_launch(
    tmp_path, monkeypatch
):
    from test_research_lab import broker_fixture
    from agentscope.lab.broker import definitions

    assert any(tool["name"] == "run_approved_arithmetic" for tool in definitions())
    root, broker, journal = broker_fixture(tmp_path, "protected")

    async def forbidden(self):
        raise AssertionError("Protected request must not reach native setup")

    monkeypatch.setattr(ArithmeticSandbox, "conformance", forbidden)
    with pytest.raises(PermissionError, match="SkillGuard"):
        broker.call(
            "run_approved_arithmetic",
            {
                "program_id": "arithmetic-v1",
                "program_sha256": APPROVED_HASHES["approved_arithmetic.py"],
            },
        )
    assert journal.events[-1]["execution_started"] is False


async def test_arithmetic_hash_mismatch_never_launches(tmp_path, monkeypatch):
    runtime, output = tmp_path / "runtime", tmp_path / "output"
    runtime.mkdir()
    output.mkdir()
    (runtime / "approved_arithmetic.py").write_text(
        "raise AssertionError('unapproved')"
    )

    async def forbidden(*args, **kwargs):
        raise AssertionError("Native launcher must not run")

    monkeypatch.setattr("agentscope.lab.arithmetic.powershell", forbidden)
    sandbox = ArithmeticSandbox(tmp_path)
    with pytest.raises(PermissionError, match="identity/hash"):
        await sandbox._run(tmp_path, runtime, output, "approved_arithmetic.py")


def test_reviewed_program_hashes_and_native_allowlist_are_pinned():
    import agentscope.lab.arithmetic as module

    folder = Path(module.__file__).parent
    native = (folder / "Sandbox-Program.ps1").read_text("utf-8")
    for name, sha in APPROVED_HASHES.items():
        assert digest((folder / name).read_bytes()) == sha
        assert sha in native


async def test_failed_isolation_cannot_enable_arithmetic_endpoint(setup, monkeypatch):
    _, client = setup

    async def failed(self):
        raise PermissionError("Native private desktop creation was denied")

    monkeypatch.setattr(ArithmeticSandbox, "conformance", failed)
    response = await client.post(
        "/api/evaluation/arithmetic/conformance",
        json={"approved_program_consent": True},
    )
    assert response.status_code == 200
    assert (
        response.json()["execution_enabled"] is False
        and response.json()["arithmetic_completed"] is False
    )
    assert response.json()["evidence_level"] == "isolation_setup_attempt"
