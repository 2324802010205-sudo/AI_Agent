"""Multi-Skill context for one task: plan, bound, present and attest Skill instructions.

Every enabled and authorized Skill is offered to the model in one prompt prefix. Each Skill
sits in its own bounded block that carries its unique ID and SHA-256, so Skills sharing a
display name stay distinguishable. Only ``SKILL.md`` text is ever delivered. Bundled files
are listed but neither delivered nor executed.

The plan never drops a Skill silently. A Skill that is not delivered (too large, over the
context budget, blocked by SkillGuard, failed integrity) is reported with its reason, and
Skills that ask for tools AgentScope does not provide are flagged. The receipt lists what
was exposed, and ``attest`` re-checks it against the text actually submitted over ACP.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict

from .prompting import neutralize
from .skills import SkillRegistry, discovery_score, meaningful_words

FORMAT = "agentscope-multi-skill-v1"
MAX_SKILL_CHARS = 60_000
MAX_CONTEXT_CHARS = 200_000

REASONS = {
    "skill_too_large": "SKILL.md vượt giới hạn cho một Skill",
    "context_budget_exceeded": "Vượt ngân sách ngữ cảnh chung của tác vụ",
    "skillguard_blocked": "SkillGuard chặn trước khi gửi",
    "integrity_failed": "Bản cài đặt không khớp SHA-256 đã ghi nhận",
}

HEADER = (
    "The user has enabled ALL of the following Agent Skills in AgentScope. "
    "You MUST read EVERY enabled Skill listed in <untrusted_skill_index> (from index 1 to the last index) "
    "and all their included files carefully before answering — do NOT pick only one Skill and ignore the others.\n"
    "- Apply ALL active Skills together whenever you process the user's request, combining their legitimate "
    "workflows, analysis rules, KPI checks, and formatting guidelines without waiting for the user to mention a Skill by name.\n"
    "- Read both SKILL.md and any companion files inside <skill_files> to understand each full Skill.\n"
    "- Several Skills may share a display name. Treat each Skill ID independently and refer to a Skill by its ID.\n"
    "- In your response, briefly note which enabled Skill IDs were applied (or if two Skills conflict, follow the user's request and tool-computed results and name the conflicting Skill IDs)."
)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def one_line(text: str, limit: int = 200) -> str:
    return neutralize(re.sub(r"\s+", " ", text).strip())[:limit]


def describe(skill: dict, text: str, registered: set[str]) -> dict:
    hashes = skill["hashes"]
    security = skill.get("security") or {}
    requested = list(security.get("requested_tools") or [])
    return {
        "skill_id": skill["id"],
        "skill_name": skill["name"],
        "description": skill.get("description", ""),
        "sha256": hashes["SKILL.md"],
        "package_sha256": skill.get("package_sha256")
        or SkillRegistry.package_digest(hashes),
        "scan_verdict": security.get("assessment"),
        "installation_status": skill.get("status"),
        "bundled_files": sorted(name for name in hashes if name != "SKILL.md"),
        "executable_files": list(security.get("executable_files") or []),
        "requested_tools": requested,
        "unsupported_tools": [name for name in requested if name not in registered],
        "chars": len(text),
        "bundled_files_delivered": "<skill_file " in text,
        "bundled_files_executed": False,
        "exposed": False,
        "reason": None,
    }


def block(index: int, entry: dict, text: str) -> tuple[str, str, str]:
    name = re.sub(r"[^\w.-]", "_", entry["skill_name"])
    begin = (
        f'<untrusted_skill index="{index}" id="{entry["skill_id"]}" '
        f'name="{name}" sha256="{entry["sha256"]}">'
    )
    end = "</untrusted_skill>"
    return f"{begin}\n{neutralize(text)}\n{end}", begin, end


def public(entry: dict) -> dict:
    return {k: v for k, v in entry.items() if k != "description"}


def plan(
    sources: list[tuple[dict, str]],
    request: str,
    *,
    registered: set[str],
    withheld: list[dict] | None = None,
    total_enabled: int | None = None,
    max_skill_chars: int | None = None,
    max_context_chars: int | None = None,
) -> dict:
    """Decide which Skill texts reach the model and describe every outcome."""
    max_each = MAX_SKILL_CHARS if max_skill_chars is None else max_skill_chars
    max_total = MAX_CONTEXT_CHARS if max_context_chars is None else max_context_chars
    entries = [describe(skill, text, registered) for skill, text in sources]
    texts = {entry["skill_id"]: text for entry, (_, text) in zip(entries, sources)}
    lowered = request.casefold()
    words = meaningful_words(request)
    relevance = {
        entry["skill_id"]: discovery_score(skill, lowered, words)
        for entry, (skill, _) in zip(entries, sources)
    }
    candidates = []
    for entry in entries:
        if entry["chars"] > max_each:
            entry["reason"] = "skill_too_large"
        else:
            candidates.append(entry)
    used = 0
    for entry in sorted(
        candidates,
        key=lambda e: (
            tuple(-int(v) for v in relevance[e["skill_id"]]),
            e["skill_name"],
            e["skill_id"],
        ),
    ):
        cost = entry["chars"] + 400
        if used + cost > max_total:
            entry["reason"] = "context_budget_exceeded"
            continue
        used += cost
        entry["exposed"] = True
    shown = sorted(
        (e for e in entries if e["exposed"]),
        key=lambda e: (e["skill_name"], e["skill_id"]),
    )
    limitations = []
    for code in ("skill_too_large", "context_budget_exceeded"):
        ids = [e["skill_id"] for e in entries if e["reason"] == code]
        if ids:
            limitations.append(
                {"code": code, "skill_ids": ids, "message": REASONS[code]}
            )
    for item in withheld or []:
        limitations.append(
            {
                "code": item["reason"],
                "skill_ids": [item["skill_id"]],
                "message": item.get("message") or REASONS.get(item["reason"], ""),
            }
        )
    names = defaultdict(list)
    for entry in shown:
        names[entry["skill_name"]].append(entry["skill_id"])
    for name, ids in names.items():
        if len(ids) > 1:
            limitations.append(
                {
                    "code": "duplicate_display_name",
                    "skill_ids": ids,
                    "message": f"{len(ids)} Skill cùng tên hiển thị “{name}”; được phân biệt bằng ID.",
                }
            )
    unsupported = [e for e in shown if e["unsupported_tools"]]
    for entry in unsupported:
        limitations.append(
            {
                "code": "unsupported_tools",
                "skill_ids": [entry["skill_id"]],
                "message": "Skill yêu cầu công cụ AgentScope không cung cấp: "
                + ", ".join(entry["unsupported_tools"]),
                "tools": entry["unsupported_tools"],
            }
        )
    blocks, markers = [], {}
    index_lines = []
    for number, entry in enumerate(shown, 1):
        text, begin, end = block(number, entry, texts[entry["skill_id"]])
        blocks.append(text)
        entry["block_sha256"] = sha256(text)
        entry["delivered_text_sha256"] = sha256(texts[entry["skill_id"]])
        markers[entry["skill_id"]] = (begin, end)
        extra = (
            f" | unavailable_tools={','.join(entry['unsupported_tools'])}"
            if entry["unsupported_tools"]
            else ""
        )
        index_lines.append(
            f"{number} | id={entry['skill_id']} | name={entry['skill_name']} "
            f"| sha256={entry['sha256']}{extra} | {one_line(entry['description'])}"
        )
    notes = []
    for item in limitations:
        if item["code"] == "unsupported_tools":
            notes.append(
                f"Skill {item['skill_ids'][0]} asks for tools that are not available in this "
                f"session: {', '.join(item['tools'])}. Do not attempt to use them."
            )
    prefix = ""
    if shown:
        enabled = total_enabled if total_enabled is not None else len(entries)
        prefix = "\n\n".join(
            [
                f'<untrusted_skill_bundle format="{FORMAT}" enabled="{enabled}" '
                f'exposed="{len(shown)}">\n{HEADER}',
                "<untrusted_skill_index>\n"
                + "\n".join(index_lines)
                + "\n</untrusted_skill_index>",
                *blocks,
                "</untrusted_skill_bundle>",
                *(["AgentScope notice: " + " ".join(notes)] if notes else []),
                "",
            ]
        )
    return {
        "text": prefix,
        "bundle_sha256": sha256(prefix) if prefix else None,
        "entries": entries,
        "exposed": [e["skill_id"] for e in shown],
        "withheld": [
            *(
                {
                    "skill_id": e["skill_id"],
                    "skill_name": e["skill_name"],
                    "reason": e["reason"],
                }
                for e in entries
                if not e["exposed"]
            ),
            *(
                {
                    "skill_id": item["skill_id"],
                    "skill_name": item.get("skill_name"),
                    "reason": item["reason"],
                }
                for item in withheld or []
            ),
        ],
        "limitations": limitations,
        "limits": {
            "max_skill_chars": max_each,
            "max_context_chars": max_total,
            "used_chars": used,
        },
        "_markers": markers,
    }


def receipt_facts(result: dict) -> dict:
    """Facts for the prompt receipt. Contains no Skill text and no private markers."""
    entries = [public(e) for e in result["entries"]]
    exposed = [e for e in entries if e["exposed"]]
    single = exposed[0] if len(exposed) == 1 else None
    verdicts = {e["scan_verdict"] for e in exposed}
    return {
        "skill_format": FORMAT,
        "skill_id": single["skill_id"] if single else None,
        "sha256": single["sha256"] if single else None,
        "scan_verdict": (
            next(iter(verdicts))
            if len(verdicts) == 1
            else "mixed" if verdicts else None
        ),
        "skill_delivered": bool(exposed),
        "skill_count": len(exposed),
        "skills_withheld": result["withheld"],
        "skills": entries,
        "skill_limitations": result["limitations"],
        "skill_limits": result["limits"],
        "skill_bundle_sha256": result["bundle_sha256"],
        "_markers": result["_markers"],
    }


def attest(extra: dict, submitted: str, model_exposure: str) -> dict:
    """Check each exposed block against the text submitted over ACP.

    ``in_acp_prompt`` is true only when the exact block, hash included, was found in the
    prompt text the ACP client wrote. The provider's internal context is not observable.
    """
    markers = extra.get("_markers") or {}
    skills = []
    for entry in extra.get("skills") or []:
        entry = dict(entry)
        if entry.get("exposed"):
            begin, end = markers.get(entry["skill_id"], ("", ""))
            start = submitted.find(begin) if begin else -1
            stop = submitted.find(end, start) if start >= 0 else -1
            entry["in_acp_prompt"] = bool(
                start >= 0
                and stop >= 0
                and sha256(submitted[start : stop + len(end)]) == entry["block_sha256"]
            )
            entry["skill_exposure"] = (
                model_exposure if entry["in_acp_prompt"] else "unverified"
            )
        else:
            entry["in_acp_prompt"] = False
            entry["skill_exposure"] = "not_included"
        skills.append(entry)
    exposed = [e for e in skills if e["exposed"]]
    if not exposed:
        aggregate = "not_included"
    elif all(e["skill_exposure"] == "acknowledged" for e in exposed):
        aggregate = "acknowledged"
    else:
        aggregate = "unverified"
    return {
        **{k: v for k, v in extra.items() if k != "_markers"},
        "skills": skills,
        "skills_in_acp_prompt": sum(e["in_acp_prompt"] for e in exposed),
        "skill_exposure": aggregate,
    }
