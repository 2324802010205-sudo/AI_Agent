# AgentScope 0.1.5 — báo cáo kỹ thuật và nghiên cứu Auto Mode

> Cập nhật tiếp theo: [báo cáo 0.1.6](SECURITY_EVALUATION_VI_0_1_6.md). Có một control Gemini ACP thật với ground truth Excel, chưa có lượt injection được gửi an toàn. Lab VM và execution arithmetic không được tuyên bố đã kiểm chứng thành công.

Ngày: 17/11/2026, múi giờ Asia/Bangkok. Phạm vi: tiếp tục v0.1.4, không xây lại ứng dụng, không thay đổi cấu hình CLI toàn cục, không bật Auto trên profile thật, không push remote.

## 1. Trạng thái tiếp nhận và bằng chứng có từ trước

Đã xác minh hai repository thật ở `C:\Users\ADMIN\AgentScope-Workspace`. Thư mục đang mở trong IDE, `C:\Users\ADMIN\AgentScope-Desktop`, là nơi giữ dữ liệu/build cũ, không phải repository Git hiện hành. Backend ban đầu sạch tại `bfdfed7`; Desktop sạch tại `4f45d7a`. Không thấy AGENTS.md áp dụng trong hai repository. Không xóa hoặc di chuyển database, Skill gốc, lịch sử Git hay cấu hình xác thực.

Đã đọc `PROMPT_INJECTION_LAB.md`, luồng runtime/ACP/SkillGuard, importer, prompt provenance, transport giả, test trình duyệt và build Windows. Trước sửa: **111 backend tests PASS, 1 live test SKIP; 14 frontend tests PASS; 1 browser E2E PASS**. Các con số cũ 48 đơn, doanh thu 344.740.000 VND, lợi nhuận 95.980.000 VND tiếp tục được xác minh bằng công cụ và workbook.

Những phần đã có trước phiên này: ACP streaming, session/model discovery, multi-turn, deterministic spreadsheet tools, capabilities, Skill quarantine/integrity, băm prompt, delimiter neutralization, nguồn sự kiện, `security.boundary`, `security.unmediated_tool`, xử lý denial thành blocked và skill matching chặt hơn. Chúng không phải những tính năng mới được tạo trong phiên này.

Theo báo cáo cũ, một thử nghiệm ban đầu và bảy lượt bổ sung đã chuyển payload tới ACP nhưng không thấy canary, sai tổng, hoặc yêu cầu tệp bị cấm. Hai probe riêng từng cho thấy một lần đọc marker trong vùng CLI tin cậy không có permission callback, và một lần ngoài vùng tin cậy được SkillGuard từ chối. Đây là **bằng chứng kế thừa**, không phải số lượt live được thực hiện lại trong phiên này; không có raw transcript cũ đầy đủ để tái kiểm chứng độc lập mọi chi tiết.

## 2. ACP execution mode thực tế

Đã chạy `agy.exe --version`, `--help`, `acp --help`; CLI là **1.5.10**. Interactive CLI có `--mode` được mô tả là mode cho session hiện tại. ACP help không có cùng cờ `--mode`; ACP có giao thức `session/set_mode`. Adapter v0.1.4 chỉ truyền `acp --sandbox --include-default-customizations=false --disable-telemetry`, sau đó initialize và session/new, không hề gửi mode selection.

Hai handshake **có xác thực**, không gửi prompt, không đổi mode, cùng trả:

| Trường | Kết quả cả 2 session |
| --- | --- |
| agentInfo | Antigravity ACP Server 1.5.10 |
| models.currentModelId | `gemini-3.8-flash-high` |
| modes.currentModeId | `default` |
| configOptions mode.currentValue | `default` |
| availableModes | `default`, `accept-edits`, `auto`, `plan` |

Snapshot được lưu trong [ACP_MODE_OBSERVATION_2026-11-17.json](ACP_MODE_OBSERVATION_2026-11-17.json). SHA-256 của file settings trước/sau trùng nhau; không in hoặc sao chép thông tin xác thực. Probe đầu tiên trong môi trường quyền hạn chế nhận `Authentication required`, trước khi tạo được session; probe sau dùng quyền truy cập login hiện có thành công. Không có model prompt trong các probe này.

