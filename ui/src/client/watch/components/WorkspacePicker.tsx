import { useState } from "react";
import { useWorkspaces, useSetWorkspaceDir } from "../lib/watch-queries.js";
import { useWatchStore } from "../lib/watch-store.js";
import type { WorkspaceInfo } from "../lib/watch-types.js";

function navigateToWorkspace(projectRoot: string, wsPath: string) {
  window.location.href = `/watch?project=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent(wsPath)}`;
}

function WorkspaceRow({ ws, projectRoot }: { ws: WorkspaceInfo; projectRoot: string }) {
  return (
    <button
      type="button"
      onClick={() => navigateToWorkspace(projectRoot, ws.path)}
      className="w-full text-left px-4 py-3 flex items-center gap-3 bg-surface-primary border-2 border-border rounded hover:border-border-hover hover:bg-surface-secondary transition-colors cursor-pointer"
    >
      <span className="w-2 h-2 rounded-full bg-status-active shrink-0" />
      <span className="font-mono text-sm text-text-primary flex-1 truncate">
        {ws.name}
      </span>
      <span className="font-mono text-xs text-text-muted uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-subtle/30 border border-accent/20">
        {ws.vcsType}
      </span>
      <span className="font-mono text-xs text-text-dim truncate max-w-64">
        {ws.path}
      </span>
    </button>
  );
}

function WorkspaceDirConfig({
  projectRoot,
  currentDir,
}: {
  projectRoot: string;
  currentDir: string | null;
}) {
  const [editing, setEditing] = useState(!currentDir);
  const [dirInput, setDirInput] = useState(currentDir ?? ".agents");
  const setWorkspaceDirMutation = useSetWorkspaceDir();
  const saveWorkspaceDir = useWatchStore((s) => s.saveWorkspaceDir);

  const handleSave = () => {
    const dir = dirInput.trim();
    if (!dir) return;
    setWorkspaceDirMutation.mutate(
      { projectPath: projectRoot, workspaceDir: dir },
      {
        onSuccess: () => {
          saveWorkspaceDir(projectRoot, dir);
          setEditing(false);
        },
      }
    );
  };

  if (!editing) {
    return (
      <div className="mt-6 flex items-center gap-2">
        <span className="font-mono text-xs text-text-dim">workspace dir:</span>
        <span className="font-mono text-xs text-text-muted">{currentDir}</span>
        <button
          type="button"
          onClick={() => {
            setDirInput(currentDir ?? ".agents");
            setEditing(true);
          }}
          className="font-mono text-xs text-accent hover:text-accent/80 transition-colors cursor-pointer"
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 p-4 bg-surface-primary border-2 border-border rounded">
      <p className="font-mono text-xs text-text-muted mb-3">
        {currentDir
          ? "Change the workspace directory (relative to project root)."
          : "Set a workspace directory to discover additional workspaces (relative to project root)."}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={dirInput}
          onChange={(e) => setDirInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape" && currentDir) setEditing(false);
          }}
          placeholder=".agents"
          className="flex-1 bg-bg-primary border-2 border-border rounded px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-border-focus"
          autoFocus
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={setWorkspaceDirMutation.isPending}
          className="px-4 py-2 bg-accent-subtle border-2 border-accent/40 rounded font-mono text-sm text-accent hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-50"
        >
          {setWorkspaceDirMutation.isPending ? "Saving..." : "Save"}
        </button>
        {currentDir && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-3 py-2 font-mono text-xs text-text-dim hover:text-text-muted transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>
      {setWorkspaceDirMutation.isError && (
        <p className="font-mono text-xs text-status-blocked mt-2">
          {setWorkspaceDirMutation.error.message}
        </p>
      )}
    </div>
  );
}

export function WorkspacePicker({ projectRoot }: { projectRoot: string }) {
  const workspaceDir = useWatchStore((s) => s.workspaceDir);
  const { data: workspaces, isLoading, error } = useWorkspaces(projectRoot, workspaceDir ?? undefined);
  const [customPath, setCustomPath] = useState("");

  // Show initial setup prompt when no workspaceDir and only default workspace
  const onlyDefault =
    workspaces &&
    workspaces.length <= 1 &&
    workspaces.every((ws) => ws.name === "default" || ws.path === projectRoot);
  const showInitialSetup = !workspaceDir && onlyDefault && !isLoading;

  return (
    <div className="max-w-2xl mx-auto p-8">
      {/* Back link */}
      <a
        href="/watch"
        className="font-mono text-xs text-text-muted hover:text-accent transition-colors inline-block mb-4"
      >
        &larr; all projects
      </a>

      <h2 className="font-mono text-lg text-text-primary mb-1">
        {projectRoot.split("/").pop()}
      </h2>
      <p className="font-mono text-xs text-text-dim mb-6">{projectRoot}</p>

      {/* Custom path input */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customPath.trim()) {
              navigateToWorkspace(projectRoot, customPath.trim());
            }
          }}
          placeholder="/path/to/workspace"
          className="flex-1 bg-surface-primary border-2 border-border rounded px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-border-focus"
        />
        <button
          type="button"
          onClick={() => customPath.trim() && navigateToWorkspace(projectRoot, customPath.trim())}
          className="px-4 py-2 bg-accent-subtle border-2 border-accent/40 rounded font-mono text-sm text-accent hover:bg-accent/20 transition-colors cursor-pointer"
        >
          Open
        </button>
      </div>

      {/* Workspace list */}
      {isLoading && (
        <p className="text-text-muted font-mono text-sm">
          Scanning workspaces...
        </p>
      )}
      {error && (
        <p className="text-status-blocked font-mono text-sm">
          {error.message}
        </p>
      )}
      {workspaces && workspaces.length > 0 && (
        <div className="flex flex-col gap-2">
          {workspaces.map((ws) => (
            <WorkspaceRow key={ws.path} ws={ws} projectRoot={projectRoot} />
          ))}
        </div>
      )}
      {workspaces && workspaces.length === 0 && (
        <p className="text-text-dim font-mono text-sm">
          No workspaces found.
        </p>
      )}

      {/* Workspace dir config — initial setup or editable */}
      {(showInitialSetup || workspaceDir) && (
        <WorkspaceDirConfig projectRoot={projectRoot} currentDir={workspaceDir} />
      )}
    </div>
  );
}
