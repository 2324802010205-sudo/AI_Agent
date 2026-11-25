"""Authenticated endpoints for functional controls, imports and offline checks."""

import asyncio
import csv
import io
import json
from typing import Literal

from fastapi import File, Form, UploadFile
from fastapi.responses import Response

from . import conditions, evaluation, skillguard
from .functional import CLEAN_SKILL, FunctionalEvaluation, StartFunctional
from .imported_evidence import MAX_BYTES, ImportedEvidence
from .trial import SERVER, allowlist_policy


def offline_checks():
    clean_text = CLEAN_SKILL.decode("utf-8")
    references = skillguard.inspect_text(
        "Documentation mentions workbook-helper.py.", ["workbook-helper.py"]
    )
    policy = conditions.resolve("skillguard_on", "quarantine", functional=True)
    clean = skillguard.decide(
        policy, {"security": {"assessment": "no_significant_findings"}}, clean_text
    )
    flagged_fixture = skillguard.decide(
        policy,
        {"security": {"assessment": "high_risk_behavior"}},
        "Synthetic policy fixture.",
    )
    permitted, _ = allowlist_policy(
        {"kind": "other", "name": f"mcp_{SERVER}_list_sheets"}
    )
    denied, _ = allowlist_policy({"kind": "other", "name": "unregistered-fixture-tool"})
    return {
        "evidence_type": "synthetic",
        "checks": [
            {
                "label": "Tham chiếu tên tệp được phát hiện bằng quét tĩnh",
                "passed": any(
                    item.get("rule") == "bundled_code_reference" for item in references
                ),
            },
            {
                "label": "Skill sạch đi qua bước kiểm tra tĩnh",
                "passed": clean["deliver"] and not clean["findings"],
            },
            {
                "label": "Metadata rủi ro giả lập bị cách ly",
                "passed": flagged_fixture["decision"] == "quarantined_before_exposure",
            },
            {
                "label": "Công cụ bảng tính đã đăng ký được cấp quyền",
                "passed": permitted == "allow",
            },
            {
                "label": "Công cụ giả lập chưa đăng ký bị từ chối",
                "passed": denied == "deny",
            },
            {
                "label": "Đối chứng dùng quyền MCP thực thi bắt buộc",
                "passed": conditions.resolve("baseline", "quarantine", functional=True)[
                    "mcp_policy"
                ]
                == "enforce",
            },
        ],
    }


def functional_export(campaign, extension):
    rows = campaign["runs"]
    if extension == "md":
        successful = sum(
            row["state"] == "completed" and row.get("verified_report") is True
            for row in rows
        )
        return "\n".join(
            [
                "# Đối chứng chức năng Gemini ACP · AppContainer ON",
                "",
                f"Đợt `{campaign['id']}` · Model `{campaign['model']}` · Workbook `{campaign['workbook_variant']}`",
                f"SHA-256 workbook `{campaign['workbook_sha256']}`",
                f"XLSX hoàn tất và khớp biên nhận {successful}/{len(rows)} lượt đã lên kế hoạch.",
                "Temperature chưa có bằng chứng. Các lượt lỗi, hết hạn và hủy vẫn xuất hiện trong bảng.",
                "",
                "| ID lượt | Điều kiện | Kết quả | Thời gian (ms) | Đối chiếu XLSX | SHA-256 XLSX |",
                "|---|---|---|---:|---|---|",
                *[
                    f"| {row['id']} | {conditions.SHORT_LABELS[row['condition']]} | {row['state']} | {row.get('duration_ms', '—')} | {'Đạt' if row.get('verified_report') else '—'} | {row.get('report_sha256') or '—'} |"
                    for row in rows
                ],
                "",
            ]
        )
    output = io.StringIO()
    fields = [
        "campaign_id",
        "evidence_type",
        "model",
        "temperature",
        "workbook_sha256",
        "skill_sha256",
        "appcontainer",
        "id",
        "condition",
        "repetition",
        "state",
        "started_at",
        "finished_at",
        "duration_ms",
        "experiment_id",
        "session_id",
        "report_sha256",
        "verified_report",
        "error",
        "actions",
    ]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        data = {**campaign, **row, "campaign_id": campaign["id"]}

        def cell(value):
            if isinstance(value, (list, dict)):
                return json.dumps(value, ensure_ascii=False)
            if isinstance(value, str) and value.lstrip().startswith(
                ("=", "+", "-", "@")
            ):
                return "'" + value
            return value

        writer.writerow({field: cell(data.get(field)) for field in fields})
    return "\ufeff" + output.getvalue()


def download(content, extension, stem):
    return Response(
        content,
        media_type="text/csv" if extension == "csv" else "text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{stem}.{extension}"'},
    )


def register_research_runner_routes(app, experiments):
    functional = FunctionalEvaluation(experiments)
    imports = ImportedEvidence(experiments.config.root)
    app.state.functional = functional

    @app.get("/api/research/functional")
    async def functional_history():
        return functional.all()

    @app.post("/api/research/functional")
    async def functional_start(body: StartFunctional):
        return functional.start(body)

    @app.get("/api/research/functional/{identifier}")
    async def functional_result(identifier: str):
        return await asyncio.to_thread(functional.results, identifier)

    @app.post("/api/research/functional/{identifier}/cancel")
    async def functional_cancel(identifier: str):
        return functional.cancel(identifier)

    @app.get("/api/research/functional/{identifier}/export/{extension}")
    async def export_functional(identifier: str, extension: Literal["csv", "md"]):
        campaign = await asyncio.to_thread(functional.results, identifier)
        return download(
            functional_export(campaign, extension), extension, "gemini-functional"
        )

    @app.get("/api/research/evidence-imports")
    async def evidence_imports():
        return await asyncio.to_thread(imports.all)

    @app.post("/api/research/evidence-imports")
    async def import_evidence(
        file: UploadFile = File(...),
        evidence_type: Literal["historical_acp", "synthetic"] = Form(...),
    ):
        return await asyncio.to_thread(
            imports.import_archive, await file.read(MAX_BYTES + 1), evidence_type
        )

    @app.get("/api/research/evidence-imports/{identifier}")
    async def imported_result(identifier: str):
        return await asyncio.to_thread(imports.results, identifier)

    @app.get("/api/research/evidence-imports/{identifier}/export/{extension}")
    async def export_imported(identifier: str, extension: Literal["csv", "md"]):
        source = await asyncio.to_thread(imports.results, identifier)
        if extension == "csv":
            content = evaluation.csv_report(source)
        else:
            kind = (
                "ACP lưu trữ (nguồn do người nhập khai báo)"
                if source["evidence_type"] == "historical_acp"
                else "Dữ liệu giả lập"
            )
            content = (
                f"Nguồn {kind} · SHA-256 `{source['sha256']}`\n\n"
                + evaluation.markdown_report(source)
            )
        return download(content, extension, "imported-research-evidence")

    @app.get("/api/research/offline-checks")
    async def run_offline():
        return offline_checks()
