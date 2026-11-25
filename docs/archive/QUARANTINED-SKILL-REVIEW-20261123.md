# Rà soát Skill cách ly từ Chat thường

Ngày 23/11/2026. Hai kho dùng nhánh `research/quarantined-skill-offline-review`. Mốc `checkpoint/quarantined-skill-review-20261123` lưu Backend `4715e7a` và Desktop `a179658`.

## Luồng người dùng

Chọn Skill đang cách ly ngay trong bộ chọn Chat thường. Ô soạn hiện tên Skill, mức rủi ro và các tệp bị đánh dấu. **Xem phát hiện** mở thông tin quét. **Đánh giá trong Lab** mở hộp thoại rà soát tĩnh tại máy và yêu cầu xác nhận từng lần. **Bỏ chọn** trả nút gửi về trạng thái bình thường cùng bản nháp hiện có.

Trước đây, bộ chọn Chat thường vô hiệu hóa các mục cách ly vì cổng chọn Skill chỉ cho chạy gói đủ điều kiện. Nút gửi và kiểm tra phía backend tiếp tục chặn yêu cầu Chat có Skill cách ly. Luồng mới chỉ mở quyền rà soát, còn trạng thái gói trong registry giữ nguyên.

## Biên nhận và phạm vi

Backend so sánh SHA-256 gói đã xác nhận với danh sách tệp trong registry, đọc lại bản cài để kiểm tra từng tệp và đối chiếu các byte với bản lưu nhập. Sau đó backend quét tĩnh, ghi thời gian xác nhận, mã biên nhận, ID bản lưu, SHA-256 của gói và từng tệp cùng kết quả quét. Bản lưu nhập giữ nội dung gốc. Nếu dấu vân tay sai hoặc bản lưu hỏng, yêu cầu trả lỗi trước khi lưu biên nhận thành công.

Đây là rà soát ngoại tuyến của nội dung gói. Biên nhận ghi `local_static_review`, `provider=not_called`, `model_exposure=not_submitted`, `presented_material_sha256=null`, `tool_execution=not_run` và `artifact_verification=not_applicable`. Vì thế phiên rà soát này chưa có phản hồi, đề xuất công cụ, kết quả chạy hay quyết định lọc của Gemini. Hoạt động quét tĩnh cũng không cho biết hiệu quả prompt injection. Hồ sơ được lưu riêng trong bảng `skill_reviews` và tra lại được theo ID Skill và ID biên nhận qua API loopback.

Chat được cấp quyền vẫn sử dụng cổng kiểm tra Skill và chính sách ACP/MCP hiện hành. Bốn chế độ giữ luồng riêng. AppContainer và kiểm tra tham số công cụ tiếp tục áp dụng ở các đường chạy được cấu hình cô lập. Phạm vi mới chỉ đọc gói đã nhập và ghi một biên nhận. Người dùng có thể chọn bỏ Skill để tiếp tục tác vụ workbook qua luồng bình thường.

[API biên nhận](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Backend/agentscope/skill_routes.py) · [Đối chiếu và lưu bản đánh giá](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Backend/agentscope/skills.py) · [Hộp thoại xác nhận](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/src/components/IsolatedSkillReview.tsx)

## Kiểm thử

Backend đạt 310, bỏ qua 2 theo cấu hình. Hồi quy kiểm tra Chat thường có Skill hợp lệ và không có Skill, chặn gói cách ly trước ACP, từ chối công cụ ngoài danh sách bằng bản ghi giả lập và giữ hành vi phân loại từ chối của nhà cung cấp. Kiểm thử mới xác nhận thiếu đồng ý, sai SHA-256 và bản lưu hỏng đều bị từ chối, mỗi lần đồng ý tạo ID riêng và giá trị registry cùng byte của bản lưu được giữ nguyên. Các hồi quy ACP này dùng mock và fixture.

Desktop Vitest đạt 41, Playwright đạt 5/5 và build TypeScript/Vite thành công. Playwright xác nhận bố cục cột hẹp, thao tác mở kết quả quét, nút bắt đầu bị khóa trước xác nhận và Chat vẫn bị khóa sau khi rà soát xong.

## Bản cài Windows

