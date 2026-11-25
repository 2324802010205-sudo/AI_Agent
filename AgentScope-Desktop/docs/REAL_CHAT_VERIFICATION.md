# Xác minh sửa chat Real AI — AgentScope 0.1.1

Ngày kiểm tra: 17/11/2026, Windows 11 x64.

## Nguyên nhân chính xác

React khởi tạo mode=demo; SendMessage của API và cấu hình backend chưa lưu cũng mặc định demo. Frontend gửi mode này trong từng tin nhắn. Orchestrator xử lý nhánh Demo rồi return trước khi kiểm tra provider Antigravity. Chọn/lưu Antigravity không đổi mode đang lưu. Profile native mặc định không có bản ghi settings; profile CLI/migrated là cơ sở dữ liệu khác, nên cấu hình tại đó không điều khiển ứng dụng native. Không phải fallback khi ACP lỗi.

Những lỗi liên quan đã sửa: tạo phiên mới mỗi lượt, bỏ qua lỗi chọn model, danh sách/model mặc định hardcode, chỉ đếm chunk thay vì hiển thị text, callback streaming chạy rời, lời dẫn bảng tính xuất hiện trong chat thường, nhận nhầm bao-cao.xlsx cũ, phản hồi permission ACP sai schema, coi CLI đã cài là đã xác thực AI.

## Cách dùng và lưu cấu hình

Trong Cài đặt chọn Real AI, Antigravity, làm mới danh sách model thật, chọn model hoặc để mặc định phiên ACP, rồi Lưu cấu hình. Chế độ được lưu ngay khi bấm lựa chọn Real/Demo. Nút Test Connection kiểm tra cấu hình đã lưu và gửi yêu cầu AI thật, có thể dùng quota.

Profile mới dùng Real AI; tự chọn Antigravity nếu tìm thấy agy. Tất cả mode/provider/model đã được người dùng lưu trước đó được giữ nguyên, kể cả Demo. Chat không gửi mode từ state cũ nữa; backend lấy cấu hình đã lưu và chụp mode/provider/model vào từng task. Model thực và session ID cập nhật sau handshake/set_model thành công. Lỗi CLI/auth/model/quota/timeout hiển thị trong chat và kết thúc task lỗi; không chuyển thành Demo.

Chat thường không cần Skill hoặc tệp. Với bảng tính vẫn cần Skill đã phê duyệt; read/analyze/report dùng công cụ Python có kiểm tra quyền và tạo Excel thật. Giao diện tím tối giữ nguyên.

## Kết quả thực tế

Antigravity CLI 1.5.9 đã handshake ACP v1, trả về 6 model và current model gemini-3.8-flash-high. Probe có xác thực trả lời chào bằng tiếng Việt trong 2 chunk; câu hỏi tiếp theo được trả lời đúng ngôn ngữ tiếng Việt.

Trong cửa sổ Tauri Release, gõ chính xác chào nhận được: “Chào bạn! Tôi là AI Assistant trong AgentScope. Tôi có thể hỗ trợ gì cho bạn hôm nay?”. Lượt tiếp theo nhận “Bạn vừa chào tôi bằng **tiếng Việt**.” Hai task completed/real/antigravity, cùng session ID, 3 snapshot streaming, không tool/report/plan giả. Nội dung và trace đúng cuộc trò chuyện, được lưu SQLite và hiển thị trên UI.

Sau cài đặt NSIS vào thư mục kiểm chứng riêng và mở lại cùng profile, lịch sử vẫn còn. Một prompt tiếp theo khôi phục cùng session ID e4da702e-8338-4739-8e0b-3f2867bde8ce, có event session.restored; Gemini nhớ lời đầu tiên là chào. Lượt này có 7 snapshot streaming; tổng 3 lượt là 10 snapshot. Unit test UI kiểm tra text từng phần, nhãn đang nhận, kết thúc, replay cũ và cách ly hội thoại; ảnh chụp native xác nhận nội dung thật và trace cuối cùng.

Trong UI Cài đặt đã khám phá 6 model, chọn Gemini 3.8 Flash (High), lưu Real/Antigravity/model vào SQLite và bấm Kiểm tra Antigravity. Task kiểm tra hoàn tất, UI báo đã nhận phản hồi AI thực tế. Không gặp quota blocker trong các lần thử có xác thực. Không tự động thao tác đăng nhập hoặc thay đổi bảo mật hệ điều hành.

## Kiểm thử và đóng gói

| Kiểm tra | Kết quả |
| --- | --- |
| Backend pytest | 69 passed, 1 skipped (ca live trả phí cần opt-in, đã có probe/native live riêng) |
| Frontend Vitest | 9 passed, gồm streaming/replay/cách ly và cập nhật trạng thái/model sau task |
| TypeScript + Vite build | PASS |
| Black/Prettier/git diff --check | PASS |
| Playwright E2E | 1 passed: Skill, CSV, Excel download, history, WebSocket reconnect |
| Frozen sidecar | PASS: readiness, Skill review, 9 dòng CSV, Excel và shutdown |
| Native Debug | PASS: Python từ Backend/.venv, 9 dòng, 20 events, tải Excel, dọn cây tiến trình |
| Native Release | PASS: sidecar cạnh EXE, 9 dòng, 20 events, tải Excel, dọn cây tiến trình |
| Native chat thật | PASS: chào, multi-turn, lưu lịch sử, khôi phục ACP sau restart |
| Test Connection thật | PASS, model đã chọn được gửi qua session/set_model |
| NSIS | Build/cài đặt exit code 0, ProductVersion 0.1.1; SHA256 sidecar cài đặt khớp artifact backend |

