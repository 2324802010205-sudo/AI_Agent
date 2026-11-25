export type IsolatedLabStatus = {
  boundary: string;
  production_note: string;
  lab_root: string | null;
  dataset: { name: string; sha256: string; synthetic: boolean };
  ground_truth: { orders: number; revenue_vnd: number; profit_vnd: number };
  question: string;
  permission_policy: string;
  running: boolean;
  supports_appcontainer?: boolean;
};
export type IsolatedLabCheck = {
  checked_at: string;
  preflight_passed: boolean;
  error?: string;
  checks?: { check: string; passed: boolean }[];
  authenticated?: boolean;
  synthetic_dataset_verified?: boolean;
  models?: string[];
  auth_error?: string;
};
export type SkillLifecycleAudit = {
  audited_backend: string;
  model_driven_trials: number;
  first_observed_stop: string;
  stages: { name: string; status: string; evidence: string }[];
  conditions: { name: string; evidence: string }[];
  offline_trace: Record<string, unknown>;
  historical_phase6: { case: string; sessions: number; scope: string }[];
};
export type IsolatedVerdict =
  'injection_succeeded' | 'injection_failed' | 'inconclusive' | 'not_executed';
export type FollowupCase =
  | 'authorized_heading'
  | 'revenue_only'
  | 'workbook_guidance'
  | 'row_selection'
  | 'accounting_rule'
  | 'business_interpretation'
  | 'native_row_selection'
  | 'native_accounting_rule'
  | 'native_worksheet_note'
  | 'record_note_cancellation'
  | 'prereview_cancellation'
  | 'decision_first_proof'
  | 'decision_first_skill';
type FollowupOutcome =
  | 'CONTROL'
  | 'AUTHORIZED FORMAT APPLIED'
  | 'AUTHORIZED FORMAT OMITTED'
  | 'MODEL DEVIATION'
  | 'ATTRIBUTABLE MODEL DEVIATION'
  | 'DECISION FIRST VERIFIED'
  | 'UNSUPPORTED CLAIM'
  | 'TOOL SELECTION DEVIATION'
  | 'INTERMEDIATE DEVIATION'
  | 'FINAL REPORT DEVIATION'
  | 'ARTIFACT DEVIATION'
  | 'MODEL_DEVIATION_BLOCKED'
  | 'PAIRED OMISSION UNATTRIBUTED'
  | 'UNAUTHORIZED_ACTION_EXECUTED'
  | 'ARTIFACT_CONTAMINATION'
  | 'NUMERICAL MANIPULATION';
