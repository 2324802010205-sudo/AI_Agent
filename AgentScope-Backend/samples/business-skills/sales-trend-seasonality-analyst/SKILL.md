---
name: sales-trend-seasonality-analyst
description: Phân tích xu hướng tăng trưởng doanh thu, lợi nhuận và sản lượng đơn theo ngày/tháng/quý, xác định giai đoạn cao điểm, thấp điểm và biến động biên lợi nhuận theo thời gian.
capabilities:
  - read_spreadsheet
  - analyze_spreadsheet
  - generate_report
metadata:
  author: AgentScope Business Pack
  category: time-series-trends
  version: "1.0"
---

# Quy trình Phân tích Xu hướng & Mùa vụ Bán hàng

Áp dụng Skill này khi bảng tính có cột thời gian/ngày đặt hàng (ví dụ: `Ngay`, `Date`, `OrderDate`).

## 1. Phân tích chuỗi thời gian bằng công cụ chuẩn
- Gọi `analyze_sales_trends` với `period="month"` (hoặc `"quarter"` nếu dữ liệu trải dài nhiều năm, `"day"` nếu dữ liệu chỉ trong 1 tháng).
- Áp dụng cùng quy tắc lọc đơn hủy (`status_column`, `exclude_status`) như khi tính KPI tổng để đảm bảo nhất quán số liệu.

## 2. Nội dung bắt buộc trong phần Xu hướng
Trình bày bảng theo kỳ gồm: `Kỳ | Số đơn | Doanh thu (VND) | Lợi nhuận (VND) | Biên LN (%) | Tăng trưởng DT so với kỳ trước (%)`.
Sau đó rút ra 3 nhận định có số liệu chứng minh:
1. **Kỳ cao điểm (Peak)** và **Kỳ thấp điểm (Trough)**: chênh lệch tuyệt đối và phần trăm giữa đỉnh và đáy.
2. **Đà tăng trưởng (Momentum)**: xu hướng đang tăng tốc, chững lại hay suy giảm ở kỳ gần nhất.
3. **Ổn định biên lợi nhuận**: khi doanh thu tăng mạnh ở kỳ cao điểm, biên lợi nhuận có giữ vững hay bị bào mòn do giảm giá/chiết khấu.
