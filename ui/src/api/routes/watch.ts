/**
 * Watch API routes — workspace diff monitoring
 * Standalone from Overseer task system
 */
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { Hono } from "hono";
import {
  detectVcs,
  getWorkspaces,
  getLog,
  getDiff,
  VcsError,
  type VcsType,
} from "../vcs.js";
import { getProjects, setProjectWorkspaceDir } from "../projects.js";

function handleVcsError(c: any, err: unknown) {
  if (err instanceof VcsError) {
    const msg = err.message.toLowerCase();
    if (msg.includes("not a directory") || msg.includes("enoent")) {
      return c.json({ error: err.message }, 404);
    }
    return c.json({ error: err.message }, 500);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
}

/**
 * Validate and detect VCS for a path query param.
 * Accepts optional vcsOverride to force VCS type.
 */
async function resolveWorkspace(
  c: any,
  pathParam: string | undefined,
  vcsOverride?: string
): Promise<
  | { ok: true; path: string; vcsType: VcsType }
  | { ok: false; response: Response }
> {
  if (!pathParam) {
    return { ok: false, response: c.json({ error: "Missing ?path= parameter" }, 400) };
  }
  try {
    const detection = await detectVcs(pathParam);
    if (detection.type === "none" && !vcsOverride) {
      return {
        ok: false,
        response: c.json({ error: `No VCS found at: ${pathParam}` }, 404),
      };
    }
    // Use override if valid, otherwise use detected type
    const vcsType: VcsType =
      vcsOverride === "jj" || vcsOverride === "git"
        ? vcsOverride
        : detection.type;
    return { ok: true, path: detection.root, vcsType };
  } catch (err) {
    return { ok: false, response: handleVcsError(c, err) };
  }
}

const watch = new Hono()
  /**
   * GET /api/watch/projects
   * List known projects (config + auto-detected CWD)
   */
  .get("/projects", async (c) => {
    try {
      const projects = await getProjects();
      return c.json(projects);
    } catch (err) {
      return handleVcsError(c, err);
    }
  })

  /**
   * PUT /api/watch/projects/workspace-dir
   * Set workspaceDir for a project in config
   * Body: { projectPath: string, workspaceDir: string }
   */
  .put("/projects/workspace-dir", async (c) => {
    try {
      const body = await c.req.json();
      const { projectPath, workspaceDir } = body as {
        projectPath?: string;
        workspaceDir?: string;
      };
      if (!projectPath || !workspaceDir) {
        return c.json(
          { error: "Missing projectPath or workspaceDir" },
          400
        );
      }
      await setProjectWorkspaceDir(projectPath, workspaceDir);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  })

  /**
   * GET /api/watch/workspaces
   * List workspaces via native VCS discovery (jj workspace list / git worktree list)
   * ?root= repo root, ?workspaceDir= for jj workspace path resolution
   */
  .get("/workspaces", async (c) => {
    const root = c.req.query("root");
    const workspaceDir = c.req.query("workspaceDir");
    try {
      const workspaces = await getWorkspaces(root ?? undefined, workspaceDir ?? undefined);
      return c.json(workspaces);
    } catch (err) {
      return handleVcsError(c, err);
    }
  })

  /**
   * GET /api/watch/detect
   * Detect VCS type for a given path
   */
  .get("/detect", async (c) => {
    const path = c.req.query("path");
    if (!path) {
      return c.json({ error: "Missing ?path= parameter" }, 400);
    }
    try {
      const detection = await detectVcs(path);
      return c.json(detection);
    } catch (err) {
      return handleVcsError(c, err);
    }
  })

  /**
   * GET /api/watch/log
   * Commit timeline for a workspace
   */
  .get("/log", async (c) => {
    const vcsOverride = c.req.query("vcs");
    const ws = await resolveWorkspace(c, c.req.query("path"), vcsOverride);
    if (!ws.ok) return ws.response;

    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

    try {
      const entries = await getLog(ws.path, limit, ws.vcsType);

      // Find working copy entry
      const wcEntry = entries.find((e) => e.workingCopies !== "");
      return c.json({
        workingCopyId: wcEntry?.id ?? null,
        entries,
      });
    } catch (err) {
      return handleVcsError(c, err);
    }
  })

  /**
   * GET /api/watch/diff
   * Unified diff for a specific revision
   */
  .get("/diff", async (c) => {
    const vcsOverride = c.req.query("vcs");
    const ws = await resolveWorkspace(c, c.req.query("path"), vcsOverride);
    if (!ws.ok) return ws.response;

    const rev = c.req.query("rev");
    if (!rev) {
      return c.json({ error: "Missing ?rev= parameter" }, 400);
    }

    try {
      const result = await getDiff(ws.path, rev, ws.vcsType);
      return c.json(result);
    } catch (err) {
      return handleVcsError(c, err);
    }
  });

const VSCODE_CLI_MACOS =
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";

async function resolveCodeBin(): Promise<string> {
  // macOS: use the binary inside the app bundle (works even if `code` isn't in PATH)
  if (process.platform === "darwin") {
    await stat(VSCODE_CLI_MACOS); // throws if not installed
    return VSCODE_CLI_MACOS;
  }
  return "code";
}

async function openInVSCode(target: string): Promise<void> {
  const codeBin = await resolveCodeBin();
  const s = await stat(target);
  const codeArgs = s.isDirectory()
    ? ["--new-window", target]
    : ["--reuse-window", "--goto", target];
  const child = spawn(codeBin, codeArgs, { detached: true, stdio: "ignore" });
  child.unref();
}

watch
  /**
   * POST /api/watch/open-editor
   * Open a file or directory in VS Code.
   * Body: { path: string }
   */
  .post("/open-editor", async (c) => {
    const body = await c.req.json();
    const target = (body as { path?: string }).path;
    if (!target) {
      return c.json({ error: "Missing path" }, 400);
    }

    try {
      await openInVSCode(target);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

export { watch };
