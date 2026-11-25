# Quản lý và dùng nhiều Skill cùng lúc

Ngày 23/11/2026. Cả hai kho dùng nhánh cục bộ `feature/multi-skill-runtime`, tách từ Backend `41e7505` và Desktop `a392a45`. Nhánh `checkpoint/pre-multi-skill-20261123` giữ nguyên trạng thái trước đó. Các nhánh, bằng chứng và cuộc trò chuyện cũ không bị đổi. Không có lệnh push.

**Kết luận:** 10 Skill được quản lý độc lập, và mọi Skill đủ điều kiện được đưa cùng lúc vào prompt của Gemini ACP thật. Điều này đã kiểm chứng trên bản cài Windows với hai phiên Gemini thật. Hai điểm chưa chứng minh được nằm ở mục "Giới hạn".

## Nguyên nhân của hành vi một Skill

Trước đợt này, Chat chọn đúng một Skill cho mỗi lượt theo ba cách. `SkillRegistry.discover()` trả về một Skill theo độ liên quan. Cuộc trò chuyện lưu một `selected_skill_id`. Biên nhận gửi prompt lấy trường từ Skill đầu tiên (`facts = delivered[0]`). Giao diện có một hộp chọn Skill và với API, bỏ trống trường Skill nghĩa là không có Skill nào trên Antigravity. Hai commit trước đã nạp nhiều Skill nhưng chưa có trạng thái riêng cho từng Skill, giới hạn ngữ cảnh, biên nhận từng Skill hay giao diện công tắc. Nút tắt cũng ghi đè trạng thái `quarantine` bằng `disabled`, làm hỏng luồng đánh giá Skill cách ly.

## Thay đổi Backend

- **Trạng thái:** `skill_state()` phân biệt `enabled`, `disabled` (người dùng tắt), `quarantined` và `restricted` (hạn chế bảo mật). Skill đã xóa không còn trong thư viện. `set_enabled` chỉ đổi công tắc của một ID. Bật Skill cách ly hoặc hạn chế trả 409. Tắt Skill cách ly không đổi gì.
- **Chụp trạng thái:** `resolve_enabled()` ghi ID, SHA-256 của `SKILL.md` và SHA-256 của gói cho mọi Skill đủ điều kiện, trong một đoạn mã không có điểm chờ. Tác vụ lưu `skill_snapshot`, `loaded_skills` và `skill_exposure_plan`.
- **Ngữ cảnh:** `skill_context.py` dựng một prompt với khối `<untrusted_skill index id name sha256>` cho từng Skill. Skill cùng tên vẫn phân biệt bằng ID. Nội dung đi qua `neutralize`. Chỉ văn bản `SKILL.md` được gửi. Tệp đi kèm không được gửi và không chạy.
- **Giới hạn:** mỗi Skill tối đa 60.000 ký tự, tổng tối đa 200.000. Skill quá lớn, vượt ngân sách, bị SkillGuard chặn hoặc không khớp SHA-256 bị giữ lại kèm lý do, và hiện trong sự kiện, tin nhắn trò chuyện và biên nhận. Skill cùng tên hiển thị và Skill đòi công cụ AgentScope không có vẫn được gửi, kèm cảnh báo.
- **Biên nhận:** mỗi Skill có `exposed`, `block_sha256` và `in_acp_prompt`. `in_acp_prompt` chỉ đúng khi đúng khối, khớp hash, nằm trong văn bản prompt mà ứng dụng khách ACP đã ghi.
- **Kiểm tra lại sau phê duyệt:** nếu một Skill bị tắt, gỡ hoặc đổi nội dung trong lúc chờ phê duyệt, tác vụ dừng trước khi gửi.
- **API:** `GET /api/skills/runtime-summary`. Với Antigravity, bỏ trống `auto_skill` và `skill_id` nghĩa là gửi mọi Skill đang bật. `auto_skill: false` hoặc `skill_id: null` tắt hết. Nhà cung cấp đám mây giữ cách chọn theo độ liên quan.

Tài liệu chi tiết: `AgentScope-Backend/docs/MULTI_SKILL_RUNTIME_VI.md`.

## Thay đổi Desktop

- Ô soạn: nút **“N Skills đang bật”** mở bộ quản lý gọn. Mỗi dòng có công tắc riêng, nhãn trạng thái, ID rút gọn và hash. Skill đang bật được gửi tự động, nên không phải chọn lại. Bốn chế độ thực thi vẫn còn. Chế độ thí nghiệm giữ một Skill “Thử nghiệm” trong cùng bộ quản lý, vì thí nghiệm OFF/ON bản chất kiểm tra một Skill.
- Trang Skills: công tắc cho từng thẻ, bốn nhãn `Đang bật`, `Đã tắt bởi bạn`, `Cách ly`, `Hạn chế bảo mật`, bộ đếm theo trạng thái và ID trên mỗi thẻ. Skill cách ly và hạn chế có công tắc bị khóa.
- Luồng **Đánh giá trong Lab** cho Skill cách ly vẫn riêng, chỉ đọc, và ghi `provider=not_called`, `model_exposure=not_submitted`. Giao diện ghi “Không được gửi tới Gemini” cho các Skill này.
- Hoạt động của tác vụ có khối “Skill đã gửi tới Gemini · x/y”, liệt kê từng Skill đã gửi hoặc chưa gửi và lý do.

