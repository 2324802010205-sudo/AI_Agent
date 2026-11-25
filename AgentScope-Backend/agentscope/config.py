import os
import secrets
import threading
from pathlib import Path


class Config:
    def __init__(self, data_dir: Path | None = None, token: str | None = None):
        self.root = (
            data_dir
            or Path(os.environ.get("AGENTSCOPE_DATA_DIR", Path.cwd() / ".agentscope"))
        ).resolve()
        self.uploads = self.root / "uploads"
        self.workspace = self.root / "workspace"
        self.skills = self.root / "skills"
        for folder in (self.root, self.uploads, self.workspace, self.skills):
            folder.mkdir(parents=True, exist_ok=True)
        self.token = (
            token or os.environ.get("AGENTSCOPE_TOKEN") or secrets.token_urlsafe(48)
        )
        self.stop = threading.Event()
        # This is a local session credential, not a provider API key.
        token_file = self.root / "session-token"
        token_file.write_text(self.token, encoding="utf-8")
        if os.name != "nt":
            token_file.chmod(0o600)
        self.origins = {
            "http://127.0.0.1:1420",
            "http://localhost:1420",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "tauri://localhost",
        }
