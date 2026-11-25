export type ResearchMode = 'normal' | 'skillguard_off' | 'skillguard_on' | 'compare';
export type Condition = 'baseline' | 'skillguard_off' | 'skillguard_on';
export type ProtectionPolicy = 'quarantine' | 'filter' | 'runtime_only';

export interface ReadinessStep {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}
export interface ResearchReadiness {
  state: 'ready' | 'unavailable' | 'unchecked';
  headline: string;
  blocker: string | null;
  action: 'check' | 'signin' | 'install_cli' | null;
  checking: boolean;
  supported: boolean;
  appcontainer?: {
    mode: 'on';
    required: true;
    verification: 'verified' | 'failed' | 'unchecked';
  };
  checked_at?: string;
  stale?: boolean;
  steps: ReadinessStep[];
  models?: string[];
  flash_models?: string[];
  requirements: { text_skill: string[]; executable_skill: string; not_required: string };
}
export interface MandatoryControl {
  id: string;
  label: string;
  enforced_by: string;
}
export interface ResearchPolicy {
  mandatory_controls: MandatoryControl[];
  optional_defenses: Record<string, string>;
  protection_policies: Record<ProtectionPolicy, string>;
  conditions: Record<Condition, string>;
  mcp_tools: string[];
}
export interface PythonVerification {
  state: 'verified' | 'failed';
  profile: string;
  script_sha256: string;
  input_sha256: string;
  timeout_seconds: number;
  receipt_path: string;
  token?: {
    pid: number;
    token_appcontainer_sid: string;
    token_integrity_sid: string;
    token_capabilities: string[];
  };
  exit_code?: number;
  private_read_denied?: boolean;
  input_write_denied?: boolean;
  artifact?: { name: string; sha256: string; size: number };
  error?: string;
}
export interface GroundTruthVariant {
  orders: number;
  revenue: number | null;
  profit: number | null;
  label: string;
  cancelled_orders?: number;
}
export interface GroundTruth {
  available: boolean;
  reason?: string;
  sheet?: string;
  columns?: Record<string, string | null>;
  variants?: Record<string, GroundTruthVariant>;
  method?: string;
}
export interface Refusal {
  tool: string | null;
  reason: string;
  label: string;
  enforced_by: 'mandatory' | 'skillguard' | string;
  arguments?: Record<string, unknown>;
}
export interface OutOfTaskAction {
  tool: string;
  result?: Record<string, unknown>;
  verified_on_disk?: boolean;
}
export interface WorkspaceArtifact {
  name: string;
  size: number;
  sha256: string;
  verified_on_disk?: boolean;
  origin?: 'mcp' | 'unattributed';
}
export interface ObservedToolCall {
  tool: string;
  arguments: Record<string, unknown>;
  stage:
    | 'PROPOSED'
    | 'PROPOSED_NOT_EXECUTED'
    | 'AUTHORIZED'
    | 'DISPATCHED'
    | 'EXECUTED'
    | 'BLOCKED'
    | 'EXECUTION_FAILED';
  reason?: string | null;
}
export interface Assessment {
  headline: string;
  category:
    'unavailable' | 'blocked' | 'influenced' | 'resisted' | 'clean' | 'baseline' | 'baseline_error';
  title: string;
  skill_exposed_to_model: boolean;
  skill_exposure?: 'blocked' | 'no_skill' | 'delivered' | 'unverified';
  model_filter_blocked?: boolean;
  tool_calls?: ObservedToolCall[];
  skillguard_decision?: string;
  unauthorized_proposals: Refusal[];
  integrity_blocks: Refusal[];
  script_requests: Record<string, unknown>[];
  code_execution_requests?: Record<string, unknown>[];
  available_tools?: string[];
  out_of_task_actions?: OutOfTaskAction[];
  artifacts_created?: WorkspaceArtifact[];
  unattributed_artifacts?: WorkspaceArtifact[];
  recovered?: boolean;
  recovery?: { state: string } | null;
  report_attempts: {
    values: Record<string, number | null>;
    matches_ground_truth?: boolean;
    comparable?: boolean;
  }[];
  deviating_report_attempts: number;
  report: {
    created: boolean;
    valid: boolean;
    status?: 'REPORT_VERIFIED' | 'INCOMPLETE';
    revalidated_from_archive?: boolean;
    failure?: string | null;
    deviates_from_ground_truth: boolean;
    values?: Record<string, number> | null;
    checks?: Record<string, boolean> | null;
    reason?: string | null;
  };
  answer: { values: Record<string, number>; deviates_from_ground_truth: boolean };
  tools_executed: string[];
  unmediated_cli_tools: string[];
}
export interface ConditionRecord {
  condition: Condition;
  label: string;
  task_id: string;
  state: string;
  resolved: {
    protection_policy: ProtectionPolicy | null;
    optional_defenses: Record<string, boolean>;
    mandatory_controls: string[];
    mcp_policy: string;
    policy_sha256: string;
  };
  skillguard: {
    decision: string;
    findings: {
      line: number;
      rule: string;
      label: string;
      excerpt: string;
      skill_name?: string;
      skill_id?: string;
    }[];
    removed_lines: {
      line: number;
      end_line?: number;
      kind?: 'code_block' | 'line';
      label?: string;
      excerpt: string;
      skill_name?: string;
      skill_id?: string;
    }[];
    reason?: string;
  };
  prompt_sha256: string;
  input_snapshot_sha256: string;
  session?: { session_id: string; model: string; container_sid?: string } | null;
  delivery?: { prompt_submitted: boolean; prompt_completed: boolean } | null;
  error?: { type: string; message: string } | null;
  report?: { name: string; sha256: string };
  validation?: { sales_breakdowns_verified?: boolean | null } | null;
  assessment?: Assessment;
}
export interface Experiment {
  id: string;
  created_at: string;
  finished_at?: string;
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  conversation_id: string;
  task: { text: string };
  workbook: {
    file_id: string;
    name: string;
    sha256: string;
    sheets: { name: string; rows: number }[];
  };
  skill: {
    id: string;
    name: string;
    status?: string;
    skill_md_sha256: string;
    package: { assessment: string; executable_files: string[]; high_risk: boolean };
    attempts: { line: number; rule: string; label: string; excerpt: string }[];
    scripts_executed: boolean;
  };
  skills?: {
    id: string;
    name: string;
    status?: string;
    skill_md_sha256: string;
    package_sha256?: string;
  }[];
  model: string;
  protection_policy: ProtectionPolicy;
  ground_truth: GroundTruth;
  input_snapshot_sha256: string;
  order: Condition[];
  conditions: Record<Condition, ConditionRecord>;
  comparison?: { conclusions: string[]; distinct_session_ids: boolean; equivalent_inputs: boolean };
  error?: { message: string };
}
export interface ExperimentSummary {
  id: string;
  created_at: string;
  state: Experiment['state'];
  conversation_id: string;
  task: { text: string };
  workbook: { name: string };
  skill: { name: string; skill_md_sha256?: string };
  model: string;
  order: Condition[];
  outcomes: Record<string, string | null>;
}

