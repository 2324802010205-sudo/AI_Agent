# Quản lý và dùng nhiều Skill cùng lúc

Tài liệu này mô tả hành vi của nhánh `feature/multi-skill-runtime`. Mã nguồn chính nằm ở `agentscope/skills.py`, `agentscope/skill_context.py` và `agentscope/experiments/chat_workbook.py`.

## Bốn trạng thái khác nhau

Một Skill luôn có đúng một trạng thái vòng đời. Máy chủ tính trạng thái bằng `SkillRegistry.skill_state()` và trả về trong mọi bản ghi Skill.

| `state` | Ý nghĩa | Bật được | Gửi tới Gemini |
|---|---|---|---|
| `enabled` | Đã cài, người dùng bật, kết quả quét hiện tại không có phát hiện đáng kể | Có | Có |
| `disabled` | Người dùng đã tắt | Có | Không |
| `quarantined` | Gói bị cách ly theo kết quả quét (`status=quarantine`) | Không | Không |
| `restricted` | Đánh giá bảo mật hạn chế (bản quét mới có phát hiện, hoặc Skill của phòng thí nghiệm) | Không | Không |

Skill đã xóa không còn trong thư viện. Bản lưu nhập và lịch sử tác vụ vẫn được giữ.

`set_enabled` chỉ đổi công tắc của người dùng cho một ID. Bật một Skill `quarantined` hoặc `restricted` trả về 409. Tắt một Skill `quarantined` không đổi gì, nên luồng đánh giá chỉ đọc vẫn dùng được.

## Nhiều Skill trong một tác vụ

Với Antigravity, mọi Skill `enabled` được đưa vào cùng một prompt. Gửi `auto_skill: true` hoặc bỏ trống cả `auto_skill` lẫn `skill_id` đều chọn chế độ `all_enabled`. `auto_skill: false` hoặc `skill_id: null` tắt hết Skill cho lượt đó. `skill_id` giới hạn tác vụ vào một Skill. Nhà cung cấp đám mây giữ cách chọn theo độ liên quan khi không có `auto_skill: true`.

1. `resolve_enabled()` chụp trạng thái trong một đoạn mã đồng bộ. Mỗi Skill được ghi ID, SHA-256 của `SKILL.md` và SHA-256 của gói. Skill không khớp SHA-256 bị giữ lại với lý do `integrity_failed`.
2. `ContainedWorkbookChat.skill_context` áp cổng SkillGuard cho từng Skill. Ở chế độ `all_enabled`, một Skill bị chặn chỉ bị giữ lại và báo `skillguard_blocked`. Các Skill khác vẫn được gửi. Skill được chọn riêng vẫn dừng tác vụ như trước.
3. `skill_context.plan` dựng một khối có ranh giới cho từng Skill: `<untrusted_skill index id name sha256>`. ID và hash nằm trong thẻ mở nên các Skill trùng tên vẫn phân biệt được. Nội dung đi qua `neutralize`, nên Skill không thể đóng khối hoặc giả vai trò.
4. Sau khi người dùng phê duyệt, `confirm_snapshot` kiểm tra lại các Skill đã gửi. Nếu một Skill bị tắt, gỡ hoặc đổi nội dung trong lúc chờ, tác vụ dừng trước khi gửi và báo rõ.

Chỉ văn bản `SKILL.md` được gửi. Tệp đi kèm chỉ được liệt kê (`bundled_files`), không gửi và không chạy (`bundled_files_delivered=false`, `bundled_files_executed=false`). Gói có mã thực thi bị cách ly ngay từ lúc quét.

## Giới hạn được báo cáo, không bỏ qua im lặng

| Mã | Điều kiện | Kết quả |
|---|---|---|
| `skill_too_large` | `SKILL.md` lớn hơn `MAX_SKILL_CHARS` (60.000) | Giữ lại, có lý do |
| `context_budget_exceeded` | Tổng vượt `MAX_CONTEXT_CHARS` (200.000) | Giữ lại Skill ít liên quan nhất, có lý do |
| `skillguard_blocked` | Cổng nội dung của SkillGuard chặn | Giữ lại, có lý do |
| `integrity_failed` | Bản cài không khớp SHA-256 | Giữ lại, có lý do |
| `duplicate_display_name` | Nhiều Skill cùng tên hiển thị | Vẫn gửi, phân biệt bằng ID |
| `unsupported_tools` | `allowed-tools` nêu công cụ AgentScope không có | Vẫn gửi, dặn mô hình không dùng công cụ đó |

Mỗi giới hạn xuất hiện trong sự kiện `skill.exposure_limited`, trong tin nhắn trò chuyện và trong biên nhận. AgentScope không phát hiện được mâu thuẫn về ngữ nghĩa giữa các Skill. Prompt dặn Gemini theo yêu cầu của người dùng và kết quả công cụ, và nêu ID các Skill mâu thuẫn trong câu trả lời.

## Biên nhận

Sự kiện `prompt.submitted` ghi `skills[]` với `exposed`, `reason`, `sha256`, `block_sha256`, `in_acp_prompt` và `skill_exposure`. `in_acp_prompt` chỉ đúng khi đúng khối đó, khớp hash, nằm trong văn bản prompt mà ứng dụng khách ACP đã ghi. `skill_exposure=acknowledged` nghĩa là ACP nhận prompt và kết thúc lượt. Cách nhà cung cấp xử lý nội bộ nằm ngoài quan sát.

Bản ghi tác vụ có `skill_snapshot` (ID và SHA-256 lúc chốt), `loaded_skills` và `skill_exposure_plan`.

## API

- `GET /api/skills`: mỗi Skill có thêm `state`, `eligible`, `toggleable`, `state_reason`.
- `POST /api/skills/{id}/enable` và `/disable`: đổi công tắc của đúng ID đó.
- `DELETE /api/skills/{id}`: gỡ đúng một Skill. Trả 409 khi một tác vụ đang giữ Skill đó.
- `GET /api/skills/runtime-summary`: số lượng theo trạng thái và kế hoạch gửi hiện tại (Skill sẽ gửi, Skill bị giữ lại, giới hạn).
