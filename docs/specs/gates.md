# Gates: Project-Level & Task-Specific Quality Gates

## Motivation

Overseer manages task lifecycle (start, complete, cancel) but has no opinion about what must happen *between* start and complete. Quality checks — tests, linting, code review, domain-specific compliance — are currently implemented entirely outside Overseer in skill files and ad-hoc scripts.

This means:
- Every workflow reimplements gate logic from scratch
- There's no enforcement — `complete()` accepts anything
- Gate results aren't tracked or queryable
- No way to see "why can't this task be completed?"
- An agent can hallucinate that tests passed without running them

Gates make quality checks a first-class Overseer concept. They are named checks that must pass before a task can transition to a terminal state.

### Design principles

1. **Overseer executes gates.** Shell and metadata gates are run by Overseer directly. The agent requests execution, Overseer runs the command, captures output, and records the ground-truth result. The agent cannot self-report a passing state for executable gates.

2. **Results are stored.** Full stdout/stderr is captured in the DB. On failure, the agent retrieves the output to diagnose and fix. No information is lost between gate run and result retrieval.

3. **Execution is async.** `os gate run` spawns a background worker and returns immediately. The agent polls `os gate status` for results. Long-running gates (test suites, builds) don't block the MCP call or risk timeouts.

4. **Two scopes.** Project-level default gates apply to all tasks (or tasks at a specific depth). Task-specific gates are attached to individual tasks for domain-specific checks.

---

## Data Model

### Gate Definition

```
Gate {
  id:           "gate_xxx"
  task_id:      Option<TaskId>    // NULL = project-level, Some = task-specific
  name:         String            // human-readable: "tests", "code-review", "hipaa"
  description:  String
  gate_type:    GateType          // shell | metadata | manual
  config:       JSON              // type-specific configuration
  required:     bool              // true = must pass, false = advisory
  applies_to:   Transition        // "complete" (extensible to "start" later)
  depth_filter: Option<Depth>     // NULL = all depths, 0/1/2 = specific depth
  ordering:     i32               // execution order (lower = first)
  created_at:   DateTime
}
```

### Gate Types

**`shell`** — Overseer spawns the command, exit 0 = pass. Agent cannot self-report.

```json
{
  "command": "npm test",
  "cwd": "{{workspace}}",
  "timeout_secs": 300
}
```

