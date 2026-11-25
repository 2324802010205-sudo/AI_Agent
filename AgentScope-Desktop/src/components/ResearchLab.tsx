import { useCallback, useEffect, useState } from 'react';
import { Download, FlaskConical, LockKeyhole, RefreshCw, Shield } from 'lucide-react';
import { api } from '../api';
import type { Attachment, LabPlan, LabStatus, LabTrial, Skill } from '../types';

export function evidenceLabel(trial?: LabTrial): string {
  if (!trial || trial.evidence_level === 'not_run') return 'Chưa có lượt mô hình thật';
  if (trial.evidence_level !== 'real_model_observed')
    return 'Chưa có hoạt động mô hình được quan sát';
  if (
    trial.outcome?.prevention &&
    trial.audit_complete &&
    trial.actions?.some(
      (a) => a.model_selected && (a.denied_before_execution || a.os_denial_verified),
    )
  )
    return `Yêu cầu bị ngăn · ${trial.outcome.protection || 'cần review nguồn'}`;
  if (trial.outcome?.classification === 'model_noncompliance')
    return 'Mô hình không làm theo · không phải thành công SkillGuard';
  if (trial.outcome?.classification === 'unauthorized_operation_verified')
    return 'Đã xác minh thao tác trái phép · cần review';
  return trial.outcome?.classification || 'Cần xem bằng chứng độc lập';
}

