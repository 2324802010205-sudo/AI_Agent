"""Recheck archived ACP context, model answers, and generated sales reports offline."""

import argparse
import json
from pathlib import Path
import sys

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agentscope.lab.boundary_evaluation import (
    FOLLOWUP_QUESTION,
    annotate,
    report_reference,
)  # noqa: E402
from agentscope.lab.containment import trials as T  # noqa: E402
from agentscope.lab import workflow_evaluation as W  # noqa: E402
from agentscope.prompting import fence  # noqa: E402


def require(observed, trial, check):
    if not observed:
        raise ValueError(f"{trial['id']}: {check}")


def audit_trial(folder, trial):
    turn = trial["turn"]
    raw = trial["raw_model_answer"]
    prompt = trial["exposed_context"]
    skill = trial.get("skill_snapshot")
    observed = trial["observed_tool_results"]
    artifact = trial["report_artifact"]
    report = folder / "reports" / artifact["name"]
    run = folder / "runs" / trial["id"]
    kind = trial["kind"]

    workflow = trial.get("preset") == "workflow"
    question = (
        W.QUESTION
        if workflow
        else FOLLOWUP_QUESTION if trial.get("case") else T.REVENUE_QUESTION
    )
    repro, sections = T.compose(question, observed, skill, trial["data_view"])
    require(
        repro == prompt and sections == trial["prompt_sections"],
        trial,
        "prompt composition differs",
    )
    requests = [
        exchange
        for exchange in turn["acp_exchanges"]
        if exchange["method"] == "session/prompt"
    ]
    require(
        requests[0]["params"]
        == {
            "sessionId": turn["session_id"],
            "prompt": [{"type": "text", "text": prompt}],
        },
        trial,
        "ACP prompt differs",
    )
    require(
        all("result" in request and "error" not in request for request in requests),
        trial,
        "ACP did not complete",
    )
    require(
        [request["params"]["prompt"][0]["text"] for request in requests[1:]]
        == [followup["text"] for followup in turn["followups"]],
        trial,
        "unaccounted follow-up",
    )
    require(
        T.sha(prompt.encode()) == turn["prompt_sha256"]
        and prompt == (run / f"{kind}.prompt.txt").read_text("utf-8"),
        trial,
        "prompt hash or log differs",
    )
    require(
        T.sha(raw.encode()) == turn["raw_answer_sha256"]
        and raw
        == turn["response_turns"][-1]["text"]
        == (run / f"{kind}.raw-answer.txt").read_text("utf-8"),
        trial,
        "raw response differs",
    )
    if skill:
        require(
            fence("untrusted_skill", skill)
            == "<untrusted_skill>\n" + skill + "\n</untrusted_skill>",
            trial,
            "Skill preprocessing changed fixture",
        )
        require(
            T.sha(skill.encode()) == trial["skill"]["sha256"],
            trial,
            "Skill hash differs",
        )
    cell = observed[0].get("guidance_cell")
    tool_context = json.loads(
        prompt.split("<observed_tool_results>\n", 1)[1].split(
            "\n</observed_tool_results>", 1
        )[0]
    )[0]
    require(tool_context.get("guidance_cell") == cell, trial, "worksheet text differs")
    validation = T.answer_signals(
        raw, trial["ground_truth"], cell["text"] if cell else skill
    )
    require(validation == trial["signals"], trial, "validator replay differs")
    require(
        T.sha(report.read_bytes()) == artifact["sha256"], trial, "report hash differs"
    )
    require(artifact["size"] == report.stat().st_size, trial, "report size differs")
    workflow_file = None
    if workflow:
        workflow_file = W.report_validation(
            {**artifact, "path": str(report)},
            T.synthetic_dataset(),
            trial["ground_truth"],
        )
        require(
            workflow_file == trial.get("workflow_file_validation"),
            trial,
            "workflow XLSX validation differs",
        )
    book = load_workbook(report, read_only=True, data_only=True, keep_links=False)
    try:
        header, *rows = book["Dữ liệu"].values
        statistics = {row[0]: row[2] for row in list(book["Thống kê"].values)[1:]}
        for column, field in (
            ("Doanh_thu_VND", "revenue_vnd"),
            ("Loi_nhuan_VND", "profit_vnd"),
        ):
            index = header.index(column)
            require(
                sum(row[index] for row in rows)
                == statistics[column]
                == trial["ground_truth"][field],
                trial,
                f"report {field} differs",
            )
        require(
            len(rows) == trial["ground_truth"]["orders"],
            trial,
            "report order count differs",
        )
    finally:
        book.close()
    return {
        "trial_id": trial["id"],
        "session_id": turn["session_id"],
        "model": turn["model"],
        "kind": kind,
        "condition": trial.get("condition"),
        "case": trial.get("case"),
        "data_view": trial["data_view"],
        "workbook_sha256": trial["dataset_sha256"],
        "prompt_sha256": turn["prompt_sha256"],
        "raw_answer_sha256": turn["raw_answer_sha256"],
        "context_reproduced": True,
        "acp_completed": True,
        "skill_verbatim": True if skill else None,
        "guidance_cell": cell,
        "report_filename_in_tool_context": tool_context.get("report_file"),
        "aggregate_present_in_tool_context": "analysis" in tool_context,
        "row_count_in_tool_context": len(tool_context.get("raw_rows", [])),
        "validation_reproduced_from_raw": True,
        "validation": validation["validation"],
        "strict_validation": validation["strict_validation"],
        "tool_calls": len(trial["tool_calls"]),
        "permission_requests": len(trial["permission_requests"]),
        "followup_count": len(turn["followups"]),
        "report": {
            **report_reference(raw, artifact["name"], artifact["path"]),
            "sha256": artifact["sha256"],
            "size_bytes": report.stat().st_size,
            "verified_ground_truth": True,
        },
        "outcome": trial["boundary_assessment"]["outcome"],
        **(
            {
                "workflow": trial["boundary_assessment"]["workflow"],
                "workflow_file_validation": workflow_file,
            }
            if workflow
            else {}
        ),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archives", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    audited = [
        audit_trial(folder, trial)
        for folder in args.archives
        for trial in annotate(json.loads((folder / "evidence.json").read_text("utf-8")))
    ]
    if len({trial["session_id"] for trial in audited}) != len(audited):
        raise ValueError("Duplicate ACP session IDs")
    T.write_json(
        args.output,
        {
            "scope": "Client-side ACP text and completed responses; provider-internal context unavailable.",
            "trials": audited,
        },
    )
    print(
        f"Audited {len(audited)} sessions; {sum(not t['report']['mentioned'] for t in audited)} omitted report filenames."
    )
