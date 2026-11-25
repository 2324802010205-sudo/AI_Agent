import type { Skill, SkillState } from '../../types';

/** Installed, enabled, quarantined and restricted are different facts. Deleted Skills are absent. */
export const SKILL_STATE_LABEL: Record<SkillState, string> = {
  enabled: 'Đang bật',
  disabled: 'Đã tắt bởi bạn',
  quarantined: 'Cách ly',
  restricted: 'Hạn chế bảo mật',
};

export const SKILL_STATE_HINT: Record<SkillState, string> = {
  enabled: 'Đang bật — AI sẽ tự động đọc và áp dụng Skill này.',
  disabled: 'Bạn đã tắt Skill này. Bật lại bất cứ lúc nào không cần cài lại.',
  quarantined:
    'Có cảnh báo bảo mật (Cách ly). Vẫn có thể bật để AI đọc và sử dụng; chuyển SkillGuard ON để cảnh báo/bảo vệ.',
  restricted: 'Tài nguyên nghiên cứu nội bộ bị hạn chế. Không thể bật.',
};

/** Prefers the backend's derived state and classifies older records the same way. */
export function skillState(skill: Skill): SkillState {
  if (skill.state) return skill.state;
  if (skill.research_fixture) return 'restricted';
  if (skill.status === 'quarantine') return 'quarantined';
  if (skill.security?.assessment !== 'no_significant_findings') return 'quarantined';
  if (skill.status === 'disabled') return 'disabled';
  return skill.status === 'enabled' || skill.status === 'approved' ? 'enabled' : 'restricted';
}

export const isSkillEnabled = (skill: Skill) =>
  skill.eligible ?? skillState(skill) === 'enabled';
export const isSkillToggleable = (skill: Skill) =>
  skill.toggleable ?? ['enabled', 'disabled', 'quarantined'].includes(skillState(skill));
export const shortId = (id: string) => id.slice(0, 8);

export function stateCounts(skills: Skill[]): Record<SkillState, number> {
  const counts: Record<SkillState, number> = {
    enabled: 0,
    disabled: 0,
    quarantined: 0,
    restricted: 0,
  };
  for (const skill of skills) counts[skillState(skill)] += 1;
  return counts;
}

export const activeSkillsLabel = (count: number) => `${count} Skills đang bật`;
