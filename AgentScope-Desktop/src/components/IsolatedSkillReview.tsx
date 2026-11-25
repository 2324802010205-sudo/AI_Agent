import { useState } from 'react';
import { api } from '../api';
import type { IsolatedSkillReview as Receipt, Skill } from '../types';
import SkillEvidence, { skillScanLabel } from './SkillEvidence';

export default function IsolatedSkillReview({
  skill,
  conversationId,
}: {
  skill: Skill;
  conversationId?: string;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt>();

  const review = async () => {
    if (!consent || busy || !skill.package_sha256) return;
    setConsent(false);
    setBusy(true);
    setError('');
    try {
      setReceipt(await api.reviewIsolatedSkill(skill.id, skill.package_sha256, conversationId));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lab-plan" aria-label="Phiên đánh giá chỉ đọc">
      <h3>{skill.name}</h3>
      <p>{skillScanLabel(skill)} · Skill đang cách ly</p>
      <p>
        Phiên này xác minh bản lưu và quét tĩnh các tệp tại máy. Phạm vi đánh giá là nội dung gói
        Skill. Gemini, ACP và MCP đứng ngoài phạm vi của phiên này.
      </p>
      <form
        className="lab-form"
        onSubmit={(event) => {
          event.preventDefault();
          void review();
        }}
      >
        {!receipt && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={busy}
              />
              Tôi xác nhận rà soát chỉ đọc bản Skill này một lần.
            </label>
            <div>
              <button className="secondary-button" type="submit" disabled={!consent || busy}>
                {busy ? 'Đang xác minh bản lưu…' : 'Bắt đầu rà soát chỉ đọc'}
              </button>
            </div>
          </>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      {receipt && (
        <>
          <p role="status">Đã lưu biên nhận · Skill vẫn đang cách ly</p>
          <dl className="experiment-definition">
            <dt>Mã biên nhận</dt>
            <dd>
              <code>{receipt.id}</code>
            </dd>
            <dt>SHA-256 gói</dt>
            <dd>
              <code title={receipt.snapshot.package_sha256}>
                {receipt.snapshot.package_sha256.slice(0, 16)}…
              </code>
            </dd>
            <dt>SHA-256 SKILL.md</dt>
            <dd>
              <code title={receipt.snapshot.skill_md_sha256}>
                {receipt.snapshot.skill_md_sha256.slice(0, 16)}…
              </code>
            </dd>
            <dt>Gemini ACP</dt>
            <dd>Chưa gửi nội dung</dd>
            <dt>Phản hồi và bộ lọc Gemini</dt>
            <dd>Không áp dụng cho rà soát tại máy</dd>
            <dt>Công cụ và tệp kết quả</dt>
            <dd>Chưa chạy công cụ · Không áp dụng đối chiếu tệp</dd>
          </dl>
          <details>
            <summary>Kết quả quét ({receipt.security.findings.length})</summary>
            <SkillEvidence
              skill={{ ...skill, security: receipt.security, hashes: receipt.snapshot.file_hashes }}
            />
          </details>
        </>
      )}
    </section>
  );
}
