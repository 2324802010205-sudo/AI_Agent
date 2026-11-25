import csv
import math
import os
import statistics
import threading
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Literal

from openpyxl import Workbook, load_workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill

from .models import ToolArgs, now, uid
from .storage import Store

MAX_ROWS, MAX_COLS = 50000, 256


class Cancelled(Exception):
    pass


def checkpoint(cancel: threading.Event):
    if cancel.is_set():
        raise Cancelled("Tác vụ đã được hủy.")


def clean(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return (
        value if isinstance(value, (str, int, float, bool, type(None))) else str(value)
    )


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (ValueError, TypeError):
        return None


def verify_report(path, data):
    """Reopen the serialized XLSX before publishing it as a downloadable file."""
    with path.open("rb") as stream:
        workbook = load_workbook(stream, read_only=True, data_only=False)
        try:
            summary = data["summary"]
            overview = workbook["Tổng quan"]
            rows = workbook["Dữ liệu"]
            statistics_rows = list(workbook["Thống kê"].values)[1:]
            valid_stats = len(statistics_rows) == len(
                summary["numeric_columns"]
            ) and all(
                actual[:2] == (expected["column"], expected["count"])
                and all(
                    isinstance(value, (int, float))
                    and math.isclose(value, expected[key], rel_tol=1e-12)
                    for value, key in zip(actual[2:], ("sum", "mean", "min", "max"))
                )
                and len(actual) == 6
                for actual, expected in zip(statistics_rows, summary["numeric_columns"])
            )
            if (
                overview["B2"].value != data["name"]
                or overview["B3"].value != data["sheet"]
                or overview["B5"].value != summary["row_count"]
                or rows.max_row != summary["row_count"] + 1
                or [cell.value for cell in next(rows.iter_rows(max_row=1))]
                != data["headers"]
                or not valid_stats
            ):
                raise ValueError(
                    "Không thể xác minh cấu trúc và số liệu của báo cáo Excel."
                )
        finally:
            workbook.close()


@dataclass(frozen=True)
class RegisteredTool:
    handler: str
    operation: Literal["read", "write"]
    description: str


@dataclass(frozen=True)
class ReportOutput:
    id: str
    path: Path


class ToolRegistry:
    """Trusted spreadsheet tools shared by production and the scoped MCP broker."""

    _tools = {
        "read_spreadsheet": RegisteredTool(
            "read",
            "read",
            "Read an attached CSV/Excel by its file_id; reads the first worksheet.",
        ),
        "analyze_spreadsheet": RegisteredTool(
            "analyze",
            "read",
            "Calculate descriptive statistics for an already read spreadsheet.",
        ),
        "generate_report": RegisteredTool(
            "report",
            "write",
            "Create a formatted Excel report from an analyzed spreadsheet in the approved workspace.",
        ),
    }

    def __init__(self, store: Store, workspace: Path, *, lab_guidance_cell=False):
        self.store, self.workspace = store, workspace
        self.lab_guidance_cell = lab_guidance_cell
        self.cache: dict[str, dict] = {}

    @classmethod
    def names(cls) -> tuple[str, ...]:
        return tuple(cls._tools)

    @classmethod
    def specification(cls, name: str) -> RegisteredTool:
        try:
            return cls._tools[name]
        except KeyError as error:
            raise ValueError(
                "Công cụ không có trong registry được cấp quyền."
            ) from error

    def definitions(self):
        return [
            {
                "name": name,
                "description": tool.description,
                "parameters": ToolArgs.model_json_schema(),
            }
            for name, tool in self._tools.items()
        ]

    def validate(self, name: str, arguments: dict) -> ToolArgs:
        self.specification(name)
        return ToolArgs.model_validate(arguments)

    def execute(
        self,
        name: str,
        args: ToolArgs,
        cancel: threading.Event,
        *,
        output: ReportOutput | None = None,
    ):
        checkpoint(cancel)
        handler = getattr(self, self.specification(name).handler)
        if output is not None:
            return handler(args, cancel, output=output)
        return handler(args, cancel)

    def report_output(self) -> ReportOutput:
        identifier = uid()
        return ReportOutput(
            identifier, self.workspace / f"bao-cao-{identifier[:8]}.xlsx"
        )

    def read(self, args: ToolArgs, cancel: threading.Event):
        record = self.store.get("files", args.file_id)
        if not record:
            raise ValueError("Không tìm thấy tệp đính kèm.")
        path = Path(record["path"])
        suffix = path.suffix.lower()
        rows = []
        guidance = None
        sheet_name = "CSV"
        if suffix == ".csv":
            with path.open("r", encoding="utf-8-sig", newline="") as file:
                sample = file.read(8192)
                file.seek(0)
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
                except csv.Error:
                    dialect = csv.excel
                for row in csv.reader(file, dialect):
                    checkpoint(cancel)
                    if len(row) > MAX_COLS or len(rows) > MAX_ROWS:
                        raise ValueError(
                            "Bảng tính vượt giới hạn 50.000 dòng hoặc 256 cột."
                        )
                    rows.append(row)
        elif suffix == ".xlsx":
            with zipfile.ZipFile(path) as archive:
                infos = archive.infolist()
                if (
                    len(infos) > 5000
                    or sum(i.file_size for i in infos) > 100 * 1024 * 1024
                    or any(i.file_size > max(1, i.compress_size) * 300 for i in infos)
                ):
                    raise ValueError("Cấu trúc Excel vượt giới hạn giải nén an toàn.")
            workbook = load_workbook(
                path, read_only=True, data_only=True, keep_links=False
            )
            try:
                sheet = workbook.worksheets[0]
                sheet_name = sheet.title
                if (
                    sheet.max_column
                    and sheet.max_column > MAX_COLS
                    or sheet.max_row
                    and sheet.max_row > MAX_ROWS + 1
                ):
                    raise ValueError("Bảng tính vượt giới hạn an toàn.")
                for row in sheet.iter_rows(values_only=True):
                    checkpoint(cancel)
                    if len(rows) > MAX_ROWS or len(row) > MAX_COLS:
                        raise ValueError("Bảng tính vượt giới hạn an toàn.")
                    rows.append([clean(v) for v in row])
                if self.lab_guidance_cell:
                    cell = workbook["Huong_dan"]["B3"]
                    if not isinstance(cell.value, str) or len(cell.value) > 1000:
                        raise ValueError(
                            "Cell mẫu Huong_dan!B3 phải chứa văn bản ngắn."
                        )
                    guidance = {"sheet": "Huong_dan", "cell": "B3", "text": cell.value}
            finally:
                workbook.close()
        elif suffix == ".xls":
            import xlrd

            workbook = xlrd.open_workbook(path, on_demand=True)
            try:
                sheet = workbook.sheet_by_index(0)
                sheet_name = sheet.name
                if sheet.nrows > MAX_ROWS + 1 or sheet.ncols > MAX_COLS:
                    raise ValueError("Bảng tính vượt giới hạn an toàn.")
                for index in range(sheet.nrows):
                    checkpoint(cancel)
                    rows.append([clean(v) for v in sheet.row_values(index)])
            finally:
                workbook.release_resources()
        else:
            raise ValueError("Định dạng bảng tính không hỗ trợ.")
        if len(rows) < 2 or not any(str(v or "").strip() for v in rows[0]):
            raise ValueError(
                "Bảng tính cần một dòng tiêu đề và ít nhất một dòng dữ liệu."
            )
        width = max(len(r) for r in rows)
        headers = [
            str(rows[0][i] or f"Cột {i+1}") if i < len(rows[0]) else f"Cột {i+1}"
            for i in range(width)
        ]
        data = [
            r + [None] * (width - len(r))
            for r in rows[1:]
            if any(v not in (None, "") for v in r)
        ]
        if not data:
            raise ValueError("Không có dòng dữ liệu hợp lệ.")
        self.cache[args.file_id] = {
            "headers": headers,
            "rows": data,
            "sheet": sheet_name,
            "name": record["name"],
        }
        return {
            "file_id": args.file_id,
            "path": str(path.resolve()),
            "access": "read",
            "sheet": sheet_name,
            "row_count": len(data),
            "columns": headers,
            "preview": data[:5],
            **({"guidance_cell": guidance} if guidance else {}),
            "observed": True,
            "formula_policy": "Không thực thi công thức hoặc macro; dùng cached values.",
        }

    def analyze(self, args: ToolArgs, cancel: threading.Event):
        data = self.cache.get(args.file_id)
        if data is None:
            raise ValueError("Cần đọc bảng tính trước khi phân tích.")
        numeric = []
        for column, header in enumerate(data["headers"]):
            checkpoint(cancel)
            values = [
                v for row in data["rows"] if (v := number(row[column])) is not None
            ]
            if values:
                numeric.append(
                    {
                        "column": header,
                        "count": len(values),
                        "sum": sum(values),
                        "mean": statistics.mean(values),
                        "min": min(values),
                        "max": max(values),
                    }
                )
        summary = {
            "row_count": len(data["rows"]),
            "column_count": len(data["headers"]),
            "missing_cells": sum(v in (None, "") for row in data["rows"] for v in row),
            "numeric_columns": numeric,
        }
        data["summary"] = summary
        return summary

    def report(
        self,
        args: ToolArgs,
        cancel: threading.Event,
        *,
        output: ReportOutput | None = None,
    ):
        data = self.cache.get(args.file_id)
        if data is None or "summary" not in data:
            raise ValueError("Cần phân tích bảng tính trước khi tạo báo cáo.")
        checkpoint(cancel)
        workbook = Workbook()
        overview = workbook.active
        overview.title = "Tổng quan"
        overview.append(["AGENTSCOPE · BÁO CÁO PHÂN TÍCH"])
        overview.append(["Nguồn dữ liệu", data["name"]])
        overview.append(["Trang tính", data["sheet"]])
        overview.append(["Thời điểm UTC", now()])
        overview.append(["Số dòng", data["summary"]["row_count"]])
        overview.append(["Số cột", data["summary"]["column_count"]])
        overview.append(["Ô trống", data["summary"]["missing_cells"]])
        overview.append(
            [
                "Phạm vi",
                "Thống kê mô tả; không diễn giải nguyên nhân, không chạy macro.",
            ]
        )
        statistics_sheet = workbook.create_sheet("Thống kê")
        statistics_sheet.append(
            ["Cột", "Giá trị hợp lệ", "Tổng", "Trung bình", "Nhỏ nhất", "Lớn nhất"]
        )
        for column in data["summary"]["numeric_columns"]:
            statistics_sheet.append(list(column.values()))
        raw = workbook.create_sheet("Dữ liệu")
        raw.append(data["headers"])
        for row in data["rows"]:
            checkpoint(cancel)
            raw.append([clean(v) for v in row])
        # Neutralize spreadsheet formula injection, including user-supplied headers.
        for sheet in workbook:
            for row in sheet:
                checkpoint(cancel)
                for cell in row:
                    if isinstance(cell.value, str):
                        cell.data_type = "s"
                    cell.font = Font(name="Calibri", size=11, color="24324A")
                    cell.alignment = Alignment(vertical="center")
            for cell in sheet[1]:
                cell.fill = PatternFill("solid", fgColor="6350A2")
                cell.font = Font(name="Calibri", size=11, color="FFFFFF", bold=True)
            sheet.freeze_panes = "A2"
            sheet.auto_filter.ref = sheet.dimensions
            for col in sheet.columns:
                letter = col[0].column_letter
                sheet.column_dimensions[letter].width = min(
                    48, max(18, max(len(str(c.value or "")) for c in col[:100]) + 2)
                )
            sheet.row_dimensions[1].height = 28
        if statistics_sheet.max_row > 1:
            chart = BarChart()
            chart.title = "Giá trị trung bình theo cột"
            chart.add_data(
                Reference(
                    statistics_sheet,
                    min_col=4,
                    max_col=4,
                    min_row=1,
                    max_row=statistics_sheet.max_row,
                ),
                titles_from_data=True,
            )
            chart.set_categories(
                Reference(
                    statistics_sheet,
                    min_col=1,
                    min_row=2,
                    max_row=statistics_sheet.max_row,
                )
            )
            chart.style = 13
            overview.add_chart(chart, "A11")
        output = output or self.report_output()
        path = output.path
        temporary = path.with_suffix(".partial")
        created_temporary = False
        try:
            with temporary.open("xb") as stream:
                created_temporary = True
                workbook.save(stream)
            verify_report(temporary, data)
            checkpoint(cancel)
            os.replace(temporary, path)
            record = self.store.put(
                "files",
                {
                    "id": output.id,
                    "name": path.name,
                    "type": "xlsx",
                    "size": path.stat().st_size,
                    "path": str(path),
                    "created_at": now(),
                    "output": True,
                },
            )
            return {
                "file_id": output.id,
                "name": record["name"],
                "rows": len(data["rows"]),
                "path": str(path.resolve()),
                "size": record["size"],
                "access": "write",
                "observed": True,
                "validation": {"status": "verified", "method": "xlsx_readback"},
            }
        finally:
            if created_temporary:
                temporary.unlink(missing_ok=True)
            workbook.close()
