import { Layers3 } from 'lucide-react';
import type { ExecutionEvent, SkillExposureReceipt } from '../../types';
import { shortId } from './skillState';

const REASON: Record<string, string> = {
  skill_too_large: 'SKILL.md vượt giới hạn cho một Skill',
  context_budget_exceeded: 'vượt ngân sách ngữ cảnh',
  skillguard_blocked: 'SkillGuard chặn trước khi gửi',
  integrity_failed: 'không khớp SHA-256 đã ghi nhận',
};

interface Receipt {
  skills: SkillExposureReceipt[];
  withheld: { skill_id: string; skill_name?: string | null; reason: string }[];
  limitations: { code: string; message: string }[];
  exposure: string;
  inPrompt: number;
  bundle?: string;
}

export function skillReceipt(events: ExecutionEvent[]): Receipt | undefined {
  const event = events.find(
    (item) =>
      (item.event_type === 'prompt.submitted' || item.event_type === 'skill.delivered') &&
      Array.isArray(item.result.skills),
  );
  const skills = event?.result.skills;
  if (!event || !Array.isArray(skills)) return undefined;
  const result = event.result;
  return {
    skills: skills as SkillExposureReceipt[],
    withheld: (result.skills_withheld as Receipt['withheld']) ?? [],
    limitations: (result.skill_limitations as Receipt['limitations']) ?? [],
    exposure: String(result.skill_exposure ?? 'unverified'),
    inPrompt: Number(result.skills_in_acp_prompt ?? 0),
    bundle: typeof result.skill_bundle_sha256 === 'string' ? result.skill_bundle_sha256 : undefined,
  };
}

/** What reached the ACP client, per Skill. Provider-internal handling is not observable. */
export default function SkillExposure({ events }: { events: ExecutionEvent[] }) {
  const receipt = skillReceipt(events);
  if (!receipt) return null;
  const exposed = receipt.skills.filter((skill) => skill.exposed);
  if (!exposed.length && !receipt.withheld.length) return null;
  const total =
    receipt.skills.length +
    receipt.withheld.filter((w) => !receipt.skills.some((s) => s.skill_id === w.skill_id)).length;
  return (
    <details className="skill-exposure">
      <summary>
        <Layers3 size={14} aria-hidden="true" />
        <strong>
          Skill đã gửi tới Gemini · {exposed.length}/{total}
        </strong>
        <span>
          {receipt.inPrompt === exposed.length && exposed.length > 0
            ? `${receipt.inPrompt} khối khớp SHA-256 trong prompt ACP`
            : `${receipt.inPrompt} khối xác minh được`}
        </span>
      </summary>
      <ul>
        {receipt.skills.map((skill) => (
          <li key={skill.skill_id} data-exposed={skill.exposed}>
            <strong>{skill.skill_name}</strong>
            <code title={skill.skill_id}>
              {shortId(skill.skill_id)} · {skill.sha256.slice(0, 12)}
            </code>
            <small>
              {skill.exposed
                ? skill.in_acp_prompt
                  ? 'Đã gửi · khớp trong prompt ACP'
                  : 'Đã chuẩn bị · chưa xác minh trong prompt'
                : `Chưa gửi · ${REASON[skill.reason ?? ''] ?? skill.reason ?? 'không đủ điều kiện'}`}
            </small>
          </li>
        ))}
        {receipt.withheld
          .filter((item) => !receipt.skills.some((skill) => skill.skill_id === item.skill_id))
          .map((item) => (
            <li key={item.skill_id} data-exposed="false">
              <strong>{item.skill_name || 'Skill'}</strong>
              <code title={item.skill_id}>{shortId(item.skill_id)}</code>
              <small>Chưa gửi · {REASON[item.reason] ?? item.reason}</small>
            </li>
          ))}
      </ul>
      {receipt.limitations.length > 0 && (
        <p className="skill-exposure-limits">
          {receipt.limitations.map((item) => item.message).join(' · ')}
        </p>
      )}
      <p className="skill-exposure-note">
        Xác nhận ở ranh giới ACP. Toàn bộ nội dung văn bản của các Skill đang bật đã được gửi trong
        prompt để AI tự động đọc.
      </p>
    </details>
  );
}
