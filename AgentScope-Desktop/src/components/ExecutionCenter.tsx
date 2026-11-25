import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ChevronRight,
  Download,
  PanelRightClose,
  Terminal,
  WifiOff,
} from 'lucide-react';
import { statusLabel, type ExecutionEvent, type Run } from '../types';
import { isSecurityEvidence } from '../security';
import CopyValue from './CopyValue';
import { CONDITION_LABELS } from './research/labels';
import ResearchRuntimeFacts from './research/ResearchRuntimeFacts';

export function eventStatus(event: ExecutionEvent) {
  if (['model.filter_blocked', 'provider.filtered'].includes(event.event_type))
    return 'Bị chặn bởi bộ lọc Gemini';
  if (event.result.enforced_by === 'mandatory' && event.status === 'blocked')
    return 'Bị chặn bởi chính sách công cụ bắt buộc';
  if (
    event.event_type === 'skillguard.quarantined' ||
    (event.result.enforced_by === 'skillguard' && event.status === 'blocked')
  )
    return 'Bị chặn bởi SkillGuard';
  if (event.event_type === 'skillguard.filtered') return 'Đã lọc bởi SkillGuard';
  if (event.event_type === 'research.isolation_failed') return 'Cách ly không đạt';
  if (event.status === 'blocked' || event.status === 'failed' || event.status === 'cancelled')
    return statusLabel[event.status];
  if (
    event.result.stage === 'REPORT_VERIFIED' ||
    (event.event_type === 'report.created' &&
      (event.result.validation as { status?: string })?.status === 'verified')
  )
    return 'Đã xác minh';
  if (['tool.requested', 'tool.proposed', 'mcp.proposal'].includes(event.event_type))
    return 'Đề xuất';
  if (event.event_type === 'tool.completed')
    return event.source === 'acp' ? 'ACP báo hoàn tất' : 'Đã thực thi';
  if (event.permission_decision === 'allow' || event.result.stage === 'AUTHORIZED')
    return 'Đã cấp quyền';
  return statusLabel[event.status];
}

