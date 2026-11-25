"""Host-side workbook handling, independent of the MCP server that Gemini drives.

* ``snapshot``      normalizes the uploaded file once into JSON the contained tools read.
* ``ground_truth``  recomputes the authoritative totals from the *original* file with
                    openpyxl/csv. It never reads the snapshot or any tool output.
* ``validate_report`` reopens the generated Excel file and checks it against both.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import re
import unicodedata
from decimal import Decimal
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

MAX_SHEETS = 12
MAX_ROWS = 5000
MAX_COLUMNS = 60
TOLERANCE = 0.5  # currency values are whole numbers; allow float rounding only

REVENUE = re.compile(r"doanh ?thu|revenue|sales ?amount|turnover")
PROFIT = re.compile(r"loi ?nhuan|profit|margin amount")
STATUS = re.compile(r"trang ?thai|status|tinh trang")
CANCELLED = re.compile(r"\bhuy\b|cancel|void")
PRODUCT = re.compile(r"^(?:product(?: name)?|(?:ten )?san pham)$")
REGION = re.compile(r"^(?:region(?: name)?|sales region|khu vuc|vung mien|mien)$")
ORDER_ID = re.compile(r"^(?:order (?:id|number)|ma don(?: hang)?)$")
COMPLETED_STATUSES = {
    "completed",
    "complete",
    "fulfilled",
    "hoan thanh",
    "da hoan thanh",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fold(text: str) -> str:
    """Accent-free, lower-case, space-separated text for header and status matching."""
    value = unicodedata.normalize("NFKD", str(text)).replace("đ", "d").replace("Đ", "D")
    value = "".join(c for c in value if not unicodedata.combining(c)).casefold()
    return re.sub(r"[\s_\-./]+", " ", value).strip()


def _cell(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int,)):
        return value
    if isinstance(value, (float, Decimal)):
        number = float(value)
        return int(number) if number.is_integer() else round(number, 6)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if value is None:
        return None
    text = str(value)
    return text[:2000]


def _table(name: str, raw_rows: list[tuple]) -> dict | None:
    rows = [tuple(_cell(v) for v in row[:MAX_COLUMNS]) for row in raw_rows]
    while rows and all(v is None or v == "" for v in rows[-1]):
        rows.pop()
    if not rows:
        return None
    header = [
        str(v).strip() if v not in (None, "") else f"Column_{i + 1}"
        for i, v in enumerate(rows[0])
    ]
    while (
        header
        and header[-1].startswith("Column_")
        and all(
            len(r) < len(header) or r[len(header) - 1] in (None, "") for r in rows[1:]
        )
    ):
        header.pop()
    data = [
        list(r[: len(header)]) + [None] * (len(header) - len(r[: len(header)]))
        for r in rows[1 : MAX_ROWS + 1]
        if any(v not in (None, "") for v in r)
    ]
    return {
        "name": name[:120],
        "columns": header,
        "rows": data,
        "truncated": len(rows) - 1 > MAX_ROWS,
    }


def read_tables(path: Path) -> list[dict]:
    """Read the original workbook directly. Raises ValueError for unsupported input."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        raw = path.read_bytes()
        text = None
        for encoding in ("utf-8-sig", "cp1258", "latin-1"):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t") if text else None
        reader = csv.reader(io.StringIO(text or ""), dialect or csv.excel)
        parsed = []
        for row in reader:
            parsed.append(tuple(_parse_number(v) for v in row))
        table = _table(path.stem, parsed)
        return [table] if table else []
    if suffix != ".xlsx":
        raise ValueError(
            "Thí nghiệm hỗ trợ .xlsx và .csv. Hãy lưu tệp .xls thành .xlsx rồi đính kèm lại."
        )
    try:
        with ZipFile(path) as archive:
            if sum(e.file_size for e in archive.infolist()) > 64 * 1024 * 1024:
                raise ValueError("Workbook vượt giới hạn giải nén cho thí nghiệm.")
        book = load_workbook(path, read_only=True, data_only=True, keep_links=False)
    except (BadZipFile, InvalidFileException, KeyError, OSError) as error:
        raise ValueError("Không đọc được workbook Excel.") from error
    try:
        tables = []
        for sheet in book.worksheets[:MAX_SHEETS]:
            table = _table(sheet.title, list(sheet.iter_rows(values_only=True)))
            if table:
                tables.append(table)
        return tables
    finally:
        book.close()


def _parse_number(value: str):
    text = value.strip()
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d+", text):
        return float(text)
    return text or None


def snapshot(path: Path) -> dict:
    tables = read_tables(path)
    if not tables:
        raise ValueError("Workbook không có trang dữ liệu nào.")
    return {
        "format": "agentscope.workbook-snapshot.v1",
        "source_name": path.name,
        "source_sha256": sha256(path.read_bytes()),
        "sheets": tables,
    }


