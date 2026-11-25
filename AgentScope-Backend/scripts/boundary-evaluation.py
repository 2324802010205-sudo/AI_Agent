"""Run fresh contained ACP trials and export genuine evidence only.

Example (from the backend repository)
  .venv/Scripts/python.exe scripts/boundary-evaluation.py --data-dir .boundary-evaluation --data-view aggregates --run

Repeat with --data-view raw_rows for the second nine-trial suite.
Use --followup for the three paired raw-row cases.
Use --workflow for paired row selection, accounting, and business interpretation cases.

The existing AppContainer lab must already be signed in. Every trial rechecks isolation.
"""

import argparse
import asyncio
import json
import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agentscope.config import Config  # noqa: E402
from agentscope.lab.boundary_evaluation import report_vi  # noqa: E402
from agentscope.lab.containment import trials as T  # noqa: E402
from agentscope.lab.injection_lab import IsolatedInjectionLab, StartSuite  # noqa: E402
from agentscope.skills import SkillRegistry  # noqa: E402
from agentscope.storage import Store  # noqa: E402


async def main(args):
    if not args.run:
        raise SystemExit("Pass --run to start authenticated synthetic ACP trials")
    token_file = args.data_dir / "session-token"
    token = token_file.read_text("utf-8") if token_file.is_file() else None
    config = Config(args.data_dir, token=token)
    store = Store(config.root)
    registry = SkillRegistry(config.skills, store)
    skill = None
    if args.skill:
        data = args.skill.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        skill = next(
            (s for s in registry.approved() if s["hashes"].get("SKILL.md") == digest),
            None,
        )
        if skill is None:
            skill = registry.approve(registry.import_package([("SKILL.md", data)]))
        registry.verify(skill)
    service = IsolatedInjectionLab(config, store)
    suite = service.start_suite(
        StartSuite(
            skill_id=skill and skill["id"],
            model=args.model,
            preset=(
                "phase6_proof"
                if args.phase6_proof
                else (
                    "phase6"
                    if args.phase6
                    else (
                        "phase5"
                        if args.phase5
                        else (
                            "phase4"
                            if args.phase4
                            else (
                                "workflow"
                                if args.workflow
                                else (
                                    "followup"
                                    if args.followup
                                    else "boundary" if skill else "reporting"
                                )
                            )
                        )
                    )
                )
            ),
            data_view=args.data_view,
            confirm_isolated_execution=True,
        )
    )
    print(json.dumps(suite), flush=True)
    await asyncio.gather(*service.tasks)
    values = [t for t in service.listing() if t.get("suite_id") == suite["suite_id"]]
    values.sort(key=lambda t: t["sequence"])
    output = service.root / "exports" / suite["suite_id"]
    output.mkdir(parents=True, exist_ok=True)
    T.write_json(output / "evidence.json", values)
    (output / "report-vi.md").write_text(report_vi(values), "utf-8")
    print(
        json.dumps(
            {
                "output": str(output),
                "trials": [
                    {
                        "id": t["id"],
                        "condition": t["kind"],
                        "case": t.get("case"),
                        "replicate": t["replicate"],
                        "state": t["state"],
                        "session_id": t.get("turn", {}).get("session_id"),
                        **t["boundary_assessment"],
                    }
                    for t in values
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )
    return 0 if all(t["state"] == "completed" for t in values) else 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--skill", type=Path)
    decision_first = parser.add_mutually_exclusive_group()
    decision_first.add_argument(
        "--phase6",
        action="store_true",
        help="Prove decision-first, then run 24 worksheet and six separate Skill trials",
    )
    decision_first.add_argument(
        "--phase6-proof",
        action="store_true",
        help="Run one clean Config B decision-first proof without injection trials",
    )
    parser.add_argument(
        "--phase5",
        action="store_true",
        help="Run twelve paired cancellation warning trials",
    )
    parser.add_argument(
        "--phase4",
        action="store_true",
        help="Run six paired native ACP/MCP reporting trials",
    )
    parser.add_argument(
        "--workflow", action="store_true", help="Run three paired workflow cases"
    )
    parser.add_argument(
        "--followup",
        action="store_true",
        help="Run three paired follow-up cases (six ACP sessions)",
    )
    parser.add_argument(
        "--data-view", choices=["aggregates", "raw_rows"], default="aggregates"
    )
    parser.add_argument("--model", default=T.DEFAULT_MODEL)
    parser.add_argument("--run", action="store_true")
    sys.exit(asyncio.run(main(parser.parse_args())))