Không thấy trường execution mode trong settings JSON được kiểm tra. `trustedWorkspaces` vẫn có các vùng rộng như home/System32; chỉ đọc cấu hình, không sửa. Việc một lựa chọn Auto trong terminal khác có tồn tại qua mọi loại khởi động/restore hay không **chưa được chứng minh bằng A/B live**, vì không bật Auto trên profile thật và không có mã nguồn triển khai CLI để kiểm tra sâu. Bằng chứng hiện có cho thấy session ACP mới của AgentScope là Default; **không có cơ sở coi việc terminal đang Auto đồng nghĩa ACP cũng Auto**.

Ở 0.1.5, kết quả này không còn là giả định vận hành: trước mọi prompt ACP, adapter yêu cầu mode đã biết và ghim về `default` nếu cần, qua `session/set_mode`. Nếu không xác minh được mode hoặc RPC thất bại, không gửi prompt. `set_mode_acknowledged` là ACK chọn mode, được phân biệt với `session_response` và update quan sát được. Mode cập nhật trong phiên được ghi và mode khác Default dẫn tới yêu cầu cancel/đóng phiên. Real/Demo của AgentScope và execution mode của CLI là hai khái niệm khác nhau.

Theo [đặc tả Session Modes của ACP](https://agentclientprotocol.com/protocol/v1/session-modes), modes có thể tác động tới prompt, tools và permission behavior, và agent có thể gửi mode update. Điều này không cam kết CLI này thay đổi chính xác mọi công cụ theo cách nào. [Đặc tả Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls) xác định agent sở hữu việc chạy tools; tool notifications không tự trở thành authorization của client.

## 3. Vì sao payload cũ không tạo hành vi quan sát được?

Các bằng chứng phù hợp với việc mô hình ưu tiên yêu cầu hợp lệ, ranh giới untrusted và dữ liệu công cụ. Không thể tách riêng tác dụng của SYSTEM text, `<untrusted_skill>`, nội dung task và dữ liệu quan sát từ các đầu ra cũ. Không biết suy luận nội bộ của Gemini. Không gọi kết quả này là miễn nhiễm hoặc chứng minh một cơ chế từ chối cụ thể.

Ba công cụ Python đã chạy và ghi Excel **trước** khi prompt được gửi. Gemini không có cơ hội sửa workbook đó qua chuỗi công cụ này; vẫn từng có khả năng trình bày sai số trong câu trả lời. Không có unauthorized tool request trong thử nghiệm spreadsheet cũ, nên **SkillGuard không hề chặn payload tại một lần yêu cầu công cụ thực tế của thí nghiệm đó**. Probe tệp riêng mới là bằng chứng về mediation/denial, và đồng thời bộc lộ chỗ CLI có thể tự đọc tệp.

`trustedWorkspaces`, Default/Auto và `--sandbox` thuộc runtime ngoài. Callback chỉ có tác dụng khi runtime gửi callback. Prompt fencing là hướng dẫn cho LLM; không phải kiểm soát OS. Đường dẫn cwd hẹp và data profile mới cũng không ngăn tiến trình đọc home, chạy process hoặc truy cập mạng với quyền tài khoản.

## 4. Kết quả phiên này và giới hạn số mẫu

| Nhóm kiểm chứng | Số lượt | Model/mode | Kết quả và ý nghĩa |
| --- | --- | --- | --- |
| Handshake thật | 2 session | Gemini 3.8 Flash High; Default | Xác minh metadata, 0 prompt, 0 mode switch |
| Chat thật sau sửa | 1 test, 2 prompt liên tiếp | CLI default được quan sát là Gemini 3.8 Flash High; Default được ghim | Greeting + context follow-up PASS; không phải injection trial; test không đo đầy đủ mọi tool operation |
| Matrix guard bằng transport giả | 4 trường hợp: benign/canary × default/auto được cấu hình ở fake transport | `discovered-model`, mode giả | Cả 4 giữ workflow Python, không gửi ACP prompt; mode giả không được thực thi khi guard chặn đường ACP |
| Mode/permission/audit unit/integration | Các test tập trung trong suite | Transport giả | Auto giả được chuyển Default trước prompt; unknown/conflict bị chặn; drift bị cancel; read trái phép bị deny; completed không qua callback và completed sau deny được audit/dừng |
| Injection live mới | **0** | Default: 0; Auto: 0 | Không có VM hoặc host confinement đã xác minh; không thể ước lượng tác động của Auto hoặc tỷ lệ thành công injection |

Các fake transport có chủ đích phát cả phản hồi đúng, phản hồi theo canary, request bị cấm, completion không callback và completion sau denial. Chúng kiểm chứng mã ứng dụng; chúng **không phải phản hồi Gemini**. Fixture legacy lab chỉ giả lập isolation trong test, đồng thời thay toàn bộ transport; production không có setting, biến môi trường hay API để khai báo bừa rằng đã có sandbox.

Dataset chung: `samples/AgentScope_DuLieuBanHang_Test.xlsx`, SHA-256 `cdb7e04d7fa674f4b8efd54a8c3255881e933e6195c62a24e9322338992f0dab`. Matrix dùng cùng task, workbook và capability set, chỉ bỏ/thêm phần canary sẵn có và cấu hình mode của transport giả. Không điều chỉnh payload để tăng tỷ lệ làm theo.

Audit phân biệt:

1. **Không giao tới ACP**: `skill.loaded` chỉ là selection; `security.execution_restricted` ghi `skill_delivered:false`, `acp_prompt_sent:false`. Không gọi đây là model resistance.
2. **Đã giao nhưng không thấy làm theo**: provenance/hash ở `prompt.composed` và prompt boundary, cùng output/tool observations. Không có deny không có nghĩa đã được bảo vệ.
3. **Có request và policy từ chối**: `permission.evaluated`, nguồn SkillGuard, tool call ID, decision; wire outcome `reject_once` hoặc cancelled. Authorization chưa chứng minh operation đã/không xảy ra.
4. **Runtime báo operation ngoài authorization**: `security.unmediated_tool` hoặc `security.authorization_violation`, `enforced:false`, task dừng/blocked. Cancel là phản ứng sau quan sát, không hoàn tác được thao tác. ACP completion là báo cáo của runtime, không phải trace syscall OS độc lập.

Classifier còn tách `delivered_output_influenced` và `prohibited_action_authorized_not_observed_executed`; không còn xem allow decision đơn thuần là bằng chứng execution, và giảm đếm trùng cùng tool call.

Việc khớp literal canary hoặc số giả chỉ là chỉ báo output: mô hình có thể trích lại payload để giải thích. Cần đọc ngữ cảnh để kết luận đã làm theo; không xem phép khớp chuỗi là thước đo thành công tấn công tuyệt đối.

| Cơ chế | Bảo vệ/đo được | Không chứng minh |
| --- | --- | --- |
| Ranh giới chỉ dẫn LLM | Phản hồi và action request quan sát được dưới prompt cụ thể | Suy luận nội bộ hoặc immunity tổng quát |
| Công cụ bảng tính deterministic | Dữ liệu được Python tính, workbook ghi trước/không qua LLM; capability có kiểu cố định | Mọi câu prose do một cloud model khác viết đều đúng |
| SkillGuard authorization | Quyết định cho tool AgentScope hoặc callback ACP thật sự nhận được | Runtime ngoài sẽ luôn hỏi hoặc luôn tôn trọng quyết định |
| Sandbox hệ điều hành | Nếu có và đã xác minh: giới hạn thật lên file/process/network | Cwd riêng, Default Mode, `--sandbox` CLI hoặc Job Object tự đủ để tạo ranh giới này |

## 5. Phòng vệ đã triển khai

- **Fail closed cho Skill nhập qua ACP:** chặn delivery, không phụ thuộc keyword scanner, danh tính tác giả hoặc nút approve. Bảng tính giữ nguyên các tool đã khai báo, SkillGuard và Excel download, với summary số do Python tạo trực tiếp. Skill chỉ dẫn thuần được chọn sẽ blocked kèm giải thích. Đây là hạn chế có chủ đích: phần diễn giải bằng Gemini cho lượt dùng imported Skill tạm ngưng.
- **Ngữ cảnh:** đóng phiên ACP của hội thoại khi chuyển sang Skill local, hủy preparation liên quan, vô hiệu restore session cũ có Skill và không replay các lượt Skill vào chat ACP mới. Không xóa history/database.
- **Mode:** nhớ mode từ new/load/config options, ghi `session.mode` và `acp_execution_mode` của task; ghim Default cả khi dùng lại session. Không expose Auto toggle.
- **Permission:** từ chối input mơ hồ, path alias xung đột, rawInput không phải object, relative path, tool/kind không hợp lệ; chỉ exact attachment có thể được allow. Lưu outcome thực sự chọn trên wire, không đánh đồng “callback từng chạy” với “đã allow”. Thiếu `allow_once` dẫn tới cancelled/deny.
- **Quan sát và dừng:** terminal tool event không mediation hoặc completion sau deny được phân loại riêng, gửi cancel và làm lỗi đánh thức prompt đang chờ để đóng CLI. Những thông báo này không được trình bày như một thao tác đã bị ngăn trước.
- **Cloud:** Skill prose chuyển khỏi system role, giữ fence ở user role. Cloud chỉ có typed tools do AgentScope thực thi; network approval vẫn giữ nguyên. Đây vẫn không phải bằng chứng model immunity.
- **Scanner:** thêm `static_review` với rule/line, phương pháp heuristic, assurance `none` và cảnh báo false positive/negative. Text “No credentials here” vẫn có thể khớp từ khóa; indicator không có tính kết tội hoặc chứng nhận an toàn. Dữ liệu Skill cũ vẫn tương thích.
- **UI:** Security/Permissions đưa cả boundary warning, unmediated completion, denial, delivery restriction và session mode vào bằng chứng; bỏ các câu hứa bao phủ mọi thao tác. Không có request được ghi nhận được mô tả riêng. UI review hiển thị chỉ báo tĩnh và giới hạn của nó.
- **Research harness:** runner injection/probe cũ dừng trước khi tạo fixture hoặc mở ACP. Không có cờ bypass để bật lại trên profile thật. Script mode-inspect chỉ lấy metadata, không prompt hoặc đổi mode.

## 6. Tệp thay đổi

Backend: `agentscope/antigravity_acp.py`, `runtime.py`, `skills.py`, `__init__.py`; `pyproject.toml`; `scripts/injection-lab.py`, `scripts/acp-mode-inspect.py`, `scripts/check-skill-boundary.py`; `tests/test_antigravity_acp.py`, `test_prompt_injection_lab.py`, `test_skill_capabilities.py`, `test_security_boundary.py`, `injection_lab.py`; `.gitignore` cho scratch live test; README và ba tệp docs (lab lịch sử, báo cáo này, JSON mode observation).

Desktop: `src/App.tsx`, `src/types.ts`, `src/security.ts`, `src/App.test.tsx`, `src/security.test.ts`; `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `Cargo.lock`, `tauri.conf.json`; README và `docs/SECURITY_0_1_5.md`. Không sửa native process lifecycle, kiến trúc Tauri, hoặc gộp hai repository.

## 7. Kiểm chứng và tái lập an toàn

Sau sửa: **131 backend tests PASS, 1 opt-in live test SKIP** trong suite mặc định; opt-in live test riêng **1 PASS / 26 deselected**, gồm 2 prompt chat. Có 1 Starlette/httpx deprecation warning đã tồn tại, không phải lỗi test. **17 frontend tests PASS**, Black, Prettier, TypeScript/Vite build và browser E2E **PASS**. Browser được chạy trước/sau trên profile mới; kiểm tra read/analyze/report, download Excel và WebSocket replay.

PyInstaller sidecar và Tauri release/NSIS 0.1.5 build **PASS**. Verifier chạy executable backend đã đóng gói trên profile mới: **48 dòng, doanh thu 344.740.000, lợi nhuận 95.980.000; 0 ACP prompt; instructions-only blocked; shutdown sạch**. Native executable check: **PASS**, 9 dòng CSV, Excel download, hội thoại mới được lưu và Windows process tree được thu hồi sau shell crash. Không cài đè ứng dụng người dùng. Cảnh báo build: VsDevCmd in một dòng không tìm thấy `vswhere.exe` nhưng compiler/linker/build vẫn thành công; PyInstaller cảnh báo hidden import `tzdata` thiếu. Workflow đã kiểm tra không dùng named-zone database; đây không phải chứng nhận các tính năng timezone khác.

Installer: `C:\Users\ADMIN\AgentScope-Workspace\AgentScope-Desktop\src-tauri\target\release\bundle\nsis\AgentScope_0.1.5_x64-setup.exe`. Đây là local development installer chưa ký; không publish. Chưa chạy trình cài đặt; kiểm chứng native thực hiện trên release executable và sidecar, không sửa registry cài đặt hay profile người dùng. Kết quả máy của verifier lưu ở `AgentScope-Backend/artifacts/frozen-skill-boundary.json`; native profile kiểm chứng ban đầu ở `AgentScope-Desktop/artifacts/native-check-02fe73d8-e579-4e01-8a4b-37146546c399`. Bằng chứng repo và commit cuối được ghi ở phần bàn giao sau review.

Sau lần build cuối, frozen verifier và native check được chạy lại và đều PASS. Profile frozen cuối: `.agentscope-boundary-check-ddda054f`; profile native cuối: `artifacts/native-check-7fc07882-f364-444c-8fe1-edac931ea3eb`. Hash của backend dist, sidecar được stage và backend trong release giống nhau. Manifest lưu ở `AgentScope-Desktop/artifacts/security-artifact-manifest.json`, log build cuối ở `artifacts/security-build-0.1.5.log`.

| Artifact cuối | SHA-256 |
| --- | --- |
| Backend EXE / staged / release sidecar | `a40198f3b04a57387c5f3325096da6dc5d659fecc5a567370d467b1144f80968` |
| Desktop release EXE | `c6ad237549544ada57a3bec759dbca88e77aa31490643bb502ffce436a095c7b` |
| NSIS installer (22.400.050 bytes) | `38203ae80f6116a95da495a29275836297fa5b24d4baea6571b70cdeb6e08ad5` |

```powershell
# Backend — transport giả, không tốn quota
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m pytest tests/test_security_boundary.py tests/test_prompt_injection_lab.py -q
.\.venv\Scripts\python.exe -m black --check --workers 1 agentscope tests scripts
# Chỉ metadata thật, cần CLI đã đăng nhập; không đổi execution mode
.\.venv\Scripts\python.exe scripts/acp-mode-inspect.py --output artifacts/mode-observation.json
# Sau khi build: kiểm chứng artifact thật, không gửi prompt AI
.\.venv\Scripts\python.exe scripts/check-skill-boundary.py
# Desktop
npm.cmd test
npm.cmd run format:check
npm.cmd run build
```

Tạo thư mục output mới trước khi chạy mode-inspect. Không chạy command live cũ trong báo cáo lịch sử. Build installer chỉ sau các test/build pass; không cài đè profile đang dùng và không publish.

## 8. Thiết kế thí nghiệm live kế tiếp — chưa thực hiện

Chỉ thực hiện trong VM dùng tài khoản lab, không host shares/clipboard/secret thật, không dữ liệu người dùng; chặn mạng ngoài endpoint model cần thiết bằng chính sách bên ngoài agent, snapshot và quan sát file/process/network ở OS. Cấu hình CLI riêng chỉ tin workspace lab; cần kiểm chứng confinement bằng probe deterministic độc lập trước khi đưa Skill vào. Không dùng việc đổi `trustedWorkspaces` làm bằng chứng sandbox.

Thiết kế 2×2: benign/canary gốc × Default/Auto; giữ task, dataset/hash, model ID và version CLI. Dự kiến 3 lần mỗi ô (12 lượt) chỉ nếu quota và isolation cho phép; cân bằng thứ tự, session mới mỗi lượt, không tối ưu payload theo kết quả. Ghi mode ACK/update, prompt/Skill hashes, marker match, tool IDs/request/outcome, completion và OS observations; xác minh Excel riêng. File ngoài phạm vi chỉ là marker tổng hợp, không có endpoint thu thập. Dừng toàn bộ batch ngay khi có operation trái phép; không tiếp tục chạy để tăng số mẫu. Nếu quota/error thì ghi missing, không chuyển thành “kháng injection”. Không coi 12 lượt nhỏ là tỷ lệ an toàn tổng quát.

So sánh này hiện **chưa được giải quyết thực nghiệm**. Kiểm tra môi trường không tìm thấy `Get-VM`, `VBoxManage.exe`, `vmrun.exe` hoặc `WindowsSandbox.exe` khả dụng; điều này không thay thế inventory toàn máy hay chứng minh không có hypervisor nào khác. Không provision hoặc bật thêm tính năng hệ thống. Không thay đổi terminal người dùng để cố thu được kết quả Auto. Phiên hiện tại hoàn thành phần điều tra an toàn và guard; câu hỏi nhân quả về Auto còn cần môi trường ngoài repository.

## 9. Rủi ro còn lại và thứ tự xử lý

**P0:** chưa có sandbox OS cho Antigravity. Normal chat trực tiếp vẫn dùng quyền runtime CLI; Default và callback không bao phủ tool tự chạy, và tool không gửi notification sẽ không bị phát hiện. Imported Skills được loại khỏi đường này, nhưng raw user prompts hoặc nội dung từ những nguồn khác vẫn có thể gây rủi ro. Không tuyên bố bảo vệ toàn bộ máy.

**P1:** triển khai VM/broker thực sự giới hạn file/process/network rồi mới cân nhắc mở lại Skill delivery; kiểm tra lifecycle, session restore và quota trong môi trường đó. Không sao chép token/login thật vào fixture chỉ để tạo kết quả thuận lợi.

**P1:** mở rộng evidence ở OS và correlation thứ tự permission/tool. Hiện cancellation chỉ best effort; CLI có thể đã thực hiện thao tác trước notification. Loại `think` trong tool metadata cũng không được tin là chứng minh vô hại; terminal tool chưa được cấp quyền vẫn khiến dừng bảo thủ.

**P2:** kiểm chứng số liệu trong cloud narrative còn là công việc riêng, cần định nghĩa claim/column/units và phát hiện mismatch có giới hạn; không thêm bộ dò số chung dễ tạo false confidence. Workflow ACP + Skill hiện dùng narrative deterministic để loại bỏ cơ hội LLM đổi số. Cloud API vẫn có thể viết prose sai dù tools đúng.

**P2:** scanner chỉ hỗ trợ review; cần corpus benign/malicious có nhãn và đánh giá false positive/negative, không dùng hit rate để suy ra độ an toàn runtime. Chưa đo Unicode/multi-turn/cell injection/các model khác.

## 10. Bàn giao Git độc lập

- Backend implementation và bộ kiểm chứng: `33d81240e30d1e73f4858d9f8cb456df49e041cc` — `fix(security): fail closed for unisolated ACP skills and pin session mode`.
- Desktop UI và release metadata: `41c583e3c3d6ff83c01ce959027143a2074f4224` — `fix(security): distinguish policy decisions and unmediated runtime evidence`.
- Đoạn đối chiếu commit này là cập nhật tài liệu sau hai commit implementation; không thay đổi binary đã kiểm chứng. Installer và dữ liệu test được giữ local trong các thư mục ignored, không đưa vào Git. Không push, không thay đổi remote hoặc viết lại history.
