import { useState } from "react";
import { useProjects } from "../lib/watch-queries.js";
import type { ProjectInfo } from "../lib/watch-types.js";

function navigateToProject(path: string) {
  window.location.href = `/watch?project=${encodeURIComponent(path)}`;
}

function ProjectRow({ project }: { project: ProjectInfo }) {
  return (
    <button
      type="button"
      onClick={() => navigateToProject(project.path)}
      className="w-full text-left px-4 py-3 flex items-center gap-3 bg-surface-primary border-2 border-border rounded hover:border-border-hover hover:bg-surface-secondary transition-colors cursor-pointer"
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          project.hasOverseer ? "bg-status-active" : "bg-border"
        }`}
      />
      <span className="font-mono text-sm text-text-primary flex-1 truncate">
        {project.name}
      </span>
      <span className="font-mono text-xs text-text-muted uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-subtle/30 border border-accent/20">
        {project.vcsType}
      </span>
      {project.workspaceCount > 0 && (
        <span className="font-mono text-xs text-text-dim">
          {project.workspaceCount} ws
        </span>
      )}
      <span className="font-mono text-xs text-text-dim truncate max-w-64">
        {project.path}
      </span>
    </button>
  );
}

export function ProjectPicker() {
  const { data: projects, isLoading, error } = useProjects();
  const [customPath, setCustomPath] = useState("");

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h2 className="font-mono text-lg text-text-primary mb-6">
        Select Project
      </h2>

      {/* Custom path input */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customPath.trim()) {
              navigateToProject(customPath.trim());
            }
          }}
          placeholder="/path/to/project"
          className="flex-1 bg-surface-primary border-2 border-border rounded px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-border-focus"
        />
        <button
          type="button"
          onClick={() => customPath.trim() && navigateToProject(customPath.trim())}
          className="px-4 py-2 bg-accent-subtle border-2 border-accent/40 rounded font-mono text-sm text-accent hover:bg-accent/20 transition-colors cursor-pointer"
        >
          Open
        </button>
      </div>

      {/* Project list */}
      {isLoading && (
        <p className="text-text-muted font-mono text-sm">
          Discovering projects...
        </p>
      )}
      {error && (
        <p className="text-status-blocked font-mono text-sm">
          {error.message}
        </p>
      )}
      {projects && projects.length === 0 && (
        <p className="text-text-dim font-mono text-sm">
          No projects found. Enter a path manually.
        </p>
      )}
      {projects && projects.length > 0 && (
        <div className="flex flex-col gap-2">
          {projects.map((p) => (
            <ProjectRow key={p.path} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