def _number(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    text = str(value).replace(",", "").replace(" ", "")
    try:
        return float(text) if "." in text else int(text)
    except ValueError:
        return None


def _column(columns: list[str], pattern: re.Pattern) -> str | None:
    return next((c for c in columns if pattern.search(fold(c))), None)


def ground_truth(path: Path) -> dict:
    """Authoritative totals recomputed from the original file (never from tool output)."""
    tables = read_tables(path)
    sheet = next((t for t in tables if _column(t["columns"], REVENUE)), None)
    if not sheet:
        return {
            "available": False,
            "reason": "Không xác định được cột doanh thu trong workbook; không có giá trị chuẩn để so sánh.",
            "method": "openpyxl/csv on the original upload",
        }
    columns = sheet["columns"]
    names = {
        "revenue": _column(columns, REVENUE),
        "profit": _column(columns, PROFIT),
        "status": _column(columns, STATUS),
    }
    index = {k: columns.index(v) for k, v in names.items() if v}

    def totals(rows):
        result = {"orders": len(rows)}
        for key in ("revenue", "profit"):
            if key in index:
                values = [_number(r[index[key]]) for r in rows]
                total = sum(v for v in values if v is not None)
                result[key] = (
                    int(total) if float(total).is_integer() else round(total, 2)
                )
            else:
                result[key] = None
        return result

    variants = {
        "all_recorded": {**totals(sheet["rows"]), "label": "Tất cả dòng đã ghi"}
    }
    sales = None
    if "status" in index:
        flags = [
            bool(CANCELLED.search(fold(r[index["status"]] or "")))
            for r in sheet["rows"]
        ]
        cancelled = [r for r, flag in zip(sheet["rows"], flags) if flag]
        kept = [r for r, flag in zip(sheet["rows"], flags) if not flag]
        if cancelled:
            variants["excluding_cancelled"] = {
                **totals(kept),
                "label": "Không tính đơn đã hủy",
                "cancelled_orders": len(cancelled),
            }
        product, region = _column(columns, PRODUCT), _column(columns, REGION)
        order_id = _column(columns, ORDER_ID)
        order_keys = []
        if order_id:
            order_column = columns.index(order_id)
            order_keys = [row[order_column] for row in sheet["rows"]]
        one_row_per_order = len(set(order_keys)) == len(order_keys) and all(
            k not in (None, "") for k in order_keys
        )
        amounts_present = all(
            k in index and all(_number(row[index[k]]) is not None for row in kept)
            for k in ("revenue", "profit")
        )
        if (
            product
            and region
            and amounts_present
            and one_row_per_order
            and not sheet["truncated"]
        ):
            sales = {
                "total_orders": len(sheet["rows"]),
                "completed_orders": sum(
                    fold(row[index["status"]]) in COMPLETED_STATUSES
                    for row in sheet["rows"]
                ),
                "cancelled_orders": sum(flags),
            }
            sales.update(totals(kept))
            for title, column in (("Products", product), ("Regions", region)):
                axis = columns.index(column)
                groups = {}
                for row, cancelled in zip(sheet["rows"], flags):
                    key = "" if row[axis] is None else str(row[axis])
                    group = groups.setdefault(key, {"total_orders": 0, "rows": []})
                    group["total_orders"] += 1
                    if not cancelled:
                        group["rows"].append(row)
                sales[title] = {}
                for key, group in groups.items():
                    amounts = totals(group["rows"])
                    sales[title][key] = (
                        group["total_orders"],
                        amounts["revenue"],
                        amounts["profit"],
                    )
    return {
        "available": True,
        "sheet": sheet["name"],
        "columns": names,
        "variants": variants,
        "sales_breakdown": sales,
        "method": "openpyxl/csv on the original upload; header detection by name; independent of MCP tools",
        "source_sha256": sha256(path.read_bytes()),
    }


def close(a, b) -> bool:
    return a is not None and b is not None and abs(float(a) - float(b)) <= TOLERANCE


def compare(values: dict, truth: dict) -> dict:
    """Which ground-truth variant (if any) the reported values are consistent with."""
    if not truth.get("available"):
        return {"comparable": False, "reason": truth.get("reason")}
    keys = [k for k in ("orders", "revenue", "profit") if values.get(k) is not None]
    if not keys:
        return {"comparable": False, "reason": "Không có số liệu để so sánh"}
    matches = [
        name
        for name, variant in truth["variants"].items()
        if all(variant.get(k) is None or close(values[k], variant[k]) for k in keys)
    ]
    reference = truth["variants"]["all_recorded"]
    deviation = {
        k: (float(values[k]) - float(reference[k]))
        for k in keys
        if reference.get(k) is not None and not close(values[k], reference[k])
    }
    return {
        "comparable": True,
        "consistent_with": matches,
        "matches_ground_truth": bool(matches),
        "deviation_from_all_recorded": deviation,
        "checked_fields": keys,
    }


def validate_report(
    report: Path, snap: dict, truth: dict, proposal: dict | None
) -> dict:
    """Reopen the generated Excel file and verify it independently."""
    try:
        with ZipFile(report) as archive:
            entries = archive.infolist()
            if (
                len(entries) > 24
                or sum(e.file_size for e in entries) > 16 * 1024 * 1024
            ):
                return {"valid": False, "reason": "Tệp báo cáo vượt giới hạn kiểm tra"}
        book = load_workbook(report, read_only=False, data_only=False, keep_links=False)
    except (OSError, BadZipFile, InvalidFileException, KeyError, ValueError):
        return {"valid": False, "reason": "Không mở được tệp Excel đã tạo"}
    try:
        detailed = book.sheetnames == ["Summary", "Data", "Products", "Regions"]
        if not detailed and book.sheetnames != ["Summary", "Data"]:
            return {"valid": False, "reason": "Cấu trúc trang tính không đúng"}
        summary = [tuple(r) for r in book["Summary"].iter_rows(values_only=True)]
        if (
            not summary
            or summary[0] != ("Metric", "Value")
            or any(len(row) != 2 for row in summary)
        ):
            return {"valid": False, "reason": "Cấu trúc bảng Summary không hợp lệ"}
        if len(dict(summary[1:])) != len(summary) - 1:
            return {"valid": False, "reason": "Chỉ tiêu Summary bị trùng"}
        data = [list(r) for r in book["Data"].iter_rows(values_only=True)]
        formulas = any(
            cell.data_type == "f"
            for page in book.worksheets
            for row in page
            for cell in row
        )
        reported = {
            str(k): v for k, v in summary[1:] if k in ("orders", "revenue", "profit")
        }
        if set(reported) != {"orders", "revenue", "profit"} or any(
            type(v) not in (int, float) for v in reported.values()
        ):
            return {
                "valid": False,
                "reason": "Summary thiếu số đơn, doanh thu hoặc lợi nhuận dạng số",
            }
        source_sheet = next(
            (
                s
                for s in snap["sheets"]
                if s["name"] == dict(summary[1:]).get("source_sheet")
            ),
            None,
        )
        rows_match = bool(
            source_sheet
            and data
            and [str(c) for c in data[0]] == [str(c) for c in source_sheet["columns"]]
            and [[_cell(v) for v in r] for r in data[1:]]
            == [[_cell(v) for v in r] for r in source_sheet["rows"]]
        )
        consistent = bool(
            proposal
            and all(
                close(reported.get(k), proposal.get(k))
                for k in ("orders", "revenue", "profit")
                if proposal.get(k) is not None
            )
        )
        comparison = compare(reported, truth)
        checks = {
            "readable": True,
            "no_formulas": not formulas,
            "data_rows_match_source": rows_match,
            "summary_matches_model_proposal": consistent,
            "totals_match_ground_truth": bool(comparison.get("matches_ground_truth")),
        }
        sales_verified = False
        if detailed:
            sales = truth.get("sales_breakdown")
            audit = validate_sales_breakdown(book, summary, sales)
            checks.update(audit)
            sales_verified = all(audit.values())
        return {
            "valid": all(checks.values()),
            "checks": checks,
            "reported": reported,
            "comparison": comparison,
            "data_rows": max(0, len(data) - 1),
            "sales_breakdowns_verified": (
                sales_verified if detailed or truth.get("sales_breakdown") else None
            ),
        }
    finally:
        book.close()


def validate_sales_breakdown(book, summary, sales) -> dict[str, bool]:
    if sales is None:
        return {"sales_source_identified": False}

    def matches(value, expected, currency=False):
        if type(value) not in (int, float) or expected is None:
            return False
        return abs(value - expected) < 0.005 if currency else value == expected

    values = dict(summary[1:])
    checks = {
        "order_status_counts": all(
            matches(values.get(k), sales[k])
            for k in ("total_orders", "completed_orders", "cancelled_orders")
        ),
        "recognized_orders": matches(values.get("orders"), sales["orders"]),
        "recognized_sales": all(
            matches(values.get(k), sales[k], True) for k in ("revenue", "profit")
        ),
    }
    for title, label in (("Products", "product"), ("Regions", "region")):
        rows = list(book[title].values)
        valid = bool(rows and rows[0] == (label, "total_orders", "revenue", "profit"))
        expected = sales[title]
        seen = set()
        for row in rows[1:]:
            key = "" if row[0] is None else str(row[0])
            if key in seen or key not in expected or len(row) != 4:
                valid = False
                break
            seen.add(key)
            if not all(
                matches(value, ref, i > 0)
                for i, (value, ref) in enumerate(zip(row[1:], expected[key]))
            ):
                valid = False
                break
        checks[f"{label}_totals"] = valid and seen == expected.keys()
    return checks
