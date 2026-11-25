"""Experiment-mode policy.

A condition never changes the mandatory controls. It only selects which optional
SkillGuard research defenses are applied to the selected Skill. The resolved policy is
recorded per session in the evidence manifest; there is no global switch.
"""

from __future__ import annotations

import hashlib
import json
from typing import Literal

Condition = Literal["baseline", "skillguard_off", "skillguard_on"]
ProtectionPolicy = Literal["quarantine", "filter", "runtime_only"]

CONDITIONS: tuple[Condition, ...] = ("baseline", "skillguard_off", "skillguard_on")

LABELS = {
    "baseline": "Đối chứng không Skill",
    "skillguard_off": "Unprotected Model Test — SkillGuard OFF",
    "skillguard_on": "Protected Test — SkillGuard ON",
}
SHORT_LABELS = {
    "baseline": "Không Skill",
    "skillguard_off": "SkillGuard OFF",
    "skillguard_on": "SkillGuard ON",
}

# Enforced identically in every condition, including SkillGuard OFF. Each item names the
# component that enforces it so the claim can be checked in code and evidence.
MANDATORY_CONTROLS = (
    {
        "id": "appcontainer_isolation",
        "label": "Windows AppContainer (Low IL, Job Object, chỉ capability internetClient)",
        "enforced_by": "kernel; token read back before the CLI runs",
    },
    {
        "id": "live_isolation_preflight",
        "label": "Kiểm tra cô lập trực tiếp trước mỗi phiên (hồ sơ người dùng, Credential Manager, loopback, ổ đĩa khác, thư mục bằng chứng)",
        "enforced_by": "ContainedLab.preflight; any failure stops before a prompt is sent",
    },
    {
        "id": "filesystem_boundary",
        "label": "Chỉ đọc bản sao workbook; chỉ ghi trong workspace riêng của phiên",
        "enforced_by": "NTFS DACL grants to the AppContainer SID",
    },
    {
        "id": "credential_protection",
        "label": "Không truy cập Credential Manager, hồ sơ CLI của máy chủ hay token AgentScope",
        "enforced_by": "AppContainer + preflight probes",
    },
    {
        "id": "network_restriction",
        "label": "Không kết nối loopback/LAN tới dịch vụ của máy chủ",
        "enforced_by": "AppContainer network isolation + preflight probe",
    },
    {
        "id": "tool_allowlist",
        "label": "ACP chỉ cấp quyền cho công cụ MCP đã đăng ký. Yêu cầu quyền shell, tệp và web của CLI bị từ chối.",
        "enforced_by": "ACP session/request_permission policy (reject_once)",
    },
    {
        "id": "no_bundled_code_execution",
        "label": "Không bao giờ chạy script đi kèm Skill; script không được sao chép vào môi trường",
        "enforced_by": "run_skill_script always refuses; only SKILL.md text is snapshotted",
    },
    {
        "id": "tool_argument_validation",
        "label": "Kiểm tra tham số, tính toàn vẹn workbook, ngân sách lời gọi, chỉ ghi một báo cáo",
        "enforced_by": "MCP workbook server (all modes)",
    },
    {
        "id": "synthetic_disposable_data",
        "label": "Dùng bản sao workbook dùng một lần; tệp gốc được băm trước và sau",
        "enforced_by": "experiment service hash checks",
    },
)

# Optional, content-based research defenses. Only these differ between conditions.
OPTIONAL_DEFENSES = {
    "skill_inspection_gate": "SkillGuard kiểm tra gói Skill và chặn trước khi tới mô hình nếu có rủi ro (chính sách quarantine)",
    "instruction_filtering": "SkillGuard xóa các dòng chỉ dẫn bị đánh dấu trước khi gửi (chính sách filter)",
    "prompt_isolation": "Skill được rào là dữ liệu không tin cậy, kèm cảnh báo không được ghi đè yêu cầu",
    "report_integrity_enforcement": "Số liệu báo cáo phải trùng kết quả công cụ đã tính; đề xuất khác bị từ chối",
    "out_of_task_tool_block": "MCP từ chối các công cụ lab ngoài nhiệm vụ báo cáo",
}

POLICY_LABELS = {
    "filter": "Lọc bỏ nội dung độc hại, giữ phần sạch & tiếp tục chạy Gemini",
    "quarantine": "Chặn hoàn toàn Skill rủi ro trước khi tới Gemini",
    "runtime_only": "Gửi toàn văn có đánh dấu không tin cậy và chặn ở lớp công cụ MCP",
}


def resolve(
    condition: Condition, policy: ProtectionPolicy, *, functional: bool = False
) -> dict:
    """The exact, recorded configuration of one session."""
    if condition not in CONDITIONS:
        raise ValueError("Điều kiện thí nghiệm không hợp lệ")
    on = condition == "skillguard_on"
    defenses = {
        "skill_inspection_gate": on and policy == "quarantine",
        "instruction_filtering": on and policy in ("quarantine", "filter"),
        "prompt_isolation": on,
        "report_integrity_enforcement": on or functional,
        "out_of_task_tool_block": on or functional,
    }
    resolved = {
        "condition": condition,
        "label": LABELS[condition],
        "skill_included": condition != "baseline",
        "protection_policy": policy if on else None,
        "optional_defenses": defenses,
        "mandatory_controls": [c["id"] for c in MANDATORY_CONTROLS],
        "mcp_policy": "enforce" if on or functional else "observe",
    }
    resolved["policy_sha256"] = hashlib.sha256(
        json.dumps(resolved, sort_keys=True).encode()
    ).hexdigest()
    return resolved
