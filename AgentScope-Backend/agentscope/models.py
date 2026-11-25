import re
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, SecretStr


def uid() -> str:
    return str(uuid4())


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


Status = Literal[
    "pending",
    "awaiting_approval",
    "running",
    "completed",
    "blocked",
    "failed",
    "cancelled",
    "paused",
]


class Event(BaseModel):
    id: str = Field(default_factory=uid)
    run_id: str
    step_id: str = Field(default_factory=uid)
    timestamp: str = Field(default_factory=now)
    source: str = "runtime"
    event_type: str
    tool_name: str | None = None
    status: Status = "running"
    permission_decision: Literal["allow", "deny", "require_approval"] | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    duration_ms: int | None = None
    error: str | None = None
    message: str
    mode: Literal["demo", "real"] = "real"


class SendMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=32000)
    attachment_ids: list[str] | None = Field(default=None, max_length=5)
    mode: Literal["demo", "real"] | None = None
    skill_id: str | None = Field(default=None, pattern=r"^[a-f0-9-]{36}$")
    auto_skill: bool = Field(default=False, strict=True)


class ToolArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: str = Field(pattern=r"^[a-f0-9-]{36}$")


class ProviderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["openai", "anthropic", "gemini", "antigravity"] | None = None
    model: str | None = Field(default=None, max_length=150)
    api_key: str | None = Field(default=None, max_length=512)
    mode: Literal["demo", "real"] | None = None


class ProviderModelTest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    provider: Literal["openai", "anthropic", "gemini"]
    model: str = Field(min_length=1, max_length=150)
    api_key: SecretStr | None = Field(default=None, max_length=512)


SENSITIVE = re.compile(
    r"(api.?key|authorization|token|password|secret|credential)", re.I
)
SECRET_VALUE = re.compile(
    r"(?i)(bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{8,}|AIza[a-z0-9_-]{20,}|(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+)"
)


def sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(k): "[REDACTED]" if SENSITIVE.search(str(k)) else sanitize(v)
            for k, v in value.items()
        }
    if isinstance(value, (tuple, list)):
        return [sanitize(v) for v in value]
    if isinstance(value, str):
        return SECRET_VALUE.sub("[REDACTED]", value)[:16000]
    return value
