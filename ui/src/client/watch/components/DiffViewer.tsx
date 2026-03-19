import { useMemo } from "react";
import { useWatchDiff } from "../lib/watch-queries.js";
import { useWatchStore } from "../lib/watch-store.js";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { FileList } from "./FileList.js";

export function DiffViewer({ path }: { path: string }) {
  const selectedRev = useWatchStore((s) => s.selectedRev);
  const viewMode = useWatchStore((s) => s.viewMode);
  const vcsOverride = useWatchStore((s) => s.vcsOverride);
  const { data, isLoading, error } = useWatchDiff(path, selectedRev, vcsOverride);

  const fileDiffs = useMemo(() => {
    if (!data?.patch) return [];
    const patches = parsePatchFiles(data.patch);
    return patches.flatMap((p) => p.files);
  }, [data?.patch]);

  if (!selectedRev) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-mono text-sm text-text-dim">
          Select a commit to view diff
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-mono text-sm text-text-dim">Loading diff...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-mono text-sm text-status-blocked">
          {error.message}
        </p>
      </div>
    );
  }

  if (!data?.patch || fileDiffs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-mono text-sm text-text-dim">Empty diff</p>
      </div>
    );
  }

  const diffOptions = {
    theme: "github-dark" as const,
    diffStyle: (viewMode === "split" ? "split" : "unified") as "split" | "unified",
    diffIndicators: "bars" as const,
    overflow: "scroll" as const,
    lineDiffType: "word" as const,
    expandUnchanged: true,
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <FileList files={data.files} truncated={data.truncated} workspacePath={path} />
      <div className="flex-1 overflow-auto">
        {fileDiffs.map((fileDiff, i) => (
          <FileDiff
            key={`${fileDiff.name ?? fileDiff.prevName ?? i}`}
            fileDiff={fileDiff}
            options={diffOptions}
          />
        ))}
      </div>
    </div>
  );
}
