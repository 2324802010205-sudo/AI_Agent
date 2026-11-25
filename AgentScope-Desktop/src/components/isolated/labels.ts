import type { FollowupCase, IsolatedTrial, IsolatedVerdict } from '../../types';

export const STATE_LABEL: Record<string, string> = {
  queued: 'Đang chờ',
  preflight: 'Đang kiểm tra isolation AppContainer',
  running_model: 'Đang chạy Gemini thật trong AppContainer',
  completed: 'Hoàn tất · phản hồi Gemini thật',
  blocked_isolation: 'BỊ CHẶN · isolation thất bại · chưa gửi tới mô hình',
  blocked_integrity: 'BỊ CHẶN · kiểm tra toàn vẹn Skill thất bại',
  failed: 'LỖI · không có kết quả mô hình hợp lệ',
  cancelled: 'Đã dừng trial',
};
export const VERDICT_LABEL: Record<IsolatedVerdict, string> = {
  injection_succeeded: 'Injection THÀNH CÔNG',
  injection_failed: 'Injection THẤT BẠI (mô hình giữ đúng ground truth)',
  inconclusive: 'CHƯA KẾT LUẬN',
  not_executed: 'KHÔNG THỰC THI · không phải kết quả mô hình',
};
export const vnd = (value: number) => value.toLocaleString('vi-VN');
const CONDITION = {
  control: 'Control · không Skill',
  injection: 'Skill exposure',
  canary: 'Canary vô hại',
};
export function conditionLabel(trial: IsolatedTrial) {
  if (trial.condition === 'injection_a') return 'INJECTION A · audit marker';
  if (trial.condition === 'injection_b') return 'INJECTION B · adjusted revenue';
  return CONDITION[trial.kind];
}

export const FOLLOWUP_CASES: Record<FollowupCase, string> = {
  authorized_heading: 'Tiêu đề được cho phép',
  revenue_only: 'Skill thay doanh thu',
  workbook_guidance: 'Chỉ dẫn trong worksheet',
  row_selection: 'Chọn bản ghi',
  accounting_rule: 'Quy tắc kế toán',
  business_interpretation: 'Diễn giải kinh doanh',
  native_row_selection: 'Chọn bản ghi qua MCP',
  native_accounting_rule: 'Quy tắc kế toán qua MCP',
  native_worksheet_note: 'Ghi chú worksheet qua MCP',
  record_note_cancellation: 'Ghi chú đơn hủy',
  prereview_cancellation: 'Giả lập rà soát đơn hủy',
  decision_first_proof: 'Xác minh Gemini tự quyết định',
  decision_first_skill: 'Skill báo cáo đơn hủy',
};
export const WORKFLOW_STATUS = {
  EXPECTED: 'Khớp',
  DEVIATION: 'Sai lệch',
  MISSING: 'Thiếu khai báo',
};
export const observed = (value?: boolean | null) =>
  value === true ? 'Có' : value === false ? 'Không' : 'Chưa xác minh';

export function decisionConfig(trial: IsolatedTrial) {
  return trial.review_config ? ` · Cấu hình ${trial.review_config}` : '';
}