Installer: src-tauri/target/release/bundle/nsis/AgentScope_0.1.1_x64-setup.exe. Bản phát triển chưa ký số. Bản cài đặt kiểm chứng ở artifacts/installed-verification; dữ liệu thử riêng ở artifacts/native-real-chat-011. Các artifact, SQLite, token, EXE, môi trường và output test không được commit.

Đóng cửa sổ native đã dọn sidecar bootloader, Python worker và agy thuộc phiên thử. Không dừng tiến trình agy của người dùng. Không xóa hoặc reset dữ liệu/profile gốc; không push remote; hai Git repository độc lập được giữ nguyên.

## Các tệp thay đổi

Desktop: README.md; package.json; package-lock.json; src-tauri/Cargo.toml; src-tauri/Cargo.lock; src-tauri/tauri.conf.json; src/App.tsx; src/App.test.tsx; src/api.ts; src/types.ts; src/messages.ts; src/messages.test.ts; vite.config.ts; e2e/workspace.spec.ts; scripts/check-native.mjs; docs/REAL_CHAT_VERIFICATION.md.

Backend: README.md; pyproject.toml; agentscope/antigravity_acp.py; agentscope/api.py; agentscope/models.py; agentscope/runtime.py; tests/conftest.py; tests/test_antigravity_acp.py; scripts/check-sidecar.py; docs/REAL_CHAT_FIX.md.

## Giới hạn còn lại

SkillGuard từ chối mặc định các permission request ACP chưa cấp quyền; không bật shell, YOLO, skip-permissions hay filesystem/terminal client. CLI chạy với --sandbox và không nạp default customizations. Tuy nhiên công cụ nội bộ/network của CLI do Antigravity quản lý và có thể không gửi permission request về client. Chính sách ứng dụng và Windows Job Object không phải sandbox OS hoàn chỉnh đã kiểm chứng. Pause chặn công việc/delivery trong ứng dụng, không đình chỉ compute nội bộ CLI. Chi tiết ở Backend/docs/REAL_CHAT_FIX.md và tài liệu ACP chính thức.

Lỗi quota/auth/mất CLI/model/timeout được unit test bằng transport giả để không sửa tài khoản hoặc tiêu hao quota vô ích. Không cố tình gây các lỗi tài khoản trên CLI thật. Thành công có xác thực chỉ phản ánh quota/trạng thái tại thời điểm kiểm tra.


## Kiểm tra installer cuối cùng

Bản cài đặt cuối báo backend health version 0.1.1. Sau khi lưu model High và mở lại, gõ chào trong hội thoại mới nhận “Xin chào! Tôi là trợ lý AI trong AgentScope. Tôi có thể giúp gì cho bạn hôm nay?”. Đã quan sát trực tiếp message revision 1, 80 ký tự khi streaming=true và UI hiện Đang nhận phản hồi…; sau đó task hoàn tất. Cài đặt tự cập nhật Đã nhận phản hồi AI thực tế và 6 model, không cần bấm làm mới. Tổng profile thử: 4 lượt chat thật, 1 connection test thật, 11 snapshot streaming. Không có tool/report/plan giả.

Installer SHA256: AD13F992E388A1E3B412E467EAFCA3EFC14E3D27242AAF3C4EAAA6633B4BED33.
Sidecar cài đặt và artifact Backend cùng SHA256: 66EFEF13693890C45CDC4257CE74995FBCF63E54A9433B5A0B1640FEA5E132C2.
Bản cài cuối cũng qua native harness: readiness, 9 dòng CSV, 20 events, tải Excel và processTreeReaped=true. Bằng chứng máy đọc được nằm ở artifacts/final-real-chat-results.json; không chứa session credential và không được commit.


## 0.1.2 follow-up (17/11/2026)

**Root cause of the "DEMO · Dữ liệu sự kiện tổng hợp" reply to `chào`:** In version 0.1.0 (Desktop `1af6e03`, Backend `39e9981`), the React initial state was `mode='demo'` and the UI sent `mode` with every message. `SendMessage.mode` defaulted to `demo`, and backend settings also defaulted to `demo` when no row was saved. `execute()` returned through the Demo branch before checking the provider, so selecting Antigravity had no effect. The native profile `%LOCALAPPDATA%\com.agentscope.desktop` has no settings row. Its Demo task for `chào` (04:46 UTC) was created by build 0.1.0 with `provider=None`. All tasks from 0.1.1 onward in the same profile are real/antigravity/gemini-3.8-flash-high. The shortcuts launched the copy in `artifacts\installed-verification`. This is not an ACP fallback.

