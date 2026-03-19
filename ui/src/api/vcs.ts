/**
 * VCS command executor — spawns jj/git CLI for workspace diff tracing.
 * Standalone from Overseer task system.
 */
import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { resolve, basename } from "node:path";

const VCS_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 512_000; // ~500KB

// ── Types ──────────────────────────────────────────────────────────

export type VcsType = "jj" | "git" | "none";

export interface VcsDetection {
  type: VcsType;
  root: string;
}

export interface LogEntry {
  id: string; // change_id (jj) or short hash (git)
  commitId: string; // full commit hash
  description: string;
  author: string;
  timestamp: string; // raw timestamp string
  empty: boolean;
  workingCopies: string; // workspace names, empty if not WC
}

export interface DiffFile {
  path: string;
  changeType: "A" | "M" | "D" | "R";
}

export interface DiffResult {
  rev: string;
  patch: string;
  truncated: boolean;
  files: DiffFile[];
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  vcsType: VcsType;
}

// ── Core executor ──────────────────────────────────────────────────

export class VcsError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(message);
    this.name = "VcsError";
  }
}

function execVcs(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      cmd,
      args,
      { cwd, maxBuffer: MAX_OUTPUT_BYTES, timeout: VCS_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          // maxBuffer exceeded — return what we got, mark truncated
          if (err.message?.includes("maxBuffer")) {
            resolve({ stdout: stdout ?? "", truncated: true });
            return;
          }
          const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
          reject(
            new VcsError(
              stderr?.trim() || err.message,
              typeof code === "number" ? code : -1,
              stderr ?? ""
            )
          );
          return;
        }
        resolve({ stdout: stdout ?? "", truncated: false });
      }
    );
  });
}

// ── Path validation ────────────────────────────────────────────────

async function validatePath(path: string): Promise<string> {
  const abs = resolve(path);
  const s = await stat(abs).catch(() => null);
  if (!s?.isDirectory()) {
    throw new VcsError(`Not a directory: ${abs}`, -1, "");
  }
  return abs;
}

// ── Repo root discovery ────────────────────────────────────────────

export async function findRepoRoot(from: string): Promise<string> {
  let dir = resolve(from);
  while (dir !== "/") {
    const hasJj = await access(resolve(dir, ".jj"))
      .then(() => true)
      .catch(() => false);
    if (hasJj) return dir;
    const hasGit = await access(resolve(dir, ".git"))
      .then(() => true)
      .catch(() => false);
    if (hasGit) return dir;
    dir = resolve(dir, "..");
  }
  return resolve(from); // fallback
}

// ── VCS detection ──────────────────────────────────────────────────

export async function detectVcs(path: string): Promise<VcsDetection> {
  const abs = await validatePath(path);

  // Check jj first (preferred)
  const jjExists = await access(resolve(abs, ".jj"))
    .then(() => true)
    .catch(() => false);
  if (jjExists) return { type: "jj", root: abs };

  // Check git
  const gitExists = await access(resolve(abs, ".git"))
    .then(() => true)
    .catch(() => false);
  if (gitExists) return { type: "git", root: abs };

  return { type: "none", root: abs };
}

// ── Workspace enumeration ──────────────────────────────────────────

/**
 * List workspaces using native VCS commands.
 *
 * - jj: `jj workspace list` for names, resolved against `workspaceDir`
 *   (since jj doesn't expose filesystem paths for non-default workspaces).
 * - git: `git worktree list --porcelain` for direct path discovery.
 *
 * @param root - repo root path
 * @param workspaceDir - directory containing jj workspaces (relative to root).
 *   Required for jj to resolve workspace paths. Ignored for git.
 */
export async function getWorkspaces(
  root?: string,
  workspaceDir?: string
): Promise<WorkspaceInfo[]> {
  const base = root ? resolve(root) : await findRepoRoot(process.cwd());
  const detection = await detectVcs(base);

  if (detection.type === "jj") {
    return getJjWorkspaces(base, workspaceDir);
  }
  if (detection.type === "git") {
    return getGitWorktrees(base);
  }
  return [];
}

async function getJjWorkspaces(
  repoRoot: string,
  workspaceDir?: string
): Promise<WorkspaceInfo[]> {
  // Get workspace names from jj
  const { stdout } = await execVcs(
    "jj",
    ["workspace", "list", "-T", 'name ++ "\\n"', "--no-pager", "--color=never"],
    repoRoot
  );

  const names = stdout
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);

  const results: WorkspaceInfo[] = [];

  // "default" workspace is always the repo root
  if (names.includes("default")) {
    results.push({ name: "default", path: repoRoot, vcsType: "jj" });
  }

  // Non-default workspaces: resolve against workspaceDir
  const nonDefault = names.filter((n) => n !== "default");
  if (nonDefault.length > 0 && workspaceDir) {
    const wsBase = resolve(repoRoot, workspaceDir);
    for (const name of nonDefault) {
      const wsPath = resolve(wsBase, name);
      const exists = await access(resolve(wsPath, ".jj"))
        .then(() => true)
        .catch(() => false);
      if (exists) {
        results.push({ name, path: wsPath, vcsType: "jj" });
      }
    }
  }

  return results;
}

async function getGitWorktrees(repoRoot: string): Promise<WorkspaceInfo[]> {
  const { stdout } = await execVcs(
    "git",
    ["-C", repoRoot, "worktree", "list", "--porcelain"],
    repoRoot
  );

  const results: WorkspaceInfo[] = [];
  // Porcelain format: blocks separated by blank lines, each starts with "worktree <path>"
  for (const block of stdout.split("\n\n")) {
    const lines = block.trim().split("\n");
    const wtLine = lines.find((l) => l.startsWith("worktree "));
    if (!wtLine) continue;
    const wtPath = wtLine.slice("worktree ".length);
    const name = basename(wtPath);
    results.push({ name, path: wtPath, vcsType: "git" });
  }
  return results;
}

