# Handoff: Workspace Tracer — Project Switching

## What Exists

A working **Workspace Diff Tracer** at `/tracer` in the existing Overseer UI (Hono + React + Vite on `:6969`/`:5173`). It lets you point at a jj/git workspace directory and see live commits + syntax-highlighted diffs as an agent works.

### Current Architecture

```
Browser /tracer?path=.agents/cli-alpha
    │
    ▼
Hono API  /api/tracer/{workspaces,detect,log,diff}
    │
    ▼
Spawn jj/git CLI directly (not Rust os binary)
```

**Backend** (`ui/src/api/`):
- `vcs.ts` — VCS command executor. `execVcs()` spawns jj/git with `execFile` (no shell injection), `--no-pager --color=never` for stable output, 500KB maxBuffer diff guard. Functions: `detectVcs()`, `getLog()`, `getDiff()`, `getWorkspaces()`, `findRepoRoot()`.
- `routes/tracer.ts` — Hono route group mounted at `/api/tracer`. Routes: `GET /workspaces`, `GET /detect?path=`, `GET /log?path=&limit=`, `GET /diff?path=&rev=`.
- Mounted in `app.ts` via `.route("/api/tracer", tracer)`.

**Client** (`ui/src/client/tracer/`):
- `TracerApp.tsx` — Entry point. Reads `?path=` from URL, shows `WorkspacePicker` or `WorkspaceShell`.
- `lib/tracer-types.ts` — `LogEntry`, `DiffResponse`, `WorkspaceInfo`, etc.
- `lib/tracer-store.ts` — Zustand: `workspacePath`, `selectedRev`, `autoFollow`, `viewMode` (split/stacked), `prevWorkingCopyId`.
- `lib/tracer-queries.ts` — TanStack Query hooks: `useWorkspaces()`, `useTracerLog()` (2s polling), `useTracerDiff()` (on-demand), `useTracerDetect()`.
- `components/WorkspacePicker.tsx` — Lists `.agents/*` dirs + custom path input.
- `components/WorkspaceShell.tsx` — Layout: TracerHeader + CommitTimeline (left 288px) + DiffViewer (right flex). Keyboard shortcuts (j/k, s, f, Escape).
- `components/CommitTimeline.tsx` — Polls `useTracerLog`, auto-follow on WC change, auto-select first entry.
- `components/CommitEntry.tsx` — Change ID (8 chars), description, relative time, WC pulsing dot.
- `components/TracerHeader.tsx` — Workspace name, VCS badge, auto-follow toggle, split/stacked toggle, back link.
- `components/DiffViewer.tsx` — Uses `parsePatchFiles()` from `@pierre/diffs` to split multi-file patch, renders `<FileDiff>` per file with `github-dark` theme, word-level inline diffs.
- `components/FileList.tsx` — Color-coded file change badges (A=green, M=orange, D=red).

**Routing:** `main.tsx` checks `window.location.pathname.startsWith("/tracer")` — renders `TracerApp` or `App`.

**Key dependency:** `@pierre/diffs` (in `ui/package.json`). Use `parsePatchFiles()` from `@pierre/diffs` and `FileDiff` from `@pierre/diffs/react`. Do NOT use `PatchDiff` — it only handles single-file patches and throws on multi-file diffs.

### Design Tokens

Uses existing OKLCH theme from `global.css`: `bg-primary`, `bg-secondary`, `surface-primary`, `text-primary`, `text-muted`, `text-dim`, `accent`, `border`, `status-active` (orange), `status-done` (green), `status-blocked` (red). All monospace (JetBrains Mono).

## What to Build: Project Switching

### Concept

Currently the tracer only sees `.agents/*` directories in the current repo. "Project switching" means:

1. **Enumerate known projects** — Scan for Overseer databases (`.overseer/tasks.db`) across known directories
2. **Select a project** — Pick a project, then see its agent workspaces
3. **Cross-project view** — Navigate between projects without restarting the server

### How Overseer Tracks Projects

Overseer has **no central project registry**. Each project is a VCS repo with `.overseer/tasks.db` at the repo root. The database path is resolved as:

