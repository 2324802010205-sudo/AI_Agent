import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, FileSpreadsheet, LoaderCircle, Square } from 'lucide-react';
import { api } from '../../api';
import type { ConditionRecord, Experiment } from '../../types/research';
import {
  CATEGORY_TONE,
  CONDITION_LABELS,
  DECISION_LABELS,
  TOOL_LABELS,
  enforcer,
  money,
} from './labels';
import CopyValue from '../CopyValue';

const ACTIVE = new Set(['queued', 'running']);
const stages = {
  PROPOSED: 'Đã đề xuất',
  PROPOSED_NOT_EXECUTED: 'Đề xuất · chưa có biên nhận',
  AUTHORIZED: 'Đã cấp quyền',
  DISPATCHED: 'Đã chuyển tới công cụ',
  EXECUTED: 'Đã thực thi',
  BLOCKED: 'Đã chặn',
  EXECUTION_FAILED: 'Lỗi thực thi',
};
const conditionStatus: Record<string, string> = {
  queued: 'Đang chờ',
  running: 'Đang thực hiện',
  completed: 'Đã kết thúc',
  cancelled: 'Đã hủy',
  interrupted: 'Bị gián đoạn',
  blocked_isolation: 'Cách ly không đạt',
  failed: 'Thất bại',
  incomplete: 'Chưa hoàn tất',
};

