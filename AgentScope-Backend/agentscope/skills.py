import hashlib
import io
import json
import re
import shutil
import stat
import unicodedata
import zipfile
from contextlib import suppress
from pathlib import Path, PurePosixPath

import yaml

from .models import now, uid
from .skill_inspection import SCANNER_VERSION, inspect_package
from .storage import Store
from .tools import ToolRegistry

MAX_PACKAGE = 20 * 1024 * 1024
MAX_FILES = 200
SKILL_ID = re.compile(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}")
SPREADSHEET_TOPIC = re.compile(
    r"\b(?:spreadsheets?|workbooks?|excel|xlsx|csv|xls|tabular data|bảng tính)\b", re.I
)
FRONTMATTER_LINE = re.compile(r"^---[ \t]*(?:\r?\n|$)", re.M)
MAX_DISCOVERY_WORDS = 256


class SkillLifecycleError(Exception):
    def __init__(self, code: str, status: int, message: str):
        super().__init__(message)
        self.code, self.status = code, status


def static_review(raw: str) -> dict:
    """Location-based advisory evidence. Neither hits nor their absence imply safety."""
    rules = {
        "sensitive_terms": r"ignore.{0,30}(policy|system|instructions)|powershell|keylog|exfiltrat|password|credential|curl\s|subprocess",
        "instruction_override": r"system policy update|highest priority|regardless of tool output",
    }
    indicators = [
        {"rule": rule, "line": line_number}
        for line_number, line in enumerate(raw.splitlines(), 1)
        for rule, pattern in rules.items()
        if re.search(pattern, line, re.I)
    ]
    return {
        "method": "heuristic_text_rules_v2",
        "assurance": "none",
        "status": "indicators_found" if indicators else "no_indicators",
        "indicators": indicators,
        "limitation": "Quy tắc từ khóa có thể bỏ sót và báo nhầm. Không phải chứng nhận an toàn; phê duyệt không tạo sandbox.",
    }


def meaningful_words(text: str) -> set[str]:
    """Lower-case words of 4+ characters; short tokens (\"lab\", \"a\", \"for\") match anything."""
    return {w for w in re.findall(r"\w+", text.casefold()) if 4 <= len(w) <= 64}


def discovery_score(
    skill: dict, lowered: str, words: set[str]
) -> tuple[bool, int, int]:
    name = re.escape(skill["name"].casefold())
    metadata_words = meaningful_words(f"{skill['name']} {skill['description']}")
    body_words = set(skill.get("selection", {}).get("instruction_words", []))
    return (
        bool(re.search(rf"(?<![\w-]){name}(?![\w-])", lowered)),
        len(words & metadata_words),
        len(words & (body_words - metadata_words)),
    )


def spreadsheet_skill(skill: dict) -> bool:
    return SPREADSHEET_TOPIC.search(
        f"{skill['name']} {skill['description']}"
    ) is not None or skill.get("selection", {}).get("spreadsheet", False)


def safe_name(name: str) -> str:
    if re.search(r'[\\:<>"|?*\x00-\x1f]', name) or name.startswith("/"):
        raise ValueError("Đường dẫn gói không hợp lệ.")
    parts = name.split("/")
    if not parts or any(
        p in ("..", ".", "")
        or p.rstrip(". ") != p
        or re.match(r"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])\s*(?:\.|$)", p, re.I)
        for p in parts
    ):
        raise ValueError("Tên tệp hoặc đường dẫn không an toàn.")
    if len(name) > 240:
        raise ValueError("Đường dẫn gói quá dài.")
    return "/".join(parts)


