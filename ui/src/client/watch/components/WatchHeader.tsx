import { useWatchStore } from "../lib/watch-store.js";
import { useWatchDetect, useOpenEditor } from "../lib/watch-queries.js";

export function WatchHeader({ path }: { path: string }) {
  const { data: detection } = useWatchDetect(path);
  const autoFollow = useWatchStore((s) => s.autoFollow);
  const toggleAutoFollow = useWatchStore((s) => s.toggleAutoFollow);
  const viewMode = useWatchStore((s) => s.viewMode);
  const toggleViewMode = useWatchStore((s) => s.toggleViewMode);
  const projectRoot = useWatchStore((s) => s.projectRoot);
  const vcsOverride = useWatchStore((s) => s.vcsOverride);
  const cycleVcsOverride = useWatchStore((s) => s.cycleVcsOverride);

  const openEditor = useOpenEditor();
  const wsName = path.split("/").pop() ?? path;
  const projectName = projectRoot?.split("/").pop() ?? "";
  const detectedVcs = detection?.type ?? "...";
  const displayVcs = vcsOverride ?? detectedVcs;
  const isForced = vcsOverride !== null;

  return (
    <header className="flex items-center gap-4 px-4 py-2 border-b-2 border-border bg-surface-primary shrink-0">
      {/* Breadcrumb navigation */}
      <nav className="flex items-center gap-1.5 font-mono text-xs">
        <a
          href="/watch"
          className="text-text-muted hover:text-accent transition-colors"
        >
          projects
        </a>
        {projectRoot && (
          <>
            <span className="text-text-dim">/</span>
            <a
              href={`/watch?project=${encodeURIComponent(projectRoot)}`}
              className="text-text-muted hover:text-accent transition-colors"
            >
              {projectName}
            </a>
          </>
        )}
        <span className="text-text-dim">/</span>
        <span className="text-text-primary font-bold">{wsName}</span>
      </nav>

      {/* VCS badge — clickable to cycle override */}
      <button
        type="button"
        onClick={cycleVcsOverride}
        className={`font-mono text-xs uppercase tracking-wider px-1.5 py-0.5 rounded cursor-pointer transition-all ${
          isForced
            ? "text-accent border-2 border-accent bg-accent-subtle/30 shadow-[0_0_6px_rgba(var(--accent-rgb,99,102,241),0.4)]"
            : "text-accent border border-accent/20 bg-accent-subtle/30"
        }`}
        title={isForced ? `forced: ${vcsOverride}` : `auto (${detectedVcs})`}
      >
        {displayVcs}
      </button>

      {/* Path (dimmed) */}
      <span className="font-mono text-xs text-text-dim truncate flex-1">
        {path}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Open in editor */}
        <button
          type="button"
          onClick={() => openEditor.mutate(path)}
          className="font-mono text-xs text-text-muted px-2 py-1 rounded border border-border hover:border-border-hover hover:text-accent transition-colors cursor-pointer"
          title="Open workspace in editor"
        >
          open
        </button>

        {/* Auto-follow toggle */}
        <button
          type="button"
          onClick={toggleAutoFollow}
          className={`font-mono text-xs px-2 py-1 rounded border transition-colors cursor-pointer ${
            autoFollow
              ? "text-accent border-accent/40 bg-accent-subtle/20"
              : "text-text-dim border-border hover:border-border-hover"
          }`}
          title="Auto-follow: select latest commit as agent works"
        >
          {autoFollow ? "following" : "paused"}
        </button>

        {/* View mode toggle */}
        <button
          type="button"
          onClick={toggleViewMode}
          className="font-mono text-xs text-text-muted px-2 py-1 rounded border border-border hover:border-border-hover transition-colors cursor-pointer"
          title={`Diff view: ${viewMode}`}
        >
          {viewMode}
        </button>
      </div>
    </header>
  );
}
