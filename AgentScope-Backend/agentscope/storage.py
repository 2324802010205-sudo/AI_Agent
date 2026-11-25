import json
import sqlite3
from contextlib import contextmanager, nullcontext
from pathlib import Path
from threading import RLock
from typing import Any

from .models import Event, sanitize


class Store:
    TABLES = {
        "conversations",
        "conversation_files",
        "messages",
        "files",
        "skills",
        "skill_reviews",
        "tasks",
        "approvals",
        "settings",
    }

    def __init__(self, root: Path):
        self.path = root / "agentscope.sqlite3"
        self.lock = RLock()
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            for table in self.TABLES:
                db.execute(
                    f"CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)"
                )
            db.execute("""CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
                timestamp TEXT NOT NULL, source TEXT NOT NULL, event_type TEXT NOT NULL,
                tool_name TEXT, status TEXT NOT NULL, permission_decision TEXT,
                arguments TEXT NOT NULL, result TEXT NOT NULL, duration_ms INTEGER,
                error TEXT, message TEXT NOT NULL, mode TEXT NOT NULL)""")
            db.execute(
                "CREATE INDEX IF NOT EXISTS events_run_time ON events(run_id,timestamp)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS events_type ON events(event_type,permission_decision)"
            )

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def put(self, table: str, value: dict) -> dict:
        self.put_many(table, [value])
        return value

    @contextmanager
    def write_transaction(self):
        """Serialize read-modify-write operations across sidecar processes."""
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            yield db

    skill_installation_transaction = write_transaction

    def put_many(self, table: str, values: list[dict], *, connection=None) -> None:
        assert table in self.TABLES
        with self.lock, nullcontext(connection) if connection else self.connect() as db:
            db.executemany(
                f"INSERT OR REPLACE INTO {table}(id,data) VALUES(?,?)",
                (
                    (value["id"], json.dumps(value, ensure_ascii=False))
                    for value in values
                ),
            )

    def get(self, table: str, id: str, *, connection=None) -> dict | None:
        assert table in self.TABLES
        with nullcontext(connection) if connection else self.connect() as db:
            row = db.execute(f"SELECT data FROM {table} WHERE id=?", (id,)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self, table: str, *, connection=None) -> list[dict]:
        assert table in self.TABLES
        with nullcontext(connection) if connection else self.connect() as db:
            return [
                json.loads(row[0])
                for row in db.execute(f"SELECT data FROM {table} ORDER BY rowid DESC")
            ]

    def conversation_messages(
        self, conversation_id: str, *, connection=None
    ) -> list[dict]:
        with nullcontext(connection) if connection else self.connect() as db:
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT data FROM messages WHERE json_extract(data, '$.conversation_id') = ? "
                    "ORDER BY rowid",
                    (conversation_id,),
                )
            ]

    def delete(self, table: str, id: str):
        assert table in self.TABLES
        with self.lock, self.connect() as db:
            db.execute(f"DELETE FROM {table} WHERE id=?", (id,))

    def event(self, event: Event) -> Event:
        data = sanitize(event.model_dump())
        with self.lock, self.connect() as db:
            columns = list(data)
            values = [
                (
                    json.dumps(data[k], ensure_ascii=False)
                    if k in ("arguments", "result")
                    else data[k]
                )
                for k in columns
            ]
            db.execute(
                f"INSERT INTO events({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
                values,
            )
        return Event(**data)

    def events(self, run_id: str | None = None) -> list[dict[str, Any]]:
        with self.connect() as db:
            if run_id:
                rows = db.execute(
                    "SELECT * FROM events WHERE run_id=? ORDER BY timestamp,rowid",
                    (run_id,),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM (SELECT rowid,* FROM events ORDER BY rowid DESC LIMIT 5000) ORDER BY timestamp,rowid"
                ).fetchall()
        result = []
        for row in rows:
            value = dict(row)
            value.pop("rowid", None)
            value["arguments"] = json.loads(value["arguments"])
            value["result"] = json.loads(value["result"])
            result.append(value)
        return result