def unpack(uploaded: list[tuple[str, bytes]]) -> dict[str, bytes]:
    result: dict[str, bytes] = {}
    layout: dict[str, tuple[str, bool]] = {}
    total = 0

    def add(name: str, data: bytes):
        nonlocal total
        name = safe_name(name)
        parts = name.split("/")
        for depth in range(1, len(parts) + 1):
            entry = "/".join(parts[:depth])
            directory = depth < len(parts)
            existing = layout.setdefault(entry.casefold(), (entry, directory))
            if existing != (entry, directory) or entry in result:
                raise ValueError("Gói có tên tệp hoặc thư mục xung đột.")
        total += len(data)
        if total > MAX_PACKAGE or len(result) >= MAX_FILES:
            raise ValueError("Gói vượt giới hạn 20 MB hoặc 200 tệp.")
        result[name] = data

    if len(uploaded) == 1 and uploaded[0][0].lower().endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(uploaded[0][1])) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_PACKAGE:
                raise ValueError("Gói ZIP vượt giới hạn giải nén.")
            for info in infos:
                safe_name(info.filename.rstrip("/"))
                file_mode = info.external_attr >> 16
                if (
                    stat.S_ISLNK(file_mode)
                    or (stat.S_IFMT(file_mode) not in (0, stat.S_IFREG, stat.S_IFDIR))
                    or info.external_attr & 0x400
                ):
                    raise ValueError("Gói chứa liên kết hoặc loại tệp đặc biệt.")
                if (
                    info.flag_bits & 1
                    or info.file_size > max(1, info.compress_size) * 200
                ):
                    raise ValueError(
                        "Gói ZIP được mã hóa hoặc có tỷ lệ nén không an toàn."
                    )
                if not info.is_dir():
                    add(info.filename, archive.read(info))
    else:
        for name, data in uploaded:
            add(name, data)
    roots = [n for n in result if PurePosixPath(n).name == "SKILL.md"]
    if len(roots) != 1:
        raise ValueError("Gói phải có đúng một tệp SKILL.md.")
    prefix = str(PurePosixPath(roots[0]).parent)
    if prefix != ".":
        prefix += "/"
        if any(not n.startswith(prefix) for n in result):
            raise ValueError("Tất cả tài nguyên phải nằm trong thư mục của SKILL.md.")
        result = {n[len(prefix) :]: data for n, data in result.items()}
    return result


def requested_tools(value: str | list[str]) -> list[str]:
    """Parse names and optional selectors for evidence without interpreting them."""
    values = value if isinstance(value, list) else [value]
    if any(not isinstance(item, str) for item in values):
        raise ValueError("allowed-tools phải là văn bản hoặc danh sách tên công cụ.")
    requested = {}
    for item in values:
        depth = 0
        start = 0
        for index, char in enumerate(item):
            if char == "(":
                depth += 1
            elif char == ")" and depth:
                depth -= 1
            elif not depth and (char.isspace() or char == ","):
                if start < index:
                    requested[item[start:index]] = None
                start = index + 1
        if start < len(item):
            requested[item[start:]] = None
    return list(requested)


def parse_skill(files: dict[str, bytes]) -> dict:
    raw = files["SKILL.md"].decode("utf-8-sig")
    if len(raw) > 100000 or not FRONTMATTER_LINE.match(raw):
        raise ValueError("SKILL.md cần YAML frontmatter và tối đa 100.000 ký tự.")
    parts = FRONTMATTER_LINE.split(raw, maxsplit=2)
    if len(parts) != 3:
        raise ValueError("YAML frontmatter chưa đóng.")
    _, frontmatter, instructions = parts

    class UniqueLoader(yaml.SafeLoader):
        # Frontmatter fields are textual. YAML 1.1 otherwise coerces names such as
        # "no" and "123" and drops lexical metadata values such as version 1.0.
        yaml_implicit_resolvers = {}

    def mapping(loader, node):
        pairs = loader.construct_pairs(node)
        if len({str(k) for k, _ in pairs}) != len(pairs):
            raise ValueError("YAML chứa khóa trùng lặp.")
        return dict(pairs)

    UniqueLoader.add_constructor(
        yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping
    )
    loader = UniqueLoader(frontmatter)
    try:
        document = loader.get_single_node()
        meta = loader.construct_document(document) if document is not None else None
    except (yaml.YAMLError, TypeError, RecursionError) as error:
        raise ValueError(
            "YAML metadata không hợp lệ; kiểm tra cú pháp và cấu trúc frontmatter."
        ) from error
    finally:
        loader.dispose()
    if not isinstance(meta, dict) or any(not isinstance(key, str) for key in meta):
        raise ValueError("Metadata Skill phải là một đối tượng YAML.")
    name, description = meta.get("name"), meta.get("description")
    name = unicodedata.normalize("NFKC", name.strip()) if isinstance(name, str) else ""
    if (
        not 1 <= len(name) <= 64
        or name != name.lower()
        or not all(part.isalnum() for part in name.split("-"))
    ):
        raise ValueError(
            "Tên Skill chỉ gồm chữ thường, số và dấu gạch nối, tối đa 64 ký tự."
        )
    if (
        not isinstance(description, str)
        or not description.strip()
        or len(description) > 1024
    ):
        raise ValueError("Skill cần description từ 1 đến 1024 ký tự.")
    for field, limit in (("license", None), ("compatibility", 500)):
        if field in meta:
            value = meta[field]
            if (
                not isinstance(value, str)
                or not value.strip()
                or (limit and len(value) > limit)
            ):
                raise ValueError(f"Giá trị {field} trong SKILL.md không hợp lệ.")
    metadata = meta.get("metadata", {})
    if not isinstance(metadata, dict) or any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in metadata.items()
    ):
        raise ValueError("metadata phải là ánh xạ từ chuỗi sang chuỗi.")
    allowed = meta.get("allowed-tools", "")
    if not isinstance(allowed, (str, list)):
        raise ValueError("allowed-tools phải là văn bản hoặc danh sách tên công cụ.")
    requests = requested_tools(allowed)
    declaration_span = None
    for key, value in document.value:
        if (
            key.value == "allowed-tools"
            and value.start_mark.index >= key.end_mark.index
        ):
            # YAML marks are zero-based and exclude the opening delimiter.
            start, end = value.start_mark, value.end_mark
            declaration_span = (start.line + 2, start.column, end.line + 2, end.column)
            break
    capabilities = meta.get("capabilities", [])
    capabilities = (
        [c for c in capabilities if isinstance(c, str) and len(c) <= 80]
        if isinstance(capabilities, list)
        else []
    )
    security = inspect_package(
        files, capabilities, requests, set(ToolRegistry.names()), declaration_span
    )
    return {
        "name": name,
        "description": description.strip(),
        "capabilities": capabilities,
        "security": security,
        "findings": [finding["message"] for finding in security["findings"]],
        "static_review": static_review(raw),
        "metadata": metadata,
        "selection": {
            "spreadsheet": bool(SPREADSHEET_TOPIC.search(instructions)),
            "instruction_words": sorted(meaningful_words(instructions))[
                :MAX_DISCOVERY_WORDS
            ],
        },
        **{
            field: meta[field]
            for field in ("license", "compatibility", "allowed-tools")
            if field in meta
        },
    }


