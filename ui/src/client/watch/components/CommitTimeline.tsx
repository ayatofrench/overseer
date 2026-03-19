import { useEffect, useRef } from "react";
import { useWatchLog } from "../lib/watch-queries.js";
import { useWatchStore } from "../lib/watch-store.js";
import { CommitEntry } from "./CommitEntry.js";

export function CommitTimeline({ path }: { path: string }) {
  const vcsOverride = useWatchStore((s) => s.vcsOverride);
  const { data, isLoading, error } = useWatchLog(path, 50, vcsOverride);
  const selectedRev = useWatchStore((s) => s.selectedRev);
  const setSelectedRev = useWatchStore((s) => s.setSelectedRev);
  const autoFollow = useWatchStore((s) => s.autoFollow);
  const prevWorkingCopyId = useWatchStore((s) => s.prevWorkingCopyId);
  const setPrevWorkingCopyId = useWatchStore((s) => s.setPrevWorkingCopyId);
  const listRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  // Auto-follow: seed prevWorkingCopyId on first load (no selection),
  // then select on subsequent WC changes.
  useEffect(() => {
    if (!data) return;
    const wcId = data.workingCopyId;
    if (!wcId) return;

    if (!seededRef.current) {
      // First data load — remember WC id but don't auto-select
      seededRef.current = true;
      setPrevWorkingCopyId(wcId);
      return;
    }

    if (autoFollow && wcId !== prevWorkingCopyId) {
      setPrevWorkingCopyId(wcId);
      setSelectedRev(wcId);
    }
  }, [data, autoFollow, prevWorkingCopyId, setPrevWorkingCopyId, setSelectedRev]);

  return (
    <div className="flex flex-col h-full border-r-2 border-border w-72 shrink-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="font-mono text-xs text-text-muted uppercase tracking-wider">
          Commits
        </span>
        {data && (
          <span className="font-mono text-xs text-text-dim">
            {data.entries.length}
          </span>
        )}
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="p-4 font-mono text-xs text-text-dim">Loading...</p>
        )}
        {error && (
          <p className="p-4 font-mono text-xs text-status-blocked">
            {error.message}
          </p>
        )}
        {data?.entries.map((entry) => (
          <CommitEntry
            key={entry.commitId}
            entry={entry}
            selected={selectedRev === entry.id}
            onClick={() => setSelectedRev(entry.id)}
          />
        ))}
        {data && data.entries.length === 0 && (
          <p className="p-4 font-mono text-xs text-text-dim">
            No commits yet.
          </p>
        )}
      </div>
    </div>
  );
}
