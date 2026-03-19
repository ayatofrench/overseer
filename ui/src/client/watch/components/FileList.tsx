import type { DiffFile } from "../lib/watch-types.js";
import { useOpenEditor } from "../lib/watch-queries.js";

const changeColors: Record<string, string> = {
  A: "text-status-done border-status-done/30 bg-status-done/10",
  M: "text-accent border-accent/30 bg-accent-subtle/10",
  D: "text-status-blocked border-status-blocked/30 bg-status-blocked/10",
  R: "text-status-cancelled border-status-cancelled/30 bg-status-cancelled/10",
};

export function FileList({
  files,
  truncated,
  workspacePath,
}: {
  files: DiffFile[];
  truncated: boolean;
  workspacePath?: string;
}) {
  const openEditor = useOpenEditor();

  if (files.length === 0 && !truncated) return null;

  const handleFileClick = (filePath: string) => {
    if (!workspacePath) return;
    const fullPath = `${workspacePath}/${filePath}`;
    openEditor.mutate(fullPath);
  };

  return (
    <div className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2 shrink-0">
      <span className="font-mono text-xs text-text-dim">
        {files.length} file{files.length !== 1 ? "s" : ""}
      </span>
      {files.map((f) => (
        <button
          key={f.path}
          type="button"
          onClick={() => handleFileClick(f.path)}
          className={`font-mono text-xs px-1.5 py-0.5 rounded border cursor-pointer hover:opacity-80 transition-opacity ${changeColors[f.changeType] ?? "text-text-muted border-border"}`}
          title={workspacePath ? `Open ${f.path} in editor` : f.path}
        >
          {f.changeType} {f.path.split("/").pop()}
        </button>
      ))}
      {truncated && (
        <span className="font-mono text-xs text-status-blocked">
          (truncated)
        </span>
      )}
    </div>
  );
}
