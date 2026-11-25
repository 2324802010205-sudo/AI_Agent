# Chat thường dùng Skill qua Gemini ACP

Ngày 23/11/2026. Nhánh `fix/normal-chat-skill-composer-ui` trong cả hai kho. Mốc `checkpoint/normal-chat-skill-composer-20261123` trỏ tới Backend `09230f0` và Desktop `963f538`.

## Nguyên nhân và bản sửa

Luồng bảng tính cũ đã hỗ trợ Skill hợp lệ qua ACP/MCP trong AppContainer. Cảnh báo trước đây xuất hiện với Skill đang bị hạn chế. Bộ chọn còn đặt lại lựa chọn khi mở cuộc trò chuyện khác. Backend có nhánh cũ tự tìm Skill và nhánh ACP văn bản chặn Skill khi không có đường chạy cô lập. Hai nhánh này làm ý định chọn Skill trên Desktop và nội dung thực sự được gửi thiếu nhất quán.

Chat thường giờ gửi ID đã chọn hoặc giá trị rỗng rõ ràng. Backend ghi lựa chọn của lượt gửi vào đúng cuộc trò chuyện và xác minh gói theo ID, trạng thái quét và SHA-256 trước khi chuẩn bị ACP. Bản nháp lựa chọn được giữ riêng khi chuyển qua lại giữa các cuộc trò chuyện đang mở. Bỏ chọn sẽ gửi yêu cầu bảng tính mà không kèm hướng dẫn Skill.

Skill hợp lệ được đặt trong phần dữ liệu Skill có rào phân cách. Với workbook, Backend dùng cùng bảng tính được đính kèm, cùng AppContainer và MCP đã cấp quyền. Với yêu cầu văn bản có Skill, Backend mở phiên ACP cô lập riêng, đăng ký danh sách MCP rỗng và đặt chính sách từ chối mọi công cụ. Khi đổi Skill, phiên mới dùng nội dung của đúng ID mới.

Biên nhận ghi ID, SHA-256 của `SKILL.md`, hash văn bản thực sự chuyển, kết quả quét và trạng thái giao nhận qua ACP. `acknowledged` xác nhận Antigravity ACP nhận prompt và kết thúc lượt. Nội dung xử lý nội bộ của nhà cung cấp nằm ngoài quan sát. Skill cách ly hoặc gặp cổng chặn nội dung dừng trước khi gửi. Người dùng có thể đọc phát hiện, chọn Skill khác hoặc bỏ chọn. Quy định của các chế độ nghiên cứu OFF/ON và cấp quyền MCP bắt buộc tiếp tục áp dụng.

[Lưu lựa chọn](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Backend/agentscope/api.py:234) · [Luồng workbook và biên nhận Skill](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Backend/agentscope/experiments/chat_workbook.py:22) · [ACP văn bản từ chối mọi công cụ](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Backend/agentscope/experiments/trial.py:839)

## Ô soạn

Bốn chế độ dùng chung thanh phân đoạn. Trạng thái AppContainer nằm ngay dưới thanh và chi tiết Lab mở trên một hàng toàn chiều rộng. Workbook nằm trong khu vực ngữ cảnh. Một bộ chọn Skill nằm cạnh nút đính kèm. Nút gửi tròn neo ở góc dưới phải và vùng nhập tăng chiều cao theo số dòng. Skill bị hạn chế hiện một hàng cảnh báo có **Xem phát hiện** và **Bỏ chọn**.

[Bố cục ô soạn](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/src/composer.css) · [Điều khiển chế độ](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/src/components/research/ResearchControl.tsx:156) · [Bản Windows cũ ở 1.080 px, SkillGuard OFF](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/before-1080-1.png)

Bản Windows cuối được chụp và đo ở 1.600, 1.480, 1.280 và 1.080 px với Trung tâm thực thi mở. Chiều rộng ô soạn đo được lần lượt là 772, 772, 689 và 536 px. Cả 16 tổ hợp giữ nút gửi trong khung, không chồng nút chế độ và có độ tràn ngang bằng 0. Mục nâng cao ở cột hẹp xếp hai bộ chọn theo chiều dọc. Đã kiểm tra Shift+Enter xuống dòng, nút **Xem phát hiện** mở kết quả quét, và **Bỏ chọn** cho phép gửi trở lại.

[Sau sửa · OFF và chi tiết Lab ở 1.080 px](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/after-1080-off-details.png) · [Sau sửa · cảnh báo cách ly](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/after-1080-quarantine.png) · [Sau sửa · So sánh cả hai ở 1.280 px](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/after-1280-3.png) · [Số đo các viewport](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/layout-after.json) và [số đo bổ sung ở 1.280 px](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/layout-after-1280.json)

## Gemini và MCP thật trên Windows