Thay đổi so với thiết kế trước: nhãn trạng thái vòng đời nay hiện ở mọi chế độ, thay cho nhãn “Chỉ đọc” ở chế độ không phải SkillGuard ON. Chi tiết quét và cảnh báo rủi ro vẫn chỉ hiện ở SkillGuard ON.

## Kết quả kiểm thử thực tế

Bản cài `AgentScope Multi Skill 0.2.1`, Gemini `gemini-3.8-flash-high`, workbook bán hàng tổng hợp. Script `AgentScope-Desktop/scripts/check-native-multi-skill.mjs` điều khiển bản cài qua giao diện và API, rồi đối chiếu biên nhận với tệp vết ACP thô trong `AgentScopeLab\runs\…\experiment.acp.jsonl`.

| Yêu cầu | Kết quả |
|---|---|
| 10 Skill khác nhau (mỗi Skill có mã đánh dấu riêng, #9 và #10 cùng tên `regional-notes`) | Nhập thành công, 10 ID và 10 SHA-256 khác nhau |
| 10 Skill bật cùng lúc, mặc định | Cả 10 `enabled`, giao diện hiện “10 Skills đang bật”, `runtime-summary` liệt kê đủ 10 |
| Tắt Skill #3 | #3 `disabled`, 9 Skill còn lại `enabled`, giao diện “9 Skills đang bật” |
| Bật lại #3 | Cùng ID và hash, thư viện vẫn 11 mục, không cài lại |
| Tắt #7, xóa #5 | Thư viện còn 10 mục, #7 vẫn `disabled`, mọi Skill khác giữ nguyên trạng thái |
| Khởi động lại AgentScope trên cùng hồ sơ | Trạng thái sau khi mở lại bằng đúng trạng thái trước đó (`afterRestart == beforeRestart`), giao diện “8 Skills đang bật” |
| Skill cùng tên hiển thị | Hai `regional-notes` có ID khác nhau, được bật, gửi và ghi riêng; Backend trả `duplicate_display_name` |
| Skill cách ly (có `scripts/probe.py`) | `quarantined`, không bật được, không có trong prompt, nội dung script không được gửi |
| Gemini ACP thật nhận đúng ngữ cảnh | Xem bảng bên dưới |
| Tác vụ MCP được cấp quyền | Cả hai phiên `completed`, XLSX hợp lệ, `matches_mcp_receipt=true` |

Bộ kiểm thử mã nguồn. Backend `pytest` đạt 327, bỏ qua 2 (mốc ban đầu 317, thêm 10 ca mới). Desktop Vitest đạt 47 (mốc 42, thêm 5). Playwright đạt 6/6 trên backend mới, gồm ca 10 Skill qua giao diện thật. TypeScript và Vite build thành công.

## Bằng chứng Gemini ACP

| | Phiên 1 · 9 Skill (#3 tắt) | Phiên 2 · 8 Skill (sau khi khởi động lại) |
|---|---|---|
| Phiên ACP | `c09feb6b-0f40-4872-9fba-72adff2c213b` | `9b322aa5-c779-42be-8681-c15da24ad789` |
| Lượt chạy lab | `exp-skillguard_on-e4b8f3edcb64` | `exp-skillguard_on-720bbbb6e3f5` |
| SHA-256 prompt ACP | `5062897bf9d2…ca69` | `d53cffd3734b…d231` |
| SHA-256 khối Skill | `68a04508f09f…6def` | `33b00a3badab…331f` |
| Skill đã gửi / Skill nằm trong prompt thô | 9 / 9 | 8 / 8 |
| `skill_exposure` | `acknowledged` | `acknowledged` |
| Skill không được gửi | `order-count-first` (đã tắt) | `regional-split` (đã xóa), `margin-note` (đã tắt) |
| PID ACP / MCP | 29448 / 29680 | 30836 / 31992 |
| AppContainer SID, mức toàn vẹn | cùng SID `S-1-15-2-3936…7237`, `S-1-16-4096` | cùng SID, `S-1-16-4096` |
| SHA-256 XLSX | `d82e531af79b…c81f` | `0dbd1314c0e6…d4ef` |

Với mỗi Skill đã gửi, script xác nhận trong prompt thô: toàn văn `SKILL.md`, mã đánh dấu riêng, thẻ mở có đúng ID và SHA-256, và hash của khối khớp `block_sha256` trong biên nhận. Mã đánh dấu và ID của Skill không được gửi, của Skill cách ly và nội dung script không xuất hiện trong prompt. Bản ghi đầy đủ gồm ID, hash từng Skill, danh sách công cụ MCP và phản hồi của Gemini nằm ở `native-evidence/verification.json`.

Mỗi XLSX được mở lại độc lập: 4 trang, 48 dòng dữ liệu, 38 đơn, doanh thu 344.740.000 VND, lợi nhuận 95.980.000 VND, khớp với số liệu đã xác minh cho workbook này.

Quan sát (không phải bảo đảm): câu trả lời của Gemini phản ánh các hướng dẫn Skill, như ghi đơn vị VND, nêu cách xử lý đơn hủy và nêu tỷ suất lợi nhuận. Ở phiên 2, Gemini còn nêu ID Skill trong câu trả lời. Việc mô hình dùng Skill nào là quyết định của Gemini theo yêu cầu.

## Hành vi bảo mật

- Quyền MCP bắt buộc, cổng cấp quyền công cụ ACP, kiểm tra cô lập trước phiên và AppContainer giữ nguyên. Cả hai phiên có token AppContainer đã xác minh cho tiến trình ACP và MCP.
- Skill cách ly và hạn chế không bao giờ vào prompt. Gói có mã thực thi bị cách ly ngay từ lúc quét. Không có script nào được gửi hay chạy (`bundled_files_executed=false`).
- Một Skill bị SkillGuard chặn trong chế độ nhiều Skill chỉ bị giữ lại và báo lý do. Skill được chọn riêng vẫn dừng tác vụ như trước.
- Skill đang được tác vụ giữ không xóa được (409).
- Đánh giá Skill cách ly không gọi Gemini. Giao diện không nói Gemini đã chạy Skill đó.

## Cài đặt Windows

Bản cài riêng, không đè bản cũ: `AgentScope-Desktop/artifacts/multi-skill-20261123/installed-multi-skill`, shortcut `AgentScope Multi Skill.lnk` trên Desktop.

| Tệp | SHA-256 |
|---|---|
| `AgentScope Multi Skill_0.2.1_x64-setup.exe` | `DC3708B6577A3366C487204DE59747338560E8CBE1FC3F3FC38CCF9E8EFD22BB` |
| `agentscope-multi-skill.exe` | `A1CE950D9BDA334FA51A936EC1795D1BA4F72DD42A656BE136EDDD52C537B58F` |
| `agentscope-backend.exe` | `F3FC94EC80891E6633EECF6995DBDA78309999E5E06C55AC85D35FDB4C3D58E6` |

Bản cài được dựng từ Backend `90c0e90` và Desktop `c5bcf98`. Các commit sau đó chỉ định dạng mã hoặc thêm script kiểm tra, không đổi hành vi. Ảnh chụp giao diện ở `artifacts/multi-skill-20261123/screens` (1.480 px và 1.080 px) và `native-evidence/*.png`.

## Giới hạn

- AgentScope không phát hiện được mâu thuẫn về ngữ nghĩa giữa các Skill. Prompt dặn Gemini theo yêu cầu người dùng, theo kết quả công cụ và nêu ID các Skill mâu thuẫn. Chưa có thử nghiệm Gemini thật với hai Skill mâu thuẫn nhau.
- `acknowledged` xác nhận ACP nhận prompt và kết thúc lượt. Cách nhà cung cấp xử lý nội bộ không quan sát được.
- Giới hạn ngữ cảnh và Skill quá lớn được kiểm thử bằng ACP giả lập, chưa chạy với Gemini thật. Bản thật chỉ gửi 8 đến 9 Skill nhỏ (khoảng 6.500 đến 7.100 ký tự).
- Mặc định gửi mọi Skill đang bật áp dụng cho Antigravity. Nhà cung cấp đám mây và quy trình bảng tính cục bộ không dùng AI giữ cách chọn theo độ liên quan khi gọi API không có `auto_skill: true`. Giao diện Desktop luôn gửi `auto_skill: true`.
- Ba tệp kiểm thử cũ (`test_security_boundary`, `test_prompt_injection_lab` và `test_chat_experiments`) được sửa vì chúng mã hóa mặc định cũ “không ghi Skill nghĩa là không Skill”. Các tệp Playwright và Vitest cũ được cập nhật theo bộ quản lý mới.
- `e2e/workspace.spec.ts` đã lệch định dạng Prettier từ trước, và Backend cũng chưa đạt `black` ở nhiều tệp. Tôi chỉ định dạng các tệp mới.

## Git (chỉ cục bộ, nhánh `feature/multi-skill-runtime`)

| Kho | Commit |
|---|---|
| Backend · trạng thái, ngữ cảnh nhiều Skill, biên nhận | `12f0775d0cd392546847b636f4c8a21b76ac88b4` |
| Backend · tài liệu | `90c0e90ab745c7a176a06f9c7f94375c8b7ac6e6` |
| Backend · định dạng | `6999c054bfa47766c21586cfd1650e056bef981f` |
| Desktop · bộ quản lý Skill và trang Skills | `c5bcf984705ac1416e2413176ca41ecd1f63bcd9` |
| Desktop · script kiểm tra bản cài | `885ab5d0e1a0ddc9e144dfae8da5d98029bb2777` |
| Desktop · định dạng script | `458a236f2afdc837e84b5f6a6d5983351a8916a0` |

Bằng chứng nằm trong thư mục `artifacts/` của Desktop, do `.gitignore` loại khỏi Git: `multi-skill-20261123/native-evidence/` (`verification.json`, hai XLSX, ảnh chụp) và `native-run.log`.