export interface EvaluationProportion {
  hits: number;
  n: number;
  unavailable: number;
  wilson95: [number, number] | null;
}

export interface EvaluationSnapshot {
  metric_labels: Record<string, string>;
  groups: { condition: Condition; runs: number; metrics: Record<string, EvaluationProportion> }[];
  runs: {
    experiment_id: string;
    run_id: string | null;
    condition: Condition;
    outcome: string;
    model: string;
    exposure?: string | null;
    skill_exposure?: boolean | null;
    blocking_layers?: string[];
    actions?: Record<string, unknown>[];
  }[];
}

export type WorkbookVariant = 'original' | 'reversed_rows';

export interface FunctionalRun {
  id: string;
  condition: 'baseline' | 'skillguard_on';
  repetition: number;
  state: string;
  experiment_id?: string;
  conversation_id?: string;
  session_id?: string;
  duration_ms?: number;
  verified_report?: boolean;
  error?: unknown;
  actions?: Record<string, unknown>[];
  validation?: { checks?: Record<string, boolean> };
}

export interface FunctionalCampaign {
  id: string;
  evidence_type: 'functional_acp';
  state: string;
  created_at: string;
  appcontainer: 'on';
  model: string;
  temperature: number | null;
  timeout_seconds: number;
  workbook_variant: WorkbookVariant;
  workbook_sha256: string;
  runs: FunctionalRun[];
}

export type EvidenceKind = 'historical_acp' | 'synthetic';

export interface EvidenceImport {
  id: string;
  evidence_type: EvidenceKind;
  sha256: string;
  imported_at: string;
  run_count: number;
}
