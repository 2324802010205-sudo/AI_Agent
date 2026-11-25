import { useState } from 'react';
import {
  ChevronDown,
  FlaskConical,
  LoaderCircle,
  LogIn,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  SplitSquareHorizontal,
} from 'lucide-react';
import type { ProtectionPolicy, ResearchMode, ResearchReadiness } from '../../types/research';
import { MODE_HINTS, MODE_LABELS, POLICY_LABELS } from './labels';

const MODES: { mode: ResearchMode; icon: typeof MessageSquare }[] = [
  { mode: 'normal', icon: MessageSquare },
  { mode: 'skillguard_off', icon: ShieldOff },
  { mode: 'skillguard_on', icon: ShieldCheck },
  { mode: 'compare', icon: SplitSquareHorizontal },
];

export interface ResearchOptions {
  policy: ProtectionPolicy;
  includeBaseline: boolean;
  model: string;
}

export function ReadinessStatus({
  readiness,
  busy,
  onCheck,
  onSignin,
  compact = false,
  disabled = false,
  hostModelCount = 0,
}: {
  readiness?: ResearchReadiness;
  busy: boolean;
  onCheck: () => void;
  onSignin: (reset?: boolean) => void;
  compact?: boolean;
  disabled?: boolean;
  hostModelCount?: number;
}) {
  const state = readiness?.state || 'unchecked';
  const ready = state === 'ready';
  const labModelCount = readiness?.models?.length || readiness?.flash_models?.length || 0;
  const modelMismatch = ready && hostModelCount > 0 && labModelCount > 0 && labModelCount < hostModelCount;
  const isolation = readiness?.steps.find((step) => step.id === 'isolation');
  const verification =
    readiness?.appcontainer?.verification ??
    (isolation ? (isolation.passed ? 'verified' : 'failed') : 'unchecked');
  return (
    <div className={`readiness ${ready ? 'ready' : 'blocked'} ${compact ? 'compact' : ''}`}>
      <span className="readiness-dot" />
      <div className="readiness-text">
        <strong>
          {busy
            ? 'Đang kiểm tra môi trường nghiên cứu…'
            : ready
              ? 'Lab sẵn sàng'
              : 'Lab chưa sẵn sàng'}
        </strong>
        <span className="readiness-isolation">
          <ShieldCheck size={13} aria-hidden="true" /> AppContainer ON
          <span className={`isolation-${verification}`}>
            {verification === 'verified'
              ? 'Đã kiểm tra'
              : verification === 'failed'
                ? 'Kiểm tra không đạt'
                : 'Chờ kiểm tra'}
          </span>
        </span>
        {!busy && (
          <small>
            {ready
              ? modelMismatch
                ? `Lab có ${labModelCount}/${hostModelCount} model (khác tài khoản máy chính · bấm Đăng nhập lại lab để đồng bộ)`
                : `${labModelCount} model ACP khả dụng${readiness?.stale ? ' · cần kiểm tra lại' : ''}`
              : readiness?.blocker || 'Chưa kiểm tra.'}
          </small>
        )}
      </div>
      <div className="readiness-actions">
        {!busy && (
          <button
            className="secondary-button"
            onClick={() => onSignin(ready)}
            disabled={disabled}
            title={
              ready
                ? 'Xóa phiên đăng nhập Lab cũ để tránh xung đột và đăng nhập lại tài khoản Google khác'
                : 'Mở cửa sổ đăng nhập Google riêng cho Lab'
            }
          >
            <LogIn size={13} /> {ready ? 'Đăng nhập lại lab' : 'Đăng nhập lab'}
          </button>
        )}
        <button className="secondary-button" onClick={onCheck} disabled={busy || disabled}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
          {ready ? 'Kiểm tra lại' : 'Kiểm tra'}
        </button>
      </div>
    </div>
  );
}

