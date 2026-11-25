"""Official HTTPS APIs behind a single typed tool-request interface.

Model identifiers are supplied by the user; no unavailable integration is mocked.
"""

import json
from dataclasses import dataclass, field
from typing import Callable, Awaitable

import httpx
import keyring


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class Completion:
    text: str = ""
    tools: list[ToolCall] = field(default_factory=list)
    native: dict = field(default_factory=dict)


class Secrets:
    service = "AgentScope"

    def _backend(self):
        backend = keyring.get_keyring()
        # Explicitly refuse non-OS / plaintext fallback keyrings.
        module = type(backend).__module__
        if not module.startswith(
            (
                "keyring.backends.Windows",
                "keyring.backends.macOS",
                "keyring.backends.SecretService",
                "keyring.backends.kwallet",
            )
        ):
            raise ValueError(
                "Kho bí mật hệ điều hành chưa khả dụng. Không lưu API key dạng văn bản."
            )
        return backend

    def get(self, provider: str) -> str | None:
        return self._backend().get_password(self.service, provider)

    def set(self, provider: str, value: str):
        self._backend().set_password(self.service, provider, value)


class CloudAdapter:
    HOSTS = {
        "openai": "api.openai.com",
        "anthropic": "api.anthropic.com",
        "gemini": "generativelanguage.googleapis.com",
    }

    def __init__(self, provider: str, model: str, key: str):
        if provider not in self.HOSTS:
            raise ValueError(
                "Adapter không khả dụng. Codex runtime chưa được tích hợp."
            )
        if not model or not key:
            raise ValueError("Cần cấu hình model và API key trong Cài đặt.")
        self.provider, self.model, self.key = provider, model, key

    async def complete(
        self,
        messages: list[dict],
        system: str,
        tools: list[dict],
        on_delta: Callable[[str], Awaitable[None]] | None = None,
    ) -> Completion:
        # Streaming SSE is parsed at the adapter boundary. Only visible text is emitted.
        if self.provider == "anthropic":
            endpoint = "https://api.anthropic.com/v1/messages"
            headers = {"x-api-key": self.key, "anthropic-version": "2023-06-01"}
            body = {
                "model": self.model,
                "max_tokens": 4096,
                "system": system,
                "messages": messages,
                "stream": True,
            }
            if tools:
                body["tools"] = [
                    {
                        "name": t["name"],
                        "description": t["description"],
                        "input_schema": t["parameters"],
                    }
                    for t in tools
                ]
            return await self._anthropic(endpoint, headers, body, on_delta)
        # Gemini's officially supported OpenAI compatibility endpoint.
        endpoint = (
            "https://api.openai.com/v1/chat/completions"
            if self.provider == "openai"
            else "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        )
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": True,
        }
        if tools:
            body["tools"] = [{"type": "function", "function": t} for t in tools]
        text = ""
        calls: dict[int, dict] = {}
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(90, connect=15), follow_redirects=False
        ) as client:
            async with client.stream(
                "POST",
                endpoint,
                headers={"Authorization": f"Bearer {self.key}"},
                json=body,
            ) as response:
                await self._check(response)
                async for line in response.aiter_lines():
                    if not line.startswith("data: ") or line == "data: [DONE]":
                        continue
                    payload = json.loads(line[6:])
                    if payload.get("error"):
                        raise ValueError("Provider trả lỗi trong luồng phản hồi.")
                    for choice in payload.get("choices", []):
                        delta = choice.get("delta", {})
                        chunk = delta.get("content") or ""
                        if chunk:
                            text += chunk
                            if on_delta:
                                await on_delta(chunk)
                        for call in delta.get("tool_calls", []):
                            target = calls.setdefault(
                                call["index"], {"id": "", "name": "", "arguments": ""}
                            )
                            if call.get("id"):
                                target["id"] = call["id"]
                            target["name"] += call.get("function", {}).get("name", "")
                            target["arguments"] += call.get("function", {}).get(
                                "arguments", ""
                            )
                    if (
                        len(text) > 100000
                        or sum(len(c["arguments"]) for c in calls.values()) > 100000
                    ):
                        raise ValueError("Phản hồi provider vượt giới hạn.")
        result = Completion(
            text=text,
            tools=[
                ToolCall(c["id"], c["name"], json.loads(c["arguments"]))
                for c in calls.values()
            ],
        )
        result.native = {"role": "assistant", "content": text or None}
        if result.tools:
            result.native["tool_calls"] = [
                {
                    "id": c.id,
                    "type": "function",
                    "function": {"name": c.name, "arguments": json.dumps(c.arguments)},
                }
                for c in result.tools
            ]
        return result

    async def _check(self, response):
        if not response.is_success:
            # Never echo raw provider errors or HTTP request headers containing credentials.
            await response.aread()
            raise ValueError(
                f"Provider API trả HTTP {response.status_code}. Kiểm tra API key, model, hạn mức và kết nối."
            )

    async def _anthropic(self, endpoint, headers, body, on_delta):
        blocks: dict[int, dict] = {}
        text = ""
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(90, connect=15), follow_redirects=False
        ) as client:
            async with client.stream(
                "POST", endpoint, headers=headers, json=body
            ) as response:
                await self._check(response)
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    event = json.loads(line[6:])
                    kind = event.get("type")
                    if kind == "error":
                        raise ValueError("Claude API trả lỗi trong luồng phản hồi.")
                    if kind == "content_block_start":
                        blocks[event["index"]] = {
                            **event["content_block"],
                            "partial": "",
                        }
                    if kind == "content_block_delta":
                        delta = event["delta"]
                        block = blocks[event["index"]]
                        if delta.get("type") == "text_delta":
                            chunk = delta["text"]
                            text += chunk
                            block["text"] = block.get("text", "") + chunk
                            if on_delta:
                                await on_delta(chunk)
                        elif delta.get("type") == "input_json_delta":
                            block["partial"] += delta["partial_json"]
                    if (
                        len(text) > 100000
                        or sum(len(b["partial"]) for b in blocks.values()) > 100000
                    ):
                        raise ValueError("Phản hồi provider vượt giới hạn.")
        content = []
        calls = []
        for block in blocks.values():
            partial = block.pop("partial", "")
            # Do not forward or expose private reasoning blocks.
            if block.get("type") == "tool_use":
                block["input"] = (
                    json.loads(partial) if partial else block.get("input", {})
                )
                calls.append(ToolCall(block["id"], block["name"], block["input"]))
                content.append(block)
            elif block.get("type") == "text":
                content.append(block)
        return Completion(text, calls, {"role": "assistant", "content": content})

    def tool_result(self, call: ToolCall, result: dict):
        serialized = json.dumps(result, ensure_ascii=False)
        if self.provider == "anthropic":
            return {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "content": serialized,
                    }
                ],
            }
        return {"role": "tool", "tool_call_id": call.id, "content": serialized}


class CodexAdapter:
    available = False
    reason = "Codex là agent runtime riêng; chưa có cầu nối cách ly được kiểm chứng trong phiên bản này."

    def __init__(self):
        raise NotImplementedError(self.reason)
