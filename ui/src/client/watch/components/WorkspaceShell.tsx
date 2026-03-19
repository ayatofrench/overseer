import { useEffect } from "react";
import { WatchHeader } from "./WatchHeader.js";
import { CommitTimeline } from "./CommitTimeline.js";
import { DiffViewer } from "./DiffViewer.js";
import { useWatchLog } from "../lib/watch-queries.js";
import { useWatchStore } from "../lib/watch-store.js";

function useWatchKeyboard(path: string) {
  const vcsOverride = useWatchStore((s) => s.vcsOverride);
  const { data } = useWatchLog(path, 50, vcsOverride);
  const selectedRev = useWatchStore((s) => s.selectedRev);
  const setSelectedRev = useWatchStore((s) => s.setSelectedRev);
  const toggleViewMode = useWatchStore((s) => s.toggleViewMode);
  const toggleAutoFollow = useWatchStore((s) => s.toggleAutoFollow);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const entries = data?.entries;
      if (!entries?.length) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const idx = entries.findIndex((e) => e.id === selectedRev);
        const next = entries[idx + 1];
        if (next) setSelectedRev(next.id);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const idx = entries.findIndex((e) => e.id === selectedRev);
        const prev = entries[idx - 1];
        if (prev) setSelectedRev(prev.id);
      } else if (e.key === "s") {
        toggleViewMode();
      } else if (e.key === "f") {
        toggleAutoFollow();
      } else if (e.key === "Escape") {
        setSelectedRev(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data, selectedRev, setSelectedRev, toggleViewMode, toggleAutoFollow]);
}

export function WorkspaceShell({ path }: { path: string }) {
  useWatchKeyboard(path);

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      <WatchHeader path={path} />
      <div className="flex flex-1 min-h-0">
        <CommitTimeline path={path} />
        <DiffViewer path={path} />
      </div>
    </div>
  );
}
