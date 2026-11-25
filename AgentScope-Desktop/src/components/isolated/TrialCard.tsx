import { useState } from 'react';
import { api } from '../../api';
import type { IsolatedTrial } from '../../types';
import DecisionFirst from './DecisionFirst';
import {
  FOLLOWUP_CASES,
  STATE_LABEL,
  VERDICT_LABEL,
  conditionLabel,
  WORKFLOW_STATUS,
  vnd,
  observed,
  decisionConfig,
} from './labels';

export default function TrialCard({
  trial,
  control,
}: {
  trial: IsolatedTrial;
  control?: IsolatedTrial;
}) {
  const agentic = trial.agentic;
  const workflow = trial.boundary_assessment?.workflow;
  const token = trial.turn?.container_token;
  const guidance = trial.observed_tool_results?.[0]?.guidance_cell;
  const cancellations = trial.phase5;
  const [downloadError, setDownloadError] = useState('');
  return (
    <article className="lab-plan isolated-trial" data-testid={`isolated-trial-${trial.kind}`}>
      <div className="section-row">
        <strong>
          {trial.case
            ? `${FOLLOWUP_CASES[trial.case]} · ${trial.kind.toUpperCase()}`
            : conditionLabel(trial)}{' '}
          {trial.skill ? `· ${trial.skill.name}` : ''}
          {trial.replicate ? ` · Lần ${trial.replicate}` : ''}
          {decisionConfig(trial)}
        </strong>
        <span className="code-tag" data-state={trial.state}>
          {STATE_LABEL[trial.state] || trial.state}
        </span>
      </div>
      {trial.boundary_assessment ? (
        <p className="verdict" role="status">
          <strong>
            {trial.boundary_assessment.outcome || trial.boundary_assessment.classification}
          </strong>{' '}
          · {trial.boundary_assessment.reason}
        </p>
      ) : (
        trial.assessment && (
          <p className={`verdict verdict-${trial.assessment.verdict}`} role="status">
            <strong>{VERDICT_LABEL[trial.assessment.verdict]}</strong> · {trial.assessment.reason}
          </p>
        )
      )}
      <small>
        Model {trial.turn?.model || trial.model} · Session {trial.turn?.session_id || '—'} · ACP
        mode {trial.turn?.mode?.current_mode_id || '—'} · {trial.turn?.cli_agent?.name}{' '}
        {trial.turn?.cli_agent?.version}
      </small>
      <p>
        Skill trong prompt đã soạn:{' '}
        <strong>{trial.delivery.skill_included ? 'CÓ' : 'KHÔNG'}</strong>
        {trial.delivery.skill_included && (
          <>
            {' '}
            · SKILL.md SHA-256 {trial.delivery.skill_md_sha256?.slice(0, 16)}… ·{' '}
            {trial.delivery.skill_chars} ký tự ·{' '}
            {trial.delivery.skill_text_verbatim ? 'nguyên văn' : 'đã trung hòa thẻ fence'} ·{' '}
            {trial.delivery.context}
          </>
        )}
      </p>
      {trial.delivery.skill_included && (
        <p>
          ACP nhận lượt chứa Skill ·{' '}
          {trial.delivery.prompt_completed
            ? 'đã hoàn tất'
            : trial.turn?.prompt_submitted_at
              ? 'đã gửi từ client'
              : 'chưa xác minh'}
        </p>
      )}
      {guidance && (
        <details>
          <summary>
            {guidance.sheet}!{guidance.cell} ·{' '}
            {trial.delivery.prompt_completed && trial.delivery.guidance_cell_included
              ? 'đã gửi qua ACP'
              : 'chưa xác minh gửi ACP'}
          </summary>
          <pre>{guidance.text}</pre>
        </details>
      )}
      {trial.isolation && (
        <p>
          Isolation:{' '}
          {trial.isolation.passed
            ? `${trial.isolation.checks.length}/${trial.isolation.checks.length} kiểm tra đạt`
            : `THẤT BẠI · ${trial.isolation.error}`}
          {token &&
            ` · token AppContainer=${token.token_is_appcontainer} · IL ${token.token_integrity_sid} · capabilities ${token.token_capabilities.join(', ')} · PID ${token.pid}`}
        </p>
      )}
      {!!trial.turn?.followups?.length && (
        <p>
          CLI kết thúc lượt sau khi yêu cầu công cụ bị từ chối; đã gửi {trial.turn.followups.length}{' '}
          lời nhắc cố định (giống nhau cho Control và Injection): &quot;
          {trial.turn.followups[0].text}&quot;
        </p>
      )}
      {trial.raw_model_answer != null && (
        <>
          <p>
            Ground truth · {trial.ground_truth.orders} đơn · {vnd(trial.ground_truth.revenue_vnd)}{' '}
            VND doanh thu · {vnd(trial.ground_truth.profit_vnd)} VND lợi nhuận
            {trial.ground_truth.cancelled_orders !== undefined &&
              ` · ${trial.ground_truth.cancelled_orders} đơn hủy · ngưỡng cảnh báo > 8`}
          </p>
          <div className="lab-comparison">
            {control && (
              <div>
                <h4>Control nguyên văn · cùng lần lặp</h4>
                <pre>{control.raw_model_answer ?? 'Control đang chờ kết quả'}</pre>
              </div>
            )}
            <div>
              <h4>Phản hồi Gemini nguyên văn</h4>
              {trial.preset === 'phase6' && trial.raw_model_answer === '' && (
                <p>ACP không trả phần văn bản cuối.</p>
              )}
              <pre>{trial.raw_model_answer}</pre>
            </div>
          </div>
        </>
      )}
      {trial.signals && (
        <ul className="lab-signals">
          <li>
            So với ground truth: {trial.signals.validation.classification} (
            {trial.signals.validation_basis})
          </li>
          {trial.signals.strict_validation && (
            <li>Validator JSON strict · {trial.signals.strict_validation.classification}</li>
          )}
          <li>
            Dấu hiệu payload lặp lại: {trial.signals.payload_markers_echoed.join(', ') || 'không'}
          </li>
          <li>
            Giá trị payload được báo cáo:{' '}
            {trial.signals.payload_values_reported.map(vnd).join(', ') || 'không'}
          </li>
          <li>
            Truy cập ngoài workspace được thử:{' '}
            {trial.outside_access_attempts?.length
              ? trial.outside_access_attempts.map((a) => `${a.path} (${a.status})`).join('; ')
              : 'không quan sát thấy'}
          </li>
        </ul>
      )}
      {trial.error && <p role="alert">{trial.error.message}</p>}
      {trial.preset === 'phase6' && <DecisionFirst trial={trial} control={control} />}
      {trial.preset === 'phase5' && (
        <details open>
          <summary>Đánh giá cảnh báo đơn hủy · ghi chú worksheet</summary>
          <ul>
            <li>Ghi chú đến qua MCP · {observed(trial.delivery.record_notes_included)}</li>
            <li>
              Câu cảnh báo trong lời đáp · {observed(cancellations?.warning_present)} · cờ JSON ·{' '}
              {observed(cancellations?.warning_flag)}
            </li>
            <li>
              Ứng viên phát biểu bỏ cảnh báo ·{' '}
              {cancellations?.no_warning_claim_candidates?.length ?? '—'}
            </li>
            <li>
              Đề xuất MCP đặt cờ cảnh báo sai ·{' '}
              {cancellations?.incorrect_warning_proposals?.length ?? '—'}
            </li>
            <li>
              Cảnh báo trong Excel ·{' '}
              {observed(agentic?.artifact_validation?.checks?.cancellation_warning_present)}
            </li>
            <li>
              Tổng tài chính khớp · lời đáp {observed(cancellations?.financial_totals_correct)} ·
              Excel {observed(agentic?.artifact_validation?.checks?.totals_match_ground_truth)}
            </li>
            {trial.kind !== 'control' && (
              <li>
                Control ghép cặp báo đúng ·{' '}
                {observed(trial.boundary_assessment?.paired_control_warning_correct)}
              </li>
            )}
          </ul>
          {cancellations?.no_warning_claim_candidates?.map((line, index) => (
            <pre key={index}>{line}</pre>
          ))}
          {!!cancellations?.explicit_note_rejections?.length && (
            <details>
              <summary>Lời đáp bác bỏ nội dung ghi chú</summary>
              {cancellations.explicit_note_rejections.map((line, index) => (
                <pre key={index}>{line}</pre>
              ))}
            </details>
          )}
        </details>
      )}
      {agentic && (
        <details open>
          <summary>Quy trình công cụ native ACP / MCP</summary>
          <p>{agentic.task}</p>
          <p>
            Yêu cầu ACP ·{' '}
            {trial.delivery.prompt_completed ? 'đã hoàn tất' : 'chưa xác nhận hoàn tất'}
          </p>
          {agentic.worksheet_note && (
            <details>
              <summary>
                Giá trị công cụ đọc từ {agentic.worksheet_note.sheet}!{agentic.worksheet_note.cell}
              </summary>
              <pre>{agentic.worksheet_note.untrusted_text}</pre>
            </details>
          )}
          {agentic.record_notes?.map((note) => (
            <details key={`${note.sheet}!${note.cell}`}>
              <summary>
                Ghi chú chưa tin cậy · {note.sheet}!{note.cell} · {note.record_id}
              </summary>
              <pre>{note.text}</pre>
            </details>
          ))}
          <div className="boundary-comparison">
            <table>
              <thead>
                <tr>
                  <th>Đề xuất và tham số</th>
                  <th>Quyết định MCP</th>
                  <th>Thực thi MCP</th>
                </tr>
              </thead>
              <tbody>
                {agentic.events
                  ?.filter((event) => event.event === 'proposal')
                  .map((proposal) => {
                    const decision = agentic.events?.find(
                      (event) => event.sequence === proposal.sequence && event.event === 'decision',
                    );
                    const executed = agentic.events?.some(
                      (event) => event.sequence === proposal.sequence && event.event === 'executed',
                    );
                    return (
                      <tr key={proposal.sequence}>
                        <td>
                          <strong>{proposal.tool}</strong>
                          <pre>{JSON.stringify(proposal.arguments, null, 2)}</pre>
                        </td>
                        <td>
                          {decision
                            ? decision.allowed
                              ? 'Cho phép'
                              : `Từ chối · ${decision.reason}`
                            : 'Chưa có'}
                        </td>
                        <td>{executed ? 'Đã thực thi' : 'Chưa ghi nhận thực thi'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p>
            Đối chiếu cập nhật công cụ ACP ·{' '}
            {agentic.executions_corroborated_by_acp ? 'Khớp' : 'Chưa xác nhận'}
          </p>
          <p>
            Excel cuối ·{' '}
            {agentic.artifact_validation
              ? agentic.artifact_validation.valid && agentic.artifact_validation.matches_mcp_output
                ? 'Đạt kiểm tra độc lập và khớp hash MCP'
                : 'Có sai lệch khi đối chiếu'
              : 'Chưa có tệp đã kiểm tra'}
          </p>
        </details>
      )}
      {workflow && (
        <details open>
          <summary>Đối chiếu quy trình và đầu ra</summary>
          <ul>
            <li>Công cụ đề xuất · {WORKFLOW_STATUS[workflow.proposed_tools]}</li>
            <li>
              Cập nhật tool qua ACP · {workflow.acp_tool_update_count} · Yêu cầu quyền ·{' '}
              {workflow.acp_permission_request_count}
            </li>
            <li>
              Tập bản ghi, quy tắc và diễn giải đã khai báo ·{' '}
              {WORKFLOW_STATUS[workflow.intermediate]}
              {workflow.intermediate_deviations.length > 0
                ? ` · ${workflow.intermediate_deviations.map((c) => FOLLOWUP_CASES[c]).join(', ')}`
                : ''}
            </li>
            <li>Số liệu JSON cuối · {workflow.final_numbers}</li>
            <li>
              Kiểm tra độc lập tệp Excel ·{' '}
              {workflow.file_validation === null
                ? 'Chưa có'
                : workflow.file_validation
                  ? 'Đạt'
                  : 'Sai lệch'}
            </li>
          </ul>
          {workflow.business_finding && <p>Nhận xét của Gemini · {workflow.business_finding}</p>}
        </details>
      )}
      {trial.report_reference && (
        <div>
          <p>
            Báo cáo do công cụ tạo · {trial.report_reference.expected} ·{' '}
            {trial.report_reference.mentioned ? 'Gemini nêu tên tệp' : 'Gemini bỏ qua tên tệp'}
          </p>
          {!!trial.report_reference.unsupported_filenames.length && (
            <p role="status">
              Tên tệp thiếu bằng chứng · {trial.report_reference.unsupported_filenames.join(', ')}
            </p>
          )}
          {!!trial.report_reference.unsupported_report_paths?.length && (
            <p role="status">
              Đường dẫn thiếu bằng chứng ·{' '}
              {trial.report_reference.unsupported_report_paths.join(', ')}
            </p>
          )}
        </div>
      )}
      {trial.report_artifact && (
        <button
          className="secondary-button"
          onClick={() => {
            setDownloadError('');
            void api
              .isolatedLabReport(trial.id, trial.report_artifact!.name)
              .catch((error) => setDownloadError((error as Error).message));
          }}
        >
          Tải báo cáo Excel của công cụ Python
        </button>
      )}
      {downloadError && <p role="alert">{downloadError}</p>}
      <details>
        <summary>Bằng chứng bảo mật và thực thi</summary>
        <p>
          Trial {trial.id} · Workbook SHA-256 {trial.dataset_sha256 || '—'}
        </p>
        <p>Prompt SHA-256 {trial.turn?.prompt_sha256 || '—'}</p>
        <p>Phản hồi SHA-256 {trial.turn?.raw_answer_sha256 || '—'}</p>
        <p>SKILL.md SHA-256 {trial.skill?.sha256 || '—'}</p>
        <p>Cấu hình dữ liệu · {trial.data_view || 'aggregates'}</p>
        {trial.ground_truth_cross_check && (
          <p>
            Đối chiếu openpyxl và công cụ · {JSON.stringify(trial.ground_truth_cross_check)} ·
            Workbook giữ nguyên · {String(trial.dataset_integrity_after)}
          </p>
        )}
        <ul>
          {trial.security_events.map((event, index) => (
            <li key={index}>
              {event.type} · {event.enforced ? 'ENFORCED' : 'chỉ quan sát'}
              {typeof event.tool === 'string' ? ` · ${event.tool}` : ''}
            </li>
          ))}
          <li>
            Yêu cầu quyền CLI: {trial.permission_requests?.length ?? 0}
            {agentic?.delivered_permission_outcomes &&
              ` · ACP gửi allow_once: ${agentic.delivered_permission_outcomes.filter(({ outcome }) => outcome === 'allow').length}`}{' '}
            · Tool call quan sát: {trial.tool_calls?.length ?? 0} · Tiến trình trong job:{' '}
            {trial.processes?.filter((p) => p.event === 'process_joined').length ?? 0}
          </li>
          {trial.evidence_dir && <li>Thư mục bằng chứng: {trial.evidence_dir}</li>}
        </ul>
        {trial.exposed_context && (
          <details>
            <summary>Context gửi ACP nguyên văn</summary>
            <pre>{trial.exposed_context}</pre>
          </details>
        )}
        <details>
          <summary>Yêu cầu quyền và công cụ quan sát</summary>
          <pre>
            {JSON.stringify(
              {
                permissions: trial.permission_requests,
                deliveredPermissionOutcomes: agentic?.delivered_permission_outcomes,
                tools: trial.tool_calls,
              },
              null,
              2,
            )}
          </pre>
        </details>
        {!!trial.turn?.acp_exchanges?.length && (
          <details>
            <summary>Giao thức ACP đã ghi nhận</summary>
            <pre>{JSON.stringify(trial.turn.acp_exchanges, null, 2)}</pre>
          </details>
        )}
      </details>
    </article>
  );
}
