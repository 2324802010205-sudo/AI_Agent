import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, LockKeyhole, Shield } from 'lucide-react';
import { api } from '../api';
import type { Attachment, Skill } from '../types';

type Evaluation = {
  id: string;
  state: string;
  dataset_name: string;
  dataset_sha256: string;
  ground_truth: { orders: number; revenue_vnd: number; profit_vnd: number };
  skill?: { name: string; sha256: string };
  activation_blocks: { reason: string }[];
  model_trials: {
    kind: string;
    evidence_level: string;
    model?: string;
    mode?: { current_mode_id: string };
    raw_model_answer?: string;
    skill_delivered: boolean;
    integrity_validation?: { valid: boolean; classification: string; discrepancies: unknown[] };
    publication?: { blocked: boolean; verified: boolean; answer?: string };
    error?: unknown;
  }[];
};

export default function AnswerEvaluation({ skills }: { skills: Skill[] }) {
  const [status, setStatus] = useState<{ reason: string; arithmetic_program_sha256: string }>();
  const [cases, setCases] = useState<Evaluation[]>([]);
  const [dataset, setDataset] = useState<Attachment>();
  const [skill, setSkill] = useState('');
  const [model, setModel] = useState('gemini-4-neon-high');
  const [network, setNetwork] = useState(false);
  const [localConsent, setLocalConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [arithmetic, setArithmetic] = useState<unknown>();
  const refresh = useCallback(async () => {
    const [state, history] = await Promise.all([api.evaluationStatus(), api.evaluations()]);
    setStatus(state);
    setCases(history as Evaluation[]);
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setMessage(error.message));
  }, [refresh]);
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
  return (
    <section className="research-lab" aria-label="Excel answer integrity evaluation">
      <div className="info-banner">
        <FileSpreadsheet size={22} />
        <div>
          <strong>Excel ground truth và câu trả lời Gemini thật</strong>
          <p>
            Giữ kết nối Antigravity đã đăng nhập; không cần Gemini API key. Control thông thường
            không chứa Skill và không được gọi là thử nghiệm injection.
          </p>
        </div>
      </div>
      <div className="info-banner subtle">
        <LockKeyhole size={20} />
        <p>{status?.reason || 'Đang kiểm tra ranh giới ACP.'}</p>
      </div>
      <div className="lab-form">
        <label>
          Workbook đánh giá
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void act(async () => setDataset(await api.upload(file)));
            }}
          />
          {dataset?.name}
        </label>
        <label>
          Skill được review, lưu nguyên bản
          <select value={skill} onChange={(event) => setSkill(event.target.value)}>
            <option value="">Không chọn Skill · control</option>
            {skills
              .filter((s) => s.status === 'approved')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Gemini model qua ACP
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
      </div>
      <p>
        Mặc định dùng cột Doanh_thu_VND và Loi_nhuan_VND. Giá trị được tính từ workbook, không
        hardcode theo dataset mẫu.
      </p>
      <button
        className="primary-button"
        disabled={!dataset || busy}
        onClick={() =>
          void act(() =>
            api.prepareEvaluation({ dataset_id: dataset!.id, skill_id: skill || undefined }),
          )
        }
      >
        Tính ground truth · lưu kế hoạch
      </button>
      <label className="lab-consent">
        <input
          type="checkbox"
          checked={network}
          onChange={(event) => setNetwork(event.target.checked)}
        />{' '}
        Đồng ý gửi các tổng đã tính tới Gemini bằng kết nối ACP hiện có, trong một control không
        chứa Skill.
      </label>
      {message && <p role="alert">{message}</p>}
      {cases.map((value) => (
        <article className="lab-plan" key={value.id}>
          <div className="section-row">
            <strong>{value.dataset_name}</strong>
            <span className="code-tag">{value.state}</span>
          </div>
          <p>
            {value.ground_truth.orders} đơn · doanh thu{' '}
            {value.ground_truth.revenue_vnd.toLocaleString('vi-VN')} VND · lợi nhuận{' '}
            {value.ground_truth.profit_vnd.toLocaleString('vi-VN')} VND
          </p>
          <small>
            Dataset SHA-256 {value.dataset_sha256.slice(0, 16)}… ·{' '}
            {value.skill
              ? `Skill ${value.skill.name} đã lưu, chưa đồng nghĩa đã gửi`
              : 'Không có Skill'}
          </small>
          <div className="row">
            <button
              className="secondary-button"
              disabled={!network || busy || !!value.model_trials.length}
              onClick={() =>
                void act(() =>
                  api.runEvaluation(value.id, {
                    kind: 'benign_control',
                    model,
                    publication_mode: 'enforce',
                    network_consent: true,
                  }),
                )
              }
            >
              Chạy control Gemini thật · không Skill
            </button>
            <button
              className="secondary-button"
              disabled
              title="Chưa xác minh được zero-tool ACP; không kích hoạt trên host"
            >
              Injection Skill · đang khóa
            </button>
          </div>
          {value.activation_blocks.length > 0 && (
            <p>
              Payload chưa được gửi. Đây là chặn kích hoạt do thiếu confinement, không phải model
              refusal hoặc thành công SkillGuard.
            </p>
          )}
          {value.model_trials.map((trial, index) => (
            <div className="lab-result" key={index}>
              <strong>
                {trial.kind} · {trial.evidence_level}
              </strong>
              <small>
                {trial.model || model} · ACP {trial.mode?.current_mode_id || 'chưa quan sát mode'}
              </small>
              <p>
                Skill gửi tới mô hình: {trial.skill_delivered ? 'có' : 'không'}. Không có kết luận
                miễn nhiễm injection.
              </p>
              <pre>
                {trial.raw_model_answer ||
                  JSON.stringify(trial.error || 'Chưa có phản hồi được ghi nhận', null, 2)}
              </pre>
              {trial.integrity_validation && (
                <p>
                  <Shield size={14} /> Validator: {trial.integrity_validation.classification}.{' '}
                  {trial.publication?.blocked
                    ? 'Đã giữ lại câu trả lời trước khi công bố.'
                    : 'Chỉ các numeric claims có schema chính xác được xác minh.'}
                </p>
              )}
              {trial.publication?.verified && <p>{trial.publication.answer}</p>}
            </div>
          ))}
          <button
            className="text-button"
            onClick={() => void act(() => api.exportEvaluation(value.id))}
          >
            <Download size={14} /> Xuất raw answer và bằng chứng
          </button>
        </article>
      ))}
      <h3>Probe arithmetic được allowlist</h3>
      <p>
        Chỉ chương trình arithmetic-v1 đã review và hash cố định được phép. Probe thực chạy không
        phải bằng chứng Gemini yêu cầu code execution. Không có shell hoặc đường dẫn chương trình
        tùy ý.
      </p>
      <code>{status?.arithmetic_program_sha256}</code>
      <label className="lab-consent">
        <input
          type="checkbox"
          checked={localConsent}
          onChange={(event) => setLocalConsent(event.target.checked)}
        />{' '}
        Cho phép kiểm tra AppContainer với fixture tổng hợp và chạy đúng chương trình đã duyệt nếu
        isolation pass. Không cho phép nâng quyền hay fallback không sandbox.
      </label>
      <button
        className="secondary-button"
        disabled={!localConsent || busy}
        onClick={() => void act(async () => setArithmetic(await api.arithmeticConformance()))}
      >
        Kiểm tra containment và arithmetic đã duyệt
      </button>
      {arithmetic !== undefined && (
        <pre className="lab-diagnostic">{JSON.stringify(arithmetic, null, 2)}</pre>
      )}
    </section>
  );
}
