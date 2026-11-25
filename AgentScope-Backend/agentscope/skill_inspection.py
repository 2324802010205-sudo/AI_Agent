"""Static package inspection. Package members are read as data only."""

import ast
import posixpath
import re
import sys
from pathlib import PurePosixPath
from typing import Literal, TypedDict
from urllib.parse import unquote, urlsplit

from .models import now

Category = Literal[
    "suspicious_instructions",
    "untrusted_executable",
    "high_risk_behavior",
    "policy_violation",
    "uncertain",
    "informational",
]


class Finding(TypedDict):
    code: str
    category: Category
    path: str
    line: int | None
    message: str


class Inspection(TypedDict):
    assessment: str
    scanned_at: str
    scanner_version: int
    executable_files: list[str]
    references: list[str]
    requested_tools: list[str]
    findings: list[Finding]


EXECUTABLE_SUFFIXES = frozenset(
    {
        ".py",
        ".pyw",
        ".pyc",
        ".js",
        ".mjs",
        ".cjs",
        ".ts",
        ".ps1",
        ".psm1",
        ".exe",
        ".com",
        ".bat",
        ".cmd",
        ".sh",
        ".bash",
        ".zsh",
        ".fish",
        ".dll",
        ".so",
        ".dylib",
        ".pyd",
        ".msi",
        ".jar",
        ".vbs",
        ".wsf",
        ".hta",
        ".rb",
        ".pl",
        ".php",
        ".lua",
        ".wasm",
    }
)
TEXT_SUFFIXES = frozenset(
    {
        ".md",
        ".markdown",
        ".txt",
        ".rst",
        ".yaml",
        ".yml",
        ".json",
        ".toml",
        ".ini",
        ".csv",
        ".tsv",
    }
)
TEXT_FILENAMES = {"LICENSE", "LICENCE", "COPYING", "NOTICE"}
PASSIVE_ASSET_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".xlsx"}
SCANNER_VERSION = 1
MAX_INSPECTED_TEXT = 512 * 1024
MAX_FINDINGS = 400
TEXT_RULES = (
    (
        "instruction_override",
        "suspicious_instructions",
        r"\b(?:ignore|disregard|override|bypass)\b.{0,45}\b(?:system|developer|user|policy|permissions|previous instructions)|system policy update|highest priority",
        "Chỉ dẫn có dấu hiệu ghi đè yêu cầu hoặc chính sách có thẩm quyền.",
    ),
    (
        "private_resource",
        "high_risk_behavior",
        r"(?:\b(?:read|collect|dump|extract|upload|reveal|retrieve|access)\b.{0,45}\b(?:credentials?|passwords?|api[-_ ]keys?|private files|session tokens?)\b|\.aws[/\\]credentials|\.ssh[/\\]id_)",
        "Có dấu hiệu yêu cầu truy cập hoặc tiết lộ tài nguyên riêng tư.",
    ),
    (
        "command_request",
        "high_risk_behavior",
        r"\b(?:powershell(?:\.exe)?\s+[-/]|cmd(?:\.exe)?\s+/c|curl\s+(?:[-\w]|https?:)|invoke-expression|subprocess\.(?:run|Popen)|os\.system\s*\()",
        "Có dấu hiệu yêu cầu chạy lệnh hoặc khởi tạo tiến trình.",
    ),
    (
        "result_integrity",
        "suspicious_instructions",
        r"regardless of (?:the )?(?:tool output|data|results)|\b(?:fabricate|falsify|forge)\b.{0,50}\b(?:report|result|totals?|output|evidence)\b|\bhide\b.{0,35}\b(?:from the user|failed checks)\b",
        "Chỉ dẫn có thể làm sai lệch kết quả hoặc che giấu bằng chứng.",
    ),
    (
        "authoritative_write",
        "high_risk_behavior",
        r"\b(?:overwrite|replace|edit|modify|delete|disable)\b.{0,55}\b(?:source workbook|authoritative dataset|tool configuration|mcp configuration|security policy|access controls)\b",
        "Chỉ dẫn có dấu hiệu sửa dữ liệu nguồn hoặc cấu hình có thẩm quyền.",
    ),
)
PYTHON_RULES = (
    (
        "keyboard_capture",
        r"\b(?:(?:pynput\.)?keyboard\.(?:Listener|hook|on_press(?:_key)?|on_release(?:_key)?|record|read_event)|(?:GetAsyncKeyState|SetWindowsHookEx[AW]?))\s*\(",
        "Mã gọi API có thể theo dõi hoặc thu phím bấm.",
    ),
    (
        "python_process_launch",
        r"\b(?:subprocess\.(?:call|check_call|check_output|getoutput|getstatusoutput)|os\.(?:popen|spawn\w*|exec\w*|startfile))\s*\(",
        "Mã gọi API khởi tạo tiến trình hoặc chạy lệnh.",
    ),
    (
        "dynamic_execution",
        r"(?<![\w.])(?:exec|eval|__import__)\s*\(|\bimportlib\.import_module\s*\(",
        "Mã chứa lời gọi thực thi hoặc nhập mã động.",
    ),
    (
        "network_call",
        r"\b(?:(?:requests|httpx)\.(?:get|post|put|patch|delete|request)|urllib\.request\.urlopen|socket\.(?:socket|create_connection))\s*\(",
        "Mã gọi API giao tiếp mạng.",
    ),
)
MARKDOWN_FENCE = re.compile(r"^\s*(`{3,}|~{3,})\s*(.*)$")
URL = re.compile(r"\bhttps?://[^\s<>`\]\[()\"']+", re.I)
LINK = re.compile(
    r"\]\(<?([^\s()>]+)>?(?:\s+['\"].*?['\"])?\)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)"
)