export default function ResearchControl({
  mode,
  onMode,
  readiness,
  checking,
  onCheck,
  onSignin,
  options,
  onOptions,
  settingsModel = '',
  availableModels = [],
  compact = false,
  contained = false,
}: {
  mode: ResearchMode;
  onMode: (mode: ResearchMode) => void;
  readiness?: ResearchReadiness;
  checking: boolean;
  onCheck: () => void;
  onSignin: (reset?: boolean) => void;
  options: ResearchOptions;
  onOptions: (options: ResearchOptions) => void;
  settingsModel?: string;
  availableModels?: { id: string; name: string }[];
  compact?: boolean;
  contained?: boolean;
}) {
  const [advanced, setAdvanced] = useState(!compact);
  const research = mode !== 'normal';
  const isolated = research || contained;
  const ready = readiness?.state === 'ready';
  const verification = readiness?.appcontainer?.verification;
  const modelChoices = (() => {
    const byId = new Map<string, string>();
    for (const id of readiness?.models?.length ? readiness.models : readiness?.flash_models || []) {
      byId.set(id, id);
    }
    for (const item of availableModels) {
      if (!byId.has(item.id)) byId.set(item.id, item.name !== item.id ? `${item.name} (${item.id})` : item.id);
    }
    return [...byId.entries()];
  })();
  return (
    <div className={`research-control ${research ? 'active' : ''} ${compact ? 'compact' : ''}`}>
      <div
        className="research-modes"
        role="radiogroup"
        aria-label="Chế độ chạy"
        onKeyDown={(event) => {
          const offset = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
          if (!offset) return;
          event.preventDefault();
          const index =
            (MODES.findIndex((item) => item.mode === mode) + offset + MODES.length) % MODES.length;
          onMode(MODES[index].mode);
          event.currentTarget.querySelectorAll('button')[index]?.focus();
        }}
      >
        {MODES.map(({ mode: value, icon: Icon }) => (
          <button
            key={value}
            role="radio"
            aria-checked={mode === value}
            aria-label={MODE_LABELS[value]}
            tabIndex={mode === value ? 0 : -1}
            className={`mode-${value} ${mode === value ? 'selected' : ''}`}
            onClick={() => onMode(value)}
            title={MODE_HINTS[value]}
          >
            <Icon size={13} />
            <span>
              {value === 'skillguard_off'
                ? 'SkillGuard OFF'
                : value === 'skillguard_on'
                  ? 'SkillGuard ON'
                  : MODE_LABELS[value]}
            </span>
          </button>
        ))}
      </div>
      <div className="composer-mode-meta">
        <span className="composer-runtime-status" title={readiness?.blocker ?? undefined}>
          {isolated && (
            <>
              <ShieldCheck size={14} aria-hidden="true" />
              <span>AppContainer ON</span>
              {!advanced && (
                <span className={ready && !readiness?.stale ? 'verified' : ''}>
                  {ready && !readiness?.stale
                    ? 'Lab sẵn sàng'
                    : checking
                      ? 'Đang kiểm tra…'
                      : verification === 'failed'
                        ? 'Kiểm tra không đạt'
                        : readiness?.state === 'unavailable'
                          ? 'Lab chưa sẵn sàng'
                          : readiness?.stale
                            ? 'Cần kiểm tra lại'
                            : 'Chờ kiểm tra'}
                </span>
              )}
            </>
          )}
        </span>
        <button
          className="research-advanced-toggle"
          aria-expanded={advanced}
          aria-controls="composer-mode-details"
          onClick={() => setAdvanced(!advanced)}
        >
          {research ? 'Tùy chọn nâng cao' : 'Thông tin chế độ'}
          <ChevronDown size={13} className={advanced ? 'open' : ''} />
        </button>
      </div>
      {advanced && (
        <div className="research-panel" id="composer-mode-details">
          <p className="research-hint">
            <FlaskConical size={14} aria-hidden="true" /> {MODE_HINTS[mode]}
          </p>
          {isolated && (
            <ReadinessStatus
              readiness={readiness}
              busy={checking}
              onCheck={onCheck}
              onSignin={onSignin}
              hostModelCount={availableModels.length}
              compact
            />
          )}
          {research && (
            <div className="research-advanced">
              <label>
                <span>Chính sách SkillGuard ON</span>
                <select
                  value={options.policy}
                  onChange={(e) =>
                    onOptions({ ...options, policy: e.target.value as ProtectionPolicy })
                  }
                >
                  {(Object.keys(POLICY_LABELS) as ProtectionPolicy[]).map((key) => (
                    <option key={key} value={key}>
                      {POLICY_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Model Antigravity ACP</span>
                <select
                  value={options.model}
                  onChange={(e) => onOptions({ ...options, model: e.target.value })}
                >
                  <option value="">
                    {settingsModel ? `Theo Cài đặt (${settingsModel})` : 'Tự chọn (theo ACP)'}
                  </option>
                  {modelChoices.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {mode === 'compare' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={options.includeBaseline}
                    onChange={(e) => onOptions({ ...options, includeBaseline: e.target.checked })}
                  />
                  <span>Thêm đối chứng không Skill (giúp quy kết sai lệch cho Skill)</span>
                </label>
              )}
              {!!readiness?.steps.length && (
                <ul className="readiness-steps">
                  {readiness.steps.map((step) => (
                    <li key={step.id} className={step.passed ? 'pass' : 'fail'}>
                      {step.passed ? '✓' : '✗'} {step.label}
                      {step.detail && <small> — {step.detail}</small>}
                    </li>
                  ))}
                </ul>
              )}
              {readiness && (
                <p className="research-footnote">
                  {readiness.requirements.executable_skill} {readiness.requirements.not_required}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
