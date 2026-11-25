"""Prompt provenance: which text reached the model, from whom, with what trust.

AgentScope sends a single text block per ACP turn. Untrusted material (Skill
instructions, spreadsheet-derived strings) is fenced, and anything inside a fence
that could close it or imitate a chat role is neutralized. The audit records only
hashes and sizes, never the prompt text itself.
"""

import hashlib
import re
from dataclasses import dataclass

# A fence closer (or opener) written inside untrusted data must not end the fence.
_FENCE_TAG = re.compile(r"<(\s*/?\s*)(untrusted_[a-z_]+|observed_tool_results)", re.I)
# A line that starts like a conversation turn must not impersonate one.
_ROLE_LINE = re.compile(r"(?im)^([ \t]*)\[(user|assistant|system)\]:")


def neutralize(text: str) -> str:
    text = _FENCE_TAG.sub(lambda m: "&lt;" + m.group(1) + m.group(2), text)
    return _ROLE_LINE.sub(lambda m: f"{m.group(1)}[{m.group(2)} ]:", text)


def fence(tag: str, text: str) -> str:
    return f"<{tag}>\n{neutralize(text)}\n</{tag}>"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Section:
    name: str
    trust: str  # system | untrusted | history | user
    text: str

    def describe(self) -> dict:
        return {
            "name": self.name,
            "trust": self.trust,
            "chars": len(self.text),
            "sha256": sha256(self.text),
        }


def render(sections: list[Section]) -> str:
    return "\n\n".join(s.text for s in sections)