function Metrics({ values }: { values: Record<string, number | null> }) {
  return (
    <dl className="experiment-metrics">
      {(
        [
          ['orders', 'Số đơn'],
          ['revenue', 'Doanh thu · VND'],
          ['profit', 'Lợi nhuận · VND'],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{values[key] != null ? money(values[key]) : '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function ConditionResult({
  experiment,
  record,
  onSelectRun,
}: {
  experiment: Experiment;
  record: ConditionRecord;
  onSelectRun?: (id: string) => void;
}) {
  const [evidence, setEvidence] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const assessment = record.assessment;
  const report = assessment?.report;
  const verified = report?.status === 'REPORT_VERIFIED';
  const legacyMatch = !!(report?.valid && !report.status);
  const status = assessment?.model_filter_blocked
    ? 'Bộ lọc Gemini'
    : conditionStatus[record.state] || record.state;
  const refusals = [
    ...(assessment?.unauthorized_proposals ?? []),
    ...(assessment?.integrity_blocks ?? []),
  ];
  const artifacts = [
    ...(assessment?.artifacts_created ?? []),
    ...(assessment?.unattributed_artifacts ?? []),
  ];
  const loadEvidence = async () => {
    setError('');
    setLoading(true);
    try {
      setEvidence(await api.experimentEvidence(experiment.id, record.condition));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="experiment-condition" aria-label={CONDITION_LABELS[record.condition]}>
      <header>
        <h4>{CONDITION_LABELS[record.condition]}</h4>
        <span className={`execution-status ${record.state}`}>{status}</span>
      </header>
      {assessment && (
        <p className={`experiment-verdict ${CATEGORY_TONE[assessment.category]}`}>
          {assessment.title}
        </p>
      )}
      {assessment?.code_execution_requests && assessment.code_execution_requests.length > 0 ? (
        <p className="probe-callout blocked">
          ⚠ Gemini đã bị tác động và đề xuất chạy mã Python ({assessment.code_execution_requests.length}{' '}
          lần) — đã chặn an toàn trước khi thực thi.
        </p>
      ) : (
        assessment?.skill_exposed_to_model &&
        assessment?.available_tools?.includes('run_python_code') && (
          <p className="probe-callout resisted">
            ✓ Đã mở công cụ Code Interpreter cho Gemini — Gemini tự bỏ qua yêu cầu chạy Python.
          </p>
        )
      )}
      {record.skillguard.removed_lines && record.skillguard.removed_lines.length > 0 && (
        <details className="experiment-details" open>
          <summary>
            <ChevronRight size={13} className="execution-chevron" /> SkillGuard ON đã lọc bỏ{' '}
            {record.skillguard.removed_lines.length} đoạn/dòng độc hại (vẫn gửi phần sạch tới Gemini)
          </summary>
          <ul>
            {record.skillguard.removed_lines.map((item, idx) => (
              <li key={`${item.skill_id ?? ''}-${item.line}-${idx}`}>
                {item.skill_name && <strong>{item.skill_name}</strong>}
                {item.skill_name ? ' · ' : ''}
                {item.end_line && item.end_line > item.line
                  ? `Dòng ${item.line}–${item.end_line}`
                  : `Dòng ${item.line}`}
                {item.label ? ` · ${item.label}` : ''}
                {item.excerpt && <pre>{item.excerpt}</pre>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(verified || legacyMatch) && report?.values && <Metrics values={report.values} />}
      {report?.created && (
        <p className={`report-verification ${verified || legacyMatch ? 'ok' : 'warn'}`}>
          {verified
            ? '✓ Đã đối chiếu dữ liệu gốc và biên nhận MCP'
            : legacyMatch
              ? '✓ Khớp dữ liệu gốc'
              : report.deviates_from_ground_truth
                ? 'Lệch dữ liệu gốc'
                : 'Báo cáo chưa qua xác minh'}
        </p>
      )}
      {(report?.created || onSelectRun) && (
        <div className="experiment-result-actions">
          {report?.created && (
            <button
              className="experiment-download"
              onClick={() => {
                setError('');
                void api
                  .experimentReport(
                    experiment.id,
                    record.condition,
                    record.report?.name || 'bao-cao.xlsx',
                  )
                  .catch((failure: Error) => setError(failure.message));
              }}
            >
              <Download size={13} /> Tải Excel
            </button>
          )}
          {onSelectRun && (
            <button className="experiment-link" onClick={() => onSelectRun(record.task_id)}>
              Xem diễn biến <ChevronRight size={13} />
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="experiment-error" role="status">
          {error}
        </p>
      )}
      <details className="experiment-details">
        <summary>
          <ChevronRight size={13} className="execution-chevron" /> Chi tiết điều kiện
        </summary>
        <dl className="experiment-definition">
          <dt>Chuyển Skill</dt>
          <dd>
            {assessment?.skill_exposure === 'unverified'
              ? 'Chưa xác minh mức tiếp nhận của Gemini'
              : DECISION_LABELS[record.skillguard.decision] || record.skillguard.decision}
          </dd>
          <dt>Biên nhận công cụ</dt>
          <dd>
            {assessment?.tool_calls?.length ? (
              <ul>
                {assessment.tool_calls.map((call, index) => (
                  <li key={index}>
                    {call.tool} · {stages[call.stage]}
                    {Object.keys(call.arguments).length > 0 && (
                      <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ul>
            ) : assessment?.tools_executed?.length ? (
              assessment.tools_executed.join(', ')
            ) : (
              'Chưa ghi nhận biên nhận thực thi'
            )}
          </dd>
          {refusals.length > 0 && (
            <>
              <dt>Can thiệp chính sách</dt>
              <dd>
                <ul>
                  {refusals.map((item, index) => (
                    <li key={index}>
                      {enforcer(item.enforced_by)} · {TOOL_LABELS[item.tool || ''] || item.tool} ·{' '}
                      {item.label}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {artifacts.length > 0 && (
            <>
              <dt>Tệp đầu ra</dt>
              <dd>
                <ul>
                  {artifacts.map((item) => (
                    <li key={item.name}>
                      {item.name} ·{' '}
                      {item.origin === 'mcp' ? 'Khớp biên nhận MCP' : 'Chưa xác định nguồn tạo'}
                      <CopyValue label={`SHA-256 ${item.name}`} value={item.sha256} />
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {record.session?.session_id && (
            <>
              <dt>Phiên Gemini</dt>
              <dd>
                <code>{record.session.session_id}</code>
                <CopyValue label="ID phiên Gemini" value={record.session.session_id} />
              </dd>
            </>
          )}
          {record.session?.container_sid && (
            <>
              <dt>AppContainer SID</dt>
              <dd>
                <code>{record.session.container_sid}</code>
                <CopyValue label="AppContainer SID" value={record.session.container_sid} />
              </dd>
            </>
          )}
          <dt>MCP policy</dt>
          <dd>{record.resolved.mcp_policy}</dd>
          <dt>Prompt SHA-256</dt>
          <dd>
            <code>{record.prompt_sha256}</code>
            <CopyValue label="prompt SHA-256" value={record.prompt_sha256} />
          </dd>
          {report?.failure && (
            <>
              <dt>Đối chiếu</dt>
              <dd>{report.failure}</dd>
            </>
          )}
        </dl>
        {report?.values && !verified && !legacyMatch && (
          <>
            <p>Số liệu trong tệp</p>
            <Metrics values={report.values} />
          </>
        )}
        {typeof record.validation?.sales_breakdowns_verified === 'boolean' && (
          <p className="muted">
            {record.validation.sales_breakdowns_verified
              ? 'Đã đối chiếu số đơn theo trạng thái và số liệu theo sản phẩm, khu vực.'
              : 'Chưa xác minh đủ số đơn theo trạng thái và số liệu theo sản phẩm, khu vực.'}
          </p>
        )}
        {evidence === undefined && (
          <button
            className="experiment-link"
            disabled={loading}
            onClick={() => void loadEvidence()}
          >
            {loading ? 'Đang tải…' : 'Mở bằng chứng ACP/MCP gốc'}
          </button>
        )}
        {evidence !== undefined && (
          <pre aria-label={`Bằng chứng ${record.condition}`} className="evidence-json">
            {JSON.stringify(evidence, null, 2)}
          </pre>
        )}
      </details>
    </section>
  );
}

export default function ExperimentCard({
  id,
  onFinished,
  onSelectRun,
  onProgress,
}: {
  id: string;
  onFinished?: () => void;
  onSelectRun?: (taskId: string) => void;
  onProgress?: (experiment: Experiment) => void;
}) {
  const [experiment, setExperiment] = useState<Experiment>();
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const callbacks = useRef({ onFinished, onProgress });
  callbacks.current = { onFinished, onProgress };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let wasActive = false;
    const load = async () => {
      try {
        const data = await api.experiment(id);
        if (disposed) return;
        setExperiment(data);
        callbacks.current.onProgress?.(data);
        const active = ACTIVE.has(data.state);
        if (wasActive && !active) callbacks.current.onFinished?.();
        wasActive = active;
        if (active) timer = setTimeout(load, 1500);
      } catch (failure) {
        if (!disposed) {
          setError((failure as Error).message);
          if (wasActive) timer = setTimeout(load, 3000);
        }
      }
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (!experiment)
    return (
      <p className="experiment-loading" role="status">
        {error || (
          <>
            <LoaderCircle size={14} className="spin" /> Đang tải kết quả…
          </>
        )}
      </p>
    );
  const running = ACTIVE.has(experiment.state);
  const values = experiment.ground_truth.variants?.all_recorded;
  const conclusion = experiment.comparison?.conclusions ?? [];
  return (
    <section className="experiment-card" aria-label="Kết quả thí nghiệm">
      <header className="experiment-header">
        <FileSpreadsheet size={20} />
        <div>
          <h3>{experiment.workbook.name}</h3>
          <p>
            {experiment.skills && experiment.skills.length > 1
              ? `${experiment.skills.length} Skills (${experiment.skill.name})`
              : experiment.skill.name}{' '}
            · {experiment.model}
          </p>
        </div>
        {running ? (
          <button
            className="experiment-link"
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true);
              try {
                await api.cancelExperiment(experiment.id);
              } catch (failure) {
                setError((failure as Error).message);
                setCancelling(false);
              }
            }}
          >
            <Square size={13} /> Hủy thí nghiệm
          </button>
        ) : (
          <button
            className="experiment-download"
            onClick={() =>
              void api
                .experimentExport(experiment.id)
                .catch((failure: Error) => setError(failure.message))
            }
          >
            <Download size={13} /> Xuất bằng chứng
          </button>
        )}
      </header>
      {error && (
        <p className="experiment-error" role="status">
          {error}
        </p>
      )}
      <div className="experiment-cases">
        {experiment.order.map((condition) => (
          <ConditionResult
            experiment={experiment}
            record={experiment.conditions[condition]}
            key={condition}
            onSelectRun={onSelectRun}
          />
        ))}
      </div>
      {conclusion.length > 0 && (
        <div className="experiment-conclusion">
          <h4>Kết luận</h4>
          <ul>
            {conclusion.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="experiment-details experiment-inputs">
        <summary>
          <ChevronRight size={13} className="execution-chevron" /> Đầu vào và dữ liệu đối chiếu
        </summary>
        <p>{experiment.task.text}</p>
        {experiment.ground_truth.available && values ? (
          <Metrics
            values={{ orders: values.orders, revenue: values.revenue, profit: values.profit }}
          />
        ) : (
          <p>{experiment.ground_truth.reason}</p>
        )}
        <p>
          {experiment.skill.package.assessment} · {experiment.skill.package.executable_files.length}{' '}
          tệp mã
        </p>
        {experiment.skills && experiment.skills.length > 1 && (
          <ul>
            {experiment.skills.map((item, idx) => (
              <li key={item.id}>
                Skill #{idx + 1}: <strong>{item.name}</strong>{' '}
                <code>
                  {item.id.slice(0, 8)} · {item.skill_md_sha256.slice(0, 12)}
                </code>
              </li>
            ))}
          </ul>
        )}
        {experiment.skill.attempts.length > 0 && (
          <ul>
            {experiment.skill.attempts.map((item) => (
              <li key={`${item.line}-${item.rule}`}>
                {item.label} · dòng {item.line}
                <pre>{item.excerpt}</pre>
              </li>
            ))}
          </ul>
        )}
        {experiment.comparison?.distinct_session_ids && (
          <p>Mỗi điều kiện một phiên Gemini riêng.</p>
        )}
        {experiment.comparison?.equivalent_inputs && <p>Các điều kiện dùng cùng đầu vào.</p>}
      </details>
    </section>
  );
}
