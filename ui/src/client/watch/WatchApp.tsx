import { useEffect } from "react";
import { useWatchStore } from "./lib/watch-store.js";
import { useWatchDetect, useProjects } from "./lib/watch-queries.js";
import { ProjectPicker } from "./components/ProjectPicker.js";
import { WorkspacePicker } from "./components/WorkspacePicker.js";
import { WorkspaceShell } from "./components/WorkspaceShell.js";

function getUrlParams(): { project: string | null; path: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { project: params.get("project"), path: params.get("path") };
}

/**
 * Legacy compat: if ?path= without ?project=, detect repo root and redirect.
 */
function LegacyRedirect({ path }: { path: string }) {
  const { data: detection } = useWatchDetect(path);

  useEffect(() => {
    if (detection?.root) {
      window.location.href = `/watch?project=${encodeURIComponent(detection.root)}&path=${encodeURIComponent(path)}`;
    }
  }, [detection, path]);

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <p className="font-mono text-sm text-text-dim">Detecting project...</p>
    </div>
  );
}

export function WatchApp() {
  const { project, path } = getUrlParams();
  const setProjectRoot = useWatchStore((s) => s.setProjectRoot);
  const setWorkspacePath = useWatchStore((s) => s.setWorkspacePath);
  const workspacePath = useWatchStore((s) => s.workspacePath);
  const projectRoot = useWatchStore((s) => s.projectRoot);

  // Fetch projects to resolve workspaceDir for the selected project
  const { data: projects } = useProjects();

  // Sync URL params to store (including workspaceDir from project config)
  useEffect(() => {
    if (project && project !== projectRoot) {
      const match = projects?.find((p) => p.path === project);
      setProjectRoot(project, match?.workspaceDir);
    }
  }, [project, projectRoot, projects, setProjectRoot]);

  useEffect(() => {
    if (path && path !== workspacePath) {
      setWorkspacePath(path);
    }
  }, [path, workspacePath, setWorkspacePath]);

  // Legacy: ?path= without ?project=
  if (path && !project) {
    return <LegacyRedirect path={path} />;
  }

  // Three-level routing
  if (workspacePath && projectRoot) {
    return <WorkspaceShell path={workspacePath} />;
  }

  if (projectRoot) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary">
        <div className="pt-12 pb-4 text-center">
          <h1 className="font-mono text-2xl font-bold text-text-primary mb-1">
            Workspace Watch
          </h1>
          <p className="font-mono text-sm text-text-dim">
            Monitor agent workspaces in real-time
          </p>
        </div>
        <WorkspacePicker projectRoot={projectRoot} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="pt-12 pb-4 text-center">
        <h1 className="font-mono text-2xl font-bold text-text-primary mb-1">
          Workspace Watch
        </h1>
        <p className="font-mono text-sm text-text-dim">
          Monitor agent workspaces in real-time
        </p>
      </div>
      <ProjectPicker />
    </div>
  );
}
