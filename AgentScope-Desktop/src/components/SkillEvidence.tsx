import { FileText, Shield } from 'lucide-react';
import type { Skill, SkillAssessment } from '../types';
import { isSkillEnabled, isSkillToggleable } from './skills/skillState';

export const assessmentLabel: Record<SkillAssessment | 'informational', string> = {
  no_significant_findings: 'Đã quét · chưa phát hiện dấu hiệu đáng kể',
  suspicious_instructions: 'Phát hiện chỉ dẫn đáng ngờ',
  untrusted_executable: 'Mã thực thi chưa được tin cậy',
  high_risk_behavior: 'Dấu hiệu rủi ro cao',
  policy_violation: 'Vi phạm chính sách gói',
  uncertain: 'Phân tích tĩnh chưa đầy đủ',
  informational: 'Thông tin',
};

export function skillScanLabel(skill: Skill) {
  return skill.security ? assessmentLabel[skill.security.assessment] : 'Chưa quét';
}

export const canEnableSkill = isSkillToggleable;
export const isEnabledSkill = isSkillEnabled;

export default function SkillEvidence({
  skill,
  showMetadata = false,
}: {
  skill: Skill;
  showMetadata?: boolean;
}) {
  const scan = skill.security;
  return (
    <>
      <div className="info-banner subtle">
        <Shield size={17} />
        <div>
          <strong>{skillScanLabel(skill)}</strong>
          {scan && <p>Lần quét cuối · {new Date(scan.scanned_at).toLocaleString('vi-VN')}</p>}
          <p>Phân tích tĩnh có thể bỏ sót hành vi. Kết quả này ghi nhận nội dung của gói.</p>
          {!!scan?.executable_files.length && (
            <p>Mã đi kèm chỉ được kiểm tra tĩnh. Thực thi cần môi trường cách ly và quyền riêng.</p>
          )}
        </div>
      </div>
      {!!scan?.findings.length && (
        <ul className="findings">
          {scan.findings.map((item, index) => (
            <li key={`${item.code}-${item.path}-${item.line}-${index}`}>
              <Shield size={14} />
              <span>
                <strong>
                  {assessmentLabel[item.category]} · {item.path}
                  {item.line ? `:${item.line}` : ''}
                </strong>
                <br />
                {item.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h4>Tệp trong bản lưu · SHA-256</h4>
      <div className="review-files">
        {skill.files.map((path) => (
          <div key={path}>
            <FileText size={14} />
            <strong>
              {path}
              {scan?.executable_files.includes(path)
                ? ' · Mã thực thi'
                : scan?.references.includes(path)
                  ? ' · Tham chiếu'
                  : ''}
            </strong>
            <code title={skill.hashes[path]}>{skill.hashes[path]?.slice(0, 16)}…</code>
          </div>
        ))}
      </div>
      {showMetadata && !!skill.capabilities.length && (
        <details className="lab-requirements">
          <summary>Khả năng mô tả trong metadata</summary>
          <div className="capability-list">
            {skill.capabilities.map((capability) => (
              <span key={capability}>{capability}</span>
            ))}
          </div>
          <p>SkillGuard đánh giá quyền khi công cụ được yêu cầu.</p>
        </details>
      )}
    </>
  );
}
