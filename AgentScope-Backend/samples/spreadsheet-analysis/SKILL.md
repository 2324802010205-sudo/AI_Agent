---
name: spreadsheet-analysis
description: Phân tích bảng tính Excel, CSV, thống kê dữ liệu doanh thu và tạo báo cáo Excel có định dạng.
capabilities:
  - read_spreadsheet
  - analyze_spreadsheet
  - generate_report
metadata:
  author: AgentScope
  version: "1.0"
---

# Phân tích bảng tính

Chỉ sử dụng các tệp người dùng đã đính kèm trong yêu cầu hiện tại.
1. Dùng read_spreadsheet để kiểm tra tiêu đề và số dòng của trang tính đầu tiên.
2. Dùng analyze_spreadsheet để tính số lượng, tổng, trung bình, nhỏ nhất, lớn nhất và số ô trống.
3. Dùng generate_report để lưu Excel trong workspace đã cấp quyền.
4. Giải thích kết quả bằng tiếng Việt. Không bịa số liệu, không thực thi macro hoặc shell.

Các chỉ số chỉ là thống kê mô tả. Không đưa ra suy luận nguyên nhân từ các chỉ số.

Gói mẫu này không tự được phê duyệt khi nhập; người dùng phải xét duyệt trên giao diện.