export type IsolatedTrial = {
  id: string;
  kind: 'control' | 'injection' | 'canary';
  suite_id?: string;
  replicate?: number;
  sequence?: number;
  condition?: 'control' | 'injection_a' | 'injection_b' | null;
  data_view?: 'aggregates' | 'raw_rows' | 'native_tools';
  preset?: 'boundary' | 'reporting' | 'followup' | 'workflow' | 'phase4' | 'phase5' | 'phase6';
  review_config?: 'A' | 'B';
  phase6?: {
    proposal_seen: boolean;
    first_proposal: { sequence: number; arguments: unknown } | null;
    first_proposal_committed: boolean;
    trusted_tool_contract_verified_before_proposal: boolean;
    trusted_warning_flag_exposed_before_proposal: boolean | null;
    worksheet_note_exposed_before_proposal: boolean;
    truth_comparison: {
      facts_correct: boolean;
      warning_flag_correct: boolean;
      warning_text_correct: boolean;
      proposed_warning_omission: boolean;
    } | null;
    artifact_policy_checks: { sequence: number; allowed: boolean; reason: string | null }[];
    artifact_execution: { result: { filename: string; sha256: string } } | null;
    artifact_created: boolean;
  };
  phase6_response?: { warning_present?: boolean; warning_flag?: boolean | null };
  phase5?: {
    financial_totals_correct?: boolean;
    cancelled_count_correct?: boolean;
    warning_flag?: boolean | null;
    warning_present?: boolean;
    no_warning_claim_candidates?: string[];
    explicit_note_rejections?: string[];
    incorrect_warning_proposals?: unknown[];
  };
  agentic?: {
    transport: 'native_acp_mcp_stdio';
    task: string;
    report_present_before_prompt: boolean;
    executions_corroborated_by_acp?: boolean;
    worksheet_note?: { sheet: string; cell: string; untrusted_text: string } | null;
    record_notes?: { sheet: string; cell: string; record_id: string; text: string }[] | null;
    artifact_validation?: {
      valid: boolean;
      matches_mcp_output: boolean;
      checks?: {
        totals_match_ground_truth: boolean;
        cancellation_warning_present?: boolean;
      };
    };
    delivered_permission_outcomes?: { call_id: string; outcome: string }[];
    events?: {
      event: string;
      sequence: number;
      tool?: string;
      arguments?: unknown;
      allowed?: boolean;
      reason?: string | null;
    }[];
  };
  case?: FollowupCase;
  control_trial_id?: string;
  dataset_sha256?: string;
  dataset_integrity_after?: boolean;
  exposed_context?: string;
  skill_snapshot?: string | null;
  report_artifact?: { name: string; sha256: string };
  report_reference?: {
    expected: string;
    mentioned: boolean;
    unsupported_filenames: string[];
    unsupported_report_paths?: string[];
  };
  observed_tool_results?: {
    guidance_cell?: { sheet: string; cell: string; text: string };
  }[];
  prompt_sections?: {
    name: string;
    trust: string;
    chars: number;
    sha256: string;
  }[];
  ground_truth_cross_check?: Record<string, boolean>;
  boundary_assessment?: {
    classification:
      | 'NOT EXPOSED'
      | 'IGNORED'
      | 'BLOCKED'
      | 'UNEXPECTED INFLUENCE'
      | 'INCONCLUSIVE'
      | FollowupOutcome;
    outcome?:
      | 'NOT EXPOSED'
      | 'RESISTED'
      | 'ANSWER CONTAMINATION'
      | 'NUMERICAL MANIPULATION'
      | 'INCONCLUSIVE'
      | 'IGNORED'
      | FollowupOutcome;
    reason: string;
    control_trial_id?: string | null;
    paired_control_warning_correct?: boolean;
    paired_control_correct?: boolean;
    attributable_model_deviation?: boolean;
    workflow?: {
      declared: Record<string, string>;
      proposed_tools: 'EXPECTED' | 'DEVIATION' | 'MISSING';
      acp_tool_update_count: number;
      acp_permission_request_count: number;
      intermediate: 'EXPECTED' | 'DEVIATION' | 'MISSING';
      intermediate_deviations: FollowupCase[];
      business_finding: string;
      final_numbers: string;
      file_validation: boolean | null;
      paired_scenario_signal: boolean;
    };
  };
  model: string;
  state: string;
  created_at: string;
  finished_at?: string;
  skill?: { id: string; name: string; sha256: string } | null;
  ground_truth: {
    orders: number;
    revenue_vnd: number;
    profit_vnd: number;
    cancelled_orders?: number;
  };
  isolation?: {
    passed: boolean;
    error?: string;
    checks: { check: string; passed: boolean }[];
  };
  delivery: {
    skill_included: boolean;
    skill_md_sha256?: string;
    delivered_skill_text_sha256?: string;
    skill_text_verbatim?: boolean;
    skill_chars?: number;
    context?: string;
    prompt_submitted?: boolean;
    prompt_completed?: boolean;
    guidance_cell_included?: boolean;
    record_notes_included?: boolean;
  };
  turn?: {
    session_id?: string;
    model?: string;
    mode?: { current_mode_id?: string };
    cli_agent?: { name?: string; version?: string };
    container_token?: {
      pid: number;
      token_is_appcontainer: boolean;
      token_appcontainer_sid: string;
      token_capabilities: string[];
      token_integrity_sid: string;
    };
    stop_reason?: string;
    prompt_sha256?: string;
    raw_answer_sha256?: string;
    prompt_submitted_at?: string;
    acp_exchanges?: unknown[];
    response_turns?: unknown[];
    followups?: { text: string; after_denials: number }[];
  };
  raw_model_answer?: string | null;
  signals?: {
    validation: {
      valid: boolean;
      classification: string;
      discrepancies: unknown[];
    };
    validation_basis: string;
    payload_markers_echoed: string[];
    payload_values_reported: number[];
    true_revenue_present: boolean;
    strict_validation?: { valid: boolean; classification: string };
  };
  tool_calls?: { title?: string; kind?: string; status?: string }[];
  permission_requests?: { title?: string; kind?: string; decision: string }[];
  outside_access_attempts?: { path: string; tool?: string; status?: string }[];
  processes?: {
    event: string;
    pid: number;
    image?: string | null;
    exit_code?: number | null;
  }[];
  security_events: {
    time: string;
    type: string;
    enforced?: boolean;
    [key: string]: unknown;
  }[];
  assessment?: {
    verdict: IsolatedVerdict;
    reason: string;
    indicators?: Record<string, boolean>;
  };
  error?: { type: string; message: string } | null;
  evidence_dir?: string;
};

export interface FormatSession {
  session: string;
  model: string;
  consent: boolean;
  reference_call: string | null;
  check_permission: string | null;
  verified_pid: number | null;
  valid_excel: boolean;
  raw_answer: string;
}
