import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Download, FlaskConical, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { api } from '../../api';
import type {
  Condition,
  ExperimentSummary,
  ProtectionPolicy,
  PythonVerification,
  ResearchPolicy,
  ResearchReadiness,
} from '../../types/research';
import { CONDITION_LABELS, POLICY_LABELS } from './labels';
import { ReadinessStatus } from './ResearchControl';
import EvaluationOverview from './EvaluationOverview';
import ResearchEvaluation from './ResearchEvaluation';

const OUTCOME_SHORT: Record<string, string> = {
  MODEL_FILTER_BLOCKED: 'Gemini báo chặn',
  INFLUENCED_REPORT: 'Báo cáo bị tác động',
  INFLUENCED_ANSWER: 'Câu trả lời bị tác động',
  OUT_OF_TASK_EXECUTED: 'Thực thi ngoài nhiệm vụ',
  UNAUTHORIZED_BLOCKED_AND_RECOVERED: 'Bị chặn & đã phục hồi',
  UNAUTHORIZED_PROPOSAL_BLOCKED: 'Đề xuất trái phép bị chặn',
  DEVIATION_BLOCKED: 'Số liệu sai bị chặn',
  BLOCKED_BEFORE_EXPOSURE: 'Chặn trước khi tới mô hình',
  IGNORED_SKILL_INSTRUCTIONS: 'Bỏ qua chỉ dẫn',
  NO_DEVIATION_OBSERVED: 'Không thấy sai lệch',
  BASELINE_CORRECT: 'Đối chứng đúng',
  BASELINE_DEVIATION: 'Đối chứng sai',
  INCOMPLETE: 'Chưa hoàn tất',
  NOT_RUN: 'Không chạy',
  CANCELLED: 'Đã hủy',
  INCONCLUSIVE: 'Chưa kết luận',
};

