"""Non-destructive relocation of AgentScope data; audit evidence is never rewritten."""

import json
import shutil
import sqlite3
from pathlib import Path


def relocate_data(source: Path, destination: Path) -> dict:
    source, destination = source.resolve(), destination.resolve()
    if not (source / "agentscope.sqlite3").is_file():
        raise ValueError("Source does not contain an AgentScope database")
    if (
        destination.exists()
        or destination == source
        or destination.is_relative_to(source)
        or source.is_relative_to(destination)
    ):
        raise ValueError(
            "Destination must be a new, separate directory; no overwrite is allowed"
        )
    destination.mkdir(parents=True)
    for name in ("uploads", "workspace", "skills"):
        if (source / name).exists():
            shutil.copytree(source / name, destination / name, symlinks=True)
    with sqlite3.connect(
        (source / "agentscope.sqlite3").as_uri() + "?mode=ro", uri=True
    ) as original:
        with sqlite3.connect(destination / "agentscope.sqlite3") as target:
            original.backup(target)
    changes = {}
    with sqlite3.connect(destination / "agentscope.sqlite3") as db:
        for table in ("files", "skills"):
            changed = 0
            for identifier, raw in db.execute(
                f"SELECT id,data FROM {table}"
            ).fetchall():
                data = json.loads(raw)
                if data.get("path"):
                    try:
                        relative = Path(data["path"]).resolve().relative_to(source)
                    except ValueError:
                        continue
                    data["path"] = str(destination / relative)
                    db.execute(
                        f"UPDATE {table} SET data=? WHERE id=?",
                        (json.dumps(data, ensure_ascii=False), identifier),
                    )
                    changed += 1
            changes[table] = changed
        counts = {
            table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "conversations",
                "messages",
                "files",
                "skills",
                "tasks",
                "approvals",
                "settings",
                "events",
            )
        }
    # A new server generates a fresh session credential. OS-stored API keys are unchanged.
    return {
        "source": str(source),
        "destination": str(destination),
        "updated_paths": changes,
        "record_counts": counts,
        "source_preserved": True,
        "audit_rewritten": False,
    }
