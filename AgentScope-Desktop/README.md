# AgentScope-Desktop

The isolated Prompt Injection lab supports CONTROL, an audit-marker Skill and an adjusted-revenue Skill, with three fresh contained ACP sessions per condition. Choose verified aggregates or all cached Excel rows, inspect paired raw responses and ground truth, and export the Vietnamese report, evidence JSON or each verified Excel report. The backend owns fixture import, approval, isolation checks and validation. This interface uses the existing authenticated `/api/isolated-lab` routes, including the new `/suites`, `/export` and trial `/report` endpoints.

Version 0.1.6 adds **Đánh giá PI** for real workbook ground truth, ordinary ACP controls, raw-answer export and independent numeric validation, plus a separately locked **Lab nghiên cứu** page. These controls never claim a zero-tool ACP sandbox or a completed arithmetic process when isolation has failed. Production chat, spreadsheet reports and history retain their existing behavior. See `../AgentScope-Backend/docs/SECURITY_EVALUATION_VI_0_1_6.md` for actual observations and limits.

Windows desktop shell and Vietnamese React interface for AgentScope. This repository contains React, TypeScript, Tailwind CSS, Vite, Tauri/Rust, UI tests and desktop packaging only. Python implementation and its environment belong to the independent **AgentScope-Backend** repository.

Version 0.1.5 distinguishes policy decisions, unmediated runtime operations, blocked Skill delivery and observed ACP execution modes in Security and Permissions. Imported Skills selected with Antigravity use the backend's local spreadsheet workflow; instructions-only ACP Skills require verified isolation and are blocked. Ordinary chat remains available in pinned Default Mode. See [security verification](docs/SECURITY_0_1_5.md).

**0.2.0 — thí nghiệm SkillGuard ngay trong Chat.** Chọn *Chat thường*, *Unprotected Model Test (SkillGuard OFF)*, *Protected Test (SkillGuard ON)* hoặc *So sánh cả hai* cạnh khung soạn tin; đính kèm workbook, chọn Skill đã cài và gửi yêu cầu. Mỗi điều kiện chạy một phiên Gemini mới trong AppContainer; Trung tâm thực thi hiển thị sự kiện thật (đã xác minh / suy luận / bị chặn / không quan sát được) và bảng so sánh xuất hiện trong cuộc trò chuyện. Điều hướng: Chat, Skills, Bảo mật, Lịch sử & Kết quả, Nghiên cứu nâng cao (ba trang Lab cũ). Chi tiết, cách đo và kịch bản trình diễn: `../AgentScope-Backend/docs/CHAT_RESEARCH_WORKFLOW_VI.md`. Kiểm tra ứng dụng đã cài: `node scripts/check-installed-research-demo.mjs <exe> <data-dir> <workbook> <skill> <out-dir>` (dùng quota Gemini thật).

## Layout

```text
AgentScope-Workspace/
  AgentScope-Desktop/     this independent Git repository
    src/                 chat, Skills, security, reports, event inspector and API client
    src-tauri/           native shell, Windows process lifecycle, capabilities and icons
    scripts/             frontend setup, artifact collection, installer/native checks
    e2e/                 browser workflow and owned test fixtures
    public/              UI assets and CSV demonstration data
  AgentScope-Backend/    independent Python Git repository
  AgentScope.code-workspace
```

No UI redesign or runtime rewrite was performed during separation. Chat, attachments, Skills, permission decisions, history, Markdown, reports, timeline and WebSocket replay use the existing interface. See [backend interface](docs/backend-interface.md).

## Requirements and setup

Windows x64, Node 22+, Rust stable, Microsoft C++ Build Tools with MSVC and Windows SDK, and WebView2. Frontend-only development/tests need only Node. Python is required by the separate backend project during development and by its build pipeline; the installed desktop app uses the frozen executable.

```powershell
cd AgentScope-Desktop
npm.cmd ci
npm.cmd run dev
```

Run the backend separately on `127.0.0.1:8765` using its README. In Settings, enter the backend's `.agentscope/session-token`. Session credentials are never committed. Cloud credentials belong in OS keyring via Settings, not `.env`.

