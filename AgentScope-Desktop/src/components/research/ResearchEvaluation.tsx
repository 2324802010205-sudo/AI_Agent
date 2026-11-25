import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api';
import type {
  EvidenceImport,
  EvidenceKind,
  EvaluationSnapshot,
  FunctionalCampaign,
  WorkbookVariant,
} from '../../types/research';
import { EvaluationTable } from './EvaluationOverview';

const active = new Set(['planned', 'running', 'cancelling']);
const states: Record<string, string> = {
  planned: 'Đã lên kế hoạch',
  running: 'Đang chạy',
  cancelling: 'Đang hủy',
  finished: 'Đã kết thúc',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  interrupted: 'Gián đoạn',
  timed_out: 'Hết hạn',
  report_failed: 'XLSX chưa xác minh',
  incomplete: 'Chưa hoàn tất',
  failed: 'Lỗi',
  blocked_isolation: 'AppContainer chặn',
  model_filter_blocked: 'Gemini chặn',
};
const caseLabel = (condition: string) => (condition === 'baseline' ? 'Không Skill' : 'Skill sạch');
const sourceLabel = (source: EvidenceKind) =>
  source === 'historical_acp' ? 'ACP lưu trữ · nguồn do người nhập khai báo' : 'Dữ liệu giả lập';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="lab-plan evaluation-overview research-evaluation"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      {open && children}
    </details>
  );
}

function Downloads({
  save,
  onError,
}: {
  save: (format: 'csv' | 'md') => Promise<void>;
  onError: (message: string) => void;
}) {
  const run = async (format: 'csv' | 'md') => {
    onError('');
    try {
      await save(format);
    } catch (error) {
      onError((error as Error).message);
    }
  };
  return (
    <div className="row">
      <button className="secondary-button" onClick={() => void run('csv')}>
        Tải CSV
      </button>
      <button className="secondary-button" onClick={() => void run('md')}>
        Tải Markdown
      </button>
    </div>
  );
}

function Receipts({ actions }: { actions: Record<string, unknown>[] }) {
  return (
    <details className="experiment-details">
      <summary>Biên nhận công cụ · {actions.length} sự kiện</summary>
      {actions.length ? (
        <pre>{JSON.stringify(actions, null, 2)}</pre>
      ) : (
        <p>Chưa ghi nhận biên nhận.</p>
      )}
    </details>
  );
}

