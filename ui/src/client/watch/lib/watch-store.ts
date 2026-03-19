import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VcsType } from "./watch-types.js";

export type DiffViewMode = "split" | "stacked";

interface WatchState {
  workspacePath: string | null;
  selectedRev: string | null;
  autoFollow: boolean;
  viewMode: DiffViewMode;
  prevWorkingCopyId: string | null;
  projectRoot: string | null;
  workspaceDir: string | null;
  vcsOverride: VcsType | null;
  /** Persisted map: projectRoot → workspaceDir */
  workspaceDirs: Record<string, string>;
}

interface WatchActions {
  setWorkspacePath: (path: string | null) => void;
  setSelectedRev: (rev: string | null) => void;
  setAutoFollow: (on: boolean) => void;
  toggleAutoFollow: () => void;
  setViewMode: (mode: DiffViewMode) => void;
  toggleViewMode: () => void;
  setPrevWorkingCopyId: (id: string | null) => void;
  setProjectRoot: (root: string | null, workspaceDir?: string | null) => void;
  setVcsOverride: (vcs: VcsType | null) => void;
  cycleVcsOverride: () => void;
  /** Save workspaceDir for a project (persists to localStorage) */
  saveWorkspaceDir: (projectRoot: string, dir: string) => void;
}

export type WatchStore = WatchState & WatchActions;

export const useWatchStore = create<WatchStore>()(
  persist(
    (set, get) => ({
      workspacePath: null,
      selectedRev: null,
      autoFollow: true,
      viewMode: "stacked",
      prevWorkingCopyId: null,
      projectRoot: null,
      workspaceDir: null,
      vcsOverride: null,
      workspaceDirs: {},

      setWorkspacePath: (path) => set({ workspacePath: path, selectedRev: null, prevWorkingCopyId: null }),
      setSelectedRev: (rev) => set({ selectedRev: rev }),
      setAutoFollow: (on) => set({ autoFollow: on }),
      toggleAutoFollow: () => set((s) => ({ autoFollow: !s.autoFollow })),
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === "split" ? "stacked" : "split" })),
      setPrevWorkingCopyId: (id) => set({ prevWorkingCopyId: id }),
      setProjectRoot: (root, workspaceDir) => {
        // Resolve workspaceDir: explicit arg > persisted map > null
        const resolved = workspaceDir ?? (root ? get().workspaceDirs[root] : null) ?? null;
        set({ projectRoot: root, workspaceDir: resolved, workspacePath: null, selectedRev: null, prevWorkingCopyId: null });
      },
      setVcsOverride: (vcs) => set({ vcsOverride: vcs }),
      cycleVcsOverride: () => set((s) => {
        if (s.vcsOverride === null) return { vcsOverride: "jj" };
        if (s.vcsOverride === "jj") return { vcsOverride: "git" };
        return { vcsOverride: null };
      }),
      saveWorkspaceDir: (projectRoot, dir) => set((s) => ({
        workspaceDir: s.projectRoot === projectRoot ? dir : s.workspaceDir,
        workspaceDirs: { ...s.workspaceDirs, [projectRoot]: dir },
      })),
    }),
    {
      name: "overseer-watch",
      partialize: (state) => ({
        workspaceDirs: state.workspaceDirs,
      }),
    }
  )
);

export const useSelectedRev = () => useWatchStore((s) => s.selectedRev);
export const useAutoFollow = () => useWatchStore((s) => s.autoFollow);
export const useViewMode = () => useWatchStore((s) => s.viewMode);
