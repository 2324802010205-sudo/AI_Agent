---
name: sales-kpi-executive-summary
description: Tính toán và trình bày bảng KPI điều hành bán hàng (doanh thu thuần, lợi nhuận gộp, biên lợi nhuận %, AOV, tỷ lệ hủy đơn) chuẩn hóa theo tiếng Việt từ bảng tính đính kèm.
capabilities:
  - read_spreadsheet
  - analyze_spreadsheet
  - generate_report
metadata:
  author: AgentScope Business Pack
  category: executive-kpi
  version: "1.0"
---

# Quy trình Tổng hợp KPI Điều hành Bán hàng

Áp dụng Skill này cho mọi yêu cầu phân tích bán hàng hoặc lập báo cáo kinh doanh từ bảng tính đính kèm.

## 1. Xác minh cấu trúc dữ liệu
- Gọi `list_sheets` và `read_sheet` để xác định chính xác tên trang dữ liệu và tên cột thực tế (cột doanh thu, lợi nhuận, trạng thái đơn, sản phẩm, khu vực, ngày).
- Không suy đoán hoặc tự bịa số liệu; mọi con số đều phải lấy từ kết quả công cụ MCP.

## 2. Tính toán bộ KPI cốt lõi
- Gọi `calculate_totals` (có lọc đơn hủy nếu tồn tại cột trạng thái, đồng thời truyền `completed_status`, `product_column`, `region_column` khi có).
- Gọi `analyze_sales_kpis` để lấy đầy đủ các chỉ số:
  1. Tổng số đơn ghi nhận, số đơn hoàn thành, số đơn hủy và **Tỷ lệ hủy đơn (%)**.
  2. **Doanh thu thuần** và **Lợi nhuận gộp** (định dạng dấu chấm phân cách hàng nghìn kèm đơn vị `VND`).
  3. **Biên lợi nhuận gộp (%)** = Lợi nhuận / Doanh thu.
  4. **Giá trị đơn hàng trung bình (AOV)** và **Lợi nhuận trung bình / đơn**.

## 3. Đánh giá sức khỏe kinh doanh (Scorecard)
Trình bày bảng tóm tắt KPI ở ngay đầu báo cáo kèm đánh giá nhanh:
- **Biên lợi nhuận gộp**: `>= 25%` (Tốt), `15%–25%` (Trung bình — cần tối ưu giá vốn/chiết khấu), `< 15%` (Cảnh báo mỏng biên).
- **Tỷ lệ hủy đơn**: `<= 10%` (Ổn định), `10%–20%` (Cần theo dõi), `> 20%` (Rủi ro vận hành cao).
- Nêu rõ phạm vi tính toán (đã loại trừ đơn hủy hay tính toàn bộ).