function FunctionalRunner({ onOpen }: { onOpen: (conversation: string) => void }) {
  const [history, setHistory] = useState<FunctionalCampaign[]>([]);
  const [selected, setSelected] = useState('');
  const [campaign, setCampaign] = useState<FunctionalCampaign>();
  const [variant, setVariant] = useState<WorkbookVariant>('original');
  const [repeat, setRepeat] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    api
      .functionalHistory()
      .then((items) => {
        if (current) {
          setHistory(items);
          setSelected(items[0]?.id ?? '');
        }
      })
      .catch((failure: Error) => {
        if (current) setError(failure.message);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await api.functionalResult(selected);
        if (!current) return;
        setCampaign(latest);
        setHistory((items) => [latest, ...items.filter((item) => item.id !== latest.id)]);
        if (active.has(latest.state)) timer = setTimeout(poll, 900);
      } catch (failure) {
        if (current) setError((failure as Error).message);
      }
    };
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [selected]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const started = await api.startFunctional(variant, repeat);
      setConfirm(false);
      setCampaign(started);
      setSelected(started.id);
      setHistory((items) => [started, ...items]);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setError('');
    try {
      setCampaign(await api.cancelFunctional(selected));
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const current = campaign?.id === selected ? campaign : undefined;
  const running = history.some((item) => active.has(item.state));

  return (
    <>
      <p>
        Gemini ACP thật · AppContainer ON. Mỗi lần lặp chạy hai phiên riêng với cùng workbook mẫu,
        gồm không Skill và Skill sạch.
      </p>
      <div className="form-grid">
        <label>
          Workbook mẫu
          <select
            value={variant}
            onChange={(event) => setVariant(event.target.value as WorkbookVariant)}
          >
            <option value="original">Bán hàng tổng hợp</option>
            <option value="reversed_rows">Bán hàng tổng hợp · đảo thứ tự dòng</option>
          </select>
        </label>
        <label>
          Số lần lặp mỗi điều kiện
          <select value={repeat} onChange={(event) => setRepeat(Number(event.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="research-confirm">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(event) => setConfirm(event.target.checked)}
        />
        Tôi đồng ý dùng {repeat * 2} lượt Gemini để xử lý dữ liệu tổng hợp.
      </label>
      <button
        className="primary-button"
        disabled={!confirm || busy || running}
        onClick={() => void start()}
      >
        Bắt đầu đối chứng
      </button>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {history.length > 0 && (
        <label>
          Đợt đối chứng
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id.slice(0, 8)} · {new Date(item.created_at).toLocaleString('vi-VN')}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && (
        <>
          <div className="row">
            <strong role="status">
              {states[current.state] || current.state} ·{' '}
              {current.runs.filter((run) => !active.has(run.state)).length}/{current.runs.length}{' '}
              lượt
            </strong>
            {active.has(current.state) && (
              <button
                className="secondary-button"
                disabled={current.state === 'cancelling'}
                onClick={() => void cancel()}
              >
                Hủy đợt đối chứng
              </button>
            )}
          </div>
          <p>
            {current.model} · Temperature {current.temperature ?? 'chưa ghi nhận'} ·{' '}
            {current.timeout_seconds} giây/lượt
          </p>
          <Downloads
            save={(format) => api.functionalExport(current.id, format)}
            onError={setError}
          />
          {current.runs.map((run) => (
            <div className="experiment-row" key={run.id}>
              <div>
                <strong>
                  {caseLabel(run.condition)} · Lần {run.repetition}
                </strong>
                <small>
                  {states[run.state] || run.state} · {run.id.slice(0, 8)}
                  {run.duration_ms !== undefined &&
                    ` · ${(run.duration_ms / 1000).toFixed(1)} giây`}
                  {run.verified_report && ' · XLSX đã xác minh'}
                </small>
                {run.error ? (
                  <small>
                    {typeof run.error === 'string' ? run.error : JSON.stringify(run.error)}
                  </small>
                ) : null}
                {run.actions && <Receipts actions={run.actions} />}
              </div>
              <div className="row">
                {run.conversation_id && (
                  <button className="secondary-button" onClick={() => onOpen(run.conversation_id!)}>
                    Mở lượt
                  </button>
                )}
                {run.verified_report && run.experiment_id && (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void api
                        .experimentReport(
                          run.experiment_id!,
                          run.condition,
                          `bao-cao-${run.id.slice(0, 8)}.xlsx`,
                        )
                        .catch((failure: Error) => setError(failure.message))
                    }
                  >
                    XLSX
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function EvidenceReader() {
  const [history, setHistory] = useState<EvidenceImport[]>([]);
  const [source, setSource] = useState<EvidenceKind | ''>('');
  const [file, setFile] = useState<File>();
  const [data, setData] = useState<EvidenceImport & EvaluationSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api
      .evidenceImports()
      .then(setHistory)
      .catch((failure: Error) => setError(failure.message));
  }, []);
  const read = async (identifier: string) => {
    setError('');
    setData(undefined);
    if (!identifier) return;
    setBusy(true);
    try {
      setData(await api.importedEvidence(identifier));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!file || !source) return;
    setBusy(true);
    setError('');
    try {
      const imported = await api.importEvidence(file, source);
      setHistory((items) => [imported, ...items.filter((item) => item.id !== imported.id)]);
      await read(imported.id);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        Nhập ZIP xuất từ một thí nghiệm AgentScope. Bản gốc lưu theo SHA-256. Nguồn do người nhập
        khai báo.
      </p>
      <div className="form-grid">
        <label>
          Loại bằng chứng
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as EvidenceKind | '')}
          >
            <option value="">Chọn nguồn</option>
            <option value="historical_acp">ACP lưu trữ</option>
            <option value="synthetic">Giả lập</option>
          </select>
        </label>
        <label>
          ZIP bằng chứng
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
        </label>
      </div>
      <button
        className="primary-button"
        disabled={!file || !source || busy}
        onClick={() => void save()}
      >
        Nhập chỉ đọc
      </button>
      {history.length > 0 && (
        <label>
          Hồ sơ đã nhập
          <select
            disabled={busy}
            value={data?.id || ''}
            onChange={(event) => void read(event.target.value)}
          >
            <option value="">Chọn hồ sơ</option>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {sourceLabel(item.evidence_type)} · {item.id.slice(0, 12)}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <strong>{sourceLabel(data.evidence_type)}</strong>
          <Downloads
            save={(format) => api.importedEvidenceExport(data.id, format)}
            onError={setError}
          />
          <EvaluationTable snapshot={data} />
          {data.runs.map((run, index) => (
            <div className="experiment-row" key={`${run.run_id}-${index}`}>
              <div>
                <strong>
                  {run.condition} · {states[run.outcome] || run.outcome}
                </strong>
                <small>
                  Skill{' '}
                  {run.skill_exposure === true
                    ? 'đã tới mô hình'
                    : run.skill_exposure === false
                      ? 'bị chặn trước khi gửi'
                      : 'chưa có số đo tiếp nhận'}{' '}
                  · Lớp chặn {run.blocking_layers?.join(', ') || 'chưa ghi nhận'}
                </small>
                <Receipts actions={run.actions || []} />
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function OfflineChecks() {
  const [checks, setChecks] = useState<{ label: string; passed: boolean }[]>();
  const [error, setError] = useState('');
  const run = () => {
    setError('');
    void api
      .offlineChecks()
      .then((result) => setChecks(result.checks))
      .catch((failure: Error) => setError(failure.message));
  };
  return (
    <>
      <p>Dữ liệu giả lập · kiểm tra tĩnh và quyết định cấp quyền offline.</p>
      <button className="secondary-button" onClick={run}>
        Chạy kiểm tra offline
      </button>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {checks && (
        <ul>
          {checks.map((check) => (
            <li key={check.label}>
              {check.passed ? 'Đạt' : 'Lỗi'} · {check.label}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ResearchEvaluation({ onOpen }: { onOpen: (conversation: string) => void }) {
  return (
    <>
      <Section title="Đối chứng chức năng Gemini">
        <FunctionalRunner onOpen={onOpen} />
      </Section>
      <Section title="Bằng chứng nghiên cứu đã nhập">
        <EvidenceReader />
      </Section>
      <Section title="Kiểm thử SkillGuard offline">
        <OfflineChecks />
      </Section>
    </>
  );
}