ENCODED_DATA = re.compile(r"[A-Za-z0-9+/]{1024,}={0,2}")
DECODE_INSTRUCTION = re.compile(
    r"\bdecode\b.{0,80}\bbase64\b|\bbase64\b.{0,80}\bdecode\b"
    r"|\b(?:b64decode|standard_b64decode|urlsafe_b64decode)\s*\(",
    re.I,
)
OPAQUE_LABEL = "Chỉ dẫn giải mã dữ liệu Base64 không thể kiểm tra trực tiếp"


def opaque_instruction_lines(lines: list[str]) -> set[int]:
    decoders = {n for n, line in enumerate(lines, 1) if DECODE_INSTRUCTION.search(line)}
    if not decoders:
        return set()
    encoded = {n for n, line in enumerate(lines, 1) if ENCODED_DATA.search(line)}
    return encoded | decoders if encoded else set()


def inspect_package(
    files: dict[str, bytes],
    capabilities: list[str],
    requested_tools: list[str],
    known_tools: set[str],
    declaration_span: tuple[int, int, int, int] | None,
) -> Inspection:
    findings: list[Finding] = []
    executables: list[str] = []
    references: set[str] = set()
    dependencies_declared = any(
        PurePosixPath(p).name.lower()
        in {
            "requirements.txt",
            "pyproject.toml",
            "pipfile",
            "setup.cfg",
            "setup.py",
        }
        for p in files
    )
    bundled_modules = {PurePosixPath(p).stem for p in files} | {
        part for path in files for part in PurePosixPath(path).parts[:-1]
    }

    def add(
        code: str, category: Category, path: str, message: str, line: int | None = None
    ):
        if len(findings) < MAX_FINDINGS:
            findings.append(
                Finding(
                    code=code, category=category, path=path, line=line, message=message
                )
            )

    for path, data in sorted(files.items()):
        suffix = PurePosixPath(path).suffix.lower()
        executable = suffix in EXECUTABLE_SUFFIXES or data.startswith(b"#!")
        if executable:
            executables.append(path)
            add(
                "bundled_code",
                "untrusted_executable",
                path,
                "Gói chứa mã thực thi. Cần cách ly và cấp quyền riêng để chạy.",
            )
        if (
            not executable
            and suffix not in TEXT_SUFFIXES
            and PurePosixPath(path).name.upper() not in TEXT_FILENAMES
        ):
            add(
                "uninspected_resource",
                "informational" if suffix in PASSIVE_ASSET_SUFFIXES else "uncertain",
                path,
                "Tệp này chỉ được kiểm tra cấu trúc và ghi SHA-256.",
            )
            continue
        try:
            raw = data[:MAX_INSPECTED_TEXT].decode("utf-8-sig")
            if "\x00" in raw:
                raise ValueError("binary content")
        except (UnicodeError, ValueError):
            add(
                "opaque_resource",
                "uncertain",
                path,
                "Không thể đọc tệp dưới dạng văn bản UTF-8.",
            )
            continue
        if len(data) > MAX_INSPECTED_TEXT:
            add(
                "scan_limit",
                "uncertain",
                path,
                "Nội dung vượt giới hạn phân tích tĩnh mỗi tệp.",
            )
        lines = raw.splitlines()
        opaque = opaque_instruction_lines(lines)
        python_source = suffix in {".py", ".pyw"}
        markdown = suffix in {".md", ".markdown"}
        fence = ""
        python_fence = False
        for number, line in enumerate(lines, 1):
            if number in opaque:
                add(
                    "opaque_encoded_instruction",
                    "suspicious_instructions",
                    path,
                    OPAQUE_LABEL,
                    number,
                )
            instructions = line
            if path == "SKILL.md" and declaration_span:
                first, start, last, end = declaration_span
                if first <= number <= last:
                    before = line[:start] if number == first else ""
                    after = line[end:] if number == last else ""
                    instructions = before + after
            for code, category, pattern, message in TEXT_RULES:
                if re.search(
                    pattern, instructions if code == "command_request" else line, re.I
                ):
                    add(code, category, path, message, number)
            if markdown and (marker := MARKDOWN_FENCE.match(line)):
                delimiter, info = marker.groups()
                if not fence:
                    fence = delimiter
                    python_fence = info.lower().strip() in {"python", "py", "python3"}
                elif delimiter.startswith(fence) and not info.strip():
                    fence = ""
                    python_fence = False
            elif python_source or python_fence:
                for code, pattern, message in PYTHON_RULES:
                    if re.search(pattern, line):
                        add(code, "high_risk_behavior", path, message, number)
            for address in URL.findall(line):
                try:
                    authority = urlsplit(address)
                    host = authority.hostname
                    suspicious = (
                        authority.scheme.lower() != "https"
                        or not host
                        or authority.username is not None
                    )
                except ValueError:
                    host, suspicious = None, True
                add(
                    "external_address",
                    "suspicious_instructions" if suspicious else "informational",
                    path,
                    f"Địa chỉ bên ngoài được nhắc tới ({host or 'máy chủ không hợp lệ'}).",
                    number,
                )
            if markdown:
                for inline, definition in LINK.findall(line):
                    value = inline or definition
                    if value.startswith("#") or re.match(
                        r"^[a-z][a-z0-9+.-]*:", value, re.I
                    ):
                        continue
                    target = posixpath.normpath(
                        posixpath.join(
                            posixpath.dirname(path), unquote(value.split("#", 1)[0])
                        )
                    )
                    if (
                        target.startswith(("../", "/"))
                        or target == ".."
                        or "\\" in target
                    ):
                        add(
                            "out_of_package_reference",
                            "policy_violation",
                            path,
                            "Tham chiếu trỏ ra ngoài gói cài đặt.",
                            number,
                        )
                    elif target in files:
                        references.add(target)
                    else:
                        add(
                            "missing_reference",
                            "informational",
                            path,
                            f"Thiếu tài nguyên tham chiếu: {target}",
                            number,
                        )
        if python_source and len(data) <= MAX_INSPECTED_TEXT:
            try:
                tree = ast.parse(raw, filename=path)
            except (SyntaxError, ValueError, RecursionError) as error:
                add(
                    "python_parse_failed",
                    "uncertain",
                    path,
                    "Không phân tích được cú pháp Python.",
                    getattr(error, "lineno", None),
                )
                continue
            if not dependencies_declared:
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        modules = [alias.name.split(".")[0] for alias in node.names]
                    elif (
                        isinstance(node, ast.ImportFrom)
                        and not node.level
                        and node.module
                    ):
                        modules = [node.module.split(".")[0]]
                    else:
                        continue
                    for module in modules:
                        if (
                            module not in sys.stdlib_module_names
                            and module not in bundled_modules
                        ):
                            add(
                                "undeclared_dependency",
                                "uncertain",
                                path,
                                f"Phụ thuộc Python chưa được khai báo: {module}",
                                node.lineno,
                            )
    if any(capability not in known_tools for capability in capabilities):
        add(
            "unregistered_capability",
            "informational",
            "SKILL.md",
            "Metadata mô tả công cụ ngoài danh mục AgentScope. Quyền do chính sách runtime quyết định.",
        )
    if requested_tools:
        add(
            "declared_tool_requests",
            "informational",
            "SKILL.md",
            "Đã ghi nhận allowed-tools để kiểm tra. Quyền do chính sách runtime quyết định.",
        )
    if len(findings) == MAX_FINDINGS:
        findings.append(
            Finding(
                code="findings_limit",
                category="uncertain",
                path="SKILL.md",
                line=None,
                message="Đã đạt giới hạn số mục có thể hiển thị.",
            )
        )
    categories = {finding["category"] for finding in findings}
    priority = (
        "policy_violation",
        "high_risk_behavior",
        "suspicious_instructions",
        "untrusted_executable",
        "uncertain",
    )
    assessment = next(
        (category for category in priority if category in categories),
        "no_significant_findings",
    )
    return Inspection(
        assessment=assessment,
        scanned_at=now(),
        scanner_version=SCANNER_VERSION,
        executable_files=executables,
        references=sorted(references),
        requested_tools=requested_tools,
        findings=findings,
    )