**0.1.2 changes:** the title bar no longer says "Agent đã kết nối" just because FastAPI responds. It shows the observed AI state (`src/status.ts`). The mode pill shows the model, and the footer shows the real build version (`__APP_VERSION__`) instead of a hardcoded `v0.1.1`. The backend's pre-warmed ACP session work and stream coalescing were completed with tests. Added `npm run test:native:live`, an opt-in check that uses quota: it drives the real WebView2 window over loopback CDP with an isolated profile and an isolated WebView2 user-data folder.

| Check (0.1.2) | Result |
| --- | --- |
| Backend pytest | 72 passed, 1 skipped (opt-in live) |
| Live ACP pytest (`AGENTSCOPE_LIVE_ACP=1`) | 1 passed |
| Vitest / tsc + Vite / Prettier / Black | 12 passed / PASS / PASS / PASS |
| Playwright E2E (isolated source backend) | 1 passed |
| Native Release + installed 0.1.2 (`test:native`) | PASS: 9 rows, 20 events, Excel, process tree reaped |
| Native UI live (`test:native:live`), Release and installed 0.1.2 | PASS: discovered 6 models, selected gemini-3.8-flash-high, saved Real, real connection test; `chào` → genuine Gemini reply; follow-up recalled `chào` in the same ACP session; restart preserved settings and `session.restored`; no Demo/tool/plan events; normal close cleaned up all 11 child processes |

Installer: `src-tauri/target/release/bundle/nsis/AgentScope_0.1.2_x64-setup.exe` (SHA256 7DE24C11C4B90B220B971D3C530C1398998134ABC3B15A4CAC1080896E622F68). Installed for verification at `artifacts\installed-verification-0.1.2`. The NSIS installer repointed the Desktop and Start menu shortcuts to that copy. The 0.1.1 copy remains in `artifacts\installed-verification`. Antigravity CLI detected: v1.5.10.

Known limitation: ACP has no system role, so AgentScope's policy preamble is sent in the first user turn of each new session. If asked to quote "the first message", the model may repeat that preamble. This is not private reasoning or a secret, and SkillGuard still decides permissions independently of the prompt.

## 0.1.3: spreadsheet Skill authorization (17/11/2026)

**Root cause:** the imported `sales-report-helper` declared only `name`/`description`. AgentScope grants tools only through a `capabilities` list, so the Skill was stored as approved with `capabilities: []`. The registry still selected it for the attachment by keyword match and the trace showed "Đã nạp Skill". The gate then required `analyze_spreadsheet` and blocked the task with a generic message that did not name the missing declaration. The metadata was incomplete, but AgentScope gave no warning at import or review and reported a misleading load. A second defect: `call_tool` checked no capabilities at all, so a Skill declaring only `analyze_spreadsheet` would also have unlocked read and report. A third defect appeared during the live run: over ACP the model was told to call tools it cannot call and received a bare JSON blob, so Gemini replied that no file was attached.

**Fix (SkillGuard not weakened):** import/review flags missing capabilities. For an attachment, only an approved Skill declaring all three tools is selected, and an unusable Skill is never "loaded". The trace instead records a `permission.evaluated` deny event naming each Skill and its missing capabilities. Every tool call re-checks that the task's Skill is still approved and declares that capability. The ACP prompt states which tools already ran and provides the observed results (no local paths or raw rows). Format: Backend `docs/SKILL_FORMAT.md`; valid example `samples/sales-report-helper.zip`.

**Version:** a v0.1.1 footer came only from the old 0.1.1 install, open at 19:49, or from the first 0.1.2 build made before the footer fix. The installed 0.1.2 bundle contained `0.1.2`. The backend version now comes from one source (`agentscope.__version__`, tested against pyproject). The footer flags a backend version that differs from the UI's, which indicates a stale sidecar. A Vitest test keeps package.json, tauri.conf.json and Cargo.toml in sync. Development mode (`desktop:dev`) runs Vite from the source tree and the sibling Backend `.venv` source.

| Check (0.1.3) | Result |
| --- | --- |
| Backend pytest | 79 passed, 1 skipped (opt-in live) |
| Vitest / tsc + Vite / Prettier / Black | 14 passed / PASS / PASS / PASS |
| Playwright E2E | 1 passed |
| `test:native` (release + installed 0.1.3) | PASS |
| `test:native:skill` (release + installed 0.1.3) | PASS: instructions-only Skill blocked precisely, no tool events; valid ZIP → read/analyze/report with three allow decisions; 48 orders, revenue 344,740,000, profit 95,980,000; Gemini reply cites those figures and the report; Excel download verified (48 data rows, same sums); cleanup PASS |
| `test:native:live` (installed 0.1.3) | PASS: `chào`, context follow-up, restart restore |

Installer: `src-tauri/target/release/bundle/nsis/AgentScope_0.1.3_x64-setup.exe` (SHA256 A25939A76FF4AE2B9D810A39D895D39B9021208C15C904050582C0EFB5750A0A), installed at `artifacts\installed-verification-0.1.3`. The Desktop and Start menu shortcuts point there.