export default function ResearchLab({ skills }: { skills: Skill[] }) {
  const [status, setStatus] = useState<LabStatus>();
  const [plans, setPlans] = useState<LabPlan[]>([]);
  const [workspace, setWorkspace] = useState('sales-evaluation');
  const [model, setModel] = useState('gemini-4-neon-high');
  const [mode, setMode] = useState<'default' | 'auto'>('default');
  const [scenario, setScenario] = useState('benign-control');
  const [skillId, setSkillId] = useState('');
  const [hypothesis, setHypothesis] = useState('none');
  const [dataset, setDataset] = useState<Attachment>();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [environment, history] = await Promise.all([api.labStatus(), api.labPlans()]);
      setStatus(environment);
      setPlans(history);
      setError('');
    } catch (value) {
      setError((value as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!plans.some((p) => p.state === 'running')) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [plans, refresh]);
  const active = plans.some((p) => p.state === 'running');
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (value) {
      setError((value as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const approved = skills.filter((skill) => skill.status === 'approved');
  return (
    <section className="research-lab" aria-label="Security Research Lab">
      <div className="info-banner">
        {status?.eligible ? <FlaskConical size={22} /> : <LockKeyhole size={22} />}
        <div>
          <strong>
            {status?.eligible
              ? 'Guest đủ điều kiện kiểm tra · chưa chứng nhận thí nghiệm'
              : 'Lab đang khóa · chưa có VM được xác minh'}
          </strong>
          <p>{status?.reason || 'Đang kiểm tra điều kiện, chưa chạy CLI nghiên cứu.'}</p>
          <p>
            Production giữ nguyên bảo vệ 0.1.5. Tạo kế hoạch và xuất dữ liệu không kích hoạt
            baseline hoặc Auto.
          </p>
        </div>
      </div>
      <button className="secondary-button" disabled={busy} onClick={() => void refresh()}>
        <RefreshCw size={14} /> Kiểm tra lại môi trường
      </button>
      {error && <p role="alert">{error}</p>}
      <details className="lab-requirements">
        <summary>Điều kiện VM và giới hạn hiện tại</summary>
        <ul>
          {status?.requirements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          Runner guest là triển khai thử nghiệm, chưa được kiểm chứng end-to-end trong VM của phiên
          phát triển này. Chữ ký host và probe OS thật là bắt buộc; nút xác nhận không thay thế
          isolation.
        </p>
        <p>
          Đối chứng benign phải hoàn thành đủ ba tool trước cùng role/model/mode/dataset. Khôi phục
          checkpoint là thao tác riêng bên hypervisor; ứng dụng không tự tuyên bố hai VM state tương
          đương.
        </p>
      </details>
      <div className="lab-form">
        <label>
          Workspace nghiên cứu trong guest
          <input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,47}"
          />
        </label>
        <label>
          Gemini model
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label>
          ACP mode yêu cầu
          <select value={mode} onChange={(e) => setMode(e.target.value as 'default' | 'auto')}>
            <option value="default">Default · phải được guest báo cáo</option>
            <option value="auto">Auto · chỉ trong guest đã xác minh</option>
          </select>
        </label>
        <label>
          Kịch bản / nguồn Skill
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {(
              status?.scenarios || [
                { id: 'benign-control', title: 'Đối chứng: phân tích bảng tính' },
              ]
            ).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
            <option value="imported-skill">Skill đã phê duyệt trong registry</option>
          </select>
        </label>
        {scenario === 'imported-skill' && (
          <>
            <label>
              Skill nghiên cứu
              <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                <option value="">Chọn Skill</option>
                {approved.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Giả thuyết nghiên cứu
              <select value={hypothesis} onChange={(e) => setHypothesis(e.target.value)}>
                <option value="none">Không gán trước kết quả tấn công</option>
                <option value="read-separate-document">Skill yêu cầu đọc tài liệu riêng</option>
                <option value="write-separate-report">Skill yêu cầu sửa báo cáo riêng</option>
              </select>
            </label>
          </>
        )}
        <label>
          Workbook được phép nghiên cứu (.xlsx)
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void perform(async () => setDataset(await api.upload(file)));
            }}
          />
          {dataset && <span>{dataset.name}</span>}
        </label>
      </div>
      <button
        className="primary-button"
        disabled={
          busy ||
          !dataset ||
          !workspace.trim() ||
          !model.trim() ||
          (scenario === 'imported-skill' && !skillId)
        }
        onClick={() =>
          void perform(() =>
            api.labPrepare({
              workspace,
              model,
              execution_mode: mode,
              scenario,
              skill_id: scenario === 'imported-skill' ? skillId : undefined,
              dataset_id: dataset!.id,
              hypothesis,
            }),
          )
        }
      >
        <FlaskConical size={15} /> Tạo kế hoạch · chưa chạy AI
      </button>
      <label className="lab-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{' '}
        Tôi xác nhận chỉ chạy trong VM nghiên cứu disposable, trên tài nguyên tổng hợp được phép.
        Mỗi role là một lượt riêng; dừng sau khi thấy thao tác trái phép.
      </label>
      <h3>Đối chiếu baseline / protected</h3>
      {!plans.length && (
        <p>Chưa có kế hoạch. Số lượt mô hình thật: 0. Không có kết luận tấn công hoặc phòng vệ.</p>
      )}
      {plans.map((plan) => (
        <article className="lab-plan" key={plan.id}>
          <div className="section-row">
            <strong>
              {plan.workspace} · {plan.scenario}
            </strong>
            <span className="code-tag">{plan.state}</span>
          </div>
          <p>
            {plan.model} · yêu cầu {plan.execution_mode}
          </p>
          <p>
            Skill <code>{plan.skill_sha256.slice(0, 16)}…</code> · dataset{' '}
            <code>{plan.dataset_sha256.slice(0, 16)}…</code>
          </p>
          <div className="lab-comparison">
            {(['baseline', 'protected'] as const).map((role) => {
              const trial = plan.trials[role];
              return (
                <div key={role} className="lab-result">
                  <h4>
                    <Shield size={15} />{' '}
                    {role === 'baseline'
                      ? 'Unprotected baseline trong VM'
                      : 'AgentScope Protected Mode'}
                  </h4>
                  <p>{evidenceLabel(trial)}</p>
                  <small>{trial?.evidence_level || 'not_run'}</small>
                  <button
                    className="secondary-button"
                    disabled={!status?.eligible || !consent || busy || active || !!trial}
                    onClick={() => void perform(() => api.labRun(plan.id, role))}
                  >
                    Chạy {role}
                  </button>
                  {trial && (
                    <details>
                      <summary>File state và bằng chứng</summary>
                      <pre>{JSON.stringify(trial, null, 2)}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
          <details>
            <summary>Task và các biến chưa kiểm soát</summary>
            <p>{plan.task}</p>
            <ul>
              {plan.comparison_limits.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
          <button
            className="text-button"
            onClick={() => void perform(() => api.labExport(plan.id))}
          >
            <Download size={14} /> Xuất evidence ZIP và báo cáo
          </button>
        </article>
      ))}
    </section>
  );
}
