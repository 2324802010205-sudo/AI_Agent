---
name: product-region-pareto-analysis
description: Phân tích cơ cấu sản phẩm và khu vực theo nguyên lý Pareto 80/20, so sánh tỷ trọng doanh thu, biên lợi nhuận từng nhóm hàng và đề xuất bán chéo (cross-selling).
capabilities:
  - read_spreadsheet
  - analyze_spreadsheet
  - generate_report
metadata:
  author: AgentScope Business Pack
  category: product-region-mix
  version: "1.0"
---

# Quy trình Phân tích Cơ cấu Sản phẩm & Khu vực (Pareto 80/20)

Áp dụng Skill này khi bảng tính có thông tin sản phẩm, danh mục hàng hóa hoặc khu vực/chi nhánh bán hàng.

## 1. Xếp hạng theo đóng góp Doanh thu & Lợi nhuận
Sử dụng kết quả từ `analyze_sales_kpis` và `calculate_totals` để lập 2 bảng phân tích riêng:
- **Bảng Sản phẩm**: Tên sản phẩm | Số đơn | Doanh thu (VND) | Tỷ trọng doanh thu (%) | Lợi nhuận (VND) | Biên lợi nhuận (%).
- **Bảng Khu vực**: Khu vực | Số đơn | Doanh thu (VND) | Tỷ trọng doanh thu (%) | Lợi nhuận (VND) | Biên lợi nhuận (%).

## 2. Phân loại Danh mục (Ma trận Hiệu suất)
Phân nhóm sản phẩm và khu vực dựa trên số liệu thực tế:
- **Nhóm Chủ lực (Stars)**: Tỷ trọng doanh thu cao và biên lợi nhuận trên mức trung bình.
- **Nhóm Biên cao (High-Margin Gems)**: Doanh thu còn nhỏ nhưng biên lợi nhuận vượt trội — ưu tiên làm gói bán kèm (bundle/cross-sell) với nhóm Chủ lực.
- **Nhóm Biên thấp / Cần tối ưu**: Doanh thu lớn nhưng biên thấp hoặc tỷ lệ đóng góp yếu — cần rà soát chi phí, chiết khấu hoặc cơ cấu kênh bán.
- Chỉ rõ mức độ tập trung (Top 1–2 sản phẩm hoặc Top 1 khu vực đang chiếm bao nhiêu % doanh thu) để cảnh báo rủi ro phụ thuộc.
