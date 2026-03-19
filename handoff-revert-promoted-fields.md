# Handoff: Revert Promoted Fields to Config JSON Blob

## Task
`task_01KM23MAMTXX1YHPJ53W1RNCJV` — Revert promoted fields to config JSON blob

## Problem
The v8 schema promoted `command`, `timeout_secs`, `max_retries` to top-level Gate columns. The spec says these belong inside a `config` JSON blob per gate type. This is the foundational change that everything else builds on.

## Target State (per spec `docs/specs/gates.md`)
- Shell gates: `config = { "command": "...", "cwd": "...", "timeout_secs": 300, "max_retries": 1 }`
- Metadata gates: `config = { "checks": [...] }`
- Manual gates: `config = {}`
- NO promoted columns (`command`, `timeout_secs`, `max_retries`) on the gates table or Gate struct

## Current State Analysis

All files read and analyzed. Here's every location that needs changes:

### 1. Rust — Schema (`overseer/src/db/schema.rs`)
- **Line 5**: Bump `SCHEMA_VERSION` from 8 to 9
- **Fresh schema (line 64-79)**: Remove `command TEXT`, `timeout_secs INTEGER`, `max_retries INTEGER NOT NULL DEFAULT 1` columns from gates table
- **Add migration v8→v9**: Move `command`/`timeout_secs`/`max_retries` into config blob, then drop columns (SQLite requires table rebuild to drop columns)

Migration pseudocode:
```sql
-- For each gate with promoted fields, merge into config JSON
-- Then rebuild table without promoted columns
CREATE TABLE gates_v9 (...without promoted cols...);
INSERT INTO gates_v9 SELECT ... (merge promoted into config);
DROP TABLE gates;
ALTER TABLE gates_v9 RENAME TO gates;
-- Recreate indexes
```

### 2. Rust — Types (`overseer/src/types.rs`)
- **Gate struct (line 252-269)**: Remove `command: Option<String>`, `timeout_secs: Option<i64>`, `max_retries: i32`
- **CreateGateInput (line 320-333)**: Remove `command`, `timeout_secs`, `max_retries` fields. CLI convenience args should merge into `config` before reaching this struct.

### 3. Rust — Gate Repo (`overseer/src/db/gate_repo.rs`)
- **row_to_gate (line 31-54)**: Remove reads of `command`, `timeout_secs`, `max_retries`
- **create_gate (line 88-122)**: Remove `command`, `timeout_secs`, `max_retries` from INSERT. The caller must have already merged these into `config`.
- **All SELECT queries** (get_gate, list_gates, resolve_gates): Remove `command, timeout_secs, max_retries` from column lists

### 4. Rust — Gate Executor (`overseer/src/core/gate_executor.rs`)
- **execute_shell (line 133-207)**: Currently reads `gate.command` then falls back to `config["command"]`. Change to ONLY read from `config`:
  ```rust
  let command = gate.config.get("command").and_then(|v| v.as_str())
      .unwrap_or("echo 'no command configured'");
  let timeout_secs = gate.config.get("timeout_secs").and_then(|v| v.as_u64())
      .unwrap_or(300);
  ```
- **execute_shell_with_retry (line 99-131)**: Currently reads `gate.max_retries`. Change to read from config:
  ```rust
  let max_retries = gate.config.get("max_retries").and_then(|v| v.as_i64())
      .unwrap_or(1) as i32;
  ```

### 5. Rust — CLI Gate Commands (`overseer/src/commands/gate.rs`)
- **AddArgs (line 51-96)**: Keep `--command`, `--timeout`, `--max-retries` as CLI convenience args
- **handle() Add branch (line 156-177)**: Merge convenience args INTO config before creating:
  ```rust
  let mut config = args.config.map(|c| serde_json::from_str(&c)).transpose()?
      .unwrap_or(serde_json::json!({}));
  if let Some(cmd) = args.command {
      config["command"] = serde_json::Value::String(cmd);
  }
  if let Some(timeout) = args.timeout {
      config["timeout_secs"] = serde_json::json!(timeout);
  }
  if let Some(retries) = args.max_retries {
      config["max_retries"] = serde_json::json!(retries);
  }
  let input = CreateGateInput { config: Some(config), ... };
  ```

### 6. Rust — Output Formatting (`overseer/src/output.rs`)
- **Line 916-923**: Gate detail view reads `gate.command`, `gate.timeout_secs`, `gate.max_retries`. Change to read from `gate.config`:
  ```rust
  if let Some(cmd) = gate.config.get("command").and_then(|v| v.as_str()) { ... }
  if let Some(timeout) = gate.config.get("timeout_secs").and_then(|v| v.as_i64()) { ... }
  if let Some(retries) = gate.config.get("max_retries").and_then(|v| v.as_i64()).filter(|&r| r > 1) { ... }
  ```
- **Line 965-978**: Compact gate list view — same pattern
- **Line 1028-1031**: Status report attempt display — same pattern
- **Line 1116-1119**: Unsatisfied gate display — same pattern

### 7. TypeScript — Host Types (`host/src/types.ts`)
- **Gate interface (line 155-170)**: Remove `command?: string`, `timeoutSecs?: number`, `maxRetries: number`
- **CreateGateInput (line 205-217)**: Remove `command?`, `timeoutSecs?`, `maxRetries?` — CLI convenience args are fine, but the TS type should just use `config`

### 8. TypeScript — Host Decoder (`host/src/decoder.ts`)
- **decodeGate (line 519-581)**: Remove handling of `command`, `timeoutSecs`, `maxRetries` from destructuring and gate construction

### 9. TypeScript — Host Gates API (`host/src/api/gates.ts`)
- **add() (line 29-41)**: Remove `--command`, `--timeout`, `--max-retries` arg construction. Callers should put these in `config` instead.

### 10. TypeScript — UI Types (`ui/src/types.ts`)
- **Gate interface (line 157-172)**: Remove `command?: string`, `timeoutSecs?: number`, `maxRetries: number`

### 11. TypeScript — UI Decoder (`ui/src/decoder.ts`)
- **decodeGate (line 492-554)**: Remove handling of `command`, `timeoutSecs`, `maxRetries`

### 12. UI Components (`ui/src/client/components/TaskDetail.tsx`)
- Any references to `gate.command`, `gate.timeoutSecs`, `gate.maxRetries` should read from `gate.config` instead

## Verification
After all changes:
1. `cd overseer && cargo test` — all tests pass
2. `cd overseer && cargo build` — compiles cleanly
3. `cd host && npm run build` — no TS errors
4. `cd ui && npm run build` — no TS errors
5. Existing gates in DB are migrated (config blob contains former promoted fields)
6. `os gate add --name test --type shell --command "echo hi" --timeout 60` works (merges into config)
7. `os gate status <task>` displays correctly (reads from config)

## Execution Order Dependency
This is task #1 in the recommended order. After this:
- File-based gate config (`task_01KM23MAKERADWWC8XTK2PN69R`) depends on stable config blob model
- Pretty-print + UI re-verification depend on config blob being the source of truth