To launch the real Tauri window, first set up the backend environment, then:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm.cmd run desktop:dev
```

Tauri development discovers `../AgentScope-Backend/.venv/Scripts/python.exe` and runs `-m agentscope` with the backend directory as cwd. Override with `AGENTSCOPE_BACKEND_DIR` and optionally `AGENTSCOPE_BACKEND_PYTHON` for a different checkout/environment. Native sessions use an automatically generated token and ephemeral loopback port; no manual session entry is needed. `AGENTSCOPE_DATA_DIR` optionally selects an isolated data profile. Otherwise native app data stays in the same app-local directory under identifier `com.agentscope.desktop`, preserving existing native history.

## Tests

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run format:check
# Start the backend CLI with --data-dir .agentscope --port 8765 first:
npm.cmd run test:e2e
# After producing a release executable and staging its sidecar:
npm.cmd run test:native
```

Browser E2E defaults to the sibling backend's `.agentscope/session-token`; set `AGENTSCOPE_SESSION_TOKEN_FILE` for another profile. It uses Google Chrome. `test:native` launches the actual release executable with a new isolated data directory, checks sidecar readiness, approves the fixture Skill, performs the real nine-row CSV -> Excel workflow, then simulates a shell crash and verifies the complete backend process tree exits. It never touches the default native profile or provider keys.

`npm.cmd run test:native:live` is opt-in and consumes AI quota: it drives the real native window (WebView2 over a loopback-only DevTools port, isolated data and WebView2 profile) through Settings -> Antigravity -> model -> Real -> save -> connection test, sends `chào` plus a context follow-up, restarts, and verifies persistence, observed trace events and process cleanup. Override the model with `AGENTSCOPE_LIVE_MODEL`.

## Explicit production artifact boundary

Backend builds are owned by Backend. Desktop accepts either a sibling source checkout or an already compiled backend artifact. No backend source is copied into Desktop.

```powershell
# Build the sibling backend using its own environment/tests/spec, stage its EXE, build NSIS:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1
# Or consume an artifact produced independently by backend CI:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -BackendArtifact C:\artifacts\agentscope-backend.exe
# Alternative backend checkout:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -BackendDir C:\projects\AgentScope-Backend
```

`build-backend.ps1` stages only `agentscope-backend-x86_64-pc-windows-msvc.exe` in ignored `src-tauri/binaries/`. `tauri.bundle.conf.json` declares that external binary; packaging installs it beside `agentscope-desktop.exe`. Rust launches this fixed executable with a session token, data directory, parent PID and loopback port. A Windows Job Object contains the sidecar process tree for cleanup, including the PyInstaller launcher/child. This is lifecycle management, **not an OS sandbox for tools**. Graceful shutdown is attempted before forced cleanup; a parent watcher remains in the backend.

Installer output: `src-tauri/target/release/bundle/nsis/AgentScope_0.1.1_x64-setup.exe`. The development release is unsigned. Close a running release app before rebuilding: Windows locks its EXEs.

CI frontend checks run independently. The manual Windows packaging workflow requires explicit `backend_repository` and optional `backend_ref` inputs; it checks the two repositories into sibling folders, then builds the artifact. There is no hardcoded remote and nothing is published automatically.

## Git and workspace notes

This repository and Backend each have their own `.git`. No repository/history existed before this reorganization. Baseline commits preserve the prior implementation; later commits record separation/build changes. No remote was added, pushed or rewritten. Generated dependencies, target/dist, test data, session tokens, API keys and compiled executables are ignored. Icon images are required source assets.

Open `../AgentScope.code-workspace`, or the tracked `AgentScope.code-workspace` in this repository. Explorer hides generated files without deleting them. Backend remains independently runnable and testable. Legacy runtime data/environments/build tools in the original `C:\Users\ADMIN\AgentScope-Desktop` directory were retained, not deleted. See the workspace `REORGANIZATION.md` / `VERIFICATION.md` for the local move and checks.

