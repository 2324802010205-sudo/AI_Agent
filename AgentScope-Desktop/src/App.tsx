import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  FolderOpen,
  History,
  Layers3,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import Markdown from './components/Markdown';
import RunActivity, { runReports } from './components/RunActivity';
import ResearchLab from './components/ResearchLab';
import AnswerEvaluation from './components/AnswerEvaluation';
import IsolatedInjectionLab from './components/IsolatedInjectionLab';
import SkillEvidence, {
  canEnableSkill,
  isEnabledSkill,
  skillScanLabel,
} from './components/SkillEvidence';
import LocalSkillTest from './components/LocalSkillTest';
import IsolatedSkillReview from './components/IsolatedSkillReview';
import SkillSource from './components/SkillSource';
import SkillManager from './components/skills/SkillManager';
import SkillStateBadge from './components/skills/SkillStateBadge';
import SkillSwitch from './components/skills/SkillSwitch';
import {
  SKILL_STATE_HINT,
  SKILL_STATE_LABEL,
  activeSkillsLabel,
  isSkillToggleable,
  shortId,
  skillState,
  stateCounts,
} from './components/skills/skillState';
import ResearchControl, {
  ReadinessStatus,
  type ResearchOptions,
} from './components/research/ResearchControl';
import ExperimentCard from './components/research/ExperimentCard';
import ExecutionCenter from './components/ExecutionCenter';
import {
  AdvancedResearch,
  ExperimentHistory,
  ResearchPolicyPanel,
} from './components/research/ResearchPanels';
import { CONDITION_LABELS } from './components/research/labels';
import type { Condition, ResearchMode, ResearchReadiness } from './types/research';
import { api, configureConnection, developmentBackendUrl, type ModelTestResult } from './api';
import { mergeMessages } from './messages';
import { runtimeStatus } from './status';
import { isSecurityEvidence, securityLabel } from './security';
import {
  statusLabel,
  type AntigravityModel,
  type Attachment,
  type Conversation,
  type ExecutionEvent,
  type Message,
  type Mode,
  type Run,
  type Settings,
  type Skill,
  type SkillRuntimeSummary,
  type Status,
} from './types';

type Page =
  | 'Chat'
  | 'Tasks'
  | 'Skills'
  | 'Bảo mật'
  | 'Lịch sử'
  | 'Báo cáo'
  | 'Cài đặt'
  | 'Lab nghiên cứu'
  | 'Đánh giá PI'
  | 'Lab PI cô lập'
  | 'Thí nghiệm';
const HISTORY_PAGES: Page[] = ['Lịch sử', 'Thí nghiệm', 'Tasks', 'Báo cáo'];
const MAX_SELECTED_FILES = 5;
const activeRun = (run: Run) =>
  ['running', 'paused', 'awaiting_approval', 'pending'].includes(run.status);
const NO_EVENTS: ExecutionEvent[] = [];
const ADVANCED_PAGES: Page[] = ['Lab PI cô lập', 'Đánh giá PI', 'Lab nghiên cứu'];
// Progressive disclosure: four everyday destinations, research depth one level down.
const navigation: { page: Page; label: string; icon: typeof MessageSquare; group: Page[] }[] = [
  { page: 'Chat', label: 'Chat', icon: MessageSquare, group: ['Chat'] },
  { page: 'Skills', label: 'Skills', icon: Layers3, group: ['Skills'] },
  { page: 'Bảo mật', label: 'Bảo mật', icon: ShieldCheck, group: ['Bảo mật'] },
  { page: 'Thí nghiệm', label: 'Lịch sử & Kết quả', icon: History, group: HISTORY_PAGES },
  {
    page: 'Lab PI cô lập',
    label: 'Nghiên cứu nâng cao',
    icon: FlaskConical,
    group: ADVANCED_PAGES,
  },
];
const HISTORY_TABS: [Page, string][] = [
  ['Thí nghiệm', 'Thí nghiệm & so sánh'],
  ['Lịch sử', 'Cuộc trò chuyện & nhật ký'],
  ['Tasks', 'Tác vụ'],
  ['Báo cáo', 'Báo cáo Excel'],
];
const time = (value: string) =>
  new Date(value).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
const date = (value: string) =>
  new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: 'short' });
const size = (bytes: number) =>
  bytes > 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
