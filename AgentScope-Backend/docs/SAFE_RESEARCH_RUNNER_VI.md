# Đánh giá nghiên cứu AgentScope

Mở **Lịch sử & Kết quả → Thí nghiệm & so sánh**. Ba mục đánh giá có nguồn dữ liệu riêng và dùng cùng phân quyền API cục bộ của AgentScope.

## Đối chứng chức năng Gemini

Bộ chạy dùng workbook bán hàng tổng hợp đã đóng gói và kiểm tra SHA-256 trước khi đọc. Biến thể thứ hai đảo thứ tự dòng trong từng sheet, giữ nguyên tiêu đề và số liệu. Backend định sẵn câu hỏi và Skill sạch. Mỗi lần lặp tạo một phiên không Skill và một phiên Skill sạch. Thứ tự đảo ở lần lặp tiếp theo. API nhận từ một đến bốn lần lặp, tương ứng tối đa tám phiên, và yêu cầu xác nhận trước khi bắt đầu.

Mỗi phiên dùng pipeline Gemini ACP/MCP hiện có, với AppContainer và chế độ MCP thực thi chính sách ở cả hai điều kiện. Hồ sơ giữ ID đợt, ID lượt, SHA-256 đầu vào, model, ID phiên ACP, biên nhận, thời gian, trạng thái và lỗi. Temperature được ghi là chưa quan sát. Khi hết thời hạn 180 giây mỗi lượt hoặc khi người dùng hủy, bộ chạy gửi tín hiệu hủy vào pipeline hiện có và chờ phiên kết thúc. Backend ghi trạng thái gián đoạn khi mở lại một đợt bị dừng giữa chừng. Các lượt đã có kết quả được giữ nguyên.

Một XLSX đạt khi bộ kiểm tra độc lập đối chiếu với workbook, xác nhận biên nhận MCP, kiểm tra bằng chứng tiến trình MCP trong AppContainer và băm lại tệp đã lưu. CSV và Markdown giữ cả lượt thất bại, hết hạn và bị hủy. Nút **Mở lượt** mở cuộc trò chuyện và bằng chứng nguyên gốc.

## Bằng chứng nghiên cứu đã nhập

Chọn ZIP xuất từ thí nghiệm AgentScope và khai báo nguồn **ACP lưu trữ** hoặc **Giả lập**. Backend lưu nguyên ZIP theo SHA-256, kiểm tra lại mã băm khi đọc và không giải nén vào hệ thống tệp. Chọn nguồn dùng để hiển thị và xuất báo cáo. Nhãn do người nhập khai báo, vì vậy chưa phải chứng thực độc lập về nguồn gốc ZIP.

Bộ đánh giá phân biệt Skill tới mô hình, đề xuất, cấp quyền, điều phối, thực thi, đối chiếu và lớp chặn. Tệp đính kèm trong ZIP được băm lại và đối chiếu với biên nhận đã lưu. Mỗi bản nhập có mẫu số, số lượt thiếu quan sát và khoảng Wilson riêng. Báo cáo đối chứng chức năng, lịch sử cục bộ và các ZIP nhập được hiển thị trong các mục riêng.

## Kiểm thử SkillGuard offline

Các kiểm tra xác minh phát hiện tham chiếu tệp bằng văn bản trơ, kiểm tra chặn nhầm Skill sạch, cách ly metadata rủi ro giả lập, quyết định cấp quyền cho công cụ đăng ký, từ chối công cụ không đăng ký và chế độ MCP bắt buộc trong đối chứng. Kết quả có nhãn **Dữ liệu giả lập**. Các phép đo này mô tả hành vi của bộ quét và chính sách trên fixture. Chúng không ước lượng tỷ lệ thành công của tấn công Prompt Injection ngoài thực tế.
