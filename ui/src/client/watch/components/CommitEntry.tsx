import type { LogEntry } from "../lib/watch-types.js";

function relativeTime(timestamp: string): string {
  try {
    // JJ timestamps: "2026-03-19 09:43:01.000 -05:00"
    const date = new Date(timestamp.replace(" ", "T").replace(" ", ""));
    const diff = Date.now() - date.getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  } catch {
    return "";
  }
}

interface CommitEntryProps {
  entry: LogEntry;
  selected: boolean;
  onClick: () => void;
}

export function CommitEntry({ entry, selected, onClick }: CommitEntryProps) {
  const isWc = entry.workingCopies !== "";
  const isEmpty = entry.empty;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 flex items-start gap-2 border-l-2 transition-colors cursor-pointer ${
        selected
          ? "border-accent bg-accent-subtle/20"
          : "border-transparent hover:bg-surface-secondary"
      } ${isEmpty ? "opacity-40" : ""}`}
    >
      {/* Status dot */}
      <span
        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
          selected
            ? "bg-accent"
            : isWc
              ? "bg-status-active/50"
              : "bg-border"
        }`}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          {/* Change ID */}
          <span className="font-mono text-xs text-accent shrink-0">
            {entry.id.slice(0, 8)}
          </span>
          {/* Timestamp */}
          <span className="font-mono text-xs text-text-dim ml-auto shrink-0">
            {relativeTime(entry.timestamp)}
          </span>
        </div>
        {/* Description */}
        <p className="font-mono text-xs text-text-muted truncate mt-0.5">
          {entry.description || (isEmpty ? "(empty)" : "(no description)")}
        </p>
      </div>
    </button>
  );
}