Dùng `gemini-3.8-flash-high`, một workbook bán hàng tổng hợp và Skill sạch `spreadsheet-analysis` của repo. Bốn lượt sinh XLSX chạy qua Antigravity ACP và MCP. PID, token AppContainer và biên nhận được lưu trong kết quả từng lượt.

Skill hợp lệ đã dùng có ID `43cbee54-acce-461b-a273-2662c933badb`, SHA-256 `445a59d7a7d5f89a3d5508135527919f54844cf4fb370af3a8268da7868c6c54` và verdict `no_significant_findings`. Phiên Chat thường có Skill dùng PID ACP 27800 và PID MCP 7084. Cặp OFF/ON ghi trong đợt `cc00b3706608497eae50b2f5ad6324b6`.

| Ca | Kết quả quan sát | Phiên ACP |
|---|---|---|
| Chat thường · Không Skill | Gửi đúng yêu cầu workbook. Biên nhận ghi `not_included`. MCP tạo XLSX. | `688677cd-7d16-4228-9d1c-3c88e23e1941` |
| Chat thường · Skill hợp lệ | Đối chiếu trace thô thấy chính nội dung `SKILL.md` trong prompt, hash khớp với biên nhận và `skill_exposure=acknowledged`. MCP tạo XLSX. | `124eb276-3b81-49f0-8553-fc0650e498e8` |
| Chat thường · Fixture cách ly | Registry trả `blocked_before_submission`. Timeline thiếu cả phiên ACP lẫn sự kiện gửi prompt. | Dừng trước ACP |
| SkillGuard OFF · Skill sạch | Skill tới ACP nguyên văn, chế độ MCP `observe` và các lớp cấp quyền bắt buộc. MCP tạo XLSX. | `db766a42-fc7b-4452-a4e8-446fe98d19df` |
| SkillGuard ON · Cùng Skill sạch | Skill được rào dưới dạng dữ liệu không tin cậy, chế độ MCP `enforce`. MCP tạo XLSX. | `5e873740-d47b-47d7-8a9f-0397161f28eb` |

Cả bốn tệp XLSX mở lại được, có 48 dòng dữ liệu khớp workbook gốc và khớp SHA-256 ghi nhận. Tính trực tiếp từ workbook gốc với phạm vi loại đơn hủy cho 38 đơn, doanh thu 344.740.000 VND và lợi nhuận 95.980.000 VND. Cả bốn báo cáo có cùng kết quả theo phạm vi đó. Thử nghiệm OFF/ON chỉ dùng Skill sạch và workbook tổng hợp.

[Biên nhận ACP, MCP, SHA-256 và token theo lượt](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/live-1795409949163/verification.json) · [Kiểm tra workbook độc lập](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/live-1795409949163/verification-independent.json)

## Kiểm thử mã nguồn

- Backend `pytest` đạt 309, bỏ qua 2 theo cấu hình. Các ca mới kiểm tra lựa chọn rỗng, ID và hash khi gửi Skill, đổi Skill giữa hai lượt văn bản và chặn Skill cách ly trước ACP.
- Desktop Vitest đạt 41. TypeScript và Vite production build thành công. Playwright đạt 3 luồng hiện có, gồm chọn Skill, làm báo cáo CSV → Excel, tải báo cáo và chuẩn bị bằng chứng nghiên cứu.
- Ca Playwright mới ở viewport 1.080 px đạt. Ca này đổi qua bốn chế độ, mở tùy chọn OFF và kiểm tra các bộ chọn nằm bên trong khung ô soạn.

## Cài đặt và Git

Shortcut mới đã được cài riêng và trỏ tới đúng executable. SHA-256 app là `F941F7178FBC1F60D952E99DB05C52EE7EE4014597C1204C93B18118C8EBC2AB` và backend là `9F5B9DB13A50C14B81200289CAE0029E9BC02D4F5B1B18F634AF4F3096D01B48`. Kiểm thử Gemini chạy trên bản cài trước lần tinh chỉnh CSS cuối. Đã đối chiếu SHA-256 backend và runtime JavaScript của bản cuối với bản chạy Gemini. Các hồ sơ kiểm thử dùng dữ liệu riêng trong thư mục artifacts.

[Shortcut AgentScope Chat Composer](<C:/Users/ADMIN/Desktop/AgentScope Chat Composer.lnk>) · [Bộ cài Windows](<C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/normal-chat-composer-20261123/target/release/bundle/nsis/AgentScope Chat Composer_0.2.1_x64-setup.exe>)

| Kho | Commit cục bộ |
|---|---|
| Backend | `4715e7abebe9098795cab8d3e3decf6b830c3159` |
| Desktop · ô soạn và lựa chọn Skill | `31921a95553d063d2db186a92edd76d3b3da95c8` |
| Desktop · chỉnh bố cục hẹp và thêm hồi quy | `a179658ab6158cb0f1e155492c15651c7d1f5a8e` |

Hai nhánh được giữ cục bộ.
