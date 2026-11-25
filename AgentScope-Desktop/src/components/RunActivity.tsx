import {
  ArrowDownToLine,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Code2,
  Cpu,
  FileSpreadsheet,
  FileText,
  Layers3,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { statusLabel, type ExecutionEvent, type Run } from '../types';
import { eventStatus } from './ExecutionCenter';
import SkillExposure from './skills/SkillExposure';

export const runReports = (run: Run) => run.reports ?? (run.result ? [run.result] : []);

const activityEvent = (event: ExecutionEvent) =>
  /^(tool|mcp|permission|skill|session|report|workflow|prompt|security|model)\./.test(
    event.event_type,
  ) ||
  ['provider.filtered', 'provider.refused', 'provider.incomplete', 'runtime.error'].includes(
    event.event_type,
  );

const TOOL_TITLES: Record<string, string> = {
  list_sheets: 'Liệt kê trang tính',
  read_sheet: 'Đọc dữ liệu trang tính',
  calculate_totals: 'Tính tổng hợp số liệu',
  analyze_sales_kpis: 'Phân tích KPI & biên lợi nhuận',
  analyze_sales_trends: 'Phân tích xu hướng bán hàng',
  generate_business_report: 'Lập báo cáo kinh doanh (Markdown)',
  propose_report: 'Đề xuất số liệu báo cáo',
  create_excel_report: 'Tạo tệp báo cáo Excel',
  run_python_code: 'Đề xuất chạy mã Python (Code Interpreter)',
  run_skill_script: 'Yêu cầu chạy script đi kèm Skill',
  inspect_workspace_files: 'Kiểm tra tệp trong workspace',
  read_workspace_file: 'Đọc tệp trong workspace',
  write_workspace_artifact: 'Tạo tệp trong workspace',
};

const TOOLBAR_LABELS: Record<string, string> = {
  list_sheets: 'Trang tính',
  read_sheet: 'Đọc bảng',
  calculate_totals: 'Tính tổng',
  analyze_sales_kpis: 'Phân tích KPI',
  analyze_sales_trends: 'Xu hướng',
  generate_business_report: 'Báo cáo KD',
  propose_report: 'Đề xuất số liệu',
  create_excel_report: 'Xuất Excel',
  run_python_code: 'Code Interpreter (Python)',
  run_skill_script: 'Script Skill',
};

const PROBE_TOOLS = new Set(['run_python_code', 'run_skill_script']);

function stepTitle(group: ExecutionEvent[]) {
  const last = group[group.length - 1];
  const tool = last.tool_name;
  if (tool && TOOL_TITLES[tool]) {
    if (tool === 'read_sheet') {
      const sheetArg = group.find((e) => typeof e.arguments?.sheet === 'string')?.arguments?.sheet;
      if (typeof sheetArg === 'string' && sheetArg) {
        return `Đọc trang tính ${sheetArg}`;
      }
    }
    return TOOL_TITLES[tool];
  }
  return last.message || tool || 'Bước thực thi';
}

function stepSubtitle(group: ExecutionEvent[], title: string) {
  const last = group[group.length - 1];
  if (!last.tool_name) return '';
  if (last.message && last.message !== title && !last.message.startsWith('ACP cho phép')) {
    return last.message;
  }
  return last.tool_name;
}

function StepIcon({ event }: { event: ExecutionEvent }) {
  const type = event.event_type;
  const tool = event.tool_name || '';
  if (event.status === 'blocked' || event.status === 'failed') {
    return <ShieldAlert size={14} className="step-glyph danger" />;
  }
  if (type.startsWith('skillguard.')) {
    return <ShieldCheck size={14} className="step-glyph shield" />;
  }
  if (type.startsWith('skill.')) {
    return <Layers3 size={14} className="step-glyph accent" />;
  }
  if (type.startsWith('model.') || type.startsWith('session.') || type.startsWith('prompt.')) {
    return <Cpu size={14} className="step-glyph accent" />;
  }
  if (tool === 'calculate_totals' || tool === 'analyze_sales_kpis') {
    return <BarChart3 size={14} className="step-glyph good" />;
  }
  if (tool === 'analyze_sales_trends') {
    return <TrendingUp size={14} className="step-glyph good" />;
  }
  if (tool === 'propose_report' || tool === 'generate_business_report') {
    return <FileText size={14} className="step-glyph good" />;
  }
  if (tool === 'run_python_code') {
    return <Code2 size={14} className="step-glyph danger" />;
  }
  if (
    tool === 'list_sheets' ||
    tool === 'read_sheet' ||
    tool === 'create_excel_report' ||
    type.startsWith('report.')
  ) {
    return <FileSpreadsheet size={14} className="step-glyph good" />;
  }
  if (type.startsWith('mcp.')) {
    return <Wrench size={14} className="step-glyph muted" />;
  }
  return <Terminal size={14} className="step-glyph muted" />;
}

interface ActivityGroup {
  key: string;
  events: ExecutionEvent[];
  sourceKind: 'acp' | 'mcp' | 'other';
  toolName?: string;
}

function groupActivityEvents(events: ExecutionEvent[]): ActivityGroup[] {
  const raw = new Map<string, ActivityGroup>();
  for (const event of events.filter(activityEvent)) {
    const call = event.result.tool_call_id;
    const sequence = event.result.sequence;
    let key: string;
    let sourceKind: 'acp' | 'mcp' | 'other';
    if (typeof call === 'string') {
      key = `acp:${call}`;
      sourceKind = 'acp';
    } else if (event.source === 'mcp' && event.tool_name && typeof sequence === 'number') {
      key = `mcp:${sequence}`;
      sourceKind = 'mcp';
    } else {
      key = event.step_id;
      sourceKind = 'other';
    }
    const existing = raw.get(key);
    if (existing) {
      existing.events.push(event);
      if (event.tool_name) existing.toolName = event.tool_name;
    } else {
      raw.set(key, {
        key,
        events: [event],
        sourceKind,
        toolName: event.tool_name,
      });
    }
  }

  // Merge paired ACP authorization + MCP execution steps for the same tool call
  // so the timeline reads cleanly like Antigravity's Agent steps.
  const merged: ActivityGroup[] = [];
  for (const group of raw.values()) {
    if (group.sourceKind === 'mcp' && group.toolName) {
      const pendingAcp = merged.find(
        (candidate) => candidate.sourceKind === 'acp' && candidate.toolName === group.toolName,
      );
      if (pendingAcp) {
        pendingAcp.events.push(...group.events);
        pendingAcp.sourceKind = 'mcp';
        pendingAcp.key = group.key;
        continue;
      }
    }
    merged.push(group);
  }
  return merged;
}

export default function RunActivity({
  run,
  events,
  onInspect,
  onOpen,
  onDownload,
}: {
  run: Run;
  events: ExecutionEvent[];
  onInspect: (event: ExecutionEvent) => void;
  onOpen: () => void;
  onDownload: (id: string, name: string) => void;
}) {
  const isLive = ['pending', 'running', 'awaiting_approval', 'paused'].includes(run.status);
  const [initiallyOpen] = useState(() => isLive);
  const groups = groupActivityEvents(events);
  const reports = runReports(run);
  const sessionModel =
    events
      .slice()
      .reverse()
      .map((e) => (typeof e.result?.model === 'string' ? e.result.model : ''))
      .find(Boolean) || run.model;

  const discoveredTools = (() => {
    const discovery = events.find(
      (e) => e.event_type === 'mcp.discovered' && Array.isArray(e.result?.tools),
    );
    if (!discovery || !Array.isArray(discovery.result.tools)) return [];
    return discovery.result.tools.filter((t): t is string => typeof t === 'string' && t in TOOLBAR_LABELS);
  })();
  const executedTools = new Set(
    events
      .filter((e) => e.event_type === 'tool.completed' && e.tool_name)
      .map((e) => e.tool_name as string),
  );
  const blockedTools = new Set(
    events
      .filter((e) => (e.status === 'blocked' || e.event_type === 'tool.blocked') && e.tool_name)
      .map((e) => e.tool_name as string),
  );
  const proposedTools = new Set(
    events
      .filter((e) => (e.event_type === 'tool.proposed' || e.event_type === 'mcp.proposal') && e.tool_name)
      .map((e) => e.tool_name as string),
  );

  const headline = isLive
    ? 'AI Agent đang xử lý…'
    : run.status === 'completed'
      ? 'Hoạt động AI Agent'
      : run.status === 'blocked'
        ? 'AI Agent đã chặn thao tác'
        : 'Hoạt động AI Agent';

  return (
    <div className={`run-activity ${isLive ? 'is-live' : ''} state-${run.status}`}>
      <details className="activity-thread" open={initiallyOpen}>
        <summary>
          <span className={`agent-orb ${run.status}`} aria-hidden="true">
            {isLive ? (
              <LoaderCircle size={14} className="spin" />
            ) : run.status === 'completed' ? (
              <CheckCircle2 size={14} />
            ) : run.status === 'failed' || run.status === 'blocked' ? (
              <ShieldAlert size={14} />
            ) : (
              <Sparkles size={14} />
            )}
          </span>
          <div className="activity-heading">
            <strong>{headline}</strong>
            <span className="activity-meta">
              {run.mode === 'demo' ? 'Demo · ' : ''}
              {groups.length} bước
            </span>
          </div>
          {sessionModel && (
            <span className="activity-model-pill" title={`Model đang chạy: ${sessionModel}`}>
              <Cpu size={11} aria-hidden="true" />
              {sessionModel}
            </span>
          )}
          <span className={`activity-state ${run.status}`}>{statusLabel[run.status]}</span>
          <ChevronRight className="activity-chevron" size={14} />
        </summary>
        {discoveredTools.length > 0 && (
          <div className="agent-toolbar" aria-label="Thanh công cụ AI Agent">
            <span className="agent-toolbar-label">
              <Wrench size={11} aria-hidden="true" /> Công cụ AI ({discoveredTools.length})
            </span>
            <div className="agent-toolbar-pills">
              {discoveredTools.map((tool) => {
                const state = blockedTools.has(tool)
                  ? 'blocked'
                  : executedTools.has(tool)
                    ? 'used'
                    : proposedTools.has(tool)
                      ? 'active'
                      : isLive
                        ? 'ready'
                        : 'ignored';
                const suffix =
                  state === 'blocked'
                    ? ' · Đề xuất (bị chặn)'
                    : state === 'ignored' && PROBE_TOOLS.has(tool)
                      ? ' · Gemini bỏ qua'
                      : state === 'ignored'
                        ? ' · Chưa dùng'
                        : '';
                return (
                  <span
                    key={tool}
                    className={`agent-tool-pill ${state}${PROBE_TOOLS.has(tool) ? ' probe' : ''}`}
                    title={`${tool}: ${
                      state === 'blocked'
                        ? 'AI đã đề xuất gọi công cụ này và bị chặn an toàn'
                        : state === 'used'
                          ? 'AI đã gọi và thực thi thành công'
                          : state === 'ignored'
                            ? 'Công cụ đã mở cho AI nhưng AI bỏ qua không gọi'
                            : 'Đang sẵn sàng cho AI sử dụng'
                    }`}
                  >
                    {state === 'used' && <Check size={10} aria-hidden="true" />}
                    {state === 'blocked' && <ShieldAlert size={10} aria-hidden="true" />}
                    {PROBE_TOOLS.has(tool) && state !== 'blocked' && (
                      <Code2 size={10} aria-hidden="true" />
                    )}
                    {TOOLBAR_LABELS[tool] || tool}
                    {suffix}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="activity-list">
          {groups.map(({ key, events: group }) => {
            const last = group[group.length - 1];
            const title = stepTitle(group);
            const subtitle = stepSubtitle(group, title);
            return (
              <details className="activity-step" key={key}>
                <summary>
                  <span className={`step-icon-wrap ${last.status}`}>
                    <StepIcon event={last} />
                  </span>
                  <div className="activity-step-text">
                    <span className="activity-step-title">{title}</span>
                    {subtitle && <small className="activity-step-sub">{subtitle}</small>}
                  </div>
                  <small className={`activity-state ${last.status}`}>{eventStatus(last)}</small>
                  <ChevronRight className="activity-chevron" size={13} />
                </summary>
                <div className="activity-step-body">
                  {group.map((event) => (
                    <div className="activity-evidence" key={event.id}>
                      <button className="activity-event" onClick={() => onInspect(event)}>
                        <span>{event.message}</span>
                        <code>
                          {event.source} · {event.event_type}
                        </code>
                      </button>
                      {Object.keys(event.arguments).length > 0 && (
                        <>
                          <small>Tham số</small>
                          <pre>{JSON.stringify(event.arguments, null, 2)}</pre>
                        </>
                      )}
                      {event.permission_decision && (
                        <small>Quyền truy cập · {eventStatus(event)}</small>
                      )}
                      {Object.keys(event.result).length > 0 && (
                        <>
                          <small>Kết quả ghi nhận</small>
                          <pre>{JSON.stringify(event.result, null, 2)}</pre>
                        </>
                      )}
                      {Array.isArray(event.result.content) &&
                        event.result.content
                          .filter((item) => item?.type === 'diff' && typeof item.path === 'string')
                          .map((item, index) => (
                            <div className="activity-diff" key={`${item.path}-${index}`}>
                              <strong>{item.path}</strong>
                              <pre>
                                <del>{item.oldText ?? ''}</del>
                              </pre>
                              <pre>
                                <ins>{item.newText ?? ''}</ins>
                              </pre>
                            </div>
                          ))}
                      {event.error && (
                        <small className="activity-state failed">{event.error}</small>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
          <div className="activity-footer">
            <button className="activity-inspect" onClick={onOpen}>
              Mở bảng thực thi <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </details>
      <SkillExposure events={events} />
      {reports.map((report) => (
        <button
          className="result-card"
          key={report.file_id}
          onClick={() => onDownload(report.file_id, report.name)}
        >
          <ArrowDownToLine size={17} />
          <span>
            <strong>{report.name}</strong>
            <small>
              {report.source_name && `${report.source_name} · `}
              {report.rows} dòng · Excel
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
