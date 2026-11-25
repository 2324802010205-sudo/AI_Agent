import type { Assessment, Condition, ProtectionPolicy, ResearchMode } from '../../types/research';

export const MODE_LABELS: Record<ResearchMode, string> = {
  normal: 'Chat thường',
  skillguard_off: 'Unprotected Model Test',
  skillguard_on: 'Protected Test',
  compare: 'So sánh cả hai',
};
export const MODE_HINTS: Record<ResearchMode, string> = {
  normal: 'Trợ lý thông thường với chính sách bảo mật chuẩn.',
  skillguard_off:
    'SkillGuard OFF gửi nguyên văn Skill qua ACP. Kết quả quét chỉ để cảnh báo. Cách ly và cấp quyền công cụ vẫn bắt buộc.',
  skillguard_on: 'SkillGuard ON — kiểm tra, lọc hoặc chặn Skill và kiểm tra số liệu lúc chạy.',
  compare: 'Chạy SkillGuard OFF và ON trên cùng đầu vào, mỗi điều kiện một phiên Gemini riêng.',
};
export const CONDITION_LABELS: Record<Condition, string> = {
  baseline: 'Đối chứng không Skill',
  skillguard_off: 'SkillGuard OFF',
  skillguard_on: 'SkillGuard ON',
};
export const POLICY_LABELS: Record<ProtectionPolicy, string> = {
  filter: 'Lọc bỏ nội dung độc hại, giữ phần sạch & tiếp tục chạy Gemini',
  quarantine: 'Chặn hoàn toàn Skill rủi ro trước khi tới Gemini',
  runtime_only: 'Gửi toàn văn có đánh dấu không tin cậy và chặn ở lớp công cụ MCP',
};
export const CATEGORY_TONE: Record<Assessment['category'], string> = {
  influenced: 'danger',
  blocked: 'shield',
  resisted: 'good',
  clean: 'good',
  baseline: 'neutral',
  baseline_error: 'warn',
  unavailable: 'muted',
};
export const DECISION_LABELS: Record<string, string> = {
  no_skill: 'Không dùng Skill',
  delivered_unmodified: 'Có — toàn văn, không qua SkillGuard',
  delivered_filtered: 'Có — đã lọc dòng đáng ngờ và rào là dữ liệu không tin cậy',
  delivered_isolated: 'Có — rào là dữ liệu không tin cậy',
  quarantined_before_exposure: 'Không — chặn trước khi tới mô hình',
};
export const TOOL_LABELS: Record<string, string> = {
  list_sheets: 'liệt kê trang tính',
  read_sheet: 'đọc workbook',
  calculate_totals: 'tính tổng',
  analyze_sales_kpis: 'phân tích KPI bán hàng',
  analyze_sales_trends: 'phân tích xu hướng',
  generate_business_report: 'lập báo cáo kinh doanh',
  propose_report: 'đề xuất số liệu',
  create_excel_report: 'tạo Excel',
  run_python_code: 'chạy mã Python (Code Interpreter)',
  run_skill_script: 'chạy script đi kèm Skill',
  inspect_workspace_files: 'kiểm tra tệp workspace',
  read_workspace_file: 'đọc tệp workspace',
  write_workspace_artifact: 'tạo tệp trong workspace',
};

export const money = (value: unknown) =>
  typeof value === 'number' ? value.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : '—';

export const enforcer = (value: string) =>
  value === 'skillguard' ? 'SkillGuard' : value === 'mandatory' ? 'Bảo vệ bắt buộc' : value;

export const short = (value?: string | null, length = 10) =>
  value ? `${value.slice(0, length)}…` : '—';