Known product limits remain unchanged: cloud adapters need real user credentials; live provider verification has not been performed; Codex is explicitly unavailable; application policy is not an OS sandbox; analysis reads the first worksheet. No local LLM is required.

## Verified local handoff

The separated projects pass 46 backend tests, six frontend component tests, TypeScript/production builds, and the browser spreadsheet E2E (including forced WebSocket reconnect/replay and all navigation pages). The independent frozen backend and native release workflow produce real Excel workbooks. The generated NSIS installer was actually installed to an isolated verification folder and the installed application was launched twice; its conversation persisted and its process tree was reaped after each simulated crash. Installed window controls and normal-close cleanup were also observed. The local workspace verification report records exact artifact paths and Git commits.

The test helper accepts `AGENTSCOPE_NATIVE_EXE` for an installed/debug executable and `AGENTSCOPE_NATIVE_DATA_DIR` for an isolated persistent test profile. It queries actual conversations before and after the run, and actual Windows processes after shell termination. It never uses the default user profile for its automated test data.

`build-windows.ps1` and `desktop:dev` activate the installed MSVC/SDK environment for their child process using `vswhere`; they do not change system environment settings. Backend source builds require only the backend's own Python environment. No installation/build tool download runs implicitly during these commands.


## Real Antigravity chat fix (0.1.1)

See [the verification report](docs/REAL_CHAT_VERIFICATION.md) for the reproduced Demo routing root cause, changed files, actual authenticated native chat, session restoration, regression tests and ACP permission limitations. In Settings save Real AI + Antigravity and choose a dynamically discovered model (or the actual ACP session default). Existing explicit Demo preferences remain preserved. Chat errors never silently switch to simulated replies.

`npm.cmd run test:native:skill` is opt-in and consumes AI quota. In the real window it configures Real AI, imports and approves an instructions-only Skill, which must be denied without running any tool, and then the valid `sales-report-helper.zip`. It attaches the sample workbook and verifies three real tool calls, the allow decisions, the 48-row totals, the Excel download and process cleanup.

## Kiểm chứng bản redesign

Chat lưu ID bảng tính theo cuộc trò chuyện. Người dùng có thể chọn lại các tệp đã tải hoặc dùng nhiều tệp trong cùng một lượt. Backend ghi từng báo cáo cùng ID tệp nguồn và mở lại XLSX để kiểm tra cấu trúc, số dòng và thống kê trước khi đăng ký tải xuống. Chế độ nghiên cứu tiếp tục dùng một workbook cố định cho mỗi phép so sánh.

Thả `SKILL.md` hoặc ZIP vào ô soạn để nhập bằng trình kiểm tra hiện có. Nhãn cạnh ô soạn mở chi tiết đánh giá của gói. Hoạt động trong Chat dùng cùng sự kiện đã lưu và luồng WebSocket của bảng thực thi. Bảng chi tiết ghi nguồn ACP/MCP, tham số, quyết định quyền và kết quả quan sát. [Hợp đồng backend](docs/backend-interface.md)

`node scripts/check-native-workspace.mjs` kiểm tra ứng dụng Windows và backend đóng gói bằng hồ sơ riêng. Đặt `AGENTSCOPE_NATIVE_EXE` thành đường dẫn EXE đã cài và `AGENTSCOPE_NATIVE_OUTPUT` thành thư mục kết quả mới. Chương trình kiểm tra hai XLSX, hai định dạng Skill, đổi qua bốn chế độ, mở chi tiết hoạt động, tải báo cáo và sử dụng lại dữ liệu sau khi khởi động lại. Các tác vụ bảng tính của bài kiểm tra chạy cục bộ.

Ở lần kiểm chứng ngày 21/11/2026, backend đạt 285 test (2 bỏ qua), desktop đạt 38 test và Playwright đạt 3 bài. Hai EXE đã cài qua NSIS QA trùng SHA-256 với hai EXE của bản phát hành. Kiểm thử Gemini trực tiếp trên bản cài xác nhận luồng trả lời, tái sử dụng phiên và sự kiện `session.restored` sau khi khởi động lại. XLSX tải từ bản cài được đối chiếu độc lập với 48 dòng của tệp mẫu và tổng doanh thu 344.740.000 VND.

