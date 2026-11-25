import type { Skill } from '../../types';
import { SKILL_STATE_HINT, SKILL_STATE_LABEL, skillState } from './skillState';

export default function SkillStateBadge({ skill }: { skill: Skill }) {
  const state = skillState(skill);
  return (
    <span
      className={`skill-state ${state}`}
      title={skill.state_reason || SKILL_STATE_HINT[state]}
      data-state={state}
    >
      {SKILL_STATE_LABEL[state]}
    </span>
  );
}
