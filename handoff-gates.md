# Handoff: Gate System Completion

## Project Overview

Overseer v2 — Rust CLI (`overseer/`) + TypeScript host (`host/`) + React UI (`ui/`) + MCP server.
Task management with quality gates, VCS integration (jj-first, git fallback), 3-level hierarchy (milestone > task > subtask).

## Current State

**HEAD**: `936a86d` (detached) — on top of main branch work.

**Milestone**: `task_01KM20BQY4RGEWRT1J31XTRA03` — Gate Model Upgrade v8 (9/17 complete)

### Completed
- Schema v8 + promoted fields, CLI args, executor, host types/decoders
- Retry logic, exit 75 = pending, review_id threading, auto-advance reviews
- Pretty-print CLI output (output.rs formatters for gate/review commands)
- React UI gate/review indicators (types, decoders, API routes, query hooks, TaskDetail sections)

### Remaining Tasks (8)

**Critical (p0):**
| Task ID | Description |
|---------|-------------|
| `task_01KM23MAMTXX1YHPJ53W1RNCJV` | Revert promoted fields to config JSON blob |
| `task_01KM23MAKERADWWC8XTK2PN69R` | File-based gate config |
| `task_01KM23MAP411HEKPF4SP0V6NM1` | Force-complete with human confirmation gate |

**Already implemented but need re-verification (tasks were reopened):**
| Task ID | Description |
|---------|-------------|
| `task_01KM20BR0FMW4BZJHPFH6BCA7K` | Pretty-print CLI output |
| `task_01KM20BR0QH97M0B0K1J56S19Y` | React UI gate/review indicators |

**Nice to have (p2):**
| Task ID | Description |
|---------|-------------|
| `task_01KM23MAQ76Q9WSP6K8F1NE5WB` | Template variable resolution in shell gate commands |
| `task_01KM23MARNZBHXTV986SFK37BC` | Gate result staleness detection |

### Recommended Execution Order
1. **Revert promoted fields to config JSON blob** — schema v9 migration, foundational change everything else builds on
2. **File-based gate config** — depends on stable gate data model from step 1
3. **Force-complete with human confirmation** — independent but benefits from stable model
4. **Pretty-print CLI output** — re-verify/update after config blob change
5. **React UI gate/review indicators** — re-verify/update after config blob change
6. Template variables (p2)
7. Staleness detection (p2)

## Active Gates (Dogfooding)

Every depth-1 task must pass these project-level gates before completion:

| Gate | Type | Command |
|------|------|---------|
| `tests` | shell | `cd overseer && cargo test` |
| `build` | shell | `cd overseer && cargo build && cd ../host && npm run build && cd ../ui && npm run build` |
| `review` | manual | Requires explicit `os gate pass` |

## Key Files

| Area | Files |
|------|-------|
| Gate types | `overseer/src/types.rs` (Gate, GateResult, GateStatus, GateStatusReport, etc.) |
| Gate DB | `overseer/src/db/gate_repo.rs`, `overseer/src/db/schema.rs` |
| Gate executor | `overseer/src/core/gate_executor.rs` |
| Gate service | `overseer/src/core/task_service.rs` (CRUD, pass/fail, status) |
| Gate CLI | `overseer/src/commands/gate.rs`, `overseer/src/main.rs` |
| CLI output | `overseer/src/output.rs` |
| Host types | `host/src/types.ts`, `host/src/decoder.ts`, `host/src/api/gates.ts` |
| UI types | `ui/src/types.ts`, `ui/src/decoder.ts` |
| UI routes | `ui/src/api/routes/gates.ts`, `ui/src/api/app.ts` |
| UI hooks | `ui/src/client/lib/queries.ts` |
| UI components | `ui/src/client/components/TaskDetail.tsx` |
| Gate spec | `docs/specs/gates.md` |

## CLI Binary

The locally-built binary is at `overseer/target/release/os`. The npm-installed `os` in PATH is v0.11.0 and does NOT have gate/review subcommands. Always use the full path or rebuild:

```bash
cd overseer && cargo build --release
```

The UI server needs `OVERSEER_CLI_PATH` set to the local binary:
```bash
OVERSEER_CLI_PATH=/path/to/overseer/target/release/os
```

## Overseer Task Workflow

For each task, follow this flow:

```bash
OS=/path/to/overseer-v2/overseer/target/release/os

# 1. Get next ready task
$OS task next-ready --milestone task_01KM20BQY4RGEWRT1J31XTRA03

# 2. Read full context
$OS task get <task_id>

# 3. Start task (creates VCS bookmark, records start commit)
$OS task start <task_id>

# 4. Implement the changes...

# 5. Run gates (shell gates execute, manual gates skipped)
$OS gate run <task_id>

# 6. If gates fail, read output, fix, re-run
$OS gate output <task_id> <gate_id>
# ... fix ...
$OS gate run <task_id>

# 7. Pass the manual review gate (only after you've verified the work)
$OS gate pass <task_id> gate_01KM22SHQNXPHQ4HJY0KPDCY84 --output "Verified: <summary>"

# 8. Complete task (enforces all gates satisfied, commits via VCS)
$OS task complete <task_id> --result "Description of what was done"
```

**Important VCS behavior**: `task start` checks out a task branch. `task complete` commits on that branch then checks out back to the original detached HEAD. After completing, **cherry-pick the task commit back onto HEAD**:

```bash
# After task complete, the commit is on an orphaned branch. Find it:
git reflog | head -5
# Cherry-pick it onto HEAD:
git cherry-pick <commit_sha>
```

## Instructions for Sub-Agents

Use sub-agents (`Agent` tool) for implementation work. Sub-agents CAN write files to the main workspace. Key rules:

1. **Do NOT let the sub-agent run `os task complete`** — only you (the parent) determine task completion after verifying the work actually landed on disk.

2. **After the sub-agent finishes**, verify changes exist:
   - `git status` to see modified files
   - `git diff --stat` to confirm scope
   - Build and test manually before running gates

3. **Sub-agent prompt template**:
   ```
   You are working on the Overseer v2 project at /path/to/overseer-v2.

   ## Task
   <task description and context from os task get>

   ## IMPORTANT: Completion Policy
   You are NOT allowed to run `os task complete` or `os task start`. Only the parent agent handles task lifecycle. When done, report back with a detailed summary and verification results.

   ## What to do
   <specific implementation steps>

   ## Verify
   - cargo test passes
   - cargo build succeeds
   - npm run build (host + ui) succeeds
   ```

4. **After sub-agent reports success**:
   - Verify files on disk: `git status`, `git diff --stat`
   - Start the task: `os task start <id>`
   - Run gates: `os gate run <id>`
   - If gates pass, pass the review gate
   - Complete the task
   - Cherry-pick the commit onto HEAD

## Spec Reference

The authoritative gate spec is at `docs/specs/gates.md`. Key design points:

- Gate config uses a **JSON blob** per gate type (not promoted fields):
  - Shell: `{ "command": "...", "cwd": "...", "timeout_secs": 300 }`
  - Metadata: `{ "checks": [{ "key": "...", "op": "eq", "value": "..." }] }`
  - Manual: `{}` (empty)
- **Name-based override**: task-specific gate with same name as project gate replaces it
- **Trust boundary**: shell/metadata results set by Overseer only; manual set by external caller
- `os gate pass/fail` rejected for shell/metadata gates
- `--force` on complete requires human confirmation (tty check), not available via MCP
