import { homedir } from "node:os";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";
import { detectVcs, findRepoRoot, getWorkspaces, type VcsType } from "./vcs.js";

/**
 * Config format: ~/.config/overseer/projects.json
 *
 * {
 *   "projects": [
 *     "/path/to/repo",
 *     { "path": "/path/to/repo", "workspaceDir": ".agents" }
 *   ]
 * }
 */

interface ProjectEntry {
  path: string;
  workspaceDir?: string;
}

interface ProjectConfig {
  projects: ProjectEntry[];
}

export interface ProjectInfo {
  name: string;
  path: string;
  vcsType: VcsType;
  hasOverseer: boolean;
  workspaceCount: number;
  workspaceDir?: string;
}

function normalizeEntry(raw: unknown): ProjectEntry | null {
  if (typeof raw === "string") return { path: raw };
  if (typeof raw === "object" && raw !== null && typeof (raw as any).path === "string") {
    const entry: ProjectEntry = { path: (raw as any).path };
    if (typeof (raw as any).workspaceDir === "string") {
      entry.workspaceDir = (raw as any).workspaceDir;
    }
    return entry;
  }
  return null;
}

export async function loadProjectConfig(): Promise<ProjectConfig> {
  try {
    const configPath = resolve(homedir(), ".config/overseer/projects.json");
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.projects)) {
      const projects = parsed.projects
        .map(normalizeEntry)
        .filter((e: ProjectEntry | null): e is ProjectEntry => e !== null);
      return { projects };
    }
    return { projects: [] };
  } catch {
    return { projects: [] };
  }
}

async function inspectProject(entry: ProjectEntry): Promise<ProjectInfo | null> {
  const abs = resolve(entry.path);
  const detection = await detectVcs(abs);

  const hasOverseer = await access(resolve(abs, ".overseer/tasks.db"))
    .then(() => true)
    .catch(() => false);

  // Use native VCS workspace discovery
  let workspaceCount = 0;
  try {
    const workspaces = await getWorkspaces(abs, entry.workspaceDir);
    // Don't count the "default" / main worktree
    workspaceCount = workspaces.filter(
      (ws) => ws.name !== "default" && ws.path !== abs
    ).length;
  } catch {
    // VCS command failed
  }

  return {
    name: basename(abs),
    path: abs,
    vcsType: detection.type,
    hasOverseer,
    workspaceCount,
    workspaceDir: entry.workspaceDir,
  };
}

export async function getProjects(): Promise<ProjectInfo[]> {
  const config = await loadProjectConfig();

  // Auto-detect CWD repo
  let cwdRoot: string | null = null;
  try {
    cwdRoot = await findRepoRoot(process.cwd());
  } catch {
    // not in a repo
  }

  // Collect all candidate entries, CWD first
  const candidates: ProjectEntry[] = [];
  if (cwdRoot) candidates.push({ path: resolve(cwdRoot) });
  for (const entry of config.projects) {
    candidates.push({ ...entry, path: resolve(entry.path) });
  }

  // Deduplicate by resolved path (merge workspaceDir from config if CWD matches)
  const seen = new Map<string, ProjectEntry>();
  for (const c of candidates) {
    const existing = seen.get(c.path);
    if (existing) {
      // Prefer config entry with workspaceDir over bare CWD detection
      if (c.workspaceDir && !existing.workspaceDir) {
        seen.set(c.path, c);
      }
    } else {
      seen.set(c.path, c);
    }
  }

  // Inspect all in parallel, drop failures silently
  const results = await Promise.allSettled(
    Array.from(seen.values()).map(inspectProject)
  );
  const projects: ProjectInfo[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      projects.push(r.value);
    }
  }

  return projects;
}

/**
 * Persist workspaceDir for a project in ~/.config/overseer/projects.json.
 * Creates the config file if it doesn't exist. Upserts the project entry.
 */
export async function setProjectWorkspaceDir(
  projectPath: string,
  workspaceDir: string
): Promise<void> {
  const configPath = resolve(homedir(), ".config/overseer/projects.json");
  const abs = resolve(projectPath);

  // Load existing config (raw JSON to preserve structure)
  let config: { projects: unknown[] };
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    config = {
      projects: Array.isArray(parsed?.projects) ? parsed.projects : [],
    };
  } catch {
    config = { projects: [] };
  }

  // Find existing entry for this project path
  let found = false;
  config.projects = config.projects.map((entry) => {
    const entryPath =
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry !== null
          ? (entry as any).path
          : null;
    if (entryPath && resolve(entryPath) === abs) {
      found = true;
      return { path: abs, workspaceDir };
    }
    return entry;
  });

  // If not found, add new entry
  if (!found) {
    config.projects.push({ path: abs, workspaceDir });
  }

  // Write config
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
