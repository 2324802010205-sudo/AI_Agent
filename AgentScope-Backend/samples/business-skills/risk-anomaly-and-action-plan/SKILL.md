---
name: risk-anomaly-and-action-plan
description: Kiểm tra đơn hàng bất thường (lỗ, giá trị đột biến, tỷ lệ hủy cao), tổng hợp khuyến nghị hành động ưu tiên 30/90 ngày và hoàn thiện báo cáo Markdown lẫn tệp Excel đã xác minh.
capabilities:
  - read_spreadsheet
  - analyze_spreadsheet
  - generate_report
metadata:
  author: AgentScope Business Pack
  category: risk-and-actions
  version: "1.0"
---

# Quy trình Kiểm soát Rủi ro, Bất thường & Kế hoạch Hành động

Áp dụng Skill này ở giai đoạn tổng hợp cuối cùng để đảm bảo báo cáo vừa phát hiện rủi ro, vừa có hành động cụ thể và đầy đủ tệp đầu ra.

## 1. Kiểm toán Bất thường & Rủi ro Dữ liệu
Dựa trên `anomalies`, `cancellation_rate_pct` từ `analyze_sales_kpis` và đối chiếu dữ liệu gốc:
- Liệt kê các **đơn hàng lỗ (`negative_profit`)** nếu có, nêu rõ số dòng, doanh thu, mức lỗ.
- Liệt kê các **đơn hàng giá trị đột biến (`high_value_outlier`)** (> 2,5 lần AOV) để tránh đánh giá sai xu hướng chung.
- Nếu tỷ lệ hủy đơn > 15%, chỉ rõ mức thất thoát cơ hội doanh thu ước tính hoặc số lượng đơn bị hủy cần rà soát quy trình giao nhận/xác nhận đơn.

## 2. Kế hoạch Hành động Ưu tiên (Action Plan)
Đề xuất tối thiểu 3 khuyến nghị cụ thể gắn với số liệu thực tế vừa phân tích, chia làm 2 mức:
- **Ưu tiên ngay (0–30 ngày)**: xử lý điểm nghẽn có tác động tức thì (giảm hủy đơn, kiểm tra đơn lỗ, rà soát khu vực sụt giảm).
- **Tối ưu tăng trưởng (30–90 ngày)**: chiến lược gói combo/cross-sell sản phẩm biên cao, mở rộng khu vực có tỷ trọng thấp, chuẩn bị tồn kho trước kỳ cao điểm.

## 3. Hoàn thiện Đầu ra Chuẩn hóa
- Gọi `generate_business_report` để lưu báo cáo điều hành Markdown (`business-report.md`) đầy đủ Tóm tắt điều hành, Phát hiện nổi bật và Khuyến nghị.
- Gọi `propose_report` (dùng đúng số liệu đã tính từ `calculate_totals`) rồi gọi `create_excel_report` để tạo tệp `report.xlsx`.
- Trong câu trả lời tiếng Việt cuối cùng, tóm tắt rõ ràng các phát hiện chính và kết thúc đúng định dạng JSON yêu cầu nếu có.
