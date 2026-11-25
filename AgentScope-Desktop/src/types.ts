export type Status =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'paused';
export type Mode = 'demo' | 'real';
export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
}
export interface ConversationAttachments {
  files: Attachment[];
  selected_ids: string[];
  research_selected_id?: string;
}
export interface Message {
  conversation_id?: string;
  task_id?: string;
  streaming?: boolean;
  incomplete?: boolean;
  revision?: number;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  run_id?: string;
  created_at: string;
  experiment_id?: string;
  condition?: 'baseline' | 'skillguard_off' | 'skillguard_on';
  kind?: 'experiment_condition' | 'experiment_comparison';
  research_mode?: string;
  verbatim_model_answer?: boolean;
}
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  selected_skill_id?: string | null;
}
export interface RunReport {
  file_id: string;
  name: string;
  rows: number;
  source_file_id?: string;
  source_name?: string;
}
export interface Run {
  provider?: string;
  execution_engine?: string;
  model?: string;
  session_id?: string;
  id: string;
  conversation_id: string;
  title: string;
  status: Status;
  mode: Mode;
  created_at: string;
  updated_at: string;
  skill_id?: string;
  skill_name?: string;
  loaded_skills?: { id: string; name: string; sha256?: string }[];
  skill_selection_mode?: 'all_enabled';
  result?: RunReport;
  reports?: RunReport[];
  error?: string;
  experiment_id?: string;
  condition?: 'baseline' | 'skillguard_off' | 'skillguard_on';
}
export interface ExecutionEvent {
  id: string;
  run_id: string;
  step_id: string;
  timestamp: string;
  source: string;
  event_type: string;
  tool_name?: string;
  status: Status;
  permission_decision?: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  duration_ms?: number;
  error?: string;
  message: string;
  mode: Mode;
}
export type SkillAssessment =
  | 'no_significant_findings'
  | 'suspicious_instructions'
  | 'untrusted_executable'
  | 'high_risk_behavior'
  | 'policy_violation'
  | 'uncertain';

/** Distinct lifecycle states. A deleted Skill is simply absent from the library. */
export type SkillState = 'enabled' | 'disabled' | 'quarantined' | 'restricted';

export interface Skill {
  id: string;
  name: string;
  description: string;
  status: 'quarantine' | 'enabled' | 'approved' | 'disabled';
  /** Derived by the backend. Older records are classified by `skillState()`. */
  state?: SkillState;
  eligible?: boolean;
  toggleable?: boolean;
  state_reason?: string | null;
  package_sha256?: string;
  reused_installation?: boolean;
  duplicate_installations?: Pick<Skill, 'id' | 'status' | 'created_at'>[];
  research_fixture?: boolean;
  security?: {
    assessment: SkillAssessment;
    scanned_at: string;
    executable_files: string[];
    references: string[];
    requested_tools?: string[];
    findings: {
      code: string;
      category: Exclude<SkillAssessment, 'no_significant_findings'> | 'informational';
      path: string;
      line: number | null;
      message: string;
    }[];
  };
  files: string[];
  capabilities: string[];
  findings: string[];
  static_review?: {
    method: string;
    assurance: string;
    status: string;
    indicators: { rule: string; line: number }[];
    limitation: string;
  };
  hashes: Record<string, string>;
  created_at: string;
}
export interface LocalSkillTestResult {
  skill_id: string;
  package_sha256: string;
  installation_status: Skill['status'];
  security: NonNullable<Skill['security']>;
  matches_task: boolean;
  available: boolean;
  requested_tools: { name: string; registered: boolean }[];
}
export interface IsolatedSkillReview {
  id: string;
  skill_id: string;
  skill_name: string;
  conversation_id: string | null;
  evidence_type: 'local_static_review';
  authorized_at: string;
  completed_at: string;
  status: 'quarantine';
  snapshot: {
    archive_id: string;
    package_sha256: string;
    skill_md_sha256: string;
    file_hashes: Record<string, string>;
  };
  security: NonNullable<Skill['security']>;
  provider: 'not_called';
  model_exposure: 'not_submitted';
  presented_material_sha256: null;
  tool_execution: 'not_run';
  artifact_verification: 'not_applicable';
}
export interface AntigravityModel {
  id: string;
  name: string;
}
export interface AntigravityStatus {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  ready: boolean;
  connection_status?: string;
  authenticated?: boolean;
  message: string;
  models?: AntigravityModel[];
  current_model?: string | null;
}
export interface Settings {
  provider: string;
  model: string;
  has_key: boolean;
  mode: Mode;
  workspace: string;
  network_approval: boolean;
  backend_version?: string;
  antigravity?: AntigravityStatus;
}
export const statusLabel: Record<Status, string> = {
  pending: 'Đang chờ',
  awaiting_approval: 'Chờ phê duyệt',
  running: 'Đang thực hiện',
  completed: 'Hoàn thành',
  blocked: 'Đã chặn',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
  paused: 'Tạm dừng',
};

export interface LabStatus {
  state: string;
  eligible: boolean;
  reason: string;
  requirements: string[];
  guest_runner_validation: string;
  challenge?: { nonce: string; created_at: string };
  scenarios: {
    id: string;
    title: string;
    injection_present: boolean;
    skill_sha256: string;
  }[];
}
export interface LabTrial {
  state?: string;
  evidence_level: string;
  audit_complete?: boolean;
  model?: string;
  mode?: { current_mode_id: string };
  prompt_delivered?: boolean;
  actions?: {
    model_selected?: boolean;
    execution_verified?: boolean;
    denied_before_execution?: boolean;
    os_denial_verified?: boolean;
  }[];
  outcome?: {
    classification: string;
    prevention: boolean;
    protection?: string;
  };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  error?: unknown;
}
export interface LabPlan {
  id: string;
  state: string;
  evidence_level: string;
  workspace: string;
  model: string;
  execution_mode: 'default' | 'auto';
  scenario: string;
  skill_sha256: string;
  dataset_sha256: string;
  task: string;
  trials: Partial<Record<'baseline' | 'protected', LabTrial>>;
  comparison_limits: string[];
}

export type * from './types/isolatedLab';

export interface SkillRuntimeSummary {
  total: number;
  enabled: number;
  disabled: number;
  quarantined: number;
  restricted: number;
  exposure: {
    mode: 'all_enabled';
    exposed: { id: string; name: string; sha256: string; chars: number }[];
    withheld: { skill_id: string; skill_name?: string | null; reason: string }[];
    limitations: { code: string; skill_ids: string[]; message: string }[];
    limits: { max_skill_chars: number; max_context_chars: number; used_chars: number };
  };
}

export interface SkillExposureReceipt {
  skill_id: string;
  skill_name: string;
  sha256: string;
  exposed: boolean;
  in_acp_prompt: boolean;
  skill_exposure: 'acknowledged' | 'unverified' | 'not_included';
  reason?: string | null;
  bundled_files_executed: boolean;
}
