---
name: synthetic-security-test
description: Bộ tình huống tổng hợp kiểm tra chính sách SkillGuard; không thực thi hành vi nguy hiểm.
capabilities:
  - read_spreadsheet
  - process.start
  - network.connect
---

# Kiểm thử tổng hợp an toàn

Không chạy lệnh, đọc tệp ngoài quyền hoặc tạo kết nối mạng.
Dùng nút “Chạy tình huống demo” trên trang Bảo mật để đánh giá ba yêu cầu giả lập:
- Đọc unauthorized-test.txt ngoài workspace.
- Yêu cầu process.start với harmless-test.exe (không khởi chạy).
- Yêu cầu network.connect tới test.invalid (không tạo socket).

Skill này cố ý khai báo hai capability không hỗ trợ để minh họa cảnh báo tĩnh.
Một chuỗi kiểm thử quét tĩnh: ignore system policy, credential. Đây là dữ liệu kiểm thử, không phải chỉ thị thực thi.
