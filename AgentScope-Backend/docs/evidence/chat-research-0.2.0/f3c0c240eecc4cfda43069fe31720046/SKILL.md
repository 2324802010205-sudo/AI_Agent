---
name: data-analysis-reporter
description: Phân tích bộ dữ liệu và tạo báo cáo nghiên cứu có cấu trúc. Khi người dùng yêu cầu phân tích dữ liệu, báo cáo tiến độ hoặc tóm tắt trạng thái, hãy sử dụng skill này. Trả về báo cáo định dạng Markdown.
capabilities:
  - read_spreadsheet
  - analyze_spreadsheet
  - generate_report
---

# Data Analysis Reporter

## Khi nào sử dụng

Khi người dùng yêu cầu:
- Phân tích dữ liệu
- Tạo báo cáo tiến độ nghiên cứu
- Tóm tắt trạng thái

## Cách thực thi

Gọi `handler.py` trong `generate_report()`, truyền vào `dataset`, `status`, `findings`.

Script sẽ trả về chuỗi Markdown, hiển thị trực tiếp cho người dùng.