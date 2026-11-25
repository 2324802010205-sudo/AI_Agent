"""Content-addressed import of previously exported experiment evidence. Never extracted."""

import io
import json
import re
import threading
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException

from ..models import now
from . import conditions, evaluation, workbook

MAX_BYTES = 18 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
KINDS = {"historical_acp", "synthetic"}


def summarize_archive(content, kind):
    try:
        with ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            names = set()
            digests = {}
            if (
                len(entries) > 256
                or sum(item.file_size for item in entries) > MAX_EXPANDED
            ):
                raise ValueError("ZIP vượt giới hạn dung lượng hoặc số mục.")
            for entry in entries:
                name = entry.filename
                parts = PurePosixPath(name)
                if (
                    name in names
                    or parts.is_absolute()
                    or ".." in parts.parts
                    or "\\" in name
                    or ":" in name
                    or entry.flag_bits & 1
                ):
                    raise ValueError("Tên mục hoặc mã hóa ZIP không được hỗ trợ.")
                names.add(name)
            manifest = json.loads(archive.read("manifest.json"))
            if not re.fullmatch(r"[0-9a-f]{32}", manifest.get("id", "")):
                raise ValueError("Manifest thiếu ID thí nghiệm hợp lệ.")
            manifest["evidence_type"] = kind
            runs = manifest["conditions"]
            if not runs or any(key not in conditions.CONDITIONS for key in runs):
                raise ValueError("Manifest chứa điều kiện không được hỗ trợ.")
            rows = []
            for condition, record in runs.items():
                trace_path = f"{condition}/evidence.json"
                trace = (
                    json.loads(archive.read(trace_path)) if trace_path in names else {}
                )

                def verified(directory, name, digest):
                    if (
                        not isinstance(name, str)
                        or PurePosixPath(name).name != name
                        or not digest
                    ):
                        return False
                    path = "/".join(
                        part for part in (condition, directory, name) if part
                    )
                    if path not in names:
                        return False
                    if path not in digests:
                        digests[path] = workbook.sha256(archive.read(path))
                    return digests[path] == digest

                rows.append(
                    evaluation.run_observation(
                        manifest,
                        {**record, "condition": condition},
                        trace,
                        None,
                        None,
                        artifact_verifier=verified,
                    )
                )
            return evaluation.summarize(rows)
    except (
        BadZipFile,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        RuntimeError,
        NotImplementedError,
        RecursionError,
    ) as error:
        raise HTTPException(
            400, "ZIP không đúng định dạng bản xuất thí nghiệm AgentScope hoặc đã hỏng."
        ) from error


class ImportedEvidence:
    def __init__(self, root):
        self.root = root / "imported-evidence"
        self.root.mkdir(exist_ok=True)
        self.lock = threading.Lock()

    def import_archive(self, content, kind):
        if kind not in KINDS or len(content) > MAX_BYTES:
            raise HTTPException(
                400, "Loại bằng chứng hoặc kích thước ZIP không hợp lệ."
            )
        summary = summarize_archive(content, kind)
        digest = workbook.sha256(content)
        target = self.root / digest
        with self.lock:
            if target.exists():
                saved = self.metadata(digest)
                if saved["evidence_type"] != kind:
                    raise HTTPException(409, "ZIP đã được lưu với nhãn nguồn khác.")
                if workbook.sha256((target / "trace.zip").read_bytes()) != digest:
                    raise HTTPException(409, "ZIP đã lưu sai mã băm.")
                return saved
            metadata = {
                "id": digest,
                "sha256": digest,
                "evidence_type": kind,
                "imported_at": now(),
                "run_count": len(summary["runs"]),
            }
            with TemporaryDirectory(dir=self.root) as directory:
                staging = Path(directory)
                (staging / "trace.zip").write_bytes(content)
                (staging / "metadata.json").write_text(json.dumps(metadata), "utf-8")
                staging.rename(target)
            return metadata

    def metadata(self, identifier):
        if not re.fullmatch(r"[0-9a-f]{64}", identifier):
            raise HTTPException(404, "Không tìm thấy bằng chứng đã nhập.")
        try:
            return json.loads(
                (self.root / identifier / "metadata.json").read_text("utf-8")
            )
        except FileNotFoundError as error:
            raise HTTPException(404, "Không tìm thấy bằng chứng đã nhập.") from error

    def all(self):
        return sorted(
            (
                self.metadata(path.name)
                for path in self.root.iterdir()
                if re.fullmatch(r"[0-9a-f]{64}", path.name)
            ),
            key=lambda item: item["imported_at"],
            reverse=True,
        )

    def results(self, identifier):
        metadata = self.metadata(identifier)
        path = self.root / identifier / "trace.zip"
        if not path.is_file() or path.stat().st_size > MAX_BYTES:
            raise HTTPException(409, "ZIP đã lưu không còn khả dụng.")
        content = path.read_bytes()
        if workbook.sha256(content) != identifier:
            raise HTTPException(409, "ZIP đã lưu sai mã băm.")
        return {**metadata, **summarize_archive(content, metadata["evidence_type"])}
