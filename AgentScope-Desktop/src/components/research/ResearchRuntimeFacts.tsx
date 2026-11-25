import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { ExecutionEvent } from '../../types';
import type { Condition } from '../../types/research';
import { CONDITION_LABELS } from './labels';
import CopyValue from '../CopyValue';

type Token = {
  pid?: number;
  is_appcontainer?: boolean;
  appcontainer_sid?: string;
  integrity_sid?: string;
  user_sid?: string;
  elevated?: boolean;
  administrators_group?: 'enabled' | 'disabled' | 'deny_only' | 'absent';
  capability_sids?: string[];
};

function adminAccess(token?: Token) {
  const group = token?.administrators_group;
  if (!group || typeof token?.elevated !== 'boolean') return 'Chưa ghi nhận';
  const groups = {
    enabled: 'Administrators được bật',
    disabled: 'Administrators bị vô hiệu',
    deny_only: 'Administrators chỉ dùng để từ chối quyền',
    absent: 'Không có nhóm Administrators trong token',
  };
  return `${token.elevated ? 'Đã nâng quyền' : 'Không nâng quyền'} · ${groups[group]}`;
}

export default function ResearchRuntimeFacts({
  condition,
  events,
}: {
  condition?: Condition;
  events: ExecutionEvent[];
}) {
  const result = (type: string) => events.find((event) => event.event_type === type)?.result;
  const session = result('model.session_started');
  const mcp = result('research.mcp_process_attested');
  const launcher = session?.appcontainer_process as Token | undefined;
  const child = mcp?.appcontainer_process as Token | undefined;
  const checked = result('research.isolation_verified');
  const failed = result('research.isolation_failed');
  const sid = launcher?.appcontainer_sid ?? session?.container_sid;
  const checks = Array.isArray(checked?.checks) ? checked.checks : [];
  const passed = (id: string) =>
    checks.some((check) => check?.check === id && check.passed === true);

  const fields = [
    ['Hồ sơ AppContainer', session?.appcontainer_profile],
    ['AppContainer SID', sid],
    ['PID ACP', launcher?.pid ?? session?.container_pid],
    ['SID người dùng ACP', launcher?.user_sid],
    ['Integrity SID ACP', launcher?.integrity_sid],
    ['PID MCP', child?.pid ?? mcp?.pid],
    ['SID người dùng MCP', child?.user_sid],
    ['Integrity SID MCP', child?.integrity_sid],
    ['Capability SID ACP', launcher?.capability_sids?.join(', ') || undefined],
    ['Capability SID MCP', child?.capability_sids?.join(', ') || undefined],
    ['Phiên Gemini', session?.session_id],
    ['Model', session?.model],
  ].flatMap(([label, value]) =>
    typeof label === 'string' && (typeof value === 'string' || typeof value === 'number')
      ? [{ label, value: String(value) }]
      : [],
  );

  return (
    <details className="execution-facts">
      <summary>
        <ChevronRight size={13} className="execution-chevron" />
        <ShieldCheck size={14} />
        <strong>Bằng chứng thực thi</strong>
        <span className={`isolation-${failed ? 'failed' : checked ? 'verified' : 'unchecked'}`}>
          AppContainer ON
        </span>
      </summary>
      <dl>
        <dt>SkillGuard</dt>
        <dd>{condition ? CONDITION_LABELS[condition] : 'ON · Chat thường'}</dd>
        <dt>Môi trường</dt>
        <dd>Windows cục bộ</dd>
        <dt>AppContainer</dt>
        <dd>ON · {failed ? 'Kiểm tra không đạt' : checked ? 'Kiểm tra đạt' : 'Chờ kiểm tra'}</dd>
        <dt>Token ACP</dt>
        <dd>
          {launcher?.is_appcontainer === true
            ? 'Đã xác minh AppContainer'
            : 'Chưa có biên nhận token'}
        </dd>
        <dt>Token MCP</dt>
        <dd>
          {mcp?.verified === true ? 'Đã xác minh AppContainer' : 'Chưa có biên nhận xác minh'}
        </dd>
        <dt>Quyền quản trị ACP</dt>
        <dd>{adminAccess(launcher)}</dd>
        <dt>Quyền quản trị MCP</dt>
        <dd>{adminAccess(child)}</dd>
        {passed('workspace_read') && passed('workspace_write') && passed('evidence_write') && (
          <>
            <dt>Kiểm tra quyền tệp</dt>
            <dd>Đọc và ghi workspace. Ghi vào thư mục bằng chứng bị chặn.</dd>
          </>
        )}
        {passed('host_loopback_connect') &&
          passed('internet_without_capability') &&
          passed('internet_with_capability') && (
            <>
              <dt>Kiểm tra quyền mạng</dt>
              <dd>Loopback bị chặn. Kết nối Internet mẫu chỉ thành công với internetClient.</dd>
            </>
          )}
        {fields.map(({ label, value }) => (
          <div className="execution-fact" key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
              <CopyValue label={label} value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