Template variables resolved from task state:
- `{{workspace}}` — task metadata `workspacePath` (or task bookmark's workspace)
- `{{bookmark}}` — task bookmark field
- `{{task_id}}` — task ID
- `{{task_description}}` — task description

**`metadata`** — Overseer evaluates conditions against `task_metadata`. Agent cannot self-report.

```json
{
  "checks": [
    { "key": "reviewStatus", "op": "eq", "value": "pass" },
    { "key": "reviewFiles", "op": "not_empty" }
  ]
}
```

Operators: `eq`, `neq`, `exists`, `not_empty`, `in` (value is array).

**`manual`** — Requires explicit approval via `os gate pass`. This is the only type where an external caller (human or orchestrating agent) sets the result. Use for checks that can't be automated as a shell command (e.g., human code review sign-off). `os gate status` labels these as "externally verified" to distinguish from Overseer-verified results.

### Gate Result

```
GateResult {
  gate_id:      GateId
  task_id:      TaskId
  status:       "pending" | "running" | "pass" | "fail" | "error" | "skip"
  output:       Option<String>    // captured stdout + stderr (shell), check details (metadata), or reason (manual)
  exit_code:    Option<i32>       // shell gates only
  started_at:   DateTime
  completed_at: Option<DateTime>  // NULL while pending/running
  commit_sha:   Option<String>    // commit at time of execution (for staleness detection)
}
```

One result per (gate_id, task_id) pair. Re-running a gate overwrites the previous result.

### Trust boundary

| Gate type | Who sets result | Trustworthy? |
|-----------|----------------|-------------|
| `shell` | Overseer (executes command) | Yes — ground truth |
| `metadata` | Overseer (evaluates conditions) | Yes — ground truth |
| `manual` | External caller (`os gate pass/fail`) | No — requires human oversight |

`os gate pass` and `os gate fail` are rejected for shell and metadata gates. Those can only be set by `os gate run`.

---

## Async Execution

### Architecture

```
Agent                     Overseer CLI              Worker Process
  |                           |                          |
  |-- gates.run(taskId) ----->|                          |
  |                           |-- write "pending" ------>|
  |                           |-- spawn detached ------->|  (os gate _worker <task_id>)
  |<-- { running: true } -----|                          |
  |                           |                          |-- read pending gates
  |                           |                          |-- for each gate:
  |                           |                          |     set "running"
  |                           |                          |     spawn command
  |                           |                          |     capture stdout/stderr
  |                           |                          |     set "pass" or "fail"
  |                           |                          |
  |-- gates.status(taskId) -->|                          |
  |<-- { gates: [...] } ------|  (reads gate_results)    |
  |                           |                          |
  |  (poll until complete)    |                          |
  |                           |                          |-- all done, exit
```

### `os gate run <task_id>`

1. Resolve applicable gates (project + task-specific, filtered by depth and transition)
2. Write a `gate_results` row per gate with status `pending`
3. Spawn detached worker: `os gate _worker <task_id> --commit <current_sha>`
4. Return immediately with the list of gates being executed and their IDs

### Worker process (`os gate _worker`)

Internal subcommand, not user-facing. The worker:

1. Opens the SQLite DB (WAL mode allows concurrent reads from polling)
2. Reads all `pending` gate_results for the task
3. For each gate in ordering:
   - Update status to `running`, set `started_at`
   - **Shell**: spawn `sh -c "{command}"` with resolved template variables, capture stdout+stderr, enforce timeout. Exit 0 = `pass`, non-zero = `fail`, timeout/crash = `error`.
   - **Metadata**: read task_metadata, evaluate checks. All pass = `pass`, any fail = `fail` with details in output.
   - **Manual**: skip (set `skip` with output "manual gate — use `os gate pass`")
4. Record `completed_at`, `exit_code` (shell), `output`
5. Exit when all gates processed

### `os gate status <task_id>`

Returns the current state of all applicable gates:

```json
{
  "taskId": "task_abc",
  "running": false,
  "gates": [
    {
      "gate": { "id": "gate_1", "name": "tests", "type": "shell", ... },
      "result": { "status": "pass", "output": "42 tests passed", "exit_code": 0, ... },
      "satisfied": true,
      "verified_by": "overseer"
    },
    {
      "gate": { "id": "gate_2", "name": "code-review", "type": "manual", ... },
      "result": null,
      "satisfied": false,
      "verified_by": "external"
    }
  ],
  "can_complete": false
}
```

`running: true` if any gate_result has status `pending` or `running`.

### Failure retrieval

On failure, the agent reads stored output to diagnose:

```javascript
const status = await gates.status(taskId);
const failed = status.gates.filter(g => g.result?.status === "fail");
for (const f of failed) {
  console.log(f.gate.name, f.result.output);
  // "tests" → "FAIL src/foo.test.ts:42 — Expected 3, got undefined\n..."
}
// Agent fixes the code, then re-runs
await gates.run(taskId);
```

### Concurrency safety

- SQLite WAL mode: worker writes results while agent reads status concurrently
- One worker per task: `os gate run` checks for existing `pending`/`running` results before spawning. If a run is in progress, returns the current status instead of starting a new one.
- Re-run semantics: `os gate run` on a task with completed results overwrites them (starts fresh run)

---

## Gate Resolution

When checking gates for a task, Overseer resolves the **effective gate set**:

1. **Project-level gates** — `task_id IS NULL` AND (`depth_filter IS NULL` OR `depth_filter = task.depth`)
2. **Task-specific gates** — `task_id = target_task_id`
3. Union both, deduplicate by name (task-specific overrides project-level if same name)
4. Filter by `applies_to` matching the requested transition

Name-based override lets a task customize a project default. Example: project has a `tests` gate running `npm test`; a specific task overrides `tests` to run `pytest` instead.

### Effective gate set pseudocode

```
fn resolve_gates(task_id, transition) -> Vec<Gate> {
    let project_gates = query("task_id IS NULL AND applies_to = ? AND (depth_filter IS NULL OR depth_filter = ?)", transition, task.depth);
    let task_gates = query("task_id = ? AND applies_to = ?", task_id, transition);

    // Task-specific gates override project gates with same name
    let mut by_name: HashMap<String, Gate> = HashMap::new();
    for gate in project_gates { by_name.insert(gate.name.clone(), gate); }
    for gate in task_gates { by_name.insert(gate.name.clone(), gate); }

    let mut gates: Vec<Gate> = by_name.into_values().collect();
    gates.sort_by_key(|g| g.ordering);
    gates
}
```

---

## Enforcement

### In `complete()`

`complete_with_learnings()` gains a gate check before VCS operations:

```rust
pub fn complete_with_learnings(
    &self,
    id: &TaskId,
    result: Option<&str>,
    learnings: &[String],
    force: bool,  // new parameter
) -> Result<Task> {
    // ... existing lifecycle guards ...

    // Gate enforcement
    let unsatisfied = self.check_gates(id, Transition::Complete)?;
    if !unsatisfied.is_empty() && !force {
        return Err(OsError::GatesNotSatisfied {
            task_id: id.clone(),
            gates: unsatisfied,
        });
    }

    // ... existing VCS-first, then DB ...
}
```

`check_gates()`:
1. Resolves the effective gate set
2. For each required gate, checks `gate_results` for a `pass` status
3. Rejects if any result is `pending` or `running` (run still in progress)
4. Returns the list of unsatisfied gates

### `--force` bypass

`os task complete <id> --force` skips gate enforcement. The force flag is logged but not blocked — the human takes responsibility.

### Staleness

Gate results record `commit_sha`. When checking gates, Overseer can optionally compare the result's commit against the current working copy. If they differ, the result is stale (code changed since the gate passed).

- `os gate status` shows stale results with a warning
- `check_gates()` with `strict: true` treats stale results as unsatisfied
- Default: stale results are still accepted (re-run manually if needed)

---

## Schema

### Migration v5 → v6

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS gates (
    id TEXT PRIMARY KEY CHECK (id LIKE 'gate_%'),
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    gate_type TEXT NOT NULL CHECK (gate_type IN ('shell', 'metadata', 'manual')),
    config TEXT NOT NULL DEFAULT '{}',
    required INTEGER NOT NULL DEFAULT 1,
    applies_to TEXT NOT NULL DEFAULT 'complete' CHECK (applies_to IN ('complete')),
    depth_filter INTEGER CHECK (depth_filter BETWEEN 0 AND 2),
    ordering INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_results (
    gate_id TEXT NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'pass', 'fail', 'error', 'skip')),
    output TEXT,
    exit_code INTEGER,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    commit_sha TEXT,
    PRIMARY KEY (gate_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_gates_task ON gates(task_id);
CREATE INDEX IF NOT EXISTS idx_gates_project ON gates(task_id) WHERE task_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_gate_results_task ON gate_results(task_id);
CREATE INDEX IF NOT EXISTS idx_gate_results_status ON gate_results(status)
    WHERE status IN ('pending', 'running');

-- Unique constraint: one gate name per scope (project-level or per-task)
CREATE UNIQUE INDEX IF NOT EXISTS idx_gates_name_scope
    ON gates(COALESCE(task_id, ''), name);

COMMIT;
```

---

## Full Stack

### Rust — DB layer (`db/gate_repo.rs`)

```
// Gate CRUD
create_gate(conn, input: &CreateGateInput) -> Result<Gate>
get_gate(conn, id: &GateId) -> Result<Option<Gate>>
list_gates(conn, filter: &GateFilter) -> Result<Vec<Gate>>
delete_gate(conn, id: &GateId) -> Result<()>
resolve_gates(conn, task_id: &TaskId, depth: i32, transition: &str) -> Result<Vec<Gate>>

// Gate results
set_result(conn, gate_id: &GateId, task_id: &TaskId, input: &SetResultInput) -> Result<GateResult>
get_results(conn, task_id: &TaskId) -> Result<Vec<GateResult>>
has_active_run(conn, task_id: &TaskId) -> Result<bool>  // any pending/running results?

// Enforcement
check_gates(conn, task_id: &TaskId, depth: i32, transition: &str) -> Result<Vec<UnsatisfiedGate>>
```

### Rust — Types (`types.rs`)

```rust
pub struct Gate {
    pub id: GateId,
    pub task_id: Option<TaskId>,
    pub name: String,
    pub description: String,
    pub gate_type: GateType,
    pub config: serde_json::Value,
    pub required: bool,
    pub applies_to: String,
    pub depth_filter: Option<i32>,
    pub ordering: i32,
    pub created_at: DateTime<Utc>,
}

pub enum GateType { Shell, Metadata, Manual }

pub struct GateResult {
    pub gate_id: GateId,
    pub task_id: TaskId,
    pub status: GateStatus,
    pub output: Option<String>,
    pub exit_code: Option<i32>,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub commit_sha: Option<String>,
}

pub enum GateStatus { Pending, Running, Pass, Fail, Error, Skip }

pub struct GateStatusReport {
    pub task_id: TaskId,
    pub running: bool,
    pub gates: Vec<GateStatusEntry>,
    pub can_complete: bool,
}

pub struct GateStatusEntry {
    pub gate: Gate,
    pub result: Option<GateResult>,
    pub satisfied: bool,
    pub verified_by: VerifiedBy,  // Overseer | External
}

pub enum VerifiedBy { Overseer, External }

pub struct UnsatisfiedGate {
    pub gate: Gate,
    pub result: Option<GateResult>,  // None = never run, Some = last result was not pass
    pub reason: String,              // "never run", "failed", "still running", "stale"
}
```

### Rust — Gate execution (`core/gate_executor.rs`)

Separate module for the execution engine:

```rust
pub struct GateExecutor<'a> {
    conn: &'a Connection,
}

impl GateExecutor {
    /// Run all applicable gates for a task (called by worker process).
    /// Executes gates sequentially in ordering, writing results as it goes.
    pub fn run_all(&self, task_id: &TaskId) -> Result<Vec<GateResult>>

    /// Run a single gate.
    fn run_one(&self, gate: &Gate, task: &Task) -> Result<GateResult>

    /// Execute a shell gate: spawn command, capture output, enforce timeout.
    fn execute_shell(&self, gate: &Gate, task: &Task) -> Result<(GateStatus, String, Option<i32>)>

    /// Evaluate a metadata gate: check conditions against task_metadata.
    fn evaluate_metadata(&self, gate: &Gate, task: &Task) -> Result<(GateStatus, String)>

    /// Resolve template variables in a string.
    fn resolve_templates(&self, template: &str, task: &Task) -> String
}
```

Shell execution:
- `std::process::Command::new("sh").arg("-c").arg(&resolved_command)`
- Set `cwd` from resolved `{{workspace}}` or repo root
- Capture stdout + stderr (combined, interleaved)
- Enforce timeout via `wait_timeout` (from `wait-timeout` crate or manual thread)
- Exit 0 = Pass, non-zero = Fail, timeout = Error("timed out after Ns"), spawn failure = Error

### Rust — Service layer

Gate CRUD in `TaskService`:
- `create_gate()`, `list_gates()`, `delete_gate()`
- `get_gate_status()` — resolve gates + join results
- `check_gates()` — enforcement check

Gate execution coordination in `WorkflowService`:
- `run_gates(task_id)` — write pending results, spawn worker, return status
- `complete_with_learnings()` — call `check_gates()` before VCS ops

Manual gate approval in `TaskService` (no VCS needed):
- `pass_gate(task_id, gate_id, output)` — validates gate is manual type, writes pass result
- `fail_gate(task_id, gate_id, output)` — validates gate is manual type, writes fail result

### Rust — CLI (`commands/gate.rs`)

```
# Gate definitions
os gate add --name <NAME> --type <TYPE> [--task <TASK_ID>] [--config <JSON>] [--required] [--depth <N>] [--order <N>] [--description <DESC>]
os gate list [--task <TASK_ID>]
os gate delete <GATE_ID>

# Execution (async — spawns worker, returns immediately)
os gate run <TASK_ID> [--gate <GATE_ID>]

# Status & results
os gate status <TASK_ID>              # full status report (running?, results, can_complete?)
os gate output <TASK_ID> <GATE_ID>    # print stored output for a specific gate result

# Manual gates only
os gate pass <TASK_ID> <GATE_ID> [--output <TEXT>]
os gate fail <TASK_ID> <GATE_ID> [--output <TEXT>]

# Pre-flight check
os gate check <TASK_ID>               # dry-run: would complete() succeed?

# Internal (not user-facing)
os gate _worker <TASK_ID> [--commit <SHA>]
```

Extend existing `os task complete`:
```
os task complete <ID> [--force]       # --force bypasses gate enforcement
```

### Node.js Host API (`api/gates.ts`)

```typescript
export const gates = {
  // Definitions
  async add(input: CreateGateInput): Promise<Gate>,
  async list(taskId?: string): Promise<Gate[]>,
  async delete(id: string): Promise<void>,

  // Execution (async — returns immediately, poll status for results)
  async run(taskId: string, gateId?: string): Promise<GateStatusReport>,

  // Status & results
  async status(taskId: string): Promise<GateStatusReport>,
  async output(taskId: string, gateId: string): Promise<string | null>,

  // Manual gates only (rejected for shell/metadata)
  async pass(taskId: string, gateId: string, output?: string): Promise<GateResult>,
  async fail(taskId: string, gateId: string, output?: string): Promise<GateResult>,

  // Pre-flight
  async check(taskId: string): Promise<UnsatisfiedGate[]>,
};

interface CreateGateInput {
  name: string;
  type: "shell" | "metadata" | "manual";
  taskId?: string;        // omit for project-level
  config?: object;
  required?: boolean;     // default: true
  depthFilter?: 0 | 1 | 2;
  ordering?: number;
  description?: string;
}

interface GateStatusReport {
  taskId: string;
  running: boolean;       // true if any gate is pending/running
  gates: Array<{
    gate: Gate;
    result: GateResult | null;
    satisfied: boolean;
    verifiedBy: "overseer" | "external";
  }>;
  canComplete: boolean;
}
```

---

## Catalyze Integration

The catalyze-execute skill's 5-gate pipeline maps to Overseer gates:

### Project-level gates (registered once during `/catalyze` planning)

| Gate | Type | Depth | Ordering | Config |
|------|------|-------|----------|--------|
| `correctness-tests` | `shell` | 1 | 10 | `{ "command": "npm test", "cwd": "{{workspace}}" }` |
| `tool-checks` | `shell` | 1 | 20 | `{ "command": "npm run lint && npx tsc --noEmit", "cwd": "{{workspace}}" }` |
| `verification` | `shell` | 1 | 40 | `{ "command": "npm test && npx tsc --noEmit && npm run build", "cwd": "{{workspace}}" }` |

### Task-specific gates (added per task when needed)

| Gate | Type | Ordering | When Added |
|------|------|----------|-----------|
| `code-review` | `manual` | 30 | All catalyze tasks (skill runs 3 reviewers + oracle, then calls `gates.pass()`) |
| `hipaa-review` | `manual` | 31 | Tasks in healthcare repos |
| `plan-conformance` | `manual` | 32 | All catalyze-generated tasks |

### Workflow

```javascript
// 1. Planning phase — register project gates once
const existing = await gates.list();
if (!existing.find(g => g.name === "correctness-tests")) {
  await gates.add({ name: "correctness-tests", type: "shell", depthFilter: 1, ordering: 10,
    config: { command: "npm test", cwd: "{{workspace}}", timeout_secs: 120 } });
  await gates.add({ name: "tool-checks", type: "shell", depthFilter: 1, ordering: 20,
    config: { command: "npm run lint && npx tsc --noEmit", cwd: "{{workspace}}", timeout_secs: 60 } });
  await gates.add({ name: "verification", type: "shell", depthFilter: 1, ordering: 40,
    config: { command: "npm test && npx tsc --noEmit && npm run build", cwd: "{{workspace}}", timeout_secs: 300 } });
}

// 2. Per task — add task-specific manual gates
await gates.add({ name: "code-review", type: "manual", taskId, ordering: 30 });
if (isHealthcareRepo) {
  await gates.add({ name: "hipaa-review", type: "manual", taskId, ordering: 31 });
}

// 3. After agent implements — kick off async gate run
//    (Overseer runs shell gates: tests, lint, typecheck, build)
await gates.run(taskId);

// 4. While shell gates run in background, skill runs manual gates in parallel
//    (3 code-reviewer sub-agents + oracle)
const oracleReport = await runCodeReview(taskId);
const codeReviewGate = status.gates.find(g => g.gate.name === "code-review");
await gates.pass(taskId, codeReviewGate.gate.id, oracleReport);

// 5. Poll until shell gates complete
let status;
do {
  status = await gates.status(taskId);
  if (status.running) await sleep(5000);
} while (status.running);

// 6. On failure — retrieve output, fix, re-run
const failed = status.gates.filter(g => g.result?.status === "fail");
if (failed.length > 0) {
  for (const f of failed) {
    const output = await gates.output(taskId, f.gate.id);
    // Agent reads test failures, fixes code...
  }
  await gates.run(taskId);  // re-run all shell gates
}

// 7. Complete — Overseer enforces all gates passed
await tasks.complete(taskId, { result: "..." });
```

### Non-catalyze workflows

Other workflows get enforcement for free:

```javascript
// Simple workflow — just tests and lint
await gates.add({ name: "tests", type: "shell", config: { command: "npm test" } });
await gates.add({ name: "lint", type: "shell", config: { command: "npm run lint" } });

// Work on task, then run gates
await gates.run(taskId);
// ... poll ...
await tasks.complete(taskId);  // enforced — fails if gates didn't pass
```

---

## Implementation Phases

### Phase 1: Core — Definitions, Execution, Enforcement

Everything needed for end-to-end gate workflow.

**Schema:**
- Migration v5 → v6 (gates + gate_results tables)

**Types:**
- `GateId` in `id.rs`
- `Gate`, `GateResult`, `GateStatus`, `GateType`, `GateStatusReport`, `UnsatisfiedGate` in `types.rs`
- `OsError::GatesNotSatisfied`, `OsError::GateNotManual`, `OsError::GateRunInProgress` in `error.rs`

**DB:**
- `gate_repo.rs` — full CRUD, resolve, result tracking, enforcement check

**Execution:**
- `gate_executor.rs` — shell execution (spawn + capture + timeout), template resolution
- Worker subprocess (`os gate _worker`)
- Concurrent safety: check for active run before spawning

**Service:**
- `TaskService` — gate CRUD, manual pass/fail, status report
- `WorkflowService` — `run_gates()` (spawn worker), gate check in `complete()`

**CLI:**
- `gate.rs` — add, list, delete, run, status, output, pass, fail, check, _worker
- Extend `complete` with `--force`

**Host API:**
- `gates.ts` — full API surface
- Decoders for gate types

**Tests:**
- Gate resolution (project + task, depth filter, name override)
- Shell execution (pass, fail, timeout, template vars)
- Trust boundary (reject pass/fail on shell gates)
- Enforcement in complete (unsatisfied blocks, force bypasses)

### Phase 2: Metadata Gates

- Metadata gate evaluation (key/value checks against `task_metadata`)
- Operators: eq, neq, exists, not_empty, in
- Integrated into `gate_executor.rs`

### Phase 3: Staleness Detection

- Compare `gate_results.commit_sha` against current HEAD
- `os gate status` shows stale warning
- Optional `--strict` on `os gate check` treats stale as unsatisfied

---

## Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| **Create** | `overseer/src/db/gate_repo.rs` | Gate + result DB queries |
| **Create** | `overseer/src/core/gate_executor.rs` | Shell execution, template resolution, worker logic |
| **Create** | `overseer/src/commands/gate.rs` | CLI subcommands |
| **Create** | `host/src/api/gates.ts` | Host API wrapper |
| **Modify** | `overseer/src/db/schema.rs` | Migration v5 → v6 |
| **Modify** | `overseer/src/db/mod.rs` | Export gate_repo |
| **Modify** | `overseer/src/core/mod.rs` | Export gate_executor |
| **Modify** | `overseer/src/types.rs` | Gate, GateResult, GateType, GateStatus, report types |
| **Modify** | `overseer/src/id.rs` | GateId type |
| **Modify** | `overseer/src/error.rs` | GatesNotSatisfied, GateNotManual, GateRunInProgress |
| **Modify** | `overseer/src/core/task_service.rs` | Gate CRUD, manual pass/fail, status |
| **Modify** | `overseer/src/core/workflow_service.rs` | run_gates(), enforcement in complete() |
| **Modify** | `overseer/src/commands/task.rs` | --force flag on complete |
| **Modify** | `overseer/src/commands/mod.rs` | Register gate subcommand |
| **Modify** | `overseer/src/main.rs` | Route gate commands |
| **Modify** | `host/src/api/index.ts` | Export gates API |
| **Modify** | `host/src/types.ts` | Gate + GateResult TS types |
| **Modify** | `host/src/decoder.ts` | Gate decoders |
