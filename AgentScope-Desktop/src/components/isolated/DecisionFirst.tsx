import type { IsolatedTrial } from '../../types';
import { observed } from './labels';

export default function DecisionFirst({
  trial,
  control,
}: {
  trial: IsolatedTrial;
  control?: IsolatedTrial;
}) {
  const review = trial.phase6;
  if (!review) return null;
  const comparison = review.truth_comparison;
  const artifact = trial.agentic?.artifact_validation;
  return (
    <details open>
      <summary>Quyết định trước khi tạo báo cáo Excel</summary>
      <ol>
        <li>
          <strong>Bằng chứng MCP</strong>
          <p>
            Hợp đồng dữ liệu khớp ·{' '}
            {observed(review.trusted_tool_contract_verified_before_proposal)} · Cờ cảnh báo có sẵn
            trước đề xuất · {observed(review.trusted_warning_flag_exposed_before_proposal)}
          </p>
          <p>
            Ghi chú đến trước đề xuất · {observed(review.worksheet_note_exposed_before_proposal)}
          </p>
        </li>
        <li>
          <strong>Quyết định Gemini</strong>
          <p>
            Đã xác minh lời gọi submit_review_decision · {observed(review.first_proposal_committed)}
          </p>
          {review.first_proposal && (
            <pre>{JSON.stringify(review.first_proposal.arguments, null, 2)}</pre>
          )}
          {control?.phase6?.first_proposal && (
            <details>
              <summary>Đề xuất gốc của Control cùng cấu hình và lần lặp</summary>
              <pre>{JSON.stringify(control.phase6.first_proposal.arguments, null, 2)}</pre>
            </details>
          )}
          {comparison && (
            <p>
              Số liệu đúng · {observed(comparison.facts_correct)} · Cờ cảnh báo đúng ·{' '}
              {observed(comparison.warning_flag_correct)} · Văn bản cảnh báo đúng ·{' '}
              {observed(comparison.warning_text_correct)}
            </p>
          )}
        </li>
        <li>
          <strong>Kiểm tra bảo mật</strong>
          <p>
            {review.artifact_policy_checks.length
              ? review.artifact_policy_checks
                  .map((check) => (check.allowed ? 'Chấp nhận' : `Từ chối · ${check.reason}`))
                  .join(' · ')
              : 'Chưa ghi nhận kiểm tra trước khi ghi tệp'}
          </p>
        </li>
        <li>
          <strong>Thực thi công cụ</strong>
          <p>Đã thực thi create_excel_report · {observed(Boolean(review.artifact_execution))}</p>
        </li>
        <li>
          <strong>Tệp cuối</strong>
          <p>
            Tệp được tạo · {observed(review.artifact_created)} · Kiểm tra độc lập ·{' '}
            {observed(artifact && artifact.valid && artifact.matches_mcp_output)} · Cảnh báo trong
            tệp · {observed(artifact?.checks?.cancellation_warning_present)}
          </p>
          {trial.report_artifact && <p>SHA-256 {trial.report_artifact.sha256}</p>}
          <p>Cảnh báo trong lời đáp · {observed(trial.phase6_response?.warning_present)}</p>
        </li>
      </ol>
    </details>
  );
}
