/**
 * Core domain types mirroring the Rust CLI output
 */

// Branded types for type-safe IDs
declare const TaskIdBrand: unique symbol;
declare const LearningIdBrand: unique symbol;

export type TaskId = string & { readonly [TaskIdBrand]: never };
export type LearningId = string & { readonly [LearningIdBrand]: never };

// Validation helpers
export function isTaskId(s: string): s is TaskId {
  return s.startsWith("task_") && s.length === 31; // "task_" + 26 ULID chars
}

export function isLearningId(s: string): s is LearningId {
  return s.startsWith("lrn_") && s.length === 30; // "lrn_" + 26 ULID chars
}

export function parseTaskId(s: string): TaskId {
  if (!isTaskId(s)) {
    throw new Error(`Invalid TaskId: ${s}`);
  }
  return s;
}

export function parseLearningId(s: string): LearningId {
  if (!isLearningId(s)) {
    throw new Error(`Invalid LearningId: ${s}`);
  }
  return s;
}

/**
 * Task context chain (inherited from hierarchy)
 */
export interface TaskContext {
  own: string;
  parent?: string;
  milestone?: string;
}

/**
 * Inherited learnings (own task + ancestors)
 */
export interface InheritedLearnings {
  /** Learnings attached directly to this task (bubbled from completed children) */
  own: Learning[];
  /** Learnings from parent task (depth > 0) */
  parent: Learning[];
  /** Learnings from root milestone (depth > 1) */
  milestone: Learning[];
}

/**
 * Priority levels: p0=highest, p1=default, p2=lowest
 */
export type Priority = 0 | 1 | 2;

/**
 * Task depth (0=milestone, 1=task, 2=subtask)
 */
export type Depth = 0 | 1 | 2;

/**
 * Task returned from list/create/update/start/complete/reopen
 * Does NOT include context chain or inherited learnings
 */
export interface Task {
  id: TaskId;
  parentId: TaskId | null;
  description: string;
  priority: Priority;
  completed: boolean;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  result: string | null;
  commitSha: string | null;
  depth: Depth;
  blockedBy?: TaskId[];
  blocks?: TaskId[];
  bookmark?: string;
  startCommit?: string;
  /** Computed: true if task or any ancestor has incomplete blockers */
  effectivelyBlocked: boolean;
  /** Arbitrary JSON metadata stored in task_metadata table */
  metadata?: Record<string, unknown>;
  /** Task was cancelled (abandoned without completion) */
  cancelled: boolean;
  /** Timestamp when task was cancelled */
  cancelledAt: string | null;
  /** Task is archived (hidden from default views) */
  archived: boolean;
  /** Timestamp when task was archived */
  archivedAt: string | null;
}

/**
 * Task returned from get/nextReady - includes context chain and inherited learnings
 */
export interface TaskWithContext extends Task {
  context: TaskContext;
  learnings: InheritedLearnings;
}

export interface Learning {
  id: LearningId;
  taskId: TaskId;
  content: string;
  sourceTaskId: TaskId | null;
  createdAt: string;
}

/**
 * Recursive task tree node (from os task tree)
 */
export interface TaskTree {
  task: Task;
  children: TaskTree[];
}

/**
 * Progress summary (aggregate counts)
 */
export interface TaskProgress {
  total: number;
  completed: number;
  ready: number;     // !completed && !effectivelyBlocked
  blocked: number;   // !completed && effectivelyBlocked
}

// ============ Gate Types ============

declare const GateIdBrand: unique symbol;
export type GateId = string & { readonly [GateIdBrand]: never };

export function isGateId(s: string): s is GateId {
  return s.startsWith("gate_") && s.length === 31; // "gate_" + 26 ULID chars
}

export function parseGateId(s: string): GateId {
  if (!isGateId(s)) {
    throw new Error(`Invalid GateId: ${s}`);
  }
  return s;
}

export type GateType = "shell" | "metadata" | "manual";
export type GateStatus = "pending" | "running" | "pass" | "fail" | "error" | "skip";
export type VerifiedBy = "overseer" | "external";

export interface Gate {
  id: GateId;
  taskId: string | null;
  name: string;
  description: string;
  gateType: GateType;
  config: Record<string, unknown>;
  command?: string;
  timeoutSecs?: number;
  maxRetries: number;
  required: boolean;
  appliesTo: string;
  depthFilter: number | null;
  ordering: number;
  createdAt: string;
}

export interface GateResult {
  gateId: GateId;
  taskId: string;
  status: GateStatus;
  output: string | null;
  exitCode: number | null;
  startedAt: string;
  completedAt: string | null;
  commitSha: string | null;
  reviewId?: string;
  attempt: number;
}

export interface GateStatusEntry {
  gate: Gate;
  result: GateResult | null;
  satisfied: boolean;
  verifiedBy: VerifiedBy;
}

export interface GateStatusReport {
  taskId: string;
  running: boolean;
  gates: GateStatusEntry[];
  canComplete: boolean;
}

export interface UnsatisfiedGate {
  gate: Gate;
  result: GateResult | null;
  reason: string;
}

export interface CreateGateInput {
  name: string;
  type: GateType;
  taskId?: string;
  config?: Record<string, unknown>;
  command?: string;
  timeoutSecs?: number;
  maxRetries?: number;
  required?: boolean;
  depthFilter?: 0 | 1 | 2;
  ordering?: number;
  description?: string;
}

// ============ Review Types ============

declare const ReviewIdBrand: unique symbol;
export type ReviewId = string & { readonly [ReviewIdBrand]: never };

export function isReviewId(s: string): s is ReviewId {
  return s.startsWith("rev_") && s.length === 30; // "rev_" + 26 ULID chars
}

export function parseReviewId(s: string): ReviewId {
  if (!isReviewId(s)) {
    throw new Error(`Invalid ReviewId: ${s}`);
  }
  return s;
}

export type ReviewStatus =
  | "gates_pending"
  | "agent_pending"
  | "human_pending"
  | "approved"
  | "changes_requested";

export interface Review {
  id: ReviewId;
  taskId: string;
  status: ReviewStatus;
  submittedAt: string;
  gatesCompletedAt: string | null;
  agentCompletedAt: string | null;
  humanCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * CLI command errors
 */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class CliTimeoutError extends Error {
  constructor(message = "CLI command timeout (30s)") {
    super(message);
    this.name = "CliTimeoutError";
  }
}
