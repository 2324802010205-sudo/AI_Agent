import type {
  AntigravityModel,
  AntigravityStatus,
  Attachment,
  Conversation,
  ConversationAttachments,
  ExecutionEvent,
  Message,
  Run,
  Settings,
  Skill,
  SkillRuntimeSummary,
  LocalSkillTestResult,
  IsolatedSkillReview,
  LabStatus,
  LabPlan,
  IsolatedLabCheck,
  IsolatedLabStatus,
  IsolatedTrial,
  SkillLifecycleAudit,
  FormatSession,
} from './types';
import type {
  Condition,
  EvidenceImport,
  EvidenceKind,
  EvaluationSnapshot,
  FunctionalCampaign,
  Experiment,
  ExperimentSummary,
  ProtectionPolicy,
  PythonVerification,
  ResearchPolicy,
  ResearchReadiness,
  WorkbookVariant,
} from './types/research';
export const developmentBackendUrl = 'http://127.0.0.1:8765';
let token =
  '__TAURI_INTERNALS__' in window ? '' : sessionStorage.getItem('agentscope-session') || '';
let base = developmentBackendUrl;
export function configureConnection(url: string, secret: string) {
  base = url;
  token = secret;
  if ('__TAURI_INTERNALS__' in window) sessionStorage.removeItem('agentscope-session');
  else sessionStorage.setItem('agentscope-session', secret);
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${base}/api${path}`, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Dịch vụ AgentScope cục bộ không phản hồi.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === 'string'
        ? data.detail
        : data.detail?.message || `Yêu cầu thất bại (${response.status})`,
    );
  }
  return response.json();
}
const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
async function saveFrom(path: string, name: string, failure: string) {
  const response = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : failure);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export interface StartExperimentBody {
  conversation_id?: string;
  content: string;
  attachment_id: string;
  skill_id?: string;
  skill_ids?: string[];
  conditions: Condition[];
  protection_policy: ProtectionPolicy;
  model?: string;
  confirm_isolated_execution: boolean;
}
export type CloudProvider = 'openai' | 'anthropic' | 'gemini';
export interface ModelTestResult {
  provider: CloudProvider | 'antigravity';
  model: string;
  duration_ms: number;
  response: string;
}
export interface ProviderTestResult {
  message: string;
  provider?: string;
  model?: string;
  models?: AntigravityModel[];
  duration_ms?: number;
  response?: string;
}
export const api = {
  health: () => request<{ status: string }>('/health'),
  conversations: () => request<Conversation[]>('/conversations'),
  createConversation: () => post<Conversation>('/conversations'),
  messages: (id: string) => request<Message[]>(`/conversations/${id}/messages`),
  attachments: (id: string) => request<ConversationAttachments>(`/conversations/${id}/attachments`),
  send: (id: string, content: string, attachments: Attachment[]) =>
    post<{ run: Run; message: Message }>(`/conversations/${id}/messages`, {
      content,
      attachment_ids: attachments.map((a) => a.id),
      auto_skill: true,
    }),
  runs: () => request<Run[]>('/tasks'),
  events: (id: string) => request<ExecutionEvent[]>(`/tasks/${id}/events`),
  control: (id: string, action: string) => post<Run>(`/tasks/${id}/control`, { action }),
  approve: (id: string, allowed: boolean) => post(`/approvals/${id}`, { allowed }),
  skills: () => request<Skill[]>('/skills'),
  skillSource: (id: string, signal: AbortSignal) =>
    request<{ content: string }>(`/skills/${id}/source`, { signal }),
  skillEvidence: (id: string) => request<Record<string, unknown>>(`/skills/${id}/evidence`),
  testSkillLocally: (id: string, task: string, spreadsheet: boolean) =>
    post<LocalSkillTestResult>(`/skills/${id}/local-test`, { task, spreadsheet }),
  reviewIsolatedSkill: (id: string, expectedHash: string, conversationId?: string) =>
    post<IsolatedSkillReview>(`/skills/${id}/isolated-reviews`, {
      confirm_read_only: true,
      expected_package_sha256: expectedHash,
      conversation_id: conversationId,
    }),
  skillRuntimeSummary: () => request<SkillRuntimeSummary>('/skills/runtime-summary'),
  skill: (id: string, action: 'enable' | 'disable') => post<Skill>(`/skills/${id}/${action}`),
  removeSkill: (id: string) =>
    request<{ status: 'removed'; cleanup_pending?: boolean }>(`/skills/${id}`, {
      method: 'DELETE',
    }),
  upload: async (file: File, conversationId?: string) => {
    const data = new FormData();
    data.append('file', file);
    const query = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : '';
    return request<Attachment>(`/files${query}`, { method: 'POST', body: data });
  },
  importSkill: async (files: File[], paths?: string[]) => {
    const data = new FormData();
    files.forEach((f, i) => data.append('files', f, paths?.[i] || f.name));
    return request<Skill>('/skills/import', { method: 'POST', body: data });
  },
  settings: () => request<Settings>('/settings'),
  antigravityStatus: () => request<AntigravityStatus>('/antigravity/status'),
  antigravityModels: () => request<{ models: AntigravityModel[] }>('/antigravity/models'),
  saveSettings: (data: Record<string, unknown>) => post<Settings>('/settings', data),
  testProvider: (model?: string) =>
    request<ProviderTestResult>('/settings/test', {
      method: 'POST',
      body: model !== undefined ? JSON.stringify({ model }) : undefined,
      signal: AbortSignal.timeout(150000),
    }),
  testModel: (data: { provider: CloudProvider; model: string; api_key?: string }) =>
    request<ModelTestResult>('/settings/test-model', {
      method: 'POST',
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(65000),
    }),
  audit: () => request<ExecutionEvent[]>('/audit'),
  securityDemo: () => post<{ run: Run }>('/security/demo'),
  labStatus: () => request<LabStatus>('/lab/status'),
  evaluationStatus: () =>
    request<{ reason: string; arithmetic_program_sha256: string }>('/evaluation/status'),
  evaluations: () => request<unknown[]>('/evaluation'),
  prepareEvaluation: (body: Record<string, unknown>) => post('/evaluation/prepare', body),
  runEvaluation: (id: string, body: Record<string, unknown>) =>
    request(`/evaluation/${id}/run`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150000),
    }),
  arithmeticConformance: () =>
    request('/evaluation/arithmetic/conformance', {
      method: 'POST',
      body: JSON.stringify({ approved_program_consent: true }),
      signal: AbortSignal.timeout(150000),
    }),
  exportEvaluation: async (id: string) => {
    const response = await fetch(`${base}/api/evaluation/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Không thể xuất evaluation');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `answer-evidence-${id.slice(0, 8)}.zip`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  isolatedLabStatus: () => request<IsolatedLabStatus>('/isolated-lab/status'),
  formatSessions: () => request<FormatSession[]>('/isolated-lab/format-sessions'),
  isolatedLabSkillLifecycle: () =>
    request<SkillLifecycleAudit>('/isolated-lab/skill-lifecycle-audit'),
  isolatedLabCheck: () =>
    request<IsolatedLabCheck>('/isolated-lab/check', {
      method: 'POST',
      signal: AbortSignal.timeout(180000),
    }),
  isolatedLabTrials: () => request<IsolatedTrial[]>('/isolated-lab/trials'),
  isolatedLabStart: (body: {
    kind: 'control' | 'injection' | 'canary';
    skill_id?: string;
    model: string;
    confirm_isolated_execution: boolean;
    data_view?: 'aggregates' | 'raw_rows';
  }) => post<IsolatedTrial>('/isolated-lab/trials', body),
  isolatedLabSuite: (body: {
    skill_id?: string;
    preset?: IsolatedTrial['preset'];
    data_view?: 'aggregates' | 'raw_rows';
    model: string;
    confirm_isolated_execution: boolean;
  }) => post<{ suite_id: string; trial_ids: string[] }>('/isolated-lab/suites', body),
  isolatedLabExport: async (format: 'markdown' | 'json', suiteId?: string) => {
    const params = new URLSearchParams({ format });
    if (suiteId) params.set('suite_id', suiteId);
    const response = await fetch(`${base}/api/isolated-lab/export?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Không thể xuất báo cáo ranh giới tin cậy');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `agentscope-boundary-${suiteId || 'all'}.${format === 'markdown' ? 'md' : 'json'}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  isolatedLabReport: async (id: string, name: string) => {
    const response = await fetch(`${base}/api/isolated-lab/trials/${id}/report`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Không thể tải báo cáo Excel đã xác minh');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  labPlans: () => request<LabPlan[]>('/lab/plans'),
  labPrepare: (body: Record<string, unknown>) => post<LabPlan>('/lab/plans', body),
  labRun: (id: string, role: 'baseline' | 'protected') =>
    post<LabPlan>(`/lab/plans/${id}/run`, {
      role,
      disposable_vm_consent: true,
    }),
  labExport: async (id: string) => {
    const response = await fetch(`${base}/api/lab/plans/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Không thể xuất bằng chứng lab');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `agentscope-lab-${id.slice(0, 8)}.zip`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  download: async (id: string, name: string) => {
    const response = await fetch(`${base}/api/files/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Không thể tải tệp');
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  researchReadiness: () => request<ResearchReadiness>('/research/readiness'),
  researchCheck: () =>
    request<ResearchReadiness>('/research/readiness/check', {
      method: 'POST',
      signal: AbortSignal.timeout(240000),
    }),
  researchSignin: (reset = false) =>
    post<{ status: string; message: string; reset?: boolean }>(
      '/research/readiness/signin',
      reset ? { reset: true } : undefined,
    ),
  researchPolicy: () => request<ResearchPolicy>('/research/policy'),
  verifyResearchPython: () =>
    post<PythonVerification>('/research/python-verification', { confirm: true }),
  experiments: () => request<ExperimentSummary[]>('/experiments'),
  functionalHistory: () => request<FunctionalCampaign[]>('/research/functional'),
  functionalResult: (id: string) => request<FunctionalCampaign>(`/research/functional/${id}`),
  startFunctional: (workbookVariant: WorkbookVariant, repetitions: number) =>
    post<FunctionalCampaign>('/research/functional', {
      workbook_variant: workbookVariant,
      repetitions,
      confirm: true,
    }),
  cancelFunctional: (id: string) => post<FunctionalCampaign>(`/research/functional/${id}/cancel`),
  functionalExport: (id: string, extension: 'csv' | 'md') =>
    saveFrom(
      `/research/functional/${id}/export/${extension}`,
      `gemini-functional.${extension}`,
      'Không thể xuất đối chứng',
    ),
  evidenceImports: () => request<EvidenceImport[]>('/research/evidence-imports'),
  importEvidence: (file: File, source: EvidenceKind) => {
    const body = new FormData();
    body.append('file', file);
    body.append('evidence_type', source);
    return request<EvidenceImport>('/research/evidence-imports', { method: 'POST', body });
  },
  importedEvidence: (id: string) =>
    request<EvidenceImport & EvaluationSnapshot>(`/research/evidence-imports/${id}`),
  importedEvidenceExport: (id: string, extension: 'csv' | 'md') =>
    saveFrom(
      `/research/evidence-imports/${id}/export/${extension}`,
      `imported-research-evidence.${extension}`,
      'Không thể xuất bằng chứng đã nhập',
    ),
  offlineChecks: () =>
    request<{ evidence_type: 'synthetic'; checks: { label: string; passed: boolean }[] }>(
      '/research/offline-checks',
    ),
  evaluationSnapshot: (cleanSha = '') =>
    request<EvaluationSnapshot>(
      `/experiments/evaluation${cleanSha ? `?clean_sha=${encodeURIComponent(cleanSha)}` : ''}`,
    ),
  evaluationExport: (extension: 'csv' | 'md', cleanSha = '') =>
    saveFrom(
      `/experiments/evaluation/export/${extension}${cleanSha ? `?clean_sha=${encodeURIComponent(cleanSha)}` : ''}`,
      `skillguard-evaluation.${extension}`,
      'Không thể xuất báo cáo đánh giá',
    ),
  experiment: (id: string) => request<Experiment>(`/experiments/${id}`),
  startExperiment: (body: StartExperimentBody) =>
    post<Experiment & { user_message: Message }>('/experiments', body),
  cancelExperiment: (id: string) => post<{ status: string }>(`/experiments/${id}/cancel`),
  experimentEvidence: (id: string, condition: Condition) =>
    request<Record<string, unknown>>(`/experiments/${id}/conditions/${condition}/evidence`),
  experimentReport: (id: string, condition: Condition, name: string) =>
    saveFrom(
      `/experiments/${id}/conditions/${condition}/report`,
      name,
      'Không thể tải báo cáo Excel của điều kiện này',
    ),
  experimentExport: (id: string) =>
    saveFrom(
      `/experiments/${id}/export`,
      `agentscope-experiment-${id.slice(0, 8)}.zip`,
      'Không thể xuất bằng chứng thí nghiệm',
    ),
  subscribe: (
    runId: string,
    onEvent: (event: ExecutionEvent) => void,
    onDisconnect: () => void,
  ) => {
    let disposed = false;
    let ws: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let retry = 0;
    const connect = async () => {
      try {
        const ticket = await post<{ ticket: string }>('/ws-ticket');
        if (disposed) return;
        ws = new WebSocket(
          `${base.replace('http', 'ws')}/ws/runs/${runId}?ticket=${encodeURIComponent(ticket.ticket)}`,
        );
        ws.onopen = () => {
          retry = 0;
        };
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.id) onEvent(data);
          } catch {
            /* ignore protocol heartbeat */
          }
        };
        ws.onclose = () => {
          if (!disposed) {
            onDisconnect();
            timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
          }
        };
        ws.onerror = () => ws?.close();
      } catch {
        if (!disposed) {
          onDisconnect();
          timer = setTimeout(connect, 5000);
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      ws?.close();
    };
  },
};
