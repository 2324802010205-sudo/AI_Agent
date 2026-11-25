# AgentScope Desktop 0.1.5 — kiểm chứng bảo mật

Backend tương thích: AgentScope-Backend 0.1.5. Kiến trúc React/TypeScript/Tauri 2 và backend Python độc lập được giữ nguyên.

Security và Permissions hiển thị riêng: chính sách cho phép, chính sách từ chối, thao tác CLI không qua SkillGuard, công cụ hoàn tất sau từ chối, ngăn gửi Skill tới ACP và execution mode do ACP báo cáo. Không có yêu cầu được ghi nhận không có nghĩa là đã chặn tấn công. Không có chỉ báo tĩnh không có nghĩa Skill an toàn.

Thay đổi hành vi có chủ đích: Skill nhập không được gửi tới Antigravity ACP khi chưa có sandbox hệ điều hành được xác minh. Bảng tính vẫn dùng các capability đã khai báo/phê duyệt và công cụ Python, tạo Excel thật; không gọi AI cho lượt này. Skill chỉ dẫn thuần được chọn sẽ bị chặn và giải thích. Chat thường dùng Default Mode được backend ghim trước prompt. Đây là hạn chế chức năng cần thiết, không phải tuyên bố rằng CLI đã được sandbox.

Mã giao diện: `src/security.ts`, `src/App.tsx`, `src/types.ts`; kiểm thử `src/security.test.ts`, `src/App.test.tsx`. Phiên bản đồng bộ trong package.json/package-lock.json và Cargo.toml/Cargo.lock/tauri.conf.json. Không thay đổi native process lifecycle hoặc global CLI settings.

Kiểm chứng: 17 frontend tests; TypeScript + Vite production build; Prettier; browser E2E trên backend profile mới đều PASS. Tauri release và NSIS installer 0.1.5 build PASS; native executable kiểm tra sidecar, CSV 9 dòng, Excel download, lưu hội thoại và process cleanup PASS. Frozen backend kiểm tra riêng workflow 48 dòng và chặn Skill delivery với 0 ACP prompt PASS. Installer chưa ký, không cài đè hoặc publish. Báo cáo đầy đủ (mode, dữ liệu, mock/live, giới hạn và native artifacts) ở repository backend ngang cấp: `../AgentScope-Backend/docs/AUTO_MODE_SECURITY_REPORT_VI.md` tính từ thư mục gốc Desktop.
