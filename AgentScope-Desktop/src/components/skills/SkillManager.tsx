import { BookOpen, ChevronDown, Layers3, Settings2, ShieldAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Skill, SkillRuntimeSummary } from '../../types';
import SkillStateBadge from './SkillStateBadge';
import SkillSwitch from './SkillSwitch';
import {
  activeSkillsLabel,
  isSkillEnabled,
  isSkillToggleable,
  shortId,
  skillState,
} from './skillState';

export interface SkillManagerProps {
  skills: Skill[];
  /** Whether SkillGuard warnings should be emphasized for flagged skills. */
  warnFlagged?: boolean;
  pendingIds: ReadonlySet<string>;
  summary?: SkillRuntimeSummary;
  onToggle: (skill: Skill, enable: boolean) => void;
  onOpen: (skill: Skill) => void;
  onInspect: (skill: Skill) => void;
  onManage: () => void;
}

/** Compact multi-Skill manager. Every enabled Skill is automatically sent for AI to read. */
export default function SkillManager({
  skills,
  warnFlagged = false,
  pendingIds,
  summary,
  onToggle,
  onOpen,
  onInspect,
  onManage,
}: SkillManagerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const active = skills.filter(isSkillEnabled).length;
  const names = new Map<string, number>();
  for (const skill of skills) names.set(skill.name, (names.get(skill.name) ?? 0) + 1);
  // A stable order keeps each row in place while its switch changes.
  const ordered = [...skills].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const leave =
    <T,>(action: (value: T) => void) =>
    (value: T) => {
      setOpen(false);
      action(value);
    };

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
        }
      } else if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close, true);
    };
  }, [open]);

  if (!skills.length)
    return (
      <button className="skill-shortcut skill-manager-trigger" onClick={onManage}>
        <Layers3 size={15} aria-hidden="true" /> Thêm Skill
      </button>
    );
  const limits = summary?.exposure.limitations ?? [];
  return (
    <div className="skill-manager" ref={root}>
      <button
        className="skill-shortcut skill-manager-trigger"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Mọi Skill đang bật tự động được gửi cho AI đọc ở mọi chế độ"
        onClick={() => setOpen((value) => !value)}
      >
        <Layers3 size={15} aria-hidden="true" />
        <span>{activeSkillsLabel(active)}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="skill-manager-panel" role="dialog" aria-label="Quản lý Skill" id={panelId}>
          <header>
            <strong>Skills trong Chat</strong>
            <span>
              {active}/{skills.length} đang bật
            </span>
          </header>
          <p className="skill-manager-note">
            Mọi Skill đang bật đều tự động được gửi cho AI đọc và áp dụng ở mọi chế độ. Tắt công tắc
            nếu không muốn dùng Skill đó.
          </p>
          <ul>
            {ordered.map((skill) => {
              const state = skillState(skill);
              const enabled = isSkillEnabled(skill);
              const duplicate = (names.get(skill.name) ?? 0) > 1;
              return (
                <li key={skill.id} data-state={state}>
                  <div className="skill-manager-row">
                    <span className="skill-manager-name">
                      <strong title={skill.name}>{skill.name}</strong>
                      <small title={skill.id}>
                        ID {shortId(skill.id)}
                        {skill.package_sha256 && ` · SHA-256 ${skill.package_sha256.slice(0, 8)}`}
                        {duplicate && ' · trùng tên'}
                      </small>
                    </span>
                    <SkillStateBadge skill={skill} />
                    <SkillSwitch
                      checked={enabled}
                      disabled={!isSkillToggleable(skill)}
                      busy={pendingIds.has(skill.id)}
                      label={`${enabled ? 'Tắt' : 'Bật'} Skill ${skill.name} (${shortId(skill.id)})`}
                      onChange={(next) => onToggle(skill, next)}
                    />
                  </div>
                  <div className="skill-manager-actions">
                    <button
                      onClick={() => leave(onOpen)(skill)}
                      aria-label={`Mở ${skill.name} ${shortId(skill.id)}`}
                    >
                      <BookOpen size={12} aria-hidden="true" /> Mở
                    </button>
                    {(state === 'quarantined' || state === 'restricted') && (
                      <button onClick={() => leave(onInspect)(skill)}>
                        <ShieldAlert size={12} aria-hidden="true" /> Xem phát hiện
                      </button>
                    )}
                    {state === 'quarantined' && (
                      <span className="skill-manager-hint">
                        {enabled
                          ? warnFlagged
                            ? 'Cảnh báo rủi ro · SkillGuard ON sẽ kiểm soát'
                            : 'Đang bật · sẽ gửi toàn bộ nội dung Skill tới AI'
                          : 'Bật công tắc để AI đọc và sử dụng'}
                      </span>
                    )}
                    {state === 'restricted' && (
                      <span className="skill-manager-hint">Không được gửi tới model</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {limits.length > 0 && (
            <div className="skill-manager-limits" role="status">
              {limits.map((item, index) => (
                <span key={`${item.code}-${index}`}>{item.message}</span>
              ))}
            </div>
          )}
          <footer>
            <button onClick={() => leave(onManage)(undefined)}>
              <Settings2 size={13} aria-hidden="true" /> Quản lý trong trang Skills
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
