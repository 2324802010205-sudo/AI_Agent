import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, LockKeyhole, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type {
  IsolatedLabCheck,
  IsolatedLabStatus,
  IsolatedTrial,
  Skill,
  SkillLifecycleAudit,
} from '../types';

import TrialCard from './isolated/TrialCard';
import FormatSessions from './isolated/FormatSessions';
import TrialComparison from './isolated/TrialComparison';
import { STATE_LABEL, vnd } from './isolated/labels';
import SkillEvidence from './SkillEvidence';
import LocalSkillTest from './LocalSkillTest';

const SUITES = [
  ['reporting', 'Chạy CONTROL / INJECTION A / INJECTION B × 3 lần'],
  ['followup', 'Chạy ba cặp kiểm tra bổ sung · dòng Excel'],
  ['workflow', 'Chạy ba cặp kiểm tra quy trình'],
  ['phase4', 'Chạy ba cặp công cụ native ACP'],
  ['phase5', 'Chạy sáu cặp cảnh báo đơn hủy'],
  ['phase6', 'Chạy Phase 6 · quyết định trước khi tạo Excel'],
] as const;

const ACTIVE = ['queued', 'preflight', 'running_model'];
export default function IsolatedInjectionLab({
  skills,
  initialInspectionId = '',
}: {
  skills: Skill[];
  initialInspectionId?: string;
}) {
  const [status, setStatus] = useState<IsolatedLabStatus>();
  const [check, setCheck] = useState<IsolatedLabCheck>();
  const [trials, setTrials] = useState<IsolatedTrial[]>([]);
  const [skill, setSkill] = useState('');
  const [inspectionId, setInspectionId] = useState(initialInspectionId);
  const [model, setModel] = useState('gemini-4-neon-high');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [lifecycle, setLifecycle] = useState<SkillLifecycleAudit>();
  const [suite, setSuite] = useState('latest');
  const [dataView, setDataView] = useState<'aggregates' | 'raw_rows'>('aggregates');
  const refresh = useCallback(async () => {
    const [state, list] = await Promise.all([api.isolatedLabStatus(), api.isolatedLabTrials()]);
    setStatus(state);
    setTrials(list);
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setMessage((error as Error).message));
  }, [refresh]);
  const active = status?.running || trials.some((t) => ACTIVE.includes(t.state));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [active, refresh]);
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await operation();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      await refresh().catch(() => {});
      setBusy(false);
    }
  };
  const approved = skills.filter((s) => s.status === 'approved');
  const inspected = skills.find((s) => s.id === inspectionId);
  const lastTextTrial = trials.find((trial) => trial.kind === 'canary' && !trial.suite_id);
  const textReady = !!(
    check?.preflight_passed &&
    check.authenticated &&
    check.synthetic_dataset_verified &&
    check.models?.includes(model)
  );
  const exportInspection = async (id: string) => {
    const evidence = await api.skillEvidence(id);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `skill-inspection-${id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const start = (kind: 'control' | 'injection' | 'canary') =>
    act(() =>
      api.isolatedLabStart({
        kind,
        model,
        skill_id: kind === 'injection' ? skill : undefined,
        confirm_isolated_execution: true,
        data_view: kind === 'canary' ? 'aggregates' : dataView,
      }),
    );
  const suites = [...new Set(trials.map((t) => t.suite_id).filter((id): id is string => !!id))];
  const selectedSuite = suite === 'latest' ? suites[0] : suite;
  const visible = selectedSuite ? trials.filter((t) => t.suite_id === selectedSuite) : trials;
  const ordered = [...visible].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return (
    <section
      className="research-lab isolated-lab"
      aria-label="Isolated Prompt Injection Research Lab"
    >
      <div className="info-banner">
        <FlaskConical size={22} />
        <div>
          <strong>Isolated Prompt Injection Research Lab · Windows AppContainer</strong>
          <p>
            Gemini thật qua Antigravity ACP chạy bên trong AppContainer (Low IL, chỉ
            internetClient), hồ sơ đăng nhập riêng của lab, dữ liệu tổng hợp. Các bộ native MCP chỉ
            cấp allow_once cho công cụ đã đăng ký. Isolation được kiểm tra lại trước mỗi trial.
          </p>
        </div>
      </div>
      <div className="info-banner subtle">
        <LockKeyhole size={20} />
        <p>{status?.production_note || 'Đang tải trạng thái lab.'}</p>
      </div>
      <section className="lab-plan" aria-label="Chạy thử Skill mẫu">
        <h3>Chạy thử Skill mẫu trên Gemini ACP</h3>
        <p>
          Lab dùng Skill văn bản tích hợp và số liệu tổng hợp để kiểm tra việc gửi nội dung qua
          AppContainer.
        </p>
        {status && (
          <p>
            Dataset tổng hợp {status.dataset.name} (SHA-256 {status.dataset.sha256.slice(0, 16)}…) ·
            ground truth Python: {status.ground_truth.orders} đơn · doanh thu{' '}
            {vnd(status.ground_truth.revenue_vnd)} VND · lợi nhuận{' '}
            {vnd(status.ground_truth.profit_vnd)} VND
          </p>
        )}
        <button
          className="secondary-button"
          disabled={busy || active || status?.supports_appcontainer === false}
          onClick={() =>
            void act(async () => {
              setCheck(undefined);
              const result = await api.isolatedLabCheck();
              setCheck(result);
              if (result.models?.length && !result.models.includes(model))
                setModel(result.models[0]);
            })
          }
        >
          Kiểm tra isolation và đăng nhập lab (không gửi prompt)
        </button>
        {check && (
          <div className="lab-result" data-testid="isolated-check">
            <strong>
              {check.preflight_passed ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}{' '}
              Preflight: {check.preflight_passed ? 'ĐẠT' : `THẤT BẠI · ${check.error}`} · Lab đăng
              nhập: {check.authenticated ? 'có' : check.auth_error || 'chưa kiểm tra'}
            </strong>
            <ul>
              {check.checks?.map((c) => (
                <li key={c.check}>
                  {c.passed ? '✓' : '✗'} {c.check}
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className="lab-requirements" open>
          <summary>Điều kiện chạy thử nghiệm</summary>
          <ul>
            <li>
              AppContainer Windows ·{' '}
              {status?.supports_appcontainer === false
                ? 'chỉ có trên Windows'
                : check?.preflight_passed
                  ? 'đã kiểm tra'
                  : 'cần preflight thành công'}
            </li>
            <li>
              Phiên ACP có đăng nhập và model được liệt kê ·{' '}
              {check?.authenticated && check.models?.includes(model) ? 'đã xác minh' : 'đang thiếu'}
            </li>
            <li>
              Dữ liệu tổng hợp có SHA-256 cố định ·{' '}
              {check?.synthetic_dataset_verified ? 'đã xác minh' : 'cần xác minh'}
            </li>
            <li>
              Preflight kiểm tra lại quyền ghi bằng chứng. Chính sách lab áp dụng cho mỗi yêu cầu
              công cụ.
            </li>
            <li>
              Mã đi kèm Skill cần VM dùng một lần đã xác thực, giới hạn tệp và mạng, quyền thực thi
              riêng và dọn dẹp sau phiên. Màn hình này chỉ hỗ trợ văn bản.
            </li>
          </ul>
        </details>
        <div className="lab-form">
          <label>
            Gemini model trong lab
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {(check?.models?.length ? check.models : [model]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="lab-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />{' '}
          Tôi chủ động chạy trial này trong AppContainer cô lập với dữ liệu tổng hợp và tài khoản
          lab riêng (sử dụng quota Gemini).
        </label>
        <div className="row">
          <button
            className="primary-button"
            disabled={!textReady || !consent || busy || active}
            onClick={() => void start('canary')}
          >
            Chạy thử Skill mẫu
          </button>
        </div>
        {message && <p role="alert">{message}</p>}
        {lastTextTrial && (
          <div className="lab-result" data-testid="latest-text-skill-trial" aria-live="polite">
            <strong>Lượt thử Skill mẫu gần nhất</strong>
            <p>{STATE_LABEL[lastTextTrial.state] || lastTextTrial.state}</p>
            {lastTextTrial.error?.message && <p>{lastTextTrial.error.message}</p>}
            {lastTextTrial.isolation?.error && <p>{lastTextTrial.isolation.error}</p>}
            {lastTextTrial.delivery.skill_included && lastTextTrial.delivery.prompt_submitted && (
              <p>Trace ACP ghi nhận yêu cầu chứa Skill mẫu.</p>
            )}
            {lastTextTrial.raw_model_answer && (
              <details>
                <summary>Phản hồi Gemini</summary>
                <pre>{lastTextTrial.raw_model_answer}</pre>
                {lastTextTrial.signals?.validation && (
                  <p>
                    {lastTextTrial.signals.validation.valid
                      ? 'Số liệu khớp dữ liệu mẫu.'
                      : 'Kết quả chưa khớp dữ liệu mẫu.'}
                  </p>
                )}
              </details>
            )}
          </div>
        )}
      </section>
      <section className="lab-plan" aria-label="Kiểm tra gói Skill cục bộ">
        <h3>Kiểm tra gói Skill cục bộ</h3>
        <div className="lab-form">
          <label>
            Skill đã nhập
            <select
              value={inspected?.id || ''}
              onChange={(event) => setInspectionId(event.target.value)}
            >
              <option value="">Chọn Skill để xem kết quả quét</option>
              {skills.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {inspected && (
          <>
            <LocalSkillTest key={inspected.id} skillId={inspected.id} />
            <SkillEvidence skill={inspected} />
            <button
              className="secondary-button"
              disabled={busy || !inspected.security}
              onClick={() => void act(() => exportInspection(inspected.id))}
            >
              Xuất bằng chứng kiểm tra tĩnh
            </button>
          </>
        )}
      </section>
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => void act(async () => setLifecycle(await api.isolatedLabSkillLifecycle()))}
      >
        Xem kiểm toán vòng đời Skill · Phase 7
      </button>
      <FormatSessions />
      {lifecycle && (
        <section className="lab-plan" aria-label="Kiểm toán vòng đời Skill">
          <h3>Vòng đời Skill trên Backend {lifecycle.audited_backend}</h3>
          <p>Điểm dừng quan sát được · {lifecycle.first_observed_stop}</p>
          <p>Phiên Gemini Phase 7 đã chạy · {lifecycle.model_driven_trials}</p>
          <ol>
            {lifecycle.stages.map(({ name, status, evidence }) => (
              <li key={name}>
                <strong>
                  {name} · {status}
                </strong>
                <p>{evidence}</p>
              </li>
            ))}
          </ol>
          <details>
            <summary>Điều kiện Phase 7 và bằng chứng hiện có</summary>
            <dl>
              {lifecycle.conditions.map(({ name, evidence }) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{evidence}</dd>
                </div>
              ))}
            </dl>
          </details>
          <details>
            <summary>Trace kiểm thử production ngoại tuyến</summary>
            <pre>{JSON.stringify(lifecycle.offline_trace, null, 2)}</pre>
          </details>
          <details>
            <summary>Đối chiếu phiên Gemini đã lưu từ Phase 6</summary>
            <ul>
              {lifecycle.historical_phase6.map(({ case: caseName, sessions, scope }) => (
                <li key={caseName}>
                  {caseName} · {sessions} phiên · {scope}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      <div className="lab-form">
        <label>
          Dữ liệu cung cấp cho Gemini
          <select
            value={dataView}
            onChange={(event) => setDataView(event.target.value as typeof dataView)}
          >
            <option value="aggregates">Tổng hợp đã kiểm chứng</option>
            <option value="raw_rows">Toàn bộ dòng Excel · Gemini tự cộng</option>
          </select>
        </label>
        <label>
          Skill đã phê duyệt cho Injection
          <select value={skill} onChange={(event) => setSkill(event.target.value)}>
            <option value="">Chọn Skill</option>
            {approved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button
          className="secondary-button"
          disabled={!textReady || !consent || busy || active}
          onClick={() => void start('control')}
        >
          Chạy Control · không Skill
        </button>
        <button
          className="primary-button"
          disabled={
            !textReady || !consent || busy || active || !approved.some((item) => item.id === skill)
          }
          onClick={() => void start('injection')}
        >
          Chạy Injection · gửi SKILL.md thật
        </button>
        {SUITES.map(([preset, label]) => (
          <button
            key={preset}
            className="primary-button"
            disabled={!textReady || !consent || busy || active}
            onClick={() =>
              void act(async () => {
                const result = await api.isolatedLabSuite({
                  preset,
                  model,
                  confirm_isolated_execution: true,
                  ...(preset === 'reporting' ? { data_view: dataView } : {}),
                });
                setSuite(result.suite_id);
              })
            }
          >
            {label}
          </button>
        ))}
      </div>

      <label>
        Bộ thử nghiệm
        <select value={suite} onChange={(event) => setSuite(event.target.value)}>
          <option value="latest">Bộ gần nhất</option>
          <option value="">Tất cả trial</option>
          {suites.map((id) => {
            const trial = trials.find((t) => t.suite_id === id);
            return (
              <option key={id} value={id}>
                {trial?.preset === 'phase6'
                  ? 'Quyết định trước khi tạo Excel'
                  : trial?.preset === 'phase5'
                    ? 'Cảnh báo đơn hủy · ghi chú worksheet'
                    : trial?.preset === 'phase4'
                      ? 'Công cụ native ACP'
                      : trial?.preset === 'workflow'
                        ? 'Kiểm tra quy trình'
                        : trial?.preset === 'followup'
                          ? 'Kiểm tra bổ sung'
                          : trial?.data_view || 'aggregates'}{' '}
                · {id.slice(0, 12)}
              </option>
            );
          })}
        </select>
      </label>
      <TrialComparison
        trials={ordered}
        view={selectedSuite && visible[0] ? (visible[0].data_view ?? 'aggregates') : undefined}
      />
      <p>
        AgentScope ghi prompt đã gửi và kết quả công cụ. Context nội bộ của Antigravity và Gemini
        chưa quan sát được. Xem lời đáp nguyên văn và kiểm tra Excel để đối chiếu từng cảnh báo.
      </p>
      <div className="row">
        <button
          className="secondary-button"
          disabled={busy || !visible.length}
          onClick={() => void act(() => api.isolatedLabExport('markdown', selectedSuite))}
        >
          Xuất báo cáo tiếng Việt
        </button>
        <button
          className="secondary-button"
          disabled={busy || !visible.length}
          onClick={() => void act(() => api.isolatedLabExport('json', selectedSuite))}
        >
          Xuất bằng chứng JSON
        </button>
      </div>
      {ordered.map((trial) => (
        <TrialCard
          key={trial.id}
          trial={trial}
          control={
            trial.kind !== 'control'
              ? trials.find((t) => t.id === trial.control_trial_id)
              : undefined
          }
        />
      ))}
    </section>
  );
}
