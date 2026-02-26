/**
 * NATS payload types (match Laravel DTOs) and Laravel result payload.
 */

// ---------------------------------------------------------------------------
// NATS Job Payloads (from Laravel)
// ---------------------------------------------------------------------------

export interface PRJobPayload {
  job_type: 'pr';
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
  };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    head_sha: string;
    base_sha: string;
    head_ref: string | null;
    base_ref: string | null;
  };
  config: {
    threshold: string;
    review_types: {
      complexity: boolean;
      logic: boolean;
      architectural: boolean;
    };
    block_on_new_errors: boolean;
    architectural_mode: 'auto' | 'always' | 'off';
  };
  auth: {
    installation_token: string;
    service_token: string;
  };
}

export interface BaselineJobPayload {
  job_type: 'baseline';
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
  };
  config: {
    threshold: string;
  };
  auth: {
    installation_token: string;
    service_token: string;
  };
}

export type JobPayload = PRJobPayload | BaselineJobPayload;

// ---------------------------------------------------------------------------
// Laravel Result Payload (POST /api/v1/review-runs)
// ---------------------------------------------------------------------------

export interface ComplexitySnapshotResult {
  filepath: string;
  symbol_name: string;
  symbol_type: string;
  start_line: number;
  metric_type: string;
  complexity: number;
  threshold: number;
  severity: 'warning' | 'error';
}

export interface ReviewCommentResult {
  filepath: string;
  line: number;
  end_line: number | null;
  symbol_name: string | null;
  severity: 'error' | 'warning' | 'info';
  category: string;
  plugin_id: string;
  message: string;
  suggestion: string | null;
}

export interface LogicFindingResult {
  filepath: string;
  symbol_name: string;
  line: number;
  category: string;
  severity: 'error' | 'warning';
  message: string;
  evidence: string;
}

export interface ReviewRunResult {
  idempotency_key: string;
  repo_id: number;
  pr_number: number | null;
  head_sha: string;
  base_sha: string | null;
  started_at: string;
  completed_at: string;
  status: 'completed' | 'failed';
  files_analyzed: number;
  avg_complexity: number;
  max_complexity: number;
  token_usage: number;
  cost: number;
  summary_comment_id: number | null;
  complexity_snapshots: ComplexitySnapshotResult[];
  review_comments: ReviewCommentResult[];
  logic_findings: LogicFindingResult[];
}