// ── JJ operations ──────────────────────────────────────────────────

const JJ_LOG_TEMPLATE = [
  'change_id ++ "\\t"',
  'commit_id ++ "\\t"',
  'description.first_line() ++ "\\t"',
  'author.email() ++ "\\t"',
  'committer.timestamp() ++ "\\t"',
  'empty ++ "\\t"',
  'self.working_copies() ++ "\\n"',
].join(" ++ ");

function parseJjLog(stdout: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 6) continue;
    entries.push({
      id: parts[0] ?? "",
      commitId: parts[1] ?? "",
      description: parts[2] ?? "",
      author: parts[3] ?? "",
      timestamp: parts[4] ?? "",
      empty: parts[5] === "true",
      workingCopies: parts[6]?.trim() ?? "",
    });
  }
  return entries;
}

async function jjLog(cwd: string, limit: number): Promise<LogEntry[]> {
  const { stdout } = await execVcs(
    "jj",
    [
      "log",
      "--no-pager",
      "--color=never",
      "--no-graph",
      "-r",
      "::@",
      "--limit",
      String(limit),
      "-T",
      JJ_LOG_TEMPLATE,
    ],
    cwd
  );
  return parseJjLog(stdout);
}

async function jjDiff(
  cwd: string,
  rev: string
): Promise<{ patch: string; truncated: boolean }> {
  return execVcs(
    "jj",
    ["diff", "--git", "--no-pager", "--color=never", "-r", rev],
    cwd
  ).then(({ stdout, truncated }) => ({ patch: stdout, truncated }));
}

async function jjDiffSummary(cwd: string, rev: string): Promise<DiffFile[]> {
  const { stdout } = await execVcs(
    "jj",
    ["diff", "--summary", "--no-pager", "--color=never", "-r", rev],
    cwd
  );
  return parseDiffSummary(stdout);
}

// ── Git operations ─────────────────────────────────────────────────

function parseGitLog(stdout: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    entries.push({
      id: parts[1] ?? "", // short hash
      commitId: parts[0] ?? "", // full hash
      description: parts[2] ?? "",
      author: parts[3] ?? "",
      timestamp: parts[4] ?? "",
      empty: false,
      workingCopies: "",
    });
  }
  return entries;
}

async function gitLog(cwd: string, limit: number): Promise<LogEntry[]> {
  const { stdout } = await execVcs(
    "git",
    [
      "-C",
      cwd,
      "log",
      "--no-color",
      `--format=%H%x09%h%x09%s%x09%an%x09%aI`,
      `-${limit}`,
    ],
    cwd
  );
  return parseGitLog(stdout);
}

async function gitDiff(
  cwd: string,
  rev: string
): Promise<{ patch: string; truncated: boolean }> {
  // For HEAD or latest commit
  const args =
    rev === "@" || rev === "HEAD"
      ? ["-C", cwd, "diff", "--no-color", "HEAD~1..HEAD"]
      : ["-C", cwd, "diff", "--no-color", `${rev}^..${rev}`];

  return execVcs("git", args, cwd).then(({ stdout, truncated }) => ({
    patch: stdout,
    truncated,
  }));
}

async function gitDiffSummary(cwd: string, rev: string): Promise<DiffFile[]> {
  const args =
    rev === "@" || rev === "HEAD"
      ? ["-C", cwd, "diff", "--name-status", "--no-color", "HEAD~1..HEAD"]
      : ["-C", cwd, "diff", "--name-status", "--no-color", `${rev}^..${rev}`];

  const { stdout } = await execVcs("git", args, cwd);
  return parseGitNameStatus(stdout);
}

// ── Shared parsers ─────────────────────────────────────────────────

function parseDiffSummary(stdout: string): DiffFile[] {
  // JJ format: "M path/to/file" or "A path" or "D path" or "R {from => to}"
  const files: DiffFile[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const type = trimmed[0] as DiffFile["changeType"];
    const path = trimmed.slice(2).trim();
    if (path && ["A", "M", "D", "R"].includes(type)) {
      files.push({ path, changeType: type });
    }
  }
  return files;
}

function parseGitNameStatus(stdout: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [type, ...pathParts] = trimmed.split("\t");
    const changeType = type?.[0] as DiffFile["changeType"];
    const path = pathParts[pathParts.length - 1]; // last part for renames
    if (path && changeType && ["A", "M", "D", "R"].includes(changeType)) {
      files.push({ path, changeType });
    }
  }
  return files;
}

// ── Public API (VCS-agnostic) ──────────────────────────────────────

export async function getLog(
  path: string,
  limit: number,
  vcsType: VcsType
): Promise<LogEntry[]> {
  const abs = await validatePath(path);
  if (vcsType === "jj") return jjLog(abs, limit);
  if (vcsType === "git") return gitLog(abs, limit);
  throw new VcsError("No VCS detected", -1, "");
}

export async function getDiff(
  path: string,
  rev: string,
  vcsType: VcsType
): Promise<DiffResult> {
  const abs = await validatePath(path);

  const [diffResult, files] = await Promise.all([
    vcsType === "jj" ? jjDiff(abs, rev) : gitDiff(abs, rev),
    vcsType === "jj" ? jjDiffSummary(abs, rev) : gitDiffSummary(abs, rev),
  ]);

  return {
    rev,
    patch: diffResult.patch,
    truncated: diffResult.truncated,
    files,
  };
}