class SkillRegistry:
    def __init__(self, root: Path, store: Store):
        self.root, self.store = root, store
        self.archives = root.parent / "skill-import-snapshots"

    def import_package(
        self, uploaded: list[tuple[str, bytes]], *, research_fixture: bool = False
    ) -> dict:
        files = unpack(uploaded)
        meta = parse_skill(files)
        hashes = {name: self.digest(data) for name, data in files.items()}
        fingerprint = self.package_digest(hashes)
        created = None
        existing = None
        try:
            with self.store.skill_installation_transaction() as connection:
                installed = self.store.all("skills", connection=connection)
                if not research_fixture:
                    existing = max(
                        (
                            row
                            for row in installed
                            if not row.get("research_fixture")
                            and row.get("hashes") == hashes
                        ),
                        key=self.revision_order,
                        default=None,
                    )
                if existing:
                    self.verify(existing)
                else:
                    self.require_plain_path(self.root, stat.S_ISDIR)
                    identifier = uid()
                    root = self.root / identifier
                    enabled = (
                        not research_fixture
                        and meta["security"]["assessment"] == "no_significant_findings"
                    )
                    skill = {
                        **meta,
                        "id": identifier,
                        "status": "enabled" if enabled else "quarantine",
                        "path": str(root),
                        "files": list(files),
                        "hashes": hashes,
                        "package_sha256": fingerprint,
                        "created_at": now(),
                        "updated_at": now(),
                    }
                    if research_fixture:
                        skill["research_fixture"] = True
                    root.mkdir()
                    created = root
                    for name, data in files.items():
                        target = root / name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with target.open("xb") as member:
                            member.write(data)
                    self.archive(skill, files)
                    self.store.put_many("skills", [skill], connection=connection)
        except Exception:
            if created:
                shutil.rmtree(created)
            raise
        if existing:
            return {
                **self.library_record(existing),
                "package_sha256": fingerprint,
                "reused_installation": True,
            }
        return skill

    @staticmethod
    def digest(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    @classmethod
    def package_digest(cls, hashes: dict[str, str]) -> str:
        return cls.digest(
            json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode()
        )

    @staticmethod
    def revision_order(skill: dict) -> tuple[str, str]:
        return skill.get("created_at") or "", skill["id"]

    def archive(
        self, skill: dict, files: dict[str, bytes], *, existing_only=False
    ) -> None:
        if not existing_only:
            self.archives.mkdir(exist_ok=True)
        self.require_plain_path(self.archives, stat.S_ISDIR)
        path = self.archives / f"{skill['id']}.zip"
        if existing_only or path.exists():
            self.require_plain_path(path, stat.S_ISREG)
            with zipfile.ZipFile(path) as archived:
                members = archived.infolist()
                if existing_only and (
                    len(members) != len(files) + 1
                    or {info.filename for info in members}
                    != {"manifest.json", *(f"package/{name}" for name in files)}
                ):
                    raise ValueError("Danh mục bản lưu không khớp.")
                if archived.getinfo("manifest.json").file_size > MAX_PACKAGE:
                    raise ValueError("Manifest bản lưu vượt giới hạn đọc.")
                manifest = json.loads(archived.read("manifest.json"))
                if (
                    not isinstance(manifest, dict)
                    or manifest["id"] != skill["id"]
                    or manifest["hashes"] != skill["hashes"]
                ):
                    raise ValueError("Bản lưu nhập Skill không khớp với manifest.")
                for name, data in files.items():
                    member = archived.getinfo(f"package/{name}")
                    if member.file_size != len(data) or archived.read(member) != data:
                        raise ValueError("Bản lưu nhập Skill đã thay đổi.")
            return
        temporary = path.with_suffix(".partial")
        try:
            with zipfile.ZipFile(
                temporary, "x", compression=zipfile.ZIP_DEFLATED
            ) as archive:
                manifest = {k: v for k, v in skill.items() if k != "path"}
                archive.writestr(
                    "manifest.json", json.dumps(manifest, ensure_ascii=False)
                )
                for name, data in files.items():
                    archive.writestr(f"package/{name}", data)
            temporary.rename(path)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def require_plain_path(path: Path, is_kind):
        info = path.lstat()
        if (
            not is_kind(info.st_mode)
            or stat.S_ISLNK(info.st_mode)
            or getattr(info, "st_file_attributes", 0)
            & stat.FILE_ATTRIBUTE_REPARSE_POINT
            or (stat.S_ISREG(info.st_mode) and info.st_nlink != 1)
        ):
            raise ValueError(
                "Tệp hoặc thư mục Skill có liên kết hoặc loại không hợp lệ."
            )

    def installed_root(self, skill: dict) -> Path:
        identifier = skill.get("id", "")
        if not SKILL_ID.fullmatch(identifier):
            raise ValueError("Mã định danh Skill không hợp lệ.")
        root = self.root / identifier
        if Path(skill.get("path", "")) != root:
            raise ValueError("Đường dẫn cài đặt không thuộc Skill đã chọn.")
        self.require_plain_path(self.root, stat.S_ISDIR)
        return root

    @staticmethod
    def layout(skill: dict) -> tuple[set[str], set[str]]:
        files = set(skill["hashes"])
        if "SKILL.md" not in files or files != set(skill["files"]):
            raise ValueError("Danh mục tệp cài đặt Skill không hợp lệ.")
        for name in files:
            safe_name(name)
        return files, {
            parent.as_posix()
            for name in files
            for parent in PurePosixPath(name).parents
            if parent.parts
        }

    def verify_layout(self, skill: dict, root: Path) -> None:
        files, directories = self.layout(skill)
        self.require_plain_path(root, stat.S_ISDIR)

        def visit(directory: Path) -> None:
            for child in directory.iterdir():
                relative = child.relative_to(root).as_posix()
                if relative in directories:
                    self.require_plain_path(child, stat.S_ISDIR)
                    visit(child)
                elif relative in files:
                    self.require_plain_path(child, stat.S_ISREG)
                else:
                    raise ValueError("Thư mục cài đặt chứa tệp ngoài manifest.")

        visit(root)

    def read_installation(self, skill: dict) -> dict[str, bytes]:
        root = self.installed_root(skill)
        try:
            self.verify_layout(skill, root)
            result = {}
            remaining = MAX_PACKAGE
            for name, expected in skill["hashes"].items():
                with (root / name).open("rb") as stream:
                    data = stream.read(remaining + 1)
                remaining -= len(data)
                if remaining < 0 or self.digest(data) != expected:
                    raise ValueError(f"Skill đã bị thay đổi hoặc thiếu tệp: {name}")
                result[name] = data
            return result
        except OSError as error:
            raise ValueError("Không đọc được bản cài đặt Skill.") from error

    def verified_member(self, skill: dict, member: str) -> bytes:
        """Verify the manifest and return the same bytes used to check the member."""
        if member not in skill["hashes"]:
            raise ValueError("Member missing from Skill manifest")
        return self.read_installation(skill)[member]

    def verify(self, skill: dict) -> str:
        data = self.verified_member(skill, "SKILL.md")
        return data.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")

    def read_package_texts(
        self,
        skill: dict,
        *,
        max_file_bytes: int = 128 * 1024,
        normalize_newlines: bool = True,
    ) -> tuple[str, dict[str, str]]:
        """Verify the whole Skill package and return SKILL.md plus all readable text files."""
        files = self.read_installation(skill)
        skill_md = files["SKILL.md"].decode("utf-8-sig")
        if normalize_newlines:
            skill_md = skill_md.replace("\r\n", "\n").replace("\r", "\n")
        companions: dict[str, str] = {}
        for name in sorted(files):
            if name == "SKILL.md":
                continue
            data = files[name]
            if len(data) > max_file_bytes or b"\x00" in data:
                continue
            try:
                text = data.decode("utf-8-sig")
            except UnicodeDecodeError:
                continue
            if normalize_newlines:
                text = text.replace("\r\n", "\n").replace("\r", "\n")
            companions[name] = text
        return skill_md, companions

    @staticmethod
    def format_materials(skill_md: str, companions: dict[str, str]) -> str:
        """Combine SKILL.md and all readable companion files so the model reads the full Skill."""
        if not companions:
            return skill_md
        blocks = [
            f'<skill_file path="{path}">\n{content}\n</skill_file>'
            for path, content in companions.items()
        ]
        return f"{skill_md}\n\n<skill_files>\n" + "\n\n".join(blocks) + "\n</skill_files>"

    def preview_source(self, identifier: str) -> str:
        """Read the verified SKILL.md for the local viewer, regardless of execution status."""
        with self.store.lock:
            skill = self.store.get("skills", identifier)
            if not skill:
                raise SkillLifecycleError(
                    "skill_not_found", 404, "Không tìm thấy bản cài đặt Skill."
                )
            try:
                return self.verify(skill)
            except (OSError, KeyError, ValueError) as error:
                raise SkillLifecycleError(
                    "skill_installation_invalid",
                    409,
                    "Bản cài đặt không khớp danh mục tệp và SHA-256 đã ghi nhận.",
                ) from error

    def approve(self, skill: dict) -> dict:
        """Legacy research fixture workflow. This flag alone cannot enable a Skill in production."""
        self.verify(skill)
        # Approving an update supersedes the previous approved version.
        for previous in self.store.all("skills"):
            if (
                previous["name"] == skill["name"]
                and previous["id"] != skill["id"]
                and previous["status"] == "approved"
            ):
                self.store.put(
                    "skills", {**previous, "status": "disabled", "updated_at": now()}
                )
        return self.store.put(
            "skills",
            {
                **skill,
                "status": "approved",
                "research_fixture": True,
                "updated_at": now(),
            },
        )

    def approved(self) -> list[dict]:
        return [s for s in self.store.all("skills") if s["status"] == "approved"]

    @staticmethod
    def has_current_scan(skill: dict) -> bool:
        security = skill.get("security") or {}
        return (
            security.get("scanner_version") == SCANNER_VERSION
            and "requested_tools" in security
            and "selection" in skill
        )

    def library_record(self, skill: dict) -> dict:
        if self.has_current_scan(skill):
            return skill
        with self.store.skill_installation_transaction() as connection:
            current = self.store.get("skills", skill["id"], connection=connection)
            if not current:
                return {key: value for key, value in skill.items() if key != "security"}
            if self.has_current_scan(current):
                return current
            try:
                files = self.read_installation(current)
                scanned = {**current, **parse_skill(files)}
                self.archive(scanned, files)
            except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                return {
                    key: value for key, value in current.items() if key != "security"
                }
            if scanned["status"] != "disabled" and not scanned.get("research_fixture"):
                if scanned["security"]["assessment"] != "no_significant_findings":
                    scanned["status"] = "quarantine"
                elif "security" not in current and scanned["status"] != "approved":
                    scanned["status"] = "enabled"
            self.store.put_many("skills", [scanned], connection=connection)
            return scanned

    @staticmethod
    def available(skill: dict | None) -> bool:
        if not skill or skill.get("research_fixture"):
            return False
        if skill["status"] == "quarantine":
            return bool(skill.get("quarantine_enabled"))
        if skill["status"] in {"enabled", "approved"}:
            return (
                skill.get("security", {}).get("assessment") == "no_significant_findings"
                or bool(skill.get("quarantine_enabled"))
            )
        return False

    @staticmethod
    def skill_state(skill: dict) -> dict:
        """Installed, enabled, quarantined and restricted are distinct states.

        Quarantined Skills keep their warning state and read-only review flow, while
        remaining toggleable so the user can explicitly enable them for model testing
        inside AppContainer (SKILL.md text only; bundled scripts are never executed).
        """
        clean = (skill.get("security") or {}).get("assessment") == (
            "no_significant_findings"
        )
        if skill.get("research_fixture"):
            return {
                "state": "restricted",
                "eligible": False,
                "toggleable": False,
                "state_reason": "Tài nguyên nghiên cứu nội bộ.",
            }
        if skill["status"] == "quarantine" or (
            not clean and skill["status"] != "disabled"
        ):
            active = bool(skill.get("quarantine_enabled"))
            return {
                "state": "quarantined",
                "eligible": active,
                "toggleable": True,
                "state_reason": (
                    "Đang bật — toàn bộ nội dung Skill sẽ được gửi tới model."
                    if active
                    else "Có cảnh báo bảo mật (Cách ly). Vẫn có thể bật để sử dụng."
                ),
            }
        if skill["status"] == "disabled":
            return {
                "state": "disabled",
                "eligible": False,
                "toggleable": True,
                "state_reason": "Bạn đã tắt Skill này.",
            }
        if skill["status"] in {"enabled", "approved"}:
            return {
                "state": "enabled",
                "eligible": True,
                "toggleable": True,
                "state_reason": None,
            }
        return {
            "state": "restricted",
            "eligible": False,
            "toggleable": False,
            "state_reason": "Trạng thái cài đặt không xác định.",
        }

    def test_local(self, identifier: str, request: str, spreadsheet: bool) -> dict:
        """Read and test the selected installation without starting a runtime session."""
        with self.store.lock:
            installed = self.store.get("skills", identifier)
            if not installed:
                raise SkillLifecycleError(
                    "skill_not_found", 404, "Không tìm thấy bản cài đặt Skill."
                )
            try:
                files = self.read_installation(installed)
            except (KeyError, ValueError) as error:
                raise SkillLifecycleError(
                    "skill_installation_invalid",
                    409,
                    "Bản cài đặt không khớp danh mục tệp và SHA-256 đã ghi nhận.",
                ) from error
        parsed = parse_skill(files)
        candidate = {**installed, **parsed}
        request = request.strip() or candidate["name"]
        named, metadata, body = discovery_score(
            candidate,
            unicodedata.normalize("NFKC", request).casefold(),
            meaningful_words(request),
        )
        registered = set(ToolRegistry.names())
        return {
            "skill_id": identifier,
            "package_sha256": self.package_digest(installed["hashes"]),
            "installation_status": installed["status"],
            "security": parsed["security"],
            "matches_task": (
                spreadsheet_skill(candidate)
                if spreadsheet
                else named or metadata + body >= 2
            ),
            "available": self.available(candidate),
            "requested_tools": [
                {"name": name, "registered": name in registered}
                for name in parsed["security"]["requested_tools"]
            ],
        }

    def list_library(self) -> list[dict]:
        installed = sorted(
            self.store.all("skills"), key=self.revision_order, reverse=True
        )
        packages = {}
        library = []
        for row in installed:
            hashes = row.get("hashes")
            fingerprint = (
                self.package_digest(hashes)
                if isinstance(hashes, dict) and hashes
                else None
            )
            canonical = (
                packages.get(fingerprint) if not row.get("research_fixture") else None
            )
            if canonical is not None:
                canonical["duplicate_installations"].append(
                    {key: row.get(key) for key in ("id", "status", "created_at")}
                )
                continue
            skill = {**self.library_record(row), "duplicate_installations": []}
            if fingerprint:
                skill["package_sha256"] = fingerprint
                if not row.get("research_fixture"):
                    packages[fingerprint] = skill
            library.append(skill)
        return library

    def set_enabled(self, identifier: str, enabled: bool) -> dict:
        """Change only the user's switch for one installed Skill, by its unique ID.

        Quarantined Skills keep ``status='quarantine'`` so warnings and offline review
        remain intact, while ``quarantine_enabled`` controls whether they are sent to the
        model in Chat. Only internal restricted fixtures cannot be toggled.
        """
        with self.store.lock:
            skill = self.store.get("skills", identifier)
            if not skill:
                raise SkillLifecycleError(
                    "skill_not_found", 404, "Không tìm thấy Skill."
                )
            skill = self.library_record(skill)
            state = self.skill_state(skill)["state"]
            if state == "restricted":
                if enabled:
                    raise SkillLifecycleError(
                        "skill_restricted",
                        409,
                        "Skill này bị hạn chế và không thể bật trong chế độ thường.",
                    )
                return skill
            if state == "quarantined":
                if enabled:
                    self.verify(skill)
                current = bool(skill.get("quarantine_enabled"))
                if skill["status"] == "quarantine" and current == enabled:
                    return skill
                return self.store.put(
                    "skills",
                    {
                        **skill,
                        "status": "quarantine",
                        "quarantine_enabled": enabled,
                        "updated_at": now(),
                    },
                )
            if enabled:
                self.verify(skill)
            target = "enabled" if enabled else "disabled"
            if skill["status"] == target:
                return skill
            return self.store.put(
                "skills", {**skill, "status": target, "updated_at": now()}
            )

    def archived_manifest(self, identifier: str) -> dict:
        if not SKILL_ID.fullmatch(identifier):
            raise SkillLifecycleError("skill_not_found", 404, "Không tìm thấy Skill.")
        path = self.archives / f"{identifier}.zip"
        try:
            self.require_plain_path(self.archives, stat.S_ISDIR)
            self.require_plain_path(path, stat.S_ISREG)
            with zipfile.ZipFile(path) as archive:
                manifest = json.loads(archive.read("manifest.json"))
            if manifest["id"] != identifier:
                raise ValueError("Mã định danh bản lưu không khớp.")
            return manifest
        except FileNotFoundError as error:
            raise SkillLifecycleError(
                "skill_snapshot_not_found", 404, "Chưa có bản lưu nhập Skill."
            ) from error
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
            raise SkillLifecycleError(
                "skill_snapshot_invalid", 409, "Không thể xác minh bản lưu nhập Skill."
            ) from error

    def review_quarantined(
        self, identifier: str, expected_hash: str, conversation_id: str | None
    ) -> dict:
        """Pin the existing archive and append only a local static-review receipt."""
        with self.store.skill_installation_transaction() as db:
            skill = self.store.get("skills", identifier, connection=db)
            if not skill:
                raise SkillLifecycleError(
                    "skill_not_found", 404, "Không tìm thấy Skill."
                )
            if skill["status"] != "quarantine":
                raise SkillLifecycleError(
                    "skill_not_quarantined",
                    409,
                    "Luồng này dành cho Skill đang cách ly.",
                )
            if conversation_id and not self.store.get(
                "conversations", conversation_id, connection=db
            ):
                raise SkillLifecycleError(
                    "conversation_not_found", 404, "Không tìm thấy cuộc trò chuyện."
                )
            try:
                hashes = skill["hashes"]
                package_hash = self.package_digest(hashes)
                if package_hash != expected_hash:
                    raise ValueError("Revision mismatch")
                approved_at = now()
                files = self.read_installation(skill)
                self.archive(skill, files, existing_only=True)
                security = parse_skill(files)["security"]
            except (
                OSError,
                ValueError,
                KeyError,
                RuntimeError,
                zipfile.BadZipFile,
            ) as error:
                raise SkillLifecycleError(
                    "skill_review_integrity_failed",
                    409,
                    "Không xác minh được bản cài và bản lưu theo SHA-256 đã chọn.",
                ) from error
            record = {
                "id": uid(),
                "skill_id": identifier,
                "skill_name": skill["name"],
                "conversation_id": conversation_id,
                "evidence_type": "local_static_review",
                "authorized_at": approved_at,
                "completed_at": now(),
                "status": skill["status"],
                "snapshot": {
                    "archive_id": identifier,
                    "package_sha256": package_hash,
                    "skill_md_sha256": hashes["SKILL.md"],
                    "file_hashes": hashes,
                },
                "security": security,
                "provider": "not_called",
                "model_exposure": "not_submitted",
                "presented_material_sha256": None,
                "tool_execution": "not_run",
                "artifact_verification": "not_applicable",
            }
            self.store.put_many("skill_reviews", [record], connection=db)
            return record

    def remove(self, identifier: str) -> dict:
        with self.store.lock:
            if not SKILL_ID.fullmatch(identifier):
                raise SkillLifecycleError(
                    "skill_not_found", 404, "Không tìm thấy Skill."
                )
            skill = self.store.get("skills", identifier)
            tombstone = self.root / f".removed-{identifier}"
            snapshot = self.archives / f"{identifier}.zip"
            if not skill:
                if not snapshot.is_file():
                    raise SkillLifecycleError(
                        "skill_not_found", 404, "Không tìm thấy Skill."
                    )
                if tombstone.exists() or tombstone.is_symlink():
                    try:
                        self.require_plain_path(self.root, stat.S_ISDIR)
                        self.verify_layout(
                            self.archived_manifest(identifier), tombstone
                        )
                        shutil.rmtree(tombstone)
                    except (
                        ValueError,
                        OSError,
                        KeyError,
                        SkillLifecycleError,
                    ) as error:
                        raise SkillLifecycleError(
                            "skill_cleanup_pending",
                            409,
                            "Skill đã gỡ khỏi thư viện; chưa dọn được tệp cài đặt.",
                        ) from error
                return {"status": "removed"}
            try:
                root = self.installed_root(skill)
                staged = tombstone.exists() or tombstone.is_symlink()
                if staged:
                    if root.exists() or root.is_symlink():
                        raise ValueError("Thư mục gỡ Skill đã tồn tại.")
                    self.verify_layout(skill, tombstone)
                else:
                    self.verify_layout(skill, root)
                    if not snapshot.is_file():
                        self.archive(skill, self.read_installation(skill))
                if self.archived_manifest(identifier)["hashes"] != skill["hashes"]:
                    raise ValueError("SHA-256 bản lưu không khớp với bản cài đặt.")
                if not staged:
                    root.rename(tombstone)
                try:
                    self.store.delete("skills", identifier)
                except Exception:
                    tombstone.rename(root)
                    raise
            except (OSError, ValueError, KeyError, SkillLifecycleError) as error:
                raise SkillLifecycleError(
                    "skill_installation_invalid",
                    409,
                    "Không thể xác minh thư mục cài đặt Skill để gỡ an toàn.",
                ) from error
            try:
                shutil.rmtree(tombstone)
            except OSError:
                return {"status": "removed", "cleanup_pending": True}
            return {"status": "removed"}

    def available_skills(self) -> list[dict]:
        """Every enabled and authorized Skill, in a stable order, one per installation."""
        return sorted(
            (skill for skill in self.list_library() if self.available(skill)),
            key=lambda skill: (skill["name"], skill.get("created_at") or "", skill["id"]),
        )

    def resolve_enabled(self) -> dict:
        """Atomically snapshot the Skills a task may use: ID, SHA-256 and verified text.

        A Skill whose installation no longer matches its recorded hashes is withheld with
        the reason rather than failing the task or being ignored without a trace.
        """
        sources, withheld, taken = [], [], now()
        with self.store.lock:
            for skill in self.available_skills():
                try:
                    skill_md, companions = self.read_package_texts(skill)
                    sources.append((skill, self.format_materials(skill_md, companions)))
                except (OSError, KeyError, ValueError):
                    withheld.append(
                        {
                            "skill_id": skill["id"],
                            "skill_name": skill["name"],
                            "reason": "integrity_failed",
                            "message": f"Skill {skill['id']} không khớp SHA-256 đã ghi nhận.",
                        }
                    )
        return {
            "sources": sources,
            "withheld": withheld,
            "snapshot": {
                "mode": "all_enabled",
                "taken_at": taken,
                "skills": [
                    {
                        "id": skill["id"],
                        "name": skill["name"],
                        "sha256": skill["hashes"]["SKILL.md"],
                        "package_sha256": skill.get("package_sha256")
                        or self.package_digest(skill["hashes"]),
                    }
                    for skill, _ in sources
                ],
            },
        }

    def revalidate(self, snapshot_skills: list[dict]) -> list[dict]:
        """Return the pinned Skills that changed or stopped being eligible."""
        changed = []
        with self.store.lock:
            for pinned in snapshot_skills:
                stored = self.store.get("skills", pinned["id"])
                current = self.library_record(stored) if stored else None
                intact = False
                if (
                    current is not None
                    and self.available(current)
                    and current["hashes"]["SKILL.md"] == pinned["sha256"]
                ):
                    try:
                        self.verify(current)
                        intact = True
                    except (OSError, KeyError, ValueError):
                        pass
                if not intact:
                    changed.append(pinned)
        return changed

    def summary(self) -> dict:
        counts = {"enabled": 0, "disabled": 0, "quarantined": 0, "restricted": 0}
        for skill in self.list_library():
            counts[self.skill_state(skill)["state"]] += 1
        return {"total": sum(counts.values()), **counts}

    def discover(
        self, request: str, spreadsheet: bool = False, selected: str | None = None
    ) -> dict | None:
        if selected:
            stored = self.store.get("skills", selected)
            match = self.library_record(stored) if stored else None
            if not self.available(match) or (
                spreadsheet and not spreadsheet_skill(match)
            ):
                raise PermissionError(
                    "Skill đã chọn bị hạn chế hoặc không phù hợp với tác vụ. Chọn Skill khác hoặc bỏ chọn."
                )
            return match

        candidates = self.available_skills()
        lowered = unicodedata.normalize("NFKC", request).casefold()
        words = meaningful_words(request)

        def score(skill):
            return discovery_score(skill, lowered, words)

        if spreadsheet:
            candidates = [s for s in candidates if spreadsheet_skill(s)]

        for skill in sorted(candidates, key=score, reverse=True):
            named, metadata_matches, body_matches = score(skill)
            if not spreadsheet and not (named or metadata_matches + body_matches >= 2):
                continue
            with suppress(ValueError):
                self.verify(skill)
                return skill
        return None