So sánh trực tiếp với Skill văn bản và workbook tổng hợp đạt 16/16 phép kiểm tra AppContainer. Hai điều kiện OFF và ON dùng hai phiên Gemini riêng, cùng đầu vào và có báo cáo khớp dữ liệu gốc lẫn biên nhận MCP. Bản phát hành lưu trạng thái điều kiện ngay khi chuyển sang đang chạy để giao diện theo dõi kịp. Bộ 32 test tiến độ thí nghiệm và tệp đính kèm đạt sau thay đổi này.

Bộ cài, ảnh WebView2 ở 1480×960 và 1080×700, cùng JSON của các lần kiểm thử native nằm trong `artifacts/redesign-20261121/`. Chỉ dọn `tsconfig.tsbuildinfo` (1.300 byte) sau khi xác nhận đây là bộ nhớ đệm TypeScript bị Git bỏ qua và được tạo lại khi build. Bộ cài cũ, hồ sơ ứng dụng, dữ liệu SQLite, tệp tải lên, Skill và bằng chứng nghiên cứu được giữ lại.

## Tinh chỉnh giao diện thực thi

- `src/components/ExecutionCenter.tsx` thay bảng thực thi, tab chi tiết và khung nhật ký trùng lặp từng nằm trong `src/App.tsx`. Mỗi dòng mở riêng, còn nhật ký tổng hợp vẫn có trong Lịch sử. `CopyValue.tsx` dùng chung cho mã định danh và bằng chứng.
- `ExperimentCard.tsx` thay lưới so sánh dài bằng thẻ theo từng điều kiện. Từng số liệu lấy từ báo cáo đã đối chiếu. Số liệu chưa qua đối chiếu, nội dung Skill và biên nhận ACP/MCP mở theo yêu cầu.
- `ResearchControl.tsx`, `App.tsx` và `execution.css` đưa bộ chọn chế độ vào ô soạn. Các bộ chọn CSS của inspector, bảng so sánh và biến thể composer cũ được bỏ khỏi `styles.css`, `research.css` và `workspace.css`.
- Cài đặt và ô soạn hiển thị AppContainer ON riêng với SkillGuard. Bằng chứng của phiên phân biệt kết quả kiểm tra cô lập, PID, SID và mức toàn vẹn đã ghi nhận của ACP/MCP. AppContainer là ranh giới bắt buộc của thử nghiệm ACP/MCP.

Bản cài song song trên Windows có tên **AgentScope Execution Verified**. Đã kiểm tra cuộn và mở riêng từng sự kiện, đổi giữa bốn chế độ, tải Excel và mở lại chat sau khi khởi động lại. Kết quả tự động gồm 74 bài Backend đạt (1 bỏ qua), 38 bài Desktop và 3 bài Playwright. Lượt SkillGuard ON với workbook tổng hợp đạt 16/16 phép thử AppContainer. ACP và MCP có cùng AppContainer SID, cùng mức toàn vẹn Low và báo cáo khớp biên nhận MCP. Bộ cài, ảnh WebView2 và biên nhận kiểm thử cục bộ nằm trong `artifacts/execution-ui-20261121/`.

## Kết nối Backend cục bộ trên Windows

Desktop tự khởi động backend và lấy cổng, mã phiên qua Tauri. Trong Cài đặt, **Kiểm tra kết nối** kiểm tra tiến trình đang chạy. **Kết nối lại** thử khởi động lại tiến trình đã thoát và đọc lại dữ liệu trong cùng hồ sơ. Ô mã phiên dành cho trình duyệt phát triển Vite. Lỗi khởi động hiện ngay trong Cài đặt cùng đường dẫn nhật ký khi có. **Về Chat thường** chuyển giao diện ra khỏi chế độ nghiên cứu. AppContainer tiếp tục là ranh giới bắt buộc của Lab.
