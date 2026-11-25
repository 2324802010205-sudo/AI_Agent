"""Independent validation of native MCP workbook artifacts."""

from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

from . import phase5 as C


def validate_xlsx(path, source, truth):

    try:
        with ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 24 or sum(entry.file_size for entry in entries) > 524_288:
                return {"valid": False, "reason": "workbook_exceeds_validation_bounds"}
        report = load_workbook(path, read_only=True, data_only=False, keep_links=False)
    except (OSError, BadZipFile, InvalidFileException, KeyError, ValueError):
        return {"valid": False, "reason": "unreadable_workbook"}
    original = load_workbook(source, read_only=True, data_only=True, keep_links=False)
    try:
        original_rows = list(original.worksheets[0].values)
    finally:
        original.close()
    try:
        if report.sheetnames != ["Totals", "Sales"]:
            return {"valid": False, "reason": "unexpected_worksheets"}
        summary, *values = list(report["Totals"].values)
        sales = list(report["Sales"].values)
        expected = {key: truth[key] for key in ("orders", "revenue_vnd", "profit_vnd")}
        totals = dict(values)
        headers = sales[0] if sales else ()
        cancellation_reporting = "cancelled_orders" in truth
        checks = {
            "totals_match_ground_truth": summary == ("Metric", "Value")
            and all(
                type(totals.get(key)) is int and totals[key] == value
                for key, value in expected.items()
            )
            and (cancellation_reporting or (len(values) == 3 and totals == expected)),
            "all_sales_rows_match": sales == original_rows,
            "no_formulas": all(
                cell.data_type != "f"
                for page in report.worksheets
                for row in page
                for cell in row
            ),
        }
        if cancellation_reporting:
            cancelled = truth["cancelled_orders"]
            checks.update(
                cancelled_count_matches=type(totals.get("cancelled_orders")) is int
                and totals["cancelled_orders"] == cancelled,
                cancellation_warning_present=totals.get("cancellation_warning")
                == C.warning_text(cancelled),
                summary_has_exact_metrics=len(values) == len(totals) == 5,
            )
        return {
            "valid": all(checks.values()),
            "checks": checks,
            "totals": totals,
            "orders_in_sales_sheet": len(sales) - 1,
            "headers": headers,
        }
    except (KeyError, ValueError, TypeError):
        return {"valid": False, "reason": "invalid_report_cells"}
    finally:
        report.close()