1. `OVERSEER_DB_PATH` env var (if set)
2. `VCS_ROOT/.overseer/tasks.db` (jj or git repo root)
3. `CWD/.overseer/tasks.db` (fallback)

The CLI accepts `--db /path/to/tasks.db` for explicit database targeting.

### Proposed Design

#### Backend: Project Discovery

Add to `vcs.ts` or new `projects.ts`:

```typescript
interface ProjectInfo {
  name: string;          // Directory name or repo name
  path: string;          // Absolute path to repo root
  vcsType: VcsType;
  hasOverseer: boolean;  // .overseer/tasks.db exists
  workspaceCount: number; // Number of .agents/* dirs
}
```

**Discovery sources** (combine and deduplicate):
- Scan common parent directories (e.g., `~/work/`, or configurable)
- Parse `jj workspace list` output from the current repo
- Read a config file (e.g., `~/.config/overseer/projects.json`) with pinned project paths
- Walk recently-used directories

**Simplest MVP:** A config file `~/.config/overseer/projects.json` listing known project roots:
```json
{ "projects": ["/Users/you/work/overseer-v2", "/Users/you/work/other-project"] }
```
Plus auto-detect the current repo (from server CWD) as the default.

#### API Routes

Add to `routes/tracer.ts`:

```
GET /api/tracer/projects                    — List known projects
GET /api/tracer/projects/:name/workspaces   — List workspaces for a project
```

Or keep it simpler — extend the existing `/workspaces` endpoint:

```
GET /api/tracer/workspaces?root=/path/to/project  — Already works!
```

The `/workspaces` endpoint already accepts a `?root=` param. The missing piece is enumerating *which roots exist*.

#### Frontend Changes

1. **ProjectPicker** — New component above WorkspacePicker, or integrated into it. Shows known projects with workspace counts.
2. **TracerApp URL scheme** — Add `?project=` param: `/tracer?project=/path/to/repo` shows that project's workspaces, `/tracer?project=/path/to/repo&path=.agents/cli-alpha` goes directly to a workspace.
3. **TracerHeader** — Show project name + workspace name. "Switch project" link.
4. **Store** — Add `projectRoot: string | null` to tracer store. WorkspacePicker fetches `/api/tracer/workspaces?root=<projectRoot>`.

#### File Changes

```
New/Modified:
  ui/src/api/projects.ts                           — Project discovery (scan, config file)
  ui/src/api/routes/tracer.ts                      — Add GET /projects route
  ui/src/client/tracer/components/ProjectPicker.tsx — Project list UI
  ui/src/client/tracer/components/WorkspacePicker.tsx — Accept projectRoot prop
  ui/src/client/tracer/lib/tracer-store.ts          — Add projectRoot
  ui/src/client/tracer/lib/tracer-queries.ts        — Add useProjects() hook
  ui/src/client/tracer/lib/tracer-types.ts          — Add ProjectInfo type
  ui/src/client/tracer/TracerApp.tsx                — Route: no params → ProjectPicker, ?project= → WorkspacePicker, ?path= → WorkspaceShell
  ui/src/client/tracer/components/TracerHeader.tsx  — Show project + workspace breadcrumb
```

### Implementation Notes

- The server CWD is `ui/` — `findRepoRoot()` in `vcs.ts` already walks up to find `.jj/` or `.git/`. Use this for auto-detecting the current project.
- `getWorkspaces(root)` already scans `.agents/` under a given root. The plumbing for multi-project workspaces is there.
- Vite dev server runs on `:5173`, Hono API on `:6969`. During dev, access `:5173` for HMR. The production build serves from `:6969` static files.
- All VCS commands use `execFile` with array args (no shell interpolation). Maintain this for any new path handling.
- `@pierre/diffs`: use `parsePatchFiles()` → `FileDiff`, never `PatchDiff` (single-file only).

### Verification

1. Create `~/.config/overseer/projects.json` with 2+ project paths
2. `curl /api/tracer/projects` returns list with workspace counts
3. `/tracer` shows ProjectPicker → select project → WorkspacePicker → select workspace → WorkspaceShell
4. TracerHeader shows `project > workspace` breadcrumb
5. "Switch project" navigates back to ProjectPicker