Đã cài AgentScope Skill Review 0.2.1 và kiểm thử giao diện Tauri với backend đóng gói trong cùng thư mục cài đặt. Hồ sơ thử riêng nhập một tệp Markdown trơ và phát hiện một dấu hiệu rủi ro. Trước khi xác nhận, nút gửi Chat và nút bắt đầu rà soát đều bị khóa. Sau khi xác nhận, backend trả HTTP 200, ghi biên nhận `2286bbaa-988b-409b-ba06-38fdea572463`, khớp SHA-256 gói và `SKILL.md`, giữ trạng thái `quarantine` và có 0 tác vụ thực thi. Đóng cửa sổ thử đã dừng cây tiến trình của ứng dụng.

[Shortcut AgentScope Skill Review](<C:/Users/ADMIN/Desktop/AgentScope Skill Review.lnk>) · [Bộ cài Windows](<C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/quarantined-skill-review-20261123/target/release/bundle/nsis/AgentScope Skill Review_0.2.1_x64-setup.exe>) · [Cảnh báo trong Chat](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/quarantined-skill-review-20261123/windows-quarantine-warning.png) · [Ảnh hộp thoại biên nhận](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/quarantined-skill-review-20261123/windows-review-receipt.png) · [Biên nhận JSON](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/quarantined-skill-review-20261123/windows-review-receipt.json)

## Hai phiên Gemini đối chứng trên bản cài

Cả hai phiên Chat thường chạy `gemini-3.8-flash-high` với cùng workbook bán hàng tổng hợp và cùng yêu cầu báo cáo. Đã đối chiếu prompt thô trong trace ACP với SHA-256 của biên nhận. Phiên không chọn Skill ghi `not_included`. Phiên có Skill đã duyệt chứa nội dung `SKILL.md` và ghi `acknowledged`. Tại mỗi phiên, token của ACP và MCP đều có cùng AppContainer SID và integrity thấp `S-1-16-4096`.

| Chat thường | Phiên Gemini ACP | PID ACP / MCP | Lượt MCP hoàn tất | Từ chối của ACP |
|---|---|---|---:|---|
| Không Skill | `353e2865-63be-4331-a933-51d2de3fbe15` | 28252 / 20884 | 7 | `run_command` |
| Skill đã duyệt | `19c28b58-3220-4c7e-b8ce-3e09c6a56494` | 1456 / 15184 | 7 | 0 |

Mỗi phiên chạy `list_sheets`, `read_sheet`, `calculate_totals`, `propose_report` và `create_excel_report`. Cổng cấp quyền ACP từ chối `run_command` ở phiên không Skill. Công cụ đó không được thực thi và phiên vẫn hoàn thành báo cáo. Không ghi nhận `MODEL_FILTER_BLOCKED` ở hai phiên này. Hành vi giữ nguyên thông báo khi nhà cung cấp từ chối được kiểm tra bằng fixture hồi quy.

Cả hai XLSX đạt kiểm tra độc lập. Từng tệp có 48 dòng khớp workbook gốc và SHA-256 khớp biên nhận. Phép tính lại theo phạm vi loại đơn hủy cho 38 đơn, doanh thu 344.740.000 VND và lợi nhuận 95.980.000 VND. Hai phiên đối chứng xác nhận đường chạy hợp lệ trên bản cài. Chưa có dữ liệu Gemini trực tiếp về phản ứng với nội dung cách ly. [Biên nhận ACP/MCP và token](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/quarantined-skill-review-20261123/live-1795412727680/verification.json) · [Đối chiếu XLSX độc lập](C:/Users/ADMIN/AgentScope-Workspace/AgentScope-Desktop/artifacts/quarantined-skill-review-20261123/live-1795412727680/verification-independent.json)

## Git

- Backend `eff6404dd9341543251a1f9e765780634450d400`
- Desktop `721c30e077815a452c67b18a61f0c6c7eafe59fd`

Cả hai commit đều ở cục bộ trên nhánh `research/quarantined-skill-offline-review`. Các kiểm thử dùng dữ liệu thử riêng. [Biên nhận Gemini/MCP lành tính từ đợt trước](C:/Users/ADMIN/AgentScope-Workspace/NORMAL-CHAT-SKILL-COMPOSER-20261123.md)