function EventRow({ event, onExpand }: { event: ExecutionEvent; onExpand: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const timestamp = new Date(event.timestamp);
  return (
    <details
      className="timeline-event"
      data-event={event.id}
      onToggle={(e) => {
        setExpanded(e.currentTarget.open);
        if (e.currentTarget.open) onExpand();
      }}
    >
      <summary title={event.message}>
        <ChevronRight size={13} className="execution-chevron" />
        <span className="execution-event-label">
          <strong>{event.message}</strong>
          <small>
            {timestamp.toLocaleTimeString('vi-VN')} · {event.source}
          </small>
        </span>
        <span className={`execution-status ${event.status}`}>{eventStatus(event)}</span>
      </summary>
      {expanded && (
        <div className="execution-event-detail">
          <div className="execution-detail-heading">
            <h3>Chi tiết sự kiện</h3>
            <CopyValue label="sự kiện" value={JSON.stringify(event, null, 2)} />
          </div>
          <dl>
            <dt>Thời điểm</dt>
            <dd>{timestamp.toLocaleString('vi-VN')}</dd>
            <dt>Sự kiện</dt>
            <dd>
              <code>{event.event_type}</code>
            </dd>
            {event.tool_name && (
              <>
                <dt>Công cụ</dt>
                <dd>{event.tool_name}</dd>
              </>
            )}
            {event.permission_decision && (
              <>
                <dt>Quyền</dt>
                <dd>{event.permission_decision}</dd>
              </>
            )}
            {event.duration_ms != null && (
              <>
                <dt>Thời lượng</dt>
                <dd>{event.duration_ms} ms</dd>
              </>
            )}
          </dl>
          {event.error && <p className="execution-status failed">{event.error}</p>}
          {Object.keys(event.arguments).length > 0 && (
            <details className="execution-payload">
              <summary>Tham số</summary>
              <pre>{JSON.stringify(event.arguments, null, 2)}</pre>
            </details>
          )}
          {Object.keys(event.result).length > 0 && (
            <details className="execution-payload">
              <summary>Kết quả và tệp ghi nhận</summary>
              <pre>{JSON.stringify(event.result, null, 2)}</pre>
            </details>
          )}
          {Array.isArray(event.result.content) &&
            event.result.content
              .filter((item) => item?.type === 'diff' && typeof item.path === 'string')
              .map((item, index) => (
                <details className="execution-payload" key={`${item.path}-${index}`}>
                  <summary>Diff · {item.path}</summary>
                  <pre className="activity-diff">
                    <del>{typeof item.oldText === 'string' ? item.oldText : ''}</del>
                    {'\n'}
                    <ins>{typeof item.newText === 'string' ? item.newText : ''}</ins>
                  </pre>
                </details>
              ))}
          <details className="execution-payload">
            <summary>Mã định danh</summary>
            <dl>
              <dt>Run ID</dt>
              <dd>
                <code>{event.run_id}</code>
                <CopyValue label="Run ID" value={event.run_id} />
              </dd>
              <dt>Step ID</dt>
              <dd>
                <code>{event.step_id}</code>
                <CopyValue label="Step ID" value={event.step_id} />
              </dd>
            </dl>
          </details>
        </div>
      )}
    </details>
  );
}

export default function ExecutionCenter({
  width,
  run,
  runs,
  events,
  skillName,
  focusEvent,
  streamLost,
  actions,
  onClose,
  onSelect,
  onCondition,
  onExport,
}: {
  width: number;
  run?: Run;
  runs: Run[];
  events: ExecutionEvent[];
  skillName?: string;
  focusEvent?: ExecutionEvent;
  streamLost: boolean;
  actions?: ReactNode;
  onClose: () => void;
  onSelect: (run: Run) => void;
  onCondition: (id: string) => void;
  onExport: () => void;
}) {
  const [permissions, setPermissions] = useState(false);
  const [following, setFollowing] = useState(true);
  const timeline = useRef<HTMLDivElement>(null);
  const handled = useRef<ExecutionEvent | undefined>(undefined);
  const current = focusEvent?.run_id === run?.id ? focusEvent : undefined;
  const visible = permissions
    ? events.filter(
        (event) =>
          event.permission_decision ||
          isSecurityEvidence(event) ||
          event.event_type === 'tool.blocked' ||
          event.event_type === 'research.isolation_failed',
      )
    : events;
  const related = run?.experiment_id
    ? runs.filter((item) => item.experiment_id === run.experiment_id)
    : [];

  useEffect(() => {
    setFollowing(true);
    setPermissions(false);
  }, [run?.id]);
  useEffect(() => {
    if (!current) return;
    setPermissions(false);
    setFollowing(false);
  }, [current]);
  useEffect(() => {
    if (!current || permissions || following || handled.current === current) return;
    const row = [
      ...(timeline.current?.querySelectorAll<HTMLDetailsElement>('[data-event]') ?? []),
    ].find((item) => item.dataset.event === current.id);
    if (row) {
      handled.current = current;
      row.open = true;
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [current, permissions, following, events]);
  useEffect(() => {
    if (following && timeline.current && (!current || handled.current === current)) {
      timeline.current.scrollTop = timeline.current.scrollHeight;
    }
  }, [following, current, events, permissions]);

  return (
    <aside className="execution-panel" style={{ width }} aria-label="Trung tâm thực thi">
      <header className="execution-header">
        <Terminal size={17} />
        <h2>Trung tâm thực thi</h2>
        <button
          className="execution-icon"
          title="Thu gọn bảng"
          aria-label="Thu gọn bảng"
          onClick={onClose}
        >
          <PanelRightClose size={16} />
        </button>
      </header>
      {run ? (
        <>
          <div className="execution-overview">
            <select
              aria-label="Tác vụ đang xem"
              value={run.id}
              onChange={(event) => {
                const selection = runs.find((item) => item.id === event.target.value);
                if (selection) onSelect(selection);
              }}
            >
              {runs.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            {related.length > 1 && (
              <div className="execution-conditions" role="group" aria-label="Điều kiện thí nghiệm">
                {related
                  .filter((item) => item.condition)
                  .map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onCondition(item.id)}
                      aria-pressed={item.id === run.id}
                    >
                      {CONDITION_LABELS[item.condition!]}
                    </button>
                  ))}
              </div>
            )}
            <div className="execution-run-meta">
              <span className={`execution-status ${run.status}`}>{statusLabel[run.status]}</span>
              {run.mode === 'demo' && <span>Demo</span>}
              {run.condition && related.length < 2 && (
                <span>{CONDITION_LABELS[run.condition]}</span>
              )}
              {skillName && <span>{skillName}</span>}
            </div>
            {run.condition ||
            run.execution_engine === 'acp_appcontainer' ||
            events.some(
              (event) =>
                event.event_type === 'research.isolation_verified' ||
                event.event_type === 'research.isolation_failed',
            ) ? (
              <ResearchRuntimeFacts condition={run.condition} events={events} />
            ) : (
              <details className="execution-facts">
                <summary>
                  <ChevronRight size={13} className="execution-chevron" />
                  <strong>Bằng chứng thực thi</strong>
                </summary>
                <dl>
                  <dt>Chế độ</dt>
                  <dd>{run.mode === 'demo' ? 'Demo tổng hợp' : 'Thực thi thực tế'}</dd>
                  {run.execution_engine === 'local_deterministic' ? (
                    <>
                      <dt>Tiến trình</dt>
                      <dd>Python · bảng tính cục bộ</dd>
                    </>
                  ) : (
                    run.model && (
                      <>
                        <dt>Model</dt>
                        <dd>{run.model}</dd>
                      </>
                    )
                  )}
                  {run.session_id && (
                    <>
                      <dt>Phiên ACP</dt>
                      <dd>
                        <code>{run.session_id}</code>
                        <CopyValue label="ID phiên ACP" value={run.session_id} />
                      </dd>
                    </>
                  )}
                </dl>
              </details>
            )}
            {actions}
          </div>
          {streamLost && (
            <p className="execution-stream">
              <WifiOff size={13} /> Đang nối lại luồng sự kiện…
            </p>
          )}
          <div className="execution-toolbar" role="group" aria-label="Lọc sự kiện">
            <button aria-pressed={!permissions} onClick={() => setPermissions(false)}>
              Tất cả
            </button>
            <button aria-pressed={permissions} onClick={() => setPermissions(true)}>
              Quyền truy cập
            </button>
            <span>{visible.length}</span>
            <button
              className="execution-icon"
              title="Tới sự kiện mới nhất"
              aria-label="Tới sự kiện mới nhất"
              onClick={() => {
                setFollowing(true);
                if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
              }}
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="execution-icon"
              title="Xuất sự kiện"
              aria-label="Xuất sự kiện"
              onClick={onExport}
            >
              <Download size={14} />
            </button>
          </div>
          <div
            className="timeline"
            ref={timeline}
            tabIndex={0}
            aria-label="Dòng thời gian"
            onScroll={(event) => {
              const node = event.currentTarget;
              setFollowing(node.scrollHeight - node.clientHeight - node.scrollTop < 40);
            }}
          >
            {visible.length ? (
              visible.map((event) => (
                <EventRow key={event.id} event={event} onExpand={() => setFollowing(false)} />
              ))
            ) : (
              <p className="execution-empty">Chưa ghi nhận sự kiện.</p>
            )}
          </div>
        </>
      ) : (
        <p className="execution-empty">Chọn một tác vụ để xem dòng thời gian.</p>
      )}
    </aside>
  );
}