function Logo({ large = false }: { large?: boolean }) {
  return (
    <div className={`logo ${large ? 'large' : ''}`}>
      <svg viewBox="0 0 32 32" fill="none">
        <path d="m16 3 11 6.5v13L16 29 5 22.5v-13L16 3Z" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="m10 21 6-12 6 12m-10-4h8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Badge({ status, children }: { status?: Status; children?: ReactNode }) {
  return (
    <span className={`badge ${status || ''}`}>
      <span />
      {children || statusLabel[status || 'pending']}
    </span>
  );
}
function StatusIcon({ status }: { status: Status }) {
  return status === 'completed' ? (
    <Check size={14} />
  ) : status === 'running' ? (
    <LoaderCircle size={14} className="spin" />
  ) : status === 'failed' || status === 'blocked' ? (
    <X size={14} />
  ) : status === 'awaiting_approval' ? (
    <LockKeyhole size={13} />
  ) : status === 'paused' ? (
    <Pause size={13} />
  ) : (
    <Circle size={10} />
  );
}
function Empty({
  icon,
  children,
  description,
}: {
  icon: ReactNode;
  children: ReactNode;
  description: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{children}</h3>
      <p>{description}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton label="Đóng" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}
function FileCard({
  file,
  onRemove,
  onDownload,
}: {
  file: Attachment;
  onRemove?: () => void;
  onDownload?: () => void;
}) {
  return (
    <div className="file-card">
      <span className="file-icon">
        <FileSpreadsheet size={21} />
      </span>
      <div>
        <strong>{file.name}</strong>
        <small>
          {file.type.toUpperCase()} <i>·</i> {size(file.size)}
        </small>
      </div>
      {onRemove && (
        <IconButton label={`Gỡ ${file.name}`} onClick={onRemove}>
          <X size={14} />
        </IconButton>
      )}
      {onDownload && (
        <IconButton label={`Tải ${file.name}`} onClick={onDownload}>
          <Download size={15} />
        </IconButton>
      )}
    </div>
  );
}
function saveJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flaggedSkillPaths(skill?: Skill) {
  return [
    ...new Set(
      skill?.security?.findings
        .filter(({ category }) => category !== 'informational')
        .map(({ path }) => path),
    ),
  ];
}

export default function App() {
  const [page, setPage] = useState<Page>('Chat');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const isNative = '__TAURI_INTERNALS__' in window;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState('');
  const [eventCache, setEventCache] = useState<Record<string, ExecutionEvent[]>>({});
  const [skills, setSkills] = useState<Skill[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [mode, setMode] = useState<Mode>('real');
  const [prompt, setPrompt] = useState('');
  const [workbooks, setWorkbooks] = useState<Attachment[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [loadedFilesFor, setLoadedFilesFor] = useState('');
  const [attachmentError, setAttachmentError] = useState(false);
  const [attachmentReload, setAttachmentReload] = useState(0);
  const [researchFileId, setResearchFileId] = useState('');
  const [importedSkillIds, setImportedSkillIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [monitorWidth, setMonitorWidth] = useState(314);
  const [selectedEvent, setSelectedEvent] = useState<ExecutionEvent>();
  const [dragging, setDragging] = useState(false);
  const [inspectingId, setInspectingId] = useState('');
  const [togglingSkillIds, setTogglingSkillIds] = useState<ReadonlySet<string>>(new Set());
  const skillsSyncSeq = useRef(0);
  const [skillSummary, setSkillSummary] = useState<SkillRuntimeSummary>();
  const [readingSkillId, setReadingSkillId] = useState('');
  const [reviewingSkill, setReviewingSkill] = useState<{ skill: Skill; conversationId?: string }>();
  const [removing, setRemoving] =
    useState<Pick<Skill, 'id' | 'name' | 'created_at' | 'package_sha256'>>();
  const [skillMutation, setSkillMutation] = useState(false);
  const [skillDrafts, setSkillDrafts] = useState<Record<string, string>>({});
  const savedSkill = conversations.find((item) => item.id === conversation)?.selected_skill_id;
  const taskSkill = skillDrafts[conversation] ?? savedSkill ?? '';
  const setSkillSelection = (value: string, target = conversation) =>
    setSkillDrafts((current) => ({ ...current, [target]: value }));
  const [labSkillId, setLabSkillId] = useState('');
  const [researchMode, setResearchMode] = useState<ResearchMode>('normal');
  const [readiness, setReadiness] = useState<ResearchReadiness>();
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [researchOptions, setResearchOptions] = useState<ResearchOptions>({
    policy: 'filter',
    includeBaseline: true,
    model: '',
  });
  const [followExperiment, setFollowExperiment] = useState('');
  const inspecting = skills.find((skill) => skill.id === inspectingId);
  const readingSkill = skills.find((skill) => skill.id === readingSkillId);
  const readingQuarantinedSkill = !!readingSkill && skillState(readingSkill) === 'quarantined';
  const readingFlaggedFiles = flaggedSkillPaths(readingSkill);
  const enabledSkills = skills.filter(isEnabledSkill);
  const flaggedEnabledSkills = enabledSkills.filter(
    (skill) =>
      skillState(skill) === 'quarantined' ||
      (!!skill.security && skill.security.assessment !== 'no_significant_findings'),
  );
  const showSkillWarnings = researchMode === 'skillguard_on' || researchMode === 'compare';
  const primaryFlaggedSkill = flaggedEnabledSkills[0];
  const flaggedFiles = flaggedSkillPaths(primaryFlaggedSkill);
  const [logSearch, setLogSearch] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const [logTool, setLogTool] = useState('');
  const [logDecision, setLogDecision] = useState('');
  const [logType, setLogType] = useState('');
  const [logSince, setLogSince] = useState('');
  const [logRun, setLogRun] = useState('');
  const [logCleared, setLogCleared] = useState('');
  const [allAudit, setAllAudit] = useState<ExecutionEvent[]>([]);
  const [logsOpen, setLogsOpen] = useState(true);
  const [session, setSession] = useState('');
  const [providerKey, setProviderKey] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('openai');
  const [testing, setTesting] = useState(false);
  const [modelTest, setModelTest] = useState<ModelTestResult>();
  const [modelTestError, setModelTestError] = useState('');
  const [antigravityModels, setAntigravityModels] = useState<AntigravityModel[]>([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const autoDiscoveredModels = useRef(false);
  const availableAntigravityModels: AntigravityModel[] = (() => {
    const byId = new Map<string, AntigravityModel>();
    for (const item of antigravityModels) byId.set(item.id, item);
    for (const id of readiness?.models ?? []) {
      if (!byId.has(id)) byId.set(id, { id, name: id });
    }
    return [...byId.values()];
  })();
  const [streamLost, setStreamLost] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const skillInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const conversationScroll = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const run = runs.find((r) => r.id === runId);
  const events = eventCache[runId] ?? NO_EVENTS;
  const runSkillName =
    run?.loaded_skills?.map(({ name }) => name).join(', ') ||
    run?.skill_name ||
    skills.find((skill) => skill.id === run?.skill_id)?.name ||
    (run?.skill_id ? 'Skill đã gỡ' : undefined);
  const active = runs.find((item) => item.conversation_id === conversation && activeRun(item));
  const liveRunId = active?.id;
  const attachments = selectedFiles.flatMap((id) => workbooks.find((file) => file.id === id) ?? []);
  const researchWorkbooks = workbooks.filter((file) => /\.(xlsx|csv)$/i.test(file.name));
  const researchWorkbook = researchWorkbooks.find(
    (file) => file.id === (researchFileId || (attachments.length === 1 ? attachments[0].id : '')),
  );
  const attachmentsLoading = !!conversation && loadedFilesFor !== conversation;
  const runtime = runtimeStatus(connected, connecting, mode, settings);
  const toast = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 6500);
  }, []);
  const clearModelTest = () => {
    setModelTest(undefined);
    setModelTestError('');
  };
  const runProviderTest = async () => {
    clearModelTest();
    setTesting(true);
    try {
      if (provider === 'antigravity') {
        const result = await api.testProvider(model.trim() || undefined);
        if (result.models && result.models.length > 0) {
          setAntigravityModels(result.models);
        }
        if (result.response !== undefined && result.duration_ms !== undefined) {
          setModelTest({
            provider: 'antigravity',
            model: result.model || model.trim() || 'Antigravity ACP',
            duration_ms: result.duration_ms,
            response: result.response,
          });
        }
        toast(result.message);
      } else if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') {
        setModelTest(
          await api.testModel({
            provider,
            model: model.trim(),
            api_key: providerKey.trim() || undefined,
          }),
        );
      }
    } catch (e) {
      if (provider === 'antigravity') {
        setModelTestError((e as Error).message);
        toast((e as Error).message);
      } else setModelTestError((e as Error).message);
    } finally {
      if (provider === 'antigravity') {
        try {
          const latest = await api.settings();
          setSettings(latest);
          if (latest.antigravity?.models && latest.antigravity.models.length > 0) {
            setAntigravityModels(latest.antigravity.models);
          }
        } catch {
          /* Keep the last observed status. */
        }
      }
      setTesting(false);
    }
  };
  const refresh = useCallback(async (current: () => boolean) => {
    const [cs, rs, ss, st] = await Promise.all([
      api.conversations(),
      api.runs(),
      api.skills(),
      api.settings(),
    ]);
    if (!current()) return;
    setConversations(cs);
    setRuns(rs);
    setSkills(ss);
    setSettings(st);
    if (st.antigravity?.models && st.antigravity.models.length > 0) {
      setAntigravityModels(st.antigravity.models);
    }
    setMode(st.mode);
    setProvider(st.provider);
    setModel(st.model || '');
    setConnected(true);
    setStreamLost(false);
  }, []);
  const loadReadiness = useCallback(async (current: () => boolean = () => true) => {
    try {
      const report = await api.researchReadiness();
      if (current()) setReadiness(report);
    } catch {
      /* backend without research routes or offline */
    }
  }, []);
  const checkReadiness = useCallback(async () => {
    setCheckingReadiness(true);
    try {
      setReadiness(await api.researchCheck());
    } catch (e) {
      toast((e as Error).message);
      await loadReadiness();
    } finally {
      setCheckingReadiness(false);
    }
  }, [toast, loadReadiness]);
  const signinLab = useCallback(
    async (reset = false) => {
      try {
        const res = await api.researchSignin(reset);
        toast(res.message);
        if (reset) await loadReadiness();
      } catch (e) {
        toast((e as Error).message);
      }
    },
    [toast, loadReadiness],
  );
  const refreshModels = useCallback(async () => {
    setRefreshingModels(true);
    try {
      const res = await api.antigravityModels();
      setAntigravityModels(res.models || []);
      setSettings(await api.settings());
      if (res.models && res.models.length > 0) {
        toast(`Đã phát hiện ${res.models.length} model từ Antigravity ACP.`);
      } else {
        toast('Không tìm thấy model nào từ Antigravity ACP.');
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRefreshingModels(false);
    }
  }, [toast]);
  useEffect(() => {
    if (
      (page !== 'Cài đặt' && page !== 'Chat') ||
      !connected ||
      provider !== 'antigravity' ||
      !settings?.antigravity?.installed ||
      availableAntigravityModels.length > 0 ||
      refreshingModels ||
      autoDiscoveredModels.current ||
      typeof api.antigravityModels !== 'function'
    )
      return;
    autoDiscoveredModels.current = true;
    let active = true;
    setRefreshingModels(true);
    Promise.resolve(api.antigravityModels())
      .then((res) => {
        if (active && res?.models?.length) setAntigravityModels(res.models);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRefreshingModels(false);
      });
    return () => {
      active = false;
    };
  }, [
    page,
    connected,
    provider,
    settings?.antigravity?.installed,
    availableAntigravityModels.length,
    refreshingModels,
  ]);
  const connect = useCallback(
    async (retry: boolean, browserToken?: string, current: () => boolean = () => true) => {
      setConnecting(true);
      setConnectionError('');
      try {
        if (isNative) {
          const { invoke } = await import('@tauri-apps/api/core');
          const connection = await invoke<{ url: string; token: string }>('backend_connection', {
            retry,
          });
          if (!current()) return;
          configureConnection(connection.url, connection.token);
        } else {
          const token = browserToken?.trim();
          if (token) configureConnection(developmentBackendUrl, token);
        }
        if (!current()) return;
        await refresh(current);
        if (!current()) return;
        if (browserToken) setSession('');
        void loadReadiness(current);
      } catch (error) {
        if (current()) {
          setConnected(false);
          setReadiness(undefined);
          setConnectionError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (current()) setConnecting(false);
      }
    },
    [isNative, refresh, loadReadiness],
  );
  useEffect(() => {
    let done = false;
    void connect(false, import.meta.env.VITE_BACKEND_TOKEN, () => !done);
    return () => {
      done = true;
    };
  }, [connect]);
  useEffect(() => {
    let disposed = false;
    if (conversation)
      api
        .messages(conversation)
        .then((data) => {
          if (!disposed) setMessages((old) => mergeMessages(old, data, conversation));
        })
        .catch((e) => {
          if (!disposed) toast(e.message);
        });
    return () => {
      disposed = true;
    };
  }, [conversation, toast]);
  useEffect(() => {
    if (!conversation || conversation === loadedFilesFor) return;
    let disposed = false;
    setAttachmentError(false);
    api.attachments(conversation).then(
      ({ files, selected_ids, research_selected_id }) => {
        if (disposed) return;
        setWorkbooks(files);
        setSelectedFiles(selected_ids);
        if (research_selected_id) setResearchFileId(research_selected_id);
        setLoadedFilesFor(conversation);
      },
      (e) => {
        if (!disposed) {
          setAttachmentError(true);
          toast(e.message);
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, [conversation, loadedFilesFor, attachmentReload, toast]);
  useEffect(() => {
    let disposed = false;
    let runsRequest = 0;
    const merge = (id: string, incoming: ExecutionEvent[]) => {
      if (disposed) return;
      const snapshots = incoming
        .map((e) => e.result.message)
        .filter((m): m is Message => !!m && typeof m === 'object' && 'id' in m && 'content' in m);
      if (snapshots.length) setMessages((old) => mergeMessages(old, snapshots, conversation));
      setEventCache((old) => {
        const map = new Map((old[id] ?? []).map((e) => [e.id, e]));
        incoming.forEach((e) => map.set(e.id, e));
        return {
          ...old,
          [id]: [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
        };
      });
    };
    const subscriptions = [...new Set([runId, liveRunId])].flatMap((id) => {
      if (!id) return [];
      const snapshot = () =>
        api
          .events(id)
          .then((data) => merge(id, data))
          .catch(() => {});
      void snapshot();
      return api.subscribe(
        id,
        (e) => {
          if (disposed) return;
          merge(id, [e]);
          if (id === runId) setStreamLost(false);
          if (
            e.event_type === 'run.status' &&
            ['completed', 'failed', 'blocked', 'cancelled'].includes(e.status)
          ) {
            api
              .settings()
              .then((data) => {
                if (!disposed) {
                  setSettings(data);
                  setMode(data.mode);
                  setAntigravityModels(data.antigravity?.models || []);
                }
              })
              .catch(() => {});
          }
          if (['run.status', 'message.created', 'report.created'].includes(e.event_type)) {
            const request = ++runsRequest;
            api
              .runs()
              .then((data) => {
                if (!disposed && request === runsRequest) setRuns(data);
              })
              .catch(() => {});
            if (conversation && e.event_type !== 'report.created')
              api
                .messages(conversation)
                .then((data) => {
                  if (!disposed) setMessages((old) => mergeMessages(old, data, conversation));
                })
                .catch(() => {});
          }
        },
        () => {
          if (id === runId) setStreamLost(true);
          void snapshot();
        },
      );
    });
    return () => {
      disposed = true;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, [runId, liveRunId, conversation]);
  useEffect(() => {
    let disposed = false;
    for (const id of new Set(
      messages
        .map((m) => m.task_id || m.run_id)
        .filter((id): id is string => !!id && id !== runId && id !== liveRunId),
    )) {
      api
        .events(id)
        .then((data) => {
          if (!disposed) setEventCache((old) => ({ ...old, [id]: data }));
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
    };
  }, [messages, runId, liveRunId]);
  useEffect(() => {
    if (selectedEvent && selectedEvent.run_id !== runId) setSelectedEvent(undefined);
  }, [runId, selectedEvent]);
  useEffect(() => {
    const scroll = conversationScroll.current;
    if (scroll && followConversation.current) scroll.scrollTop = scroll.scrollHeight;
  }, [messages, liveRunId, eventCache]);
  useEffect(() => {
    if (page === 'Bảo mật' || page === 'Lịch sử')
      api
        .audit()
        .then(setAllAudit)
        .catch(() => {});
  }, [page, events]);
  useEffect(() => {
    if (!connected) return;
    let current = true;
    api
      .skillRuntimeSummary()
      .then((summary) => current && setSkillSummary(summary))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [skills, connected]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!skillMutation) {
          if (readingSkillId) setReadingSkillId('');
          else if (reviewingSkill) setReviewingSkill(undefined);
          else if (removing) setRemoving(undefined);
          else setInspectingId('');
        }
      }
      if (event.ctrlKey && event.key === 'n') {
        event.preventDefault();
        newChat();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const taskAction = async (action: string) => {
    if (!run) return;
    try {
      const updated = await api.control(run.id, action);
      setRuns((old) => old.map((r) => (r.id === run.id ? updated : r)));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const openConversation = (id: string, task?: string) => {
    if (busy || uploading) return;
    if (id !== conversation || !id) {
      setReadingSkillId('');
      followConversation.current = true;
      setConversation(id);
      setMessages([]);
      setWorkbooks([]);
      setSelectedFiles([]);
      setLoadedFilesFor('');
      setResearchFileId('');
      setImportedSkillIds([]);
      setPrompt('');
      if (!id) setSkillSelection('', '');
      setFollowExperiment('');
    }
    setRunId(
      task ??
        runs.find((r) => r.conversation_id === id && activeRun(r))?.id ??
        (id ? runs.find((r) => r.conversation_id === id)?.id : '') ??
        '',
    );
    setPage('Chat');
  };
  const newChat = () => {
    openConversation('');
    composer.current?.focus();
  };
  const registerSkill = async (files: File[], folder = false) => {
    const skill = await api.importSkill(
      files,
      folder ? files.map((file) => file.webkitRelativePath) : undefined,
    );
    setSkills((current) => [skill, ...current.filter((item) => item.id !== skill.id)]);
    return skill;
  };
  const addFiles = async (files: File[]) => {
    if (!files.length || uploading || busy || attachmentsLoading) return false;
    if (!connected) {
      toast('Kết nối backend trong Cài đặt trước khi đính kèm tệp.');
      return false;
    }
    setUploading(true);
    let id = conversation;
    let uploadedWorkbook = false;
    const errors: string[] = [];
    try {
      for (const file of files) {
        try {
          if (/^SKILL\.md$/i.test(file.name) || /\.zip$/i.test(file.name)) {
            const skill = await registerSkill([file]);
            setImportedSkillIds((ids) => [...new Set([...ids, skill.id])]);
            continue;
          }
          if (!/\.(csv|xlsx|xls)$/i.test(file.name))
            throw new Error('Dùng Excel, CSV, SKILL.md hoặc ZIP chứa một Agent Skill.');
          if (file.size > 20 * 1024 * 1024) throw new Error('Mỗi tệp tối đa 20 MB.');
          if (!id) {
            const created = await api.createConversation();
            id = created.id;
            setConversations((old) => [created, ...old]);
          }
          const attachment = await api.upload(file, id);
          uploadedWorkbook = true;
          if (id === conversation) {
            setWorkbooks((old) => [...old, attachment]);
            setSelectedFiles((old) => [...old, attachment.id].slice(0, MAX_SELECTED_FILES));
          }
          if (researchMode !== 'normal' && /\.(xlsx|csv)$/i.test(file.name))
            setResearchFileId(attachment.id);
        } catch (e) {
          errors.push(`${file.name} · ${(e as Error).message}`);
        }
      }
      composer.current?.focus();
    } finally {
      if (id !== conversation) {
        setSkillSelection(taskSkill, id);
        setConversation(id);
      }
      setUploading(false);
    }
    if (errors.length) toast(errors.join('\n'));
    return uploadedWorkbook;
  };
  const experimentConditions = (): Condition[] =>
    researchMode === 'compare'
      ? [
          ...(researchOptions.includeBaseline ? (['baseline'] as Condition[]) : []),
          'skillguard_off',
          'skillguard_on',
        ]
      : researchMode === 'normal'
        ? []
        : [researchMode];
  const requestExperiment = () => {
    if (readiness?.state !== 'ready') {
      toast(readiness?.blocker || 'Môi trường nghiên cứu chưa sẵn sàng. Bấm Kiểm tra.');
      return;
    }
    if (!researchWorkbook) {
      toast('Thí nghiệm cần đúng một workbook .xlsx hoặc .csv đính kèm.');
      return;
    }
    if (!enabledSkills.length) {
      toast('Hãy bật ít nhất một Skill trong mục Skills đang bật để chạy thử nghiệm.');
      return;
    }
    void startExperiment(experimentConditions());
  };
  const startExperiment = async (conditions: Condition[]) => {
    if (!conditions.length || !researchWorkbook || !enabledSkills.length) return;
    setBusy(true);
    followConversation.current = true;
    try {
      const effectiveModel =
        researchOptions.model ||
        (settings?.provider === 'antigravity' && settings.model ? settings.model : undefined);
      const orderedEnabled = [...enabledSkills].sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
      const started = await api.startExperiment({
        conversation_id: conversation || undefined,
        content: prompt,
        attachment_id: researchWorkbook.id,
        skill_id: orderedEnabled[0].id,
        skill_ids: orderedEnabled.map((skill) => skill.id),
        conditions,
        protection_policy: researchOptions.policy,
        model: effectiveModel,
        confirm_isolated_execution: true,
      });
      setConversation(started.conversation_id);
      setMessages((old) => mergeMessages(old, [started.user_message], started.conversation_id));
      const first = started.conditions[started.order[0]].task_id;
      setRuns(await api.runs());
      setRunId(first);
      setFollowExperiment(started.id);
      setCollapsed(false);
      setPrompt('');
      setConversations(await api.conversations());
    } catch (e) {
      toast((e as Error).message);
      await loadReadiness();
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!prompt.trim() || busy || uploading || active || attachmentsLoading) return;
    if (!connected) {
      toast('Backend chưa kết nối. Mở Cài đặt để kết nối dịch vụ cục bộ.');
      return;
    }
    if (researchMode !== 'normal') {
      requestExperiment();
      return;
    }
    setBusy(true);
    followConversation.current = true;
    try {
      let id = conversation;
      if (!id) {
        const created = await api.createConversation();
        id = created.id;
        setSkillSelection(taskSkill, id);
        setConversation(id);
        setConversations((old) => [created, ...old]);
      }
      const response = await api.send(id, prompt, attachments);
      setMessages((old) => mergeMessages(old, [response.message], id));
      setRuns((old) => [response.run, ...old.filter((r) => r.id !== response.run.id)]);
      setMode(response.run.mode);
      setRunId(response.run.id);
      setPrompt('');
      setPage('Chat');
      setConversations(await api.conversations());
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runSample = async () => {
    if (!connected) {
      toast('Kết nối backend trong Cài đặt để bắt đầu bản demo.');
      return;
    }
    try {
      const res = await fetch('/samples/doanh-thu.csv');
      if (!res.ok) throw new Error('Không tải được dữ liệu mẫu.');
      const file = new File([await res.blob()], 'doanh-thu.csv', { type: 'text/csv' });
      if (await addFiles([file])) setPrompt('Phân tích doanh thu và tạo báo cáo Excel tổng hợp.');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const importFiles = async (files: File[], folder = false) => {
    setUploading(true);
    try {
      const s = await registerSkill(files, folder);
      setPage('Skills');
      toast(
        s.reused_installation
          ? 'Gói Skill này đã được cài đặt. Đã dùng lại bản hiện có.'
          : 'Đã nhập Skill.',
      );
      await api
        .skills()
        .then(setSkills)
        .catch(() => {});
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const skillAction = async (id: string, action: 'enable' | 'disable') => {
    setSkillMutation(true);
    try {
      const updated = await api.skill(id, action);
      setSkills((current) => current.map((skill) => (skill.id === id ? updated : skill)));
      toast(action === 'enable' ? 'Đã bật Skill.' : 'Đã tắt Skill.');
      await api
        .skills()
        .then(setSkills)
        .catch(() => {});
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSkillMutation(false);
    }
  };
  const toggleSkill = async (skill: Skill, enable: boolean) => {
    // Each Skill is switched by its own ID; a monotonic sequence prevents stale refreshes
    // from overwriting rapid multi-Skill toggles.
    const seq = ++skillsSyncSeq.current;
    setTogglingSkillIds((current) => new Set(current).add(skill.id));
    try {
      const updated = await api.skill(skill.id, enable ? 'enable' : 'disable');
      setSkills((current) => current.map((item) => (item.id === skill.id ? updated : item)));
      toast(`${enable ? 'Đã bật' : 'Đã tắt'} ${skill.name} (${shortId(skill.id)}).`);
      await api
        .skills()
        .then((fresh) => {
          if (skillsSyncSeq.current === seq) setSkills(fresh);
        })
        .catch(() => {});
    } catch (e) {
      toast((e as Error).message);
      await api
        .skills()
        .then((fresh) => {
          if (skillsSyncSeq.current === seq) setSkills(fresh);
        })
        .catch(() => {});
    } finally {
      setTogglingSkillIds((current) => {
        const next = new Set(current);
        next.delete(skill.id);
        return next;
      });
    }
  };
  const toggleAllSkills = async (enable: boolean) => {
    const targets = skills.filter(
      (skill) => isSkillToggleable(skill) && isEnabledSkill(skill) !== enable,
    );
    if (!targets.length) return;
    const seq = ++skillsSyncSeq.current;
    setTogglingSkillIds((current) => {
      const next = new Set(current);
      targets.forEach((s) => next.add(s.id));
      return next;
    });
    const failed: string[] = [];
    try {
      const results = await Promise.allSettled(
        targets.map((skill) =>
          api.skill(skill.id, enable ? 'enable' : 'disable').then((updated) => ({
            id: skill.id,
            updated,
          })),
        ),
      );
      const updatedById = new Map<string, Skill>();
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled') updatedById.set(res.value.id, res.value.updated);
        else failed.push(targets[idx].name);
      });
      if (updatedById.size) {
        setSkills((current) => current.map((item) => updatedById.get(item.id) ?? item));
      }
      toast(
        failed.length
          ? `${enable ? 'Đã bật' : 'Đã tắt'} ${updatedById.size}/${targets.length} Skill (${failed.length} lỗi).`
          : `${enable ? 'Đã bật tất cả' : 'Đã tắt tất cả'} (${updatedById.size} Skill).`,
      );
      await api
        .skills()
        .then((fresh) => {
          if (skillsSyncSeq.current === seq) setSkills(fresh);
        })
        .catch(() => {});
    } finally {
      setTogglingSkillIds((current) => {
        const next = new Set(current);
        targets.forEach((s) => next.delete(s.id));
        return next;
      });
    }
  };
  const removeSkill = async (skill: NonNullable<typeof removing>) => {
    setSkillMutation(true);
    try {
      const result = await api.removeSkill(skill.id);
      setSkills((current) =>
        current
          .filter((item) => item.id !== skill.id)
          .map((item) => ({
            ...item,
            duplicate_installations: item.duplicate_installations?.filter(
              (copy) => copy.id !== skill.id,
            ),
          })),
      );
      if (labSkillId === skill.id) setLabSkillId('');
      setRemoving(undefined);
      if (inspectingId === skill.id) setInspectingId('');
      toast(
        result.cleanup_pending
          ? 'Đã gỡ Skill khỏi thư viện. Chưa dọn được một số tệp cài đặt.'
          : `Đã gỡ ${skill.name} khỏi thư viện.`,
      );
      try {
        setSkills(await api.skills());
      } catch {
        toast('Đã gỡ bản cài đặt. Chưa tải lại được danh sách Skill.');
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSkillMutation(false);
    }
  };
  const pickRun = (r: Run) => {
    openConversation(r.conversation_id || '', r.id);
  };
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = e.clientX;
    const width = monitorWidth;
    const move = (ev: PointerEvent) =>
      setMonitorWidth(Math.min(430, Math.max(268, width + start - ev.clientX)));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const download = async (id: string, name: string) => {
    try {
      await api.download(id, name);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const visibleLogs = (page === 'Lịch sử' ? allAudit : events).filter(
    (e) =>
      e.timestamp > logCleared &&
      (!logSince || e.timestamp >= new Date(logSince).toISOString()) &&
      (!logRun || e.run_id === logRun) &&
      (!logStatus || e.status === logStatus) &&
      (!logTool || e.tool_name === logTool) &&
      (!logDecision || e.permission_decision === logDecision) &&
      (!logType || e.event_type === logType) &&
      JSON.stringify(e).toLowerCase().includes(logSearch.toLowerCase()),
  );
  const logs = (
    <div className="log-view">
      <div className="log-toolbar">
        <span className="section-eyebrow">
          <Terminal size={14} /> NHẬT KÝ THỰC THI{' '}
          <span className="count">{visibleLogs.length}</span>
        </span>
        <div className="row">
          <IconButton
            label="Sao chép nhật ký"
            onClick={() =>
              navigator.clipboard
                .writeText(JSON.stringify(visibleLogs, null, 2))
                .then(() => toast('Đã sao chép nhật ký.'))
                .catch(() => toast('Không thể truy cập bộ nhớ tạm.'))
            }
          >
            <Copy size={14} />
          </IconButton>
          <IconButton
            label="Xuất nhật ký"
            onClick={() => saveJson(visibleLogs, 'agentscope-audit.json')}
          >
            <Download size={14} />
          </IconButton>
          <IconButton
            label="Xóa khung xem"
            onClick={() => {
              setLogCleared(new Date().toISOString());
              toast('Đã xóa khung xem. Nhật ký kiểm toán vẫn được lưu.');
            }}
          >
            <Trash2 size={14} />
          </IconButton>
          <IconButton
            label={logsOpen ? 'Thu gọn nhật ký' : 'Mở nhật ký'}
            onClick={() => setLogsOpen(!logsOpen)}
          >
            <ChevronDown size={15} style={{ transform: logsOpen ? 'none' : 'rotate(180deg)' }} />
          </IconButton>
        </div>
      </div>
      {logsOpen && (
        <>
          <div className="log-filters">
            <label className="search-field">
              <Search size={13} />
              <input
                aria-label="Tìm nhật ký"
                placeholder="Tìm trong nhật ký…"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Lọc trạng thái"
              value={logStatus}
              onChange={(e) => setLogStatus(e.target.value)}
            >
              <option value="">Mọi trạng thái</option>
              {Object.entries(statusLabel).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
            {page === 'Lịch sử' && (
              <>
                <select
                  aria-label="Lọc tác vụ"
                  value={logRun}
                  onChange={(e) => setLogRun(e.target.value)}
                >
                  <option value="">Mọi tác vụ</option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  aria-label="Nhật ký từ thời điểm"
                  value={logSince}
                  onChange={(e) => setLogSince(e.target.value)}
                />
                <select
                  aria-label="Lọc công cụ"
                  value={logTool}
                  onChange={(e) => setLogTool(e.target.value)}
                >
                  <option value="">Mọi công cụ</option>
                  {[...new Set(allAudit.map((e) => e.tool_name).filter(Boolean))].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <select
                  aria-label="Lọc quyết định quyền"
                  value={logDecision}
                  onChange={(e) => setLogDecision(e.target.value)}
                >
                  <option value="">Mọi quyết định</option>
                  {['allow', 'deny', 'require_approval'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <select
                  aria-label="Lọc loại sự kiện"
                  value={logType}
                  onChange={(e) => setLogType(e.target.value)}
                >
                  <option value="">Mọi sự kiện</option>
                  {[...new Set(allAudit.map((e) => e.event_type))].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="log-lines">
            {!visibleLogs.length ? (
              <div className="log-empty">
                <span className="terminal-prompt">›</span> Sẵn sàng ghi nhận hoạt động
                <span className="cursor" />
              </div>
            ) : (
              <details open>
                <summary>
                  Đã ghi nhận {visibleLogs.filter((e) => e.event_type === 'tool.completed').length}{' '}
                  công cụ · {visibleLogs.length} sự kiện
                </summary>
                {visibleLogs.map((e) => (
                  <button
                    className={`log-line ${e.status}`}
                    key={e.id}
                    onClick={() => inspectEvent(e)}
                  >
                    <time>{time(e.timestamp)}</time>
                    <span className="log-level">
                      {e.mode === 'demo'
                        ? 'DEMO'
                        : e.status === 'failed'
                          ? 'ERROR'
                          : e.permission_decision === 'deny'
                            ? 'BLOCK'
                            : 'INFO'}
                    </span>
                    <span>{e.message}</span>
                  </button>
                ))}
              </details>
            )}
          </div>
        </>
      )}
    </div>
  );
  const needsSkillLab =
    run?.status === 'blocked' &&
    events.some(
      (event) =>
        event.event_type === 'security.execution_restricted' &&
        event.result.scope === 'skill_delivery_to_acp' &&
        event.result.fallback !== 'local_spreadsheet',
    );
  const approval = events.find(
    (e) =>
      e.status === 'awaiting_approval' &&
      !events.some((x) => x.event_type === 'permission.resolved' && x.step_id === e.step_id),
  );

  const followProgress = (experiment: {
    id: string;
    state: string;
    order: Condition[];
    conditions: Record<string, { state: string; task_id: string }>;
  }) => {
    if (experiment.id !== followExperiment) return;
    const current = experiment.order
      .map((c) => experiment.conditions[c])
      .find((r) => r.state === 'running');
    if (current && current.task_id !== runId) {
      setRunId(current.task_id);
      api
        .runs()
        .then(setRuns)
        .catch(() => {});
    }
    if (!['queued', 'running'].includes(experiment.state)) setFollowExperiment('');
  };
  const experimentFinished = () => {
    api
      .runs()
      .then(setRuns)
      .catch(() => {});
    if (conversation)
      api
        .messages(conversation)
        .then((data) => setMessages((old) => mergeMessages(old, data, conversation)))
        .catch(() => {});
  };
  const selectRun = (taskId: string) => {
    setRunId(taskId);
    setFollowExperiment('');
    setSelectedEvent(undefined);
    setCollapsed(false);
  };
  const inspectEvent = (event: ExecutionEvent) => {
    setRunId(event.run_id);
    setSelectedEvent({ ...event });
    setCollapsed(false);
  };
  const renderActivity = (task: Run) => (
    <RunActivity
      run={task}
      events={eventCache[task.id] ?? NO_EVENTS}
      onInspect={inspectEvent}
      onOpen={() => selectRun(task.id)}
      onDownload={download}
    />
  );
  const liveExperiments = [
    ...new Set(
      messages
        .filter((m) => m.role === 'user' && m.experiment_id)
        .map((m) => m.experiment_id as string),
    ),
  ].filter(
    (id) => !messages.some((m) => m.kind === 'experiment_comparison' && m.experiment_id === id),
  );
  const composerSkills = importedSkillIds
    .filter((id) => id !== taskSkill)
    .flatMap((id) => skills.find((skill) => skill.id === id) ?? []);
  const reports = runs.flatMap((task) => runReports(task).map((report) => ({ task, report })));
  const currentConversation = conversations.find((item) => item.id === conversation);
  const canSend = !!prompt.trim() && !busy && !uploading && !active && !attachmentsLoading;
  const sendLabel =
    researchMode === 'normal'
      ? 'Gửi tin nhắn'
      : researchMode === 'compare'
        ? 'So sánh cả hai'
        : 'Chạy thử nghiệm';
  const activityAnchors = new Map<string, string>();
  for (const message of messages) {
    const id = message.task_id || message.run_id;
    if (!id || (message.role !== 'user' && !message.run_id && !message.condition)) continue;
    activityAnchors.set(id, message.id);
  }
  const renderMessage = (message: Message) =>
    message.kind === 'experiment_comparison' && message.experiment_id ? (
      <div key={message.id} className="message assistant experiment-message">
        <div className="assistant-mini">
          <FlaskConical size={16} />
        </div>
        <div className="message-body">
          <div className="message-author">
            AgentScope <span>So sánh độc lập · không do Gemini viết</span>
          </div>
          <ExperimentCard
            id={message.experiment_id}
            onSelectRun={selectRun}
            onProgress={followProgress}
            onFinished={experimentFinished}
          />
          <small className="message-time">{time(message.created_at)}</small>
        </div>
      </div>
    ) : (
      <div
        key={message.id}
        className={`message ${message.role}${message.run_id ? ' activity-message' : ''}`}
      >
        {message.role === 'assistant' && (
          <div className="assistant-mini">
            <Sparkles size={16} />
          </div>
        )}
        <div className="message-body">
          {message.role === 'assistant' && !message.condition && (
            <div className="message-author">
              AI Assistant <span>AgentScope</span>
            </div>
          )}
          {message.role === 'assistant' && message.condition && (
            <div className={`message-author condition-author cond-${message.condition}`}>
              Gemini · {CONDITION_LABELS[message.condition]}
              <span>
                {message.verbatim_model_answer
                  ? 'Câu trả lời nguyên văn của Gemini'
                  : 'Không có câu trả lời'}
              </span>
              {message.task_id && (
                <button className="link-button" onClick={() => selectRun(message.task_id!)}>
                  Xem diễn biến
                </button>
              )}
            </div>
          )}
          {message.role === 'user' && message.research_mode && (
            <div className="message-author research-tag">
              <FlaskConical size={11} />{' '}
              {message.research_mode === 'compare'
                ? 'So sánh SkillGuard OFF và ON'
                : CONDITION_LABELS[message.research_mode as Condition]}
            </div>
          )}
          {!message.run_id && (
            <div className="message-text">
              <Markdown>{message.content}</Markdown>
              {message.streaming && <small role="status">Đang nhận phản hồi…</small>}
              {message.incomplete && <small>Phản hồi chưa hoàn tất.</small>}
            </div>
          )}
          {message.attachments?.map((f) => (
            <FileCard key={f.id} file={f} onDownload={() => download(f.id, f.name)} />
          ))}
          {!message.run_id && <small className="message-time">{time(message.created_at)}</small>}
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="title-brand" data-tauri-drag-region>
          <Logo />
          <strong>AgentScope</strong>
          <span className="title-divider" />
          <span className="title-subtitle">AI Agent Desktop</span>
        </div>
        <div className="title-status" data-tauri-drag-region>
          <span className={`connection-dot ${runtime.verified ? 'online' : ''}`} />
          <span title={settings?.antigravity?.message}>{runtime.label}</span>
          <span className="title-mode">{mode === 'demo' ? 'DEMO' : 'REAL'}</span>
        </div>
        <div className="window-controls">
          {[
            ['Thu nhỏ', Minus, 'minimize'],
            ['Phóng to', Square, 'toggleMaximize'],
            ['Đóng ứng dụng', X, 'close'],
          ].map(([label, Icon, action]) => {
            const I = Icon as typeof Minus;
            return (
              <button
                key={String(action)}
                aria-label={String(label)}
                className={action === 'close' ? 'close-window' : ''}
                onClick={async () => {
                  if ('__TAURI_INTERNALS__' in window) {
                    const { getCurrentWindow } = await import('@tauri-apps/api/window');
                    const win = getCurrentWindow();
                    if (action === 'minimize') await win.minimize();
                    else if (action === 'toggleMaximize') await win.toggleMaximize();
                    else await win.close();
                  } else toast('Điều khiển cửa sổ khả dụng trong bản desktop Tauri.');
                }}
              >
                <I size={14} />
              </button>
            );
          })}
        </div>
      </header>
      <div className="desktop-layout">
        <aside className="sidebar">
          <button className="new-chat" onClick={newChat}>
            <Plus size={17} /> Cuộc trò chuyện mới <kbd>⌃ N</kbd>
          </button>
          <nav>
            {navigation.map(({ page: target, label, icon: Icon, group }) => (
              <button
                key={label}
                className={`nav-item ${group.includes(page) ? 'selected' : ''}`}
                onClick={() => {
                  if (target === 'Chat' && run?.conversation_id !== conversation)
                    openConversation(conversation);
                  else setPage(target);
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
                {target === 'Thí nghiệm' &&
                  runs.filter((r) => r.status === 'running').length > 0 && (
                    <span className="nav-count">
                      {runs.filter((r) => r.status === 'running').length}
                    </span>
                  )}
                {target === 'Skills' && skills.length > 0 && <small>{skills.length}</small>}
                {group.includes(page) && <span className="nav-active-dot" />}
              </button>
            ))}
          </nav>
          <div className="recent-heading">
            Cuộc trò chuyện
            <button title="Xem lịch sử" aria-label="Xem lịch sử" onClick={() => setPage('Lịch sử')}>
              <MoreHorizontal size={16} />
            </button>
          </div>
          <div className="recent-chats">
            {conversations.map((c) => (
              <button
                key={c.id}
                className={page === 'Chat' && conversation === c.id ? 'selected' : ''}
                aria-current={page === 'Chat' && conversation === c.id ? 'page' : undefined}
                title={c.title}
                onClick={() => openConversation(c.id)}
              >
                <MessageSquare size={13} />
                <span>{c.title}</span>
              </button>
            ))}
            {!conversations.length && <p>Chưa có cuộc trò chuyện</p>}
          </div>
          <div className="sidebar-bottom">
            <button
              className={`nav-item settings-nav ${page === 'Cài đặt' ? 'selected' : ''}`}
              onClick={() => setPage('Cài đặt')}
            >
              <Settings2 size={18} />
              <span>Cài đặt</span>
            </button>
            <div className="profile">
              <div>
                <small
                  title={
                    settings?.backend_version && settings.backend_version !== __APP_VERSION__
                      ? 'Phiên bản backend khác giao diện: có thể đang chạy sidecar cũ.'
                      : undefined
                  }
                >
                  AgentScope v{__APP_VERSION__}
                  {settings?.backend_version && settings.backend_version !== __APP_VERSION__
                    ? ` · backend v${settings.backend_version}`
                    : ''}
                </small>
              </div>
            </div>
          </div>
        </aside>
        <main className="main-area">
          <div className="page-heading">
            <div className="page-breadcrumb">
              {page === 'Chat' && (
                <>
                  Chat <ChevronRight size={13} />
                </>
              )}
              <h1>
                {page === 'Chat' ? currentConversation?.title || 'Cuộc trò chuyện mới' : page}
              </h1>
            </div>
            <div className="row">
              {page === 'Chat' && messages.length > 0 && (
                <IconButton
                  label="Xuất cuộc trò chuyện"
                  onClick={() => saveJson(messages, 'agentscope-conversation.json')}
                >
                  <Download size={16} />
                </IconButton>
              )}
              <IconButton
                label={collapsed ? 'Mở bảng thực thi' : 'Ẩn bảng thực thi'}
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
              </IconButton>
            </div>
          </div>
          {page === 'Chat' ? (
            <div
              className={`chat-workspace ${dragging ? 'dragging' : ''}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (
                  !(e.relatedTarget instanceof Node) ||
                  !e.currentTarget.contains(e.relatedTarget)
                )
                  setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <div
                className="conversation-scroll"
                ref={conversationScroll}
                onScroll={({ currentTarget: scroll }) => {
                  followConversation.current =
                    scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;
                }}
              >
                {!messages.length ? (
                  <div className="welcome">
                    <Logo large />
                    <h2>Hôm nay, mình có thể giúp gì?</h2>
                    <div className="quick-actions">
                      <button
                        onClick={() => {
                          setPrompt('Tạo báo cáo Excel tổng hợp từ tệp đính kèm.');
                          composer.current?.focus();
                        }}
                      >
                        <FileBarChart2 size={16} />
                        <span>Tạo báo cáo</span>
                      </button>
                      <button
                        onClick={() => {
                          setPrompt(
                            'Phân tích KPI bán hàng (biên lợi nhuận, AOV, tỷ lệ hủy đơn, sản phẩm và khu vực chủ lực) và lập báo cáo kinh doanh tổng hợp.',
                          );
                          composer.current?.focus();
                        }}
                      >
                        <BarChart3 size={16} />
                        <span>Phân tích KPI & báo cáo kinh doanh</span>
                      </button>
                      <button
                        onClick={() => {
                          setPrompt(
                            'Phân tích xu hướng doanh thu, phát hiện đơn bất thường và đề xuất khuyến nghị tối ưu lợi nhuận.',
                          );
                          fileInput.current?.click();
                        }}
                      >
                        <Sparkles size={16} />
                        <span>Xu hướng & khuyến nghị</span>
                      </button>
                      <button
                        onClick={() => {
                          setPage('Skills');
                          skillInput.current?.click();
                        }}
                      >
                        <Layers3 size={16} />
                        <span>Cài Skill mới</span>
                      </button>
                    </div>
                    <button className="sample-link" onClick={runSample} disabled={uploading}>
                      <FileSpreadsheet size={15} /> Dùng bảng doanh thu mẫu <ArrowRight size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="messages">
                    {messages.map((message) => {
                      const task = runs.find((item) => activityAnchors.get(item.id) === message.id);
                      return (
                        <Fragment key={message.id}>
                          {message.run_id ? null : renderMessage(message)}
                          {task && renderActivity(task)}
                        </Fragment>
                      );
                    })}
                    {liveExperiments.map((id) => (
                      <div key={id} className="message assistant experiment-message">
                        <div className="assistant-mini">
                          <FlaskConical size={16} />
                        </div>
                        <div className="message-body">
                          <ExperimentCard
                            id={id}
                            onSelectRun={selectRun}
                            onProgress={followProgress}
                            onFinished={experimentFinished}
                          />
                        </div>
                      </div>
                    ))}
                    {active && !activityAnchors.has(active.id) && renderActivity(active)}
                    {busy && (
                      <div className="thinking">
                        <LoaderCircle size={15} className="spin" /> Đang tiếp nhận yêu cầu…
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="composer-section">
                {mode === 'demo' && (
                  <div className="demo-note">
                    <span /> Chế độ demo dùng sự kiện tổng hợp, không gọi AI hoặc thực thi công cụ.
                  </div>
                )}
                <div
                  className={`composer ${uploading ? 'uploading' : ''} ${researchMode !== 'normal' ? `research research-${researchMode}` : ''}`}
                >
                  <ResearchControl
                    mode={researchMode}
                    onMode={(value) => {
                      setResearchMode(value);
                      if (
                        (value !== 'normal' || settings?.provider === 'antigravity') &&
                        !readiness
                      )
                        void loadReadiness();
                    }}
                    readiness={readiness}
                    checking={checkingReadiness}
                    onCheck={() => void checkReadiness()}
                    onSignin={(reset) => void signinLab(reset)}
                    options={researchOptions}
                    onOptions={setResearchOptions}
                    settingsModel={settings?.provider === 'antigravity' ? settings.model : ''}
                    availableModels={availableAntigravityModels}
                    contained={
                      settings?.provider === 'antigravity' &&
                      (attachments.length > 0 || enabledSkills.length > 0)
                    }
                    compact
                  />
                  {attachmentsLoading && attachmentError && (
                    <button
                      className="activity-inspect"
                      onClick={() => setAttachmentReload((value) => value + 1)}
                    >
                      <RefreshCw size={13} /> Tải lại bảng tính
                    </button>
                  )}
                  {workbooks.length > 0 && (
                    <div className="composer-attachments">
                      {researchMode === 'normal' ? (
                        <div
                          className="workbook-list"
                          role="group"
                          aria-label="Bảng tính của cuộc trò chuyện"
                        >
                          <span title="Chọn tối đa 5 tệp cho mỗi tin nhắn">
                            Bảng tính · {attachments.length}/{workbooks.length}
                          </span>
                          {workbooks.map((file) => {
                            const selected = selectedFiles.includes(file.id);
                            return (
                              <button
                                key={file.id}
                                className="workbook-chip"
                                aria-pressed={selected}
                                title={file.name}
                                onClick={() => {
                                  if (!selected && selectedFiles.length === MAX_SELECTED_FILES) {
                                    toast('Chọn tối đa 5 bảng tính cho mỗi tin nhắn.');
                                    return;
                                  }
                                  setSelectedFiles((old) =>
                                    selected
                                      ? old.filter((id) => id !== file.id)
                                      : [...old, file.id],
                                  );
                                }}
                              >
                                {selected ? <Check size={13} /> : <FileSpreadsheet size={13} />}
                                <span>{file.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <label className="research-workbook">
                          <FileSpreadsheet size={14} />
                          <select
                            title={researchWorkbook?.name ?? 'Chọn bảng tính'}
                            aria-label="Bảng tính dùng cho thử nghiệm"
                            value={researchWorkbook?.id || ''}
                            onChange={(event) => setResearchFileId(event.target.value)}
                          >
                            <option value="" disabled>
                              Chọn một bảng tính
                            </option>
                            {researchWorkbooks.map((file) => (
                              <option key={file.id} value={file.id}>
                                {file.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                  {composerSkills.length > 0 && (
                    <div className="composer-imports" aria-live="polite">
                      {composerSkills.map((skill) => (
                        <button key={skill.id} onClick={() => setInspectingId(skill.id)}>
                          <Layers3 size={14} />
                          <strong>{skill.name}</strong>
                          {showSkillWarnings && <span>{skillScanLabel(skill)}</span>}
                          <ChevronRight size={13} />
                        </button>
                      ))}
                    </div>
                  )}
                  {showSkillWarnings && flaggedEnabledSkills.length > 0 && primaryFlaggedSkill && (
                    <div className="composer-restriction" role="alert">
                      <span>
                        <ShieldAlert size={14} aria-hidden="true" />
                        <span className="composer-restriction-summary">
                          <strong>
                            Cảnh báo SkillGuard ON ·{' '}
                            {flaggedEnabledSkills.map((skill) => skill.name).join(', ')}
                          </strong>
                          <span>
                            Phát hiện Skill có dấu hiệu rủi ro/độc hại (
                            {skillScanLabel(primaryFlaggedSkill)})
                          </span>
                          {flaggedFiles.length > 0 && (
                            <small>
                              {flaggedFiles.slice(0, 2).join(', ')}
                              {flaggedFiles.length > 2 && ` · +${flaggedFiles.length - 2} tệp`}
                            </small>
                          )}
                        </span>
                      </span>
                      <div>
                        <button onClick={() => setInspectingId(primaryFlaggedSkill.id)}>
                          Xem phát hiện
                        </button>
                        <button onClick={() => void toggleSkill(primaryFlaggedSkill, false)}>
                          Tắt Skill
                        </button>
                      </div>
                    </div>
                  )}
                  <textarea
                    ref={composer}
                    aria-label="Tin nhắn cho AI Assistant"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      researchMode === 'normal'
                        ? 'Bạn muốn hoàn thành công việc gì?'
                        : 'Yêu cầu phân tích bảng tính…'
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={2}
                  />
                  <div className="composer-toolbar">
                    <div className="row">
                      <IconButton
                        label="Đính kèm bảng tính"
                        onClick={() => fileInput.current?.click()}
                        disabled={uploading || busy || attachmentsLoading}
                      >
                        {uploading ? (
                          <LoaderCircle size={18} className="spin" />
                        ) : (
                          <Paperclip size={18} />
                        )}
                      </IconButton>
                      <SkillManager
                        skills={skills}
                        warnFlagged={showSkillWarnings}
                        pendingIds={togglingSkillIds}
                        summary={skillSummary}
                        onToggle={(skill, enable) => void toggleSkill(skill, enable)}
                        onOpen={(skill) => setReadingSkillId(skill.id)}
                        onInspect={(skill) => setInspectingId(skill.id)}
                        onManage={() => setPage('Skills')}
                      />
                    </div>
                    <button
                      className="send-button"
                      aria-label={sendLabel}
                      title={sendLabel}
                      onClick={() => void send()}
                      disabled={!canSend}
                    >
                      {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={19} />}
                    </button>
                  </div>
                </div>
                <div className="composer-footnote">
                  <span>Thả Excel, CSV hoặc Agent Skill</span>
                  <span>
                    <kbd>Enter</kbd> gửi <i>·</i> <kbd>Shift + Enter</kbd> xuống dòng
                  </span>
                </div>
              </div>
              {dragging && (
                <div className="drop-overlay">
                  <Upload size={36} />
                  <h2>Thả bảng tính hoặc Agent Skill</h2>
                  <p>Excel, CSV, SKILL.md hoặc ZIP</p>
                </div>
              )}
            </div>
          ) : (
            <div className="page-content">
              <div className="content-heading">
                <div>
                  <span className="section-eyebrow">
                    {HISTORY_PAGES.includes(page)
                      ? 'LỊCH SỬ & KẾT QUẢ'
                      : ADVANCED_PAGES.includes(page)
                        ? 'NGHIÊN CỨU NÂNG CAO'
                        : 'AGENTSCOPE WORKSPACE'}
                  </span>
                  <h1>{page === 'Thí nghiệm' ? 'Thí nghiệm & so sánh' : page}</h1>
                  <p>
                    {
                      {
                        Tasks: 'Theo dõi công việc, từ yêu cầu đầu tiên đến kết quả cuối cùng.',
                        Skills: 'Thêm chuyên môn cho trợ lý. Bạn kiểm soát mọi khả năng.',
                        'Bảo mật': 'Nhìn rõ quyền truy cập. Chủ động bảo vệ dữ liệu.',
                        'Đánh giá PI':
                          'Ground truth, phản hồi Gemini thật và kiểm tra tính toàn vẹn độc lập.',
                        'Lab PI cô lập':
                          'Prompt Injection thật với Gemini, chỉ bên trong AppContainer đã kiểm tra. Control và Injection chạy riêng.',
                        'Lab nghiên cứu':
                          'Thí nghiệm riêng trong VM được xác minh. Bằng chứng thật, không gán trước kết quả.',
                        'Lịch sử': 'Mọi hoạt động đều có dấu vết, mọi kết quả đều có nguồn gốc.',
                        'Thí nghiệm':
                          'Các lần so sánh SkillGuard OFF/ON, kết luận, tệp Excel và bằng chứng ACP/MCP.',
                        'Báo cáo': 'Các tệp kết quả được tạo trong không gian làm việc của bạn.',
                        'Cài đặt': 'Một trợ lý thống nhất. Kết nối với dịch vụ AI bạn lựa chọn.',
                      }[page]
                    }
                  </p>
                </div>
                {page === 'Skills' && (
                  <button
                    className="primary-button"
                    onClick={() => skillInput.current?.click()}
                    disabled={uploading}
                  >
                    <Plus size={16} /> Nhập Skill
                  </button>
                )}
                {page === 'Tasks' && (
                  <button className="primary-button" onClick={newChat}>
                    <Plus size={16} /> Tác vụ mới
                  </button>
                )}
              </div>
              {HISTORY_PAGES.includes(page) && (
                <div className="sub-tabs" role="tablist">
                  {HISTORY_TABS.map(([target, label]) => (
                    <button
                      key={target}
                      role="tab"
                      aria-selected={page === target}
                      className={page === target ? 'active' : ''}
                      onClick={() => setPage(target)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {page === 'Thí nghiệm' && <ExperimentHistory onOpen={openConversation} />}
              {ADVANCED_PAGES.includes(page) && (
                <AdvancedResearch page={page} onPage={setPage}>
                  {page === 'Lab nghiên cứu' && <ResearchLab skills={skills} />}
                  {page === 'Đánh giá PI' && <AnswerEvaluation skills={skills} />}
                  {page === 'Lab PI cô lập' && (
                    <IsolatedInjectionLab skills={skills} initialInspectionId={labSkillId} />
                  )}
                </AdvancedResearch>
              )}
              {page === 'Tasks' && (
                <>
                  <div className="stat-grid">
                    {[
                      ['Tổng tác vụ', runs.length, ListTodo],
                      [
                        'Hoàn thành',
                        runs.filter((r) => r.status === 'completed').length,
                        CheckCheck,
                      ],
                      [
                        'Đang thực hiện',
                        runs.filter((r) => r.status === 'running').length,
                        Activity,
                      ],
                    ].map(([label, value, Icon]) => {
                      const I = Icon as typeof Activity;
                      return (
                        <div className="stat-card" key={String(label)}>
                          <I size={18} />
                          <strong>{String(value)}</strong>
                          <span>{String(label)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {!runs.length ? (
                    <Empty
                      icon={<ListTodo />}
                      description="Bắt đầu từ một cuộc trò chuyện. Tiến trình thực tế sẽ xuất hiện ở đây."
                    >
                      Sẵn sàng cho công việc đầu tiên
                    </Empty>
                  ) : (
                    <div className="task-list">
                      {runs.map((r) => (
                        <button className="task-row" key={r.id} onClick={() => pickRun(r)}>
                          <span className={`event-icon ${r.status}`}>
                            <StatusIcon status={r.status} />
                          </span>
                          <div>
                            <strong>{r.title}</strong>
                            <small>
                              {date(r.created_at)} ·{' '}
                              {r.mode === 'demo'
                                ? 'DEMO · Tổng hợp'
                                : `REAL · ${r.provider || 'cục bộ'}${r.model ? ` · ${r.model}` : ''}`}
                            </small>
                          </div>
                          <Badge status={r.status} />
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {page === 'Skills' && (
                <>
                  <div className="info-banner">
                    <ShieldCheck size={19} />
                    <div>
                      <strong>Kiểm tra bảo mật tự động khi nhập Skill</strong>
                      <p>SkillGuard kiểm tra từng yêu cầu công cụ trong lúc chạy tác vụ.</p>
                    </div>
                  </div>
                  <div className="import-options">
                    <button onClick={() => skillInput.current?.click()}>
                      <FileText size={19} />
                      <div>
                        <strong>SKILL.md hoặc ZIP</strong>
                        <small>Đọc metadata và kiểm tra nội dung</small>
                      </div>
                      <Upload size={16} />
                    </button>
                    <button onClick={() => folderInput.current?.click()}>
                      <FolderOpen size={19} />
                      <div>
                        <strong>Thư mục Skill</strong>
                        <small>Giữ nguyên cấu trúc gói tài nguyên</small>
                      </div>
                      <Upload size={16} />
                    </button>
                  </div>
                  <div className="section-row">
                    <h3>
                      Thư viện của bạn <span className="count">{skills.length}</span>
                    </h3>
                    <div className="row">
                      <span>{activeSkillsLabel(enabledSkills.length)}</span>
                      {skills.some((s) => isSkillToggleable(s) && !isEnabledSkill(s)) && (
                        <button
                          className="secondary-button"
                          disabled={togglingSkillIds.size > 0}
                          onClick={() => void toggleAllSkills(true)}
                        >
                          Bật tất cả
                        </button>
                      )}
                      {enabledSkills.length > 0 && (
                        <button
                          className="secondary-button"
                          disabled={togglingSkillIds.size > 0}
                          onClick={() => void toggleAllSkills(false)}
                        >
                          Tắt tất cả
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="skill-library-summary" aria-label="Trạng thái Skill">
                    {(['enabled', 'disabled', 'quarantined', 'restricted'] as const).map(
                      (state) => (
                        <span key={state} className={`skill-state ${state}`}>
                          {stateCounts(skills)[state]} {SKILL_STATE_LABEL[state]}
                        </span>
                      ),
                    )}
                  </div>
                  {!skills.length ? (
                    <Empty
                      icon={<Layers3 />}
                      description="Nhập SKILL.md từ thư mục samples để thử quy trình phân tích bảng tính."
                    >
                      Một trợ lý, nhiều chuyên môn
                    </Empty>
                  ) : (
                    <div className="skill-grid">
                      {skills.map((s) => (
                        <div className="skill-card" key={s.id}>
                          <div className="row spread">
                            <span className="skill-card-icon">
                              <Layers3 size={22} />
                            </span>
                            <SkillStateBadge skill={s} />
                          </div>
                          <h3>{s.name}</h3>
                          <p>{s.description}</p>
                          <div className="skill-meta">
                            <Code2 size={13} /> Đã cài đặt · {s.files.length} tệp ·{' '}
                            {s.security?.executable_files.length ?? 0} mã thực thi
                          </div>
                          {showSkillWarnings && (
                            <p className="skill-scan-summary">{skillScanLabel(s)}</p>
                          )}
                          {showSkillWarnings && s.security && (
                            <div className="skill-meta">
                              Đã quét bảo mật ·{' '}
                              <time dateTime={s.security.scanned_at}>
                                {new Date(s.security.scanned_at).toLocaleDateString('vi-VN')}
                              </time>
                            </div>
                          )}
                          <div className="skill-meta">
                            <code className="skill-id" title={s.id}>
                              ID {shortId(s.id)}
                            </code>
                          </div>
                          {s.package_sha256 && (
                            <div className="skill-meta">
                              <code title={s.package_sha256}>
                                SHA-256 {s.package_sha256.slice(0, 12)}
                              </code>
                              {!!s.duplicate_installations?.length && (
                                <span>· {s.duplicate_installations.length} bản trùng</span>
                              )}
                            </div>
                          )}
                          <div className="skill-switch-row" data-locked={!isSkillToggleable(s)}>
                            <span>
                              {skillState(s) === 'quarantined'
                                ? isEnabledSkill(s)
                                  ? 'Cách ly · Đang bật, AI sẽ tự động đọc toàn bộ nội dung Skill'
                                  : s.state_reason || SKILL_STATE_HINT.quarantined
                                : isSkillToggleable(s)
                                  ? isEnabledSkill(s)
                                    ? 'Đang bật · AI sẽ tự động đọc và áp dụng'
                                    : 'Đã tắt · không gửi tới model'
                                  : s.state_reason || SKILL_STATE_HINT[skillState(s)]}
                            </span>
                            <SkillSwitch
                              checked={isEnabledSkill(s)}
                              disabled={!isSkillToggleable(s)}
                              busy={togglingSkillIds.has(s.id)}
                              label={`${isEnabledSkill(s) ? 'Tắt' : 'Bật'} Skill ${s.name} (${shortId(s.id)})`}
                              onChange={(next) => void toggleSkill(s, next)}
                            />
                          </div>
                          <div className="skill-card-actions">
                            <button onClick={() => setInspectingId(s.id)}>
                              <BookOpen size={14} />{' '}
                              {showSkillWarnings || skillState(s) === 'quarantined'
                                ? 'Chi tiết và bảo mật'
                                : 'Chi tiết Skill'}
                            </button>
                            <button disabled={skillMutation} onClick={() => setRemoving(s)}>
                              <Trash2 size={14} /> Gỡ Skill
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {page === 'Bảo mật' && (
                <>
                  <div className="security-hero">
                    <div className="security-emblem">
                      <ShieldCheck size={38} />
                    </div>
                    <div>
                      <Badge status="completed">SKILLGUARD ĐANG HOẠT ĐỘNG</Badge>
                      <h2>
                        Bằng chứng quyền truy cập.
                        <br />
                        Phạm vi bảo vệ rõ ràng.
                      </h2>
                      <p>
                        SkillGuard kiểm soát công cụ AgentScope và yêu cầu quyền ACP được gửi tới
                        nó. Công cụ nội bộ CLI có thể chạy ngoài phạm vi này. Đây không phải sandbox
                        hệ điều hành.
                      </p>
                    </div>
                  </div>
                  <div className="policy-grid">
                    {[
                      [FolderOpen, 'Hệ thống tệp', 'Chỉ tệp đã chọn & thư mục workspace'],
                      [Terminal, 'Thực thi tiến trình', 'Không cho phép shell tùy ý'],
                      [Network, 'Kết nối mạng', 'Chỉ provider đã cấu hình, cần đồng ý'],
                    ].map(([Icon, title, description]) => {
                      const I = Icon as typeof Shield;
                      return (
                        <div className="policy-card" key={String(title)}>
                          <I size={19} />
                          <strong>{String(title)}</strong>
                          <p>{String(description)}</p>
                          <span>
                            <LockKeyhole size={11} /> Đang áp dụng
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <ResearchPolicyPanel
                    readiness={readiness}
                    checking={checkingReadiness}
                    onCheck={() => void checkReadiness()}
                    onSignin={(reset) => void signinLab(reset)}
                  />
                  <div className="section-row">
                    <h3>Kiểm thử phòng vệ an toàn</h3>
                    <button
                      className="secondary-button"
                      onClick={async () => {
                        try {
                          const { run: r } = await api.securityDemo();
                          setRuns((old) => [r, ...old]);
                          setRunId(r.id);
                          setAllAudit(await api.audit());
                          toast(
                            'Đã đánh giá 3 tình huống tổng hợp. Không có thao tác nguy hiểm được thực thi.',
                          );
                        } catch (e) {
                          toast((e as Error).message);
                        }
                      }}
                    >
                      <Play size={14} /> Chạy tình huống demo
                    </button>
                  </div>
                  <div className="info-banner subtle">
                    <Shield size={18} />
                    <p>
                      Mô phỏng đọc tệp ngoài workspace, chạy chương trình không được cấp quyền và
                      kết nối tới test.invalid. Không khởi chạy tiến trình hay gửi dữ liệu.
                    </p>
                  </div>
                  <h3 className="mt">Bằng chứng bảo mật gần đây</h3>
                  <p>
                    Cho phép không chứng minh đã thực thi. Không có yêu cầu được ghi nhận không
                    chứng minh mô hình miễn nhiễm.
                  </p>
                  {allAudit.filter(isSecurityEvidence).length ? (
                    allAudit
                      .filter(isSecurityEvidence)
                      .slice(0, 30)
                      .map((e) => (
                        <button
                          key={e.id}
                          className="security-event"
                          onClick={() => inspectEvent(e)}
                        >
                          <span
                            className={`event-icon ${e.permission_decision === 'deny' || e.event_type.startsWith('security.') ? 'blocked' : 'completed'}`}
                          >
                            {e.permission_decision === 'deny' ||
                            e.event_type.startsWith('security.') ? (
                              <ShieldX size={15} />
                            ) : (
                              <ShieldCheck size={15} />
                            )}
                          </span>
                          <div>
                            <strong>{e.message}</strong>
                            <small>
                              {e.mode === 'demo' ? 'DEMO · ' : ''}
                              {e.tool_name} · {time(e.timestamp)}
                            </small>
                          </div>
                          <span className="code-tag">{securityLabel(e)}</span>
                        </button>
                      ))
                  ) : (
                    <Empty
                      icon={<Shield />}
                      description="Quyết định của SkillGuard sẽ được ghi lại khi tác vụ yêu cầu dùng công cụ."
                    >
                      Chưa có quyết định truy cập
                    </Empty>
                  )}
                </>
              )}
              {page === 'Lịch sử' && (
                <>
                  <div className="section-row">
                    <h3>
                      Cuộc trò chuyện <span className="count">{conversations.length}</span>
                    </h3>
                    <button
                      className="text-button"
                      disabled={connecting}
                      onClick={() => void connect(false)}
                    >
                      Làm mới
                    </button>
                  </div>
                  <div className="history-grid">
                    {conversations.map((c) => (
                      <button key={c.id} onClick={() => openConversation(c.id)}>
                        <MessageSquare size={19} />
                        <strong>{c.title}</strong>
                        <small>{date(c.created_at)}</small>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </div>
                  {logs}
                </>
              )}
              {page === 'Báo cáo' && (
                <>
                  {reports.length ? (
                    <div className="report-grid">
                      {reports.map(({ task, report }) => (
                        <div className="report-card" key={report.file_id}>
                          <div className="report-preview">
                            <FileSpreadsheet size={42} />
                            <span>XLSX</span>
                          </div>
                          <h3>{report.name}</h3>
                          <p>
                            {report.source_name && `${report.source_name} · `}
                            {report.rows} dòng · {date(task.updated_at)}
                          </p>
                          <span className="tiny-tag">
                            {task.mode === 'demo' ? 'TỔNG HỢP' : 'KẾT QUẢ THỰC TẾ'}
                          </span>
                          <button
                            className="secondary-button"
                            onClick={() => download(report.file_id, report.name)}
                          >
                            <Download size={15} /> Tải báo cáo
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={<FileBarChart2 />}
                      description="Đính kèm bảng tính và yêu cầu tạo báo cáo. Các tệp Excel đã tạo sẽ được lưu ở đây."
                    >
                      Kết quả xứng đáng được lưu lại
                    </Empty>
                  )}
                </>
              )}
              {page === 'Cài đặt' && (
                <div className="settings-stack">
                  <section className="settings-card">
                    <div className="settings-card-title">
                      <ShieldCheck size={19} />
                      <div>
                        <h3>Cách ly nghiên cứu trên Windows</h3>
                        <p>AppContainer là lớp cách ly bắt buộc khi chạy thử nghiệm ACP/MCP.</p>
                      </div>
                    </div>
                    <ReadinessStatus
                      readiness={readiness}
                      busy={checkingReadiness}
                      disabled={!connected || connecting}
                      hostModelCount={availableAntigravityModels.length}
                      onCheck={() => void checkReadiness()}
                      onSignin={(reset) => void signinLab(reset)}
                    />
                    <button
                      className="secondary-button mt"
                      onClick={() => {
                        setResearchMode('normal');
                        setPage('Chat');
                      }}
                    >
                      <MessageSquare size={14} /> Về Chat thường
                    </button>
                  </section>
                  <section className="settings-card">
                    <div className="settings-card-title">
                      <Activity size={19} />
                      <div>
                        <h3>Dịch vụ cục bộ</h3>
                        <p>Xử lý bảng tính, lưu cuộc trò chuyện và chạy công cụ trên máy này.</p>
                      </div>
                      <Badge status={connecting ? 'running' : connected ? 'completed' : 'blocked'}>
                        {connecting ? 'Đang kết nối' : connected ? 'Đã kết nối' : 'Chưa kết nối'}
                      </Badge>
                    </div>
                    {!isNative && (
                      <label>
                        Mã phiên phát triển
                        <input
                          type="password"
                          autoComplete="off"
                          value={session}
                          onChange={(e) => setSession(e.target.value)}
                          placeholder="Mã trong .agentscope/session-token"
                        />
                      </label>
                    )}
                    {connectionError && (
                      <p className="error-box" role="status">
                        {connectionError}
                      </p>
                    )}
                    <button
                      className="secondary-button"
                      disabled={connecting}
                      onClick={() => void connect(true, isNative ? undefined : session)}
                    >
                      {isNative
                        ? connected
                          ? 'Kiểm tra kết nối'
                          : 'Kết nối lại'
                        : 'Kết nối backend'}
                    </button>
                    <p className="field-help">
                      {isNative
                        ? 'AgentScope tự chạy dịch vụ khi mở ứng dụng và dừng dịch vụ khi đóng.'
                        : 'Chạy Backend trong môi trường phát triển rồi nhập mã phiên từ tệp .agentscope/session-token.'}
                    </p>
                  </section>
                  <section className="settings-card">
                    <div className="settings-card-title">
                      <Sparkles size={19} />
                      <div>
                        <h3>Kết nối AI</h3>
                        <p>Khóa API được lưu trong kho bí mật của hệ điều hành.</p>
                      </div>
                    </div>
                    <div className="form-grid">
                      <label>
                        Dịch vụ AI
                        <select
                          value={provider}
                          disabled={testing}
                          onChange={(e) => {
                            const nextProvider = e.target.value;
                            setProvider(nextProvider);
                            setModel(nextProvider === settings?.provider ? settings.model : '');
                            setProviderKey('');
                            clearModelTest();
                          }}
                        >
                          <option value="antigravity">Google Antigravity (ACP · agy CLI)</option>
                          <option value="openai">OpenAI · API key</option>
                          <option value="anthropic">Claude · Anthropic API key</option>
                          <option value="gemini">Google Gemini · API key</option>
                          <option value="codex" disabled>
                            Codex runtime · Chưa khả dụng
                          </option>
                        </select>
                      </label>
                      <label>
                        Model ID
                        {provider === 'antigravity' ? (
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <select
                              aria-label="Model Antigravity"
                              value={model}
                              disabled={testing}
                              onChange={(e) => {
                                setModel(e.target.value);
                                clearModelTest();
                              }}
                              style={{ flex: 1 }}
                            >
                              <option value="">Tự chọn từ phiên ACP</option>
                              {model && !availableAntigravityModels.some((m) => m.id === model) && (
                                <option value={model}>{model} · đã lưu</option>
                              )}
                              {availableAntigravityModels.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                                  {readiness?.models?.length && readiness.models.includes(m.id)
                                    ? ' · Lab'
                                    : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="secondary-button"
                              title="Khám phá lại danh sách model từ Antigravity ACP"
                              disabled={!connected || refreshingModels}
                              onClick={refreshModels}
                              style={{ padding: '0.45rem 0.65rem', whiteSpace: 'nowrap' }}
                            >
                              <RefreshCw size={13} className={refreshingModels ? 'spin' : ''} /> Tải
                              model
                            </button>
                          </div>
                        ) : (
                          <input
                            value={model}
                            maxLength={150}
                            disabled={testing}
                            onChange={(e) => {
                              setModel(e.target.value);
                              clearModelTest();
                            }}
                            placeholder="Nhập model có trong tài khoản của bạn"
                          />
                        )}
                      </label>
                    </div>
                    {provider === 'antigravity' ? (
                        <div
                          className="antigravity-info-box"
                          style={{
                            marginTop: '0.85rem',
                            marginBottom: '0.85rem',
                            padding: '0.9rem 1.05rem',
                            borderRadius: '14px',
                            backgroundColor: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                          }}
                        >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '0.4rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Terminal size={16} />
                            <strong>Antigravity ACP Runtime</strong>
                          </div>
                          <Badge status={settings?.antigravity?.ready ? 'completed' : 'blocked'}>
                            {settings?.antigravity?.ready
                              ? `Đã kết nối · v${settings.antigravity.version || 'không rõ'}`
                              : settings?.antigravity?.installed
                                ? 'CLI đã cài · chưa xác minh AI'
                                : 'Chưa cài CLI'}
                          </Badge>
                        </div>
                        <p style={{ margin: '0 0 0.4rem 0', fontSize: '0.82rem', opacity: 0.85 }}>
                          {settings?.antigravity?.message || 'Chưa kiểm tra kết nối ACP.'}
                        </p>
                        {settings?.antigravity?.path && (
                          <div
                            style={{
                              fontSize: '0.75rem',
                              opacity: 0.7,
                              wordBreak: 'break-all',
                              fontFamily: 'monospace',
                            }}
                          >
                            Đường dẫn: {settings.antigravity.path}
                          </div>
                        )}
                        <p
                          style={{
                            margin: '0.4rem 0 0 0',
                            fontSize: '0.78rem',
                            opacity: 0.8,
                          }}
                        >
                          {availableAntigravityModels.length
                            ? `Đã phát hiện ${availableAntigravityModels.length} model thực tế từ Antigravity ACP. Chọn model ở trên rồi bấm Lưu cấu hình hoặc Kiểm tra Antigravity.`
                            : 'Bấm Tải model để lấy danh sách model hiện có từ Antigravity ACP (stdio JSON-RPC 2.0).'}
                        </p>
                        {((model &&
                          !!readiness?.models?.length &&
                          !readiness.models.includes(model)) ||
                          (!!readiness?.models?.length &&
                            availableAntigravityModels.length > readiness.models.length)) && (
                          <div
                            style={{
                              marginTop: '0.55rem',
                              padding: '0.6rem 0.75rem',
                              borderRadius: '10px',
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.12)',
                            }}
                          >
                            <p
                              style={{
                                margin: '0 0 0.45rem 0',
                                fontSize: '0.78rem',
                                color: '#d8d4ec',
                              }}
                            >
                              {model && readiness?.models && !readiness.models.includes(model)
                                ? <>
                                    Tài khoản Lab hiện chỉ có {readiness.models.length} model và chưa
                                    có <code>{model}</code> (máy chính có{' '}
                                    {availableAntigravityModels.length} model). Bấm bên dưới để xóa
                                    phiên Lab cũ và đăng nhập lại đúng tài khoản Google để hiện đầy
                                    đủ model, tránh xung đột.
                                  </>
                                : <>
                                    Tài khoản Lab hiện chỉ có {readiness?.models?.length} model trong
                                    khi máy chính có {availableAntigravityModels.length} model. Bấm
                                    bên dưới để xóa phiên Lab cũ và đăng nhập lại cùng tài khoản
                                    Google.
                                  </>}
                            </p>
                            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={!connected || connecting || checkingReadiness}
                                onClick={() => void signinLab(true)}
                              >
                                <LogIn size={13} /> Đăng nhập lại lab (xóa phiên cũ)
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={!connected || connecting || checkingReadiness}
                                onClick={() => void checkReadiness()}
                              >
                                <RefreshCw size={13} className={checkingReadiness ? 'spin' : ''} />{' '}
                                Kiểm tra lại Lab
                              </button>
                            </div>
                          </div>
                        )}
                        <p
                          style={{
                            margin: '0.25rem 0 0 0',
                            fontSize: '0.78rem',
                            opacity: 0.75,
                            fontStyle: 'italic',
                          }}
                        >
                          Sử dụng phiên xác thực Google đã đăng nhập trên máy. Model đã chọn được
                          dùng cho Chat thường và làm mặc định cho thí nghiệm trong AppContainer.
                        </p>
                      </div>
                    ) : (
                      <label>
                        API key
                        <input
                          type="password"
                          autoComplete="new-password"
                          maxLength={512}
                          value={providerKey}
                          disabled={testing}
                          onChange={(e) => {
                            setProviderKey(e.target.value);
                            clearModelTest();
                          }}
                          placeholder={
                            provider === settings?.provider && settings.has_key
                              ? 'Đã lưu an toàn · nhập để thay thế'
                              : 'Nhập API key của dịch vụ này'
                          }
                        />
                      </label>
                    )}
                    <div className="settings-actions">
                      <button
                        className="primary-button"
                        disabled={!connected || testing}
                        onClick={async () => {
                          try {
                            const data = await api.saveSettings({
                              provider,
                              model: model.trim(),
                              api_key:
                                provider === 'antigravity'
                                  ? undefined
                                  : providerKey.trim() || undefined,
                              mode,
                            });
                            setSettings(data);
                            setMode(data.mode);
                            setProvider(data.provider);
                            setModel(data.model);
                            if (data.antigravity?.models && data.antigravity.models.length > 0) {
                              setAntigravityModels(data.antigravity.models);
                            }
                            setProviderKey('');
                            toast('Đã lưu cấu hình.');
                          } catch (e) {
                            toast((e as Error).message);
                          }
                        }}
                      >
                        <Check size={15} /> Lưu cấu hình
                      </button>
                      <button
                        className="secondary-button"
                        disabled={
                          !connected || testing || (provider !== 'antigravity' && !model.trim())
                        }
                        onClick={() => void runProviderTest()}
                      >
                        {testing ? <LoaderCircle className="spin" size={15} /> : <Zap size={15} />}{' '}
                        {provider === 'antigravity' ? 'Kiểm tra Antigravity' : 'Test model'}
                      </button>
                    </div>
                    {modelTest && (
                      <div className="model-test-feedback" role="status">
                        <strong>
                          {modelTest.model} đã phản hồi · {modelTest.duration_ms} ms
                        </strong>
                        <div>{modelTest.response}</div>
                      </div>
                    )}
                    {modelTestError && (
                      <div className="model-test-feedback model-test-error" role="alert">
                        {modelTestError}
                      </div>
                    )}
                    <p className="field-help">
                      {provider === 'antigravity'
                        ? 'Kiểm tra gửi yêu cầu AI thực tế và có thể dùng quota. SkillGuard từ chối yêu cầu ACP chưa cấp quyền; công cụ nội bộ của CLI không phải sandbox hệ điều hành đã được xác minh.'
                        : 'Test model dùng API key đang nhập hoặc khóa đã lưu của dịch vụ này, gửi một tin nhắn ngắn và có thể dùng quota. Bấm Lưu cấu hình để áp dụng cho Chat.'}
                    </p>
                  </section>
                  <section className="settings-card">
                    <div className="settings-card-title">
                      <ShieldCheck size={19} />
                      <div>
                        <h3>Chế độ vận hành</h3>
                        <p>Nhật ký demo được gắn nhãn và tách khỏi chứng cứ thực thi.</p>
                      </div>
                    </div>
                    <div className="mode-options">
                      {(['real', 'demo'] as Mode[]).map((m) => (
                        <button
                          className={mode === m ? 'active' : ''}
                          key={m}
                          disabled={!connected}
                          onClick={async () => {
                            try {
                              const saved = await api.saveSettings({ mode: m });
                              setSettings(saved);
                              setMode(saved.mode);
                              toast(
                                m === 'demo'
                                  ? 'Đã chuyển sang demo tổng hợp.'
                                  : 'Đã chuyển sang thực thi thực tế.',
                              );
                            } catch (e) {
                              toast((e as Error).message);
                            }
                          }}
                        >
                          <span>{m === 'demo' ? <Play size={18} /> : <Activity size={18} />}</span>
                          <strong>
                            {m === 'demo' ? 'Demo tổng hợp' : 'Real AI · Thực thi thực tế'}
                          </strong>
                          <small>
                            {m === 'demo'
                              ? 'Không API, không thực thi công cụ'
                              : 'Công cụ cục bộ + cloud AI tùy chọn'}
                          </small>
                          {mode === m && <Check size={17} />}
                        </button>
                      ))}
                    </div>
                    <p className="field-help">
                      Workspace: <code>{settings?.workspace || 'Chưa kết nối'}</code>
                    </p>
                  </section>
                </div>
              )}
            </div>
          )}
        </main>
        {!collapsed && (
          <>
            <div
              className="resize-handle"
              role="separator"
              aria-label="Thay đổi chiều rộng bảng thực thi"
              aria-orientation="vertical"
              onPointerDown={resize}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') setMonitorWidth(Math.min(430, monitorWidth + 20));
                if (e.key === 'ArrowRight') setMonitorWidth(Math.max(268, monitorWidth - 20));
              }}
            />
            <ExecutionCenter
              width={monitorWidth}
              run={run}
              runs={runs}
              events={events}
              skillName={runSkillName}
              focusEvent={selectedEvent}
              streamLost={streamLost}
              onClose={() => setCollapsed(true)}
              onSelect={(selected) => {
                if (page === 'Chat' && selected.conversation_id)
                  openConversation(selected.conversation_id, selected.id);
                else setRunId(selected.id);
              }}
              onCondition={selectRun}
              onExport={() => saveJson(events, 'agentscope-events.json')}
              actions={
                run &&
                (needsSkillLab || activeRun(run)) && (
                  <div className="execution-actions">
                    {needsSkillLab && skills.some((skill) => skill.id === run.skill_id) && (
                      <button onClick={() => setInspectingId(run.skill_id || '')}>
                        <ShieldCheck size={13} /> Kiểm tra Skill cục bộ
                      </button>
                    )}
                    {needsSkillLab && (
                      <button
                        onClick={() => {
                          setResearchMode('compare');
                          setSkillSelection(run.skill_id || '', run.conversation_id);
                          setPage('Chat');
                          composer.current?.focus();
                        }}
                      >
                        So sánh trong Chat
                      </button>
                    )}
                    {activeRun(run) && (
                      <>
                        {!run.experiment_id && (
                          <button
                            onClick={() =>
                              void taskAction(run.status === 'paused' ? 'resume' : 'pause')
                            }
                          >
                            {run.status === 'paused' ? <Play size={13} /> : <Pause size={13} />}
                            {run.status === 'paused' ? 'Tiếp tục' : 'Tạm dừng'}
                          </button>
                        )}
                        <button onClick={() => void taskAction('cancel')}>
                          <Square size={11} /> Hủy tác vụ
                        </button>
                      </>
                    )}
                  </div>
                )
              }
            />
          </>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".csv,.xlsx,.xls"
        multiple
        onChange={(e) => {
          void addFiles(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
      <input
        ref={skillInput}
        type="file"
        className="hidden"
        accept=".md,.zip"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        className="hidden"
        {...{ webkitdirectory: '', directory: '' }}
        multiple
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []), true);
          e.target.value = '';
        }}
      />
      {notice && (
        <div role="status" className="toast">
          <Activity size={16} />
          <span>{notice}</span>
          <IconButton label="Đóng thông báo" onClick={() => setNotice('')}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {reviewingSkill && (
        <Modal title="Đánh giá chỉ đọc trong Lab" onClose={() => setReviewingSkill(undefined)}>
          <IsolatedSkillReview {...reviewingSkill} />
        </Modal>
      )}
      {readingSkill && (
        <Modal title="Nội dung Skill" onClose={() => setReadingSkillId('')} wide>
          <h3>{readingSkill.name}</h3>
          <p className="modal-note">SKILL.md · Chỉ đọc tại máy</p>
          {readingQuarantinedSkill && (
            <>
              <div className="info-banner subtle" role="status">
                <ShieldAlert size={16} aria-hidden="true" />
                <div>
                  <strong>Skill đang cách ly · {skillScanLabel(readingSkill)}</strong>
                  {readingFlaggedFiles.length > 0 && (
                    <p>
                      {readingFlaggedFiles.slice(0, 2).join(', ')}
                      {readingFlaggedFiles.length > 2 &&
                        ` · +${readingFlaggedFiles.length - 2} tệp`}
                    </p>
                  )}
                </div>
              </div>
              <details className="lab-requirements">
                <summary>Xem phát hiện</summary>
                <SkillEvidence skill={readingSkill} showMetadata />
              </details>
            </>
          )}
          <SkillSource key={readingSkill.id} skillId={readingSkill.id} />
          {showSkillWarnings && !readingQuarantinedSkill && (
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setReadingSkillId('');
                  setInspectingId(readingSkill.id);
                }}
              >
                Xem phát hiện
              </button>
            </div>
          )}
        </Modal>
      )}
      {inspecting && !removing && (
        <Modal title="Thông tin Skill" onClose={() => setInspectingId('')} wide>
          <div className="skill-review-header">
            <span className="skill-card-icon">
              <Layers3 size={25} />
            </span>
            <div>
              <h3>{inspecting.name}</h3>
              <p>{inspecting.description}</p>
            </div>
          </div>
          {(showSkillWarnings || skillState(inspecting) === 'quarantined') && (
            <>
              <LocalSkillTest key={inspecting.id} skillId={inspecting.id} />
              <SkillEvidence skill={inspecting} showMetadata />
            </>
          )}
          {!!inspecting.duplicate_installations?.length && (
            <details className="lab-requirements">
              <summary>Bản cài đặt trùng ({inspecting.duplicate_installations.length})</summary>
              <div className="review-files">
                {inspecting.duplicate_installations.map((copy) => (
                  <div key={copy.id}>
                    <strong title={copy.id}>
                      {copy.id.slice(0, 8)} · {new Date(copy.created_at).toLocaleString('vi-VN')}
                    </strong>
                    <button
                      className="danger-button"
                      disabled={skillMutation}
                      onClick={() =>
                        setRemoving({
                          ...copy,
                          name: inspecting.name,
                          package_sha256: inspecting.package_sha256,
                        })
                      }
                    >
                      Gỡ bản cài đặt {copy.id.slice(0, 8)}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setInspectingId('');
                setReadingSkillId(inspecting.id);
              }}
            >
              <BookOpen size={14} /> Mở Skill
            </button>
            <button
              className="danger-button"
              disabled={skillMutation}
              onClick={() => setRemoving(inspecting)}
            >
              <Trash2 size={14} /> Gỡ Skill
            </button>
            {canEnableSkill(inspecting) && (
              <button
                className="secondary-button"
                disabled={skillMutation}
                onClick={() =>
                  void skillAction(inspecting.id, isEnabledSkill(inspecting) ? 'disable' : 'enable')
                }
              >
                {isEnabledSkill(inspecting) ? 'Tắt Skill' : 'Bật Skill'}
              </button>
            )}
          </div>
        </Modal>
      )}
      {removing && (
        <Modal
          title="Gỡ Skill"
          onClose={() => {
            if (!skillMutation) setRemoving(undefined);
          }}
        >
          <p>
            Gỡ <strong>{removing.name}</strong> khỏi thư viện?
          </p>
          <p className="modal-note">
            Mã bản cài đặt <code title={removing.id}>{removing.id.slice(0, 8)}</code>
          </p>
          <p className="modal-note">Bản lưu nhập Skill và lịch sử tác vụ được giữ lại.</p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={skillMutation}
              onClick={() => setRemoving(undefined)}
            >
              Hủy
            </button>
            <button
              className="danger-button"
              disabled={skillMutation}
              onClick={() => void removeSkill(removing)}
            >
              <Trash2 size={14} /> Xác nhận gỡ Skill
            </button>
          </div>
        </Modal>
      )}
      {approval && run?.status === 'awaiting_approval' && (
        <Modal
          title="Cho phép kết nối AI?"
          onClose={() => toast('Hãy chọn cho phép hoặc từ chối để tiếp tục.')}
        >
          <div className="approval-icon">
            <Network size={29} />
          </div>
          <p className="approval-description">
            {run?.provider === 'antigravity'
              ? 'Gemini sẽ nhận yêu cầu này, nội dung Skill đã kiểm tra và dữ liệu Excel mà công cụ MCP đọc. Tệp gốc ở trên máy.'
              : 'Provider sẽ nhận tin nhắn, lịch sử hội thoại và bản tóm tắt dữ liệu do công cụ tạo. Tệp gốc không được tải lên.'}
          </p>
          <dl className="approval-details">
            <div>
              <dt>Thao tác</dt>
              <dd>Gửi yêu cầu HTTPS</dd>
            </div>
            <div>
              <dt>Đích</dt>
              <dd>{String(approval.arguments.destination)}</dd>
            </div>
            <div>
              <dt>Công cụ</dt>
              <dd>{approval.tool_name}</dd>
            </div>
            <div>
              <dt>Skill</dt>
              <dd>{runSkillName || 'Không dùng Skill'}</dd>
            </div>
          </dl>
          <p className="field-help">
            Rủi ro: nội dung gửi đi chịu chính sách xử lý dữ liệu của provider. Quyết định chỉ áp
            dụng cho tác vụ này.
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await api.approve(String(approval.result.approval_id), false);
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              Từ chối
            </button>
            <button
              className="primary-button"
              onClick={async () => {
                try {
                  await api.approve(String(approval.result.approval_id), true);
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              <ShieldCheck size={15} /> Cho phép một lần
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