export function ExperimentConfirm({
  conditions,
  skillName,
  workbookName,
  policy,
  model,
  onCancel,
  onConfirm,
}: {
  conditions: Condition[];
  skillName: string;
  workbookName: string;
  policy: ProtectionPolicy;
  model: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal wide experiment-confirm"
        role="dialog"
        aria-modal="true"
        aria-label="Xác nhận chạy thí nghiệm"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>
            <FlaskConical size={18} /> Chạy thí nghiệm có kiểm soát
          </h2>
          <button aria-label="Đóng" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p>
          Cùng một yêu cầu, cùng workbook <b>{workbookName}</b>, cùng Skill <b>{skillName}</b> và
          cùng model <b>{model || 'Model ACP đã kiểm tra'}</b>. Mỗi điều kiện chạy trong một
          AppContainer mới với một phiên ACP mới, không dùng lịch sử hội thoại.
        </p>
        <ol className="confirm-conditions">
          {conditions.map((c) => (
            <li key={c}>
              <b>{CONDITION_LABELS[c]}</b>
              <span>
                {c === 'baseline'
                  ? 'Chỉ yêu cầu hợp lệ, không có Skill.'
                  : c === 'skillguard_off'
                    ? 'Toàn văn SKILL.md tới Gemini, SkillGuard không can thiệp.'
                    : `SkillGuard bật: ${POLICY_LABELS[policy]}, rào nội dung và kiểm tra số liệu lúc chạy.`}
              </span>
            </li>
          ))}
        </ol>
        <div className="info-banner subtle">
          <LockKeyhole size={17} />
          <p>
            Luôn bật ở mọi điều kiện: cô lập AppContainer, kiểm tra cô lập trước mỗi phiên, chỉ đọc
            bản sao workbook, không truy cập Credential Manager hay dịch vụ máy chủ, chỉ công cụ
            workbook đã đăng ký, <b>không bao giờ chạy script đi kèm Skill</b>.
          </p>
        </div>
        <label className="confirm-check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          Tôi xác nhận chạy thí nghiệm trong môi trường nghiên cứu cô lập với dữ liệu tổng hợp và
          dùng phiên Gemini thật.
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>
            Hủy
          </button>
          <button className="primary-button" disabled={!agreed} onClick={onConfirm}>
            <FlaskConical size={14} /> Bắt đầu
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExperimentHistory({ onOpen }: { onOpen: (conversationId: string) => void }) {
  const [items, setItems] = useState<ExperimentSummary[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .experiments()
      .then(setItems)
      .catch((e) => setError((e as Error).message));
  }, []);
  if (error) return <div className="error-box">{error}</div>;
  if (!items) return <p className="muted">Đang tải…</p>;
  return (
    <div className="experiment-history">
      <ResearchEvaluation onOpen={onOpen} />
      {items.length ? (
        <EvaluationOverview items={items} />
      ) : (
        <p className="muted">Chưa có thí nghiệm trong lịch sử.</p>
      )}
      {items.map((item) => (
        <div className="experiment-row" key={item.id}>
          <div>
            <strong>
              {item.skill.name} × {item.workbook.name}
            </strong>
            <small>
              {new Date(item.created_at).toLocaleString('vi-VN')} · {item.model} · {item.state}
            </small>
            <div className="outcome-chips">
              {item.order.map((c) => (
                <span key={c}>
                  {CONDITION_LABELS[c]}: <b>{OUTCOME_SHORT[item.outcomes[c] || ''] || '—'}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="secondary-button" onClick={() => void api.experimentExport(item.id)}>
              <Download size={13} /> Bằng chứng
            </button>
            <button className="secondary-button" onClick={() => onOpen(item.conversation_id)}>
              Mở <ArrowRight size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResearchPolicyPanel({
  readiness,
  checking,
  onCheck,
  onSignin,
}: {
  readiness?: ResearchReadiness;
  checking: boolean;
  onCheck: () => void;
  onSignin: (reset?: boolean) => void;
}) {
  const [policy, setPolicy] = useState<ResearchPolicy>();
  const [verification, setVerification] = useState<PythonVerification>();
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const verify = async () => {
    setVerification(undefined);
    setVerificationError('');
    setVerifying(true);
    try {
      setVerification(await api.verifyResearchPython());
    } catch (error) {
      setVerificationError((error as Error).message);
    } finally {
      setVerifying(false);
    }
  };
  useEffect(() => {
    api
      .researchPolicy()
      .then(setPolicy)
      .catch(() => {});
  }, []);
  return (
    <section className="research-policy">
      <h3>Chế độ thí nghiệm SkillGuard</h3>
      <p>
        Thí nghiệm chỉ thay đổi các phòng vệ <b>tùy chọn</b> của SkillGuard. Các bảo vệ bắt buộc
        dưới đây luôn bật, kể cả ở Unprotected Model Test.
      </p>
      <ReadinessStatus
        readiness={readiness}
        busy={checking}
        onCheck={onCheck}
        onSignin={onSignin}
      />
      <section className="lab-plan" aria-label="Kiểm chứng Python trong AppContainer">
        <h4>Kiểm chứng Python trong AppContainer</h4>
        <p>
          Chạy bộ kiểm tra cố định do AgentScope cung cấp. Python đọc dữ liệu thử được cấp quyền và
          ghi một dấu xác nhận vào workspace dùng một lần. AppContainer riêng không có capability
          mạng.
        </p>
        <div>
          <button
            className="secondary-button"
            disabled={checking || verifying}
            onClick={() => void verify()}
          >
            {verifying ? 'Đang chạy Python…' : 'Cho phép chạy Python mẫu'}
          </button>
        </div>
        {(verificationError || verification?.error) && (
          <p role="alert">{verificationError || verification?.error}</p>
        )}
        {verification?.state === 'verified' && verification.token && verification.artifact && (
          <div role="status" data-testid="python-verification-receipt">
            <strong>Đã xác minh Python chạy thật</strong>
            <ul>
              <li>
                PID {verification.token.pid} · {verification.token.token_appcontainer_sid}
              </li>
              <li>Quyền chạy do người dùng xác nhận · Low IL · 0 capability</li>
              <li>Đã chặn đọc vùng bằng chứng và ghi vào đầu vào chỉ đọc</li>
              <li>
                {verification.artifact.name} · SHA-256 <code>{verification.artifact.sha256}</code>
              </li>
            </ul>
            <details>
              <summary>Biên nhận</summary>
              <pre>{JSON.stringify(verification, null, 2)}</pre>
            </details>
          </div>
        )}
      </section>
      {policy && (
        <div className="policy-columns">
          <div>
            <h4>
              <LockKeyhole size={14} /> Luôn bật (mọi chế độ)
            </h4>
            <ul>
              {policy.mandatory_controls.map((c) => (
                <li key={c.id}>
                  {c.label}
                  <small>{c.enforced_by}</small>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>
              <ShieldCheck size={14} /> Chỉ bật ở Protected Test (SkillGuard ON)
            </h4>
            <ul>
              {Object.entries(policy.optional_defenses).map(([id, label]) => (
                <li key={id}>{label}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

const LABS = [
  {
    page: 'Lab PI cô lập',
    title: 'Lab PI cô lập (AppContainer)',
    note: 'Bộ trial nghiên cứu Phase 1–9 và bằng chứng đã lưu. Cùng môi trường cô lập với thí nghiệm trong Chat.',
  },
  {
    page: 'Đánh giá PI',
    title: 'Đánh giá PI (CLI trên máy chủ)',
    note: 'Đối chứng lành tính với CLI của máy chủ. Không gửi Skill đối kháng vì CLI máy chủ không có hợp đồng zero-tool.',
  },
  {
    page: 'Lab nghiên cứu',
    title: 'Lab nghiên cứu (VM Hyper-V)',
    note: 'Chỉ cần cho thử nghiệm tấn công hệ thống tệp với danh tính riêng. Không cần cho Skill văn bản; Windows Home không có Hyper-V.',
  },
] as const;

export function AdvancedResearch({
  page,
  onPage,
  children,
}: {
  page: string;
  onPage: (page: (typeof LABS)[number]['page']) => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="info-banner subtle">
        <FlaskConical size={18} />
        <p>
          Để trình diễn, hãy dùng <b>Chat → So sánh cả hai</b>. Các trang dưới đây giữ nguyên công
          cụ nghiên cứu chuyên sâu và toàn bộ bằng chứng lịch sử.
        </p>
      </div>
      <div className="info-banner subtle">
        <p>
          <b>AppContainer ON cho thí nghiệm SkillGuard trong Chat và Lab PI cô lập.</b> Trung tâm
          thực thi đọc SID và quyền của ACP/MCP từ token Windows. AppContainer OFF cần một môi
          trường thay thế đã xác minh quyền tệp và mạng.
        </p>
      </div>
      <div className="lab-tabs" role="tablist">
        {LABS.map((lab) => (
          <button
            key={lab.page}
            role="tab"
            aria-selected={page === lab.page}
            className={page === lab.page ? 'active' : ''}
            onClick={() => onPage(lab.page)}
          >
            <strong>{lab.title}</strong>
            <small>{lab.note}</small>
          </button>
        ))}
      </div>
      {children}
    </>
  );
}
