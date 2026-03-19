import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  WorkspaceInfo,
  LogResponse,
  DiffResponse,
  DetectResponse,
  ProjectInfo,
  VcsType,
} from "./watch-types.js";

const LOG_POLL_INTERVAL = 2000;

export const watchKeys = {
  projects: ["watch", "projects"] as const,
  workspaces: (root?: string, workspaceDir?: string) => ["watch", "workspaces", root ?? "", workspaceDir ?? ""] as const,
  detect: (path: string) => ["watch", "detect", path] as const,
  log: (path: string, limit: number, vcs: VcsType | null) => ["watch", "log", path, limit, vcs ?? "auto"] as const,
  diff: (path: string, rev: string, vcs: VcsType | null) => ["watch", "diff", path, rev, vcs ?? "auto"] as const,
} as const;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${res.status}`
    );
  }
  return res.json() as Promise<T>;
}

export function useProjects() {
  return useQuery({
    queryKey: watchKeys.projects,
    queryFn: () => fetchJson<ProjectInfo[]>("/api/watch/projects"),
  });
}

export function useWorkspaces(root?: string, workspaceDir?: string) {
  const params = new URLSearchParams();
  if (root) params.set("root", root);
  if (workspaceDir) params.set("workspaceDir", workspaceDir);
  const qs = params.toString();
  return useQuery({
    queryKey: watchKeys.workspaces(root, workspaceDir),
    queryFn: () => fetchJson<WorkspaceInfo[]>(`/api/watch/workspaces${qs ? `?${qs}` : ""}`),
    enabled: !!root,
  });
}

export function useOpenEditor() {
  return useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch("/api/watch/open-editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
  });
}

export function useSetWorkspaceDir() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectPath,
      workspaceDir,
    }: {
      projectPath: string;
      workspaceDir: string;
    }) => {
      const res = await fetch("/api/watch/projects/workspace-dir", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, workspaceDir }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      // Invalidate both projects (workspaceCount changes) and workspaces
      queryClient.invalidateQueries({ queryKey: ["watch", "projects"] });
      queryClient.invalidateQueries({ queryKey: ["watch", "workspaces"] });
    },
  });
}

export function useWatchDetect(path: string | null) {
  return useQuery({
    queryKey: watchKeys.detect(path ?? ""),
    queryFn: () =>
      fetchJson<DetectResponse>(
        `/api/watch/detect?path=${encodeURIComponent(path!)}`
      ),
    enabled: !!path,
  });
}

export function useWatchLog(path: string | null, limit = 50, vcsOverride: VcsType | null = null) {
  const vcsParam = vcsOverride ? `&vcs=${encodeURIComponent(vcsOverride)}` : "";
  return useQuery({
    queryKey: watchKeys.log(path ?? "", limit, vcsOverride),
    queryFn: () =>
      fetchJson<LogResponse>(
        `/api/watch/log?path=${encodeURIComponent(path!)}&limit=${limit}${vcsParam}`
      ),
    enabled: !!path,
    refetchInterval: LOG_POLL_INTERVAL,
  });
}

export function useWatchDiff(path: string | null, rev: string | null, vcsOverride: VcsType | null = null) {
  const vcsParam = vcsOverride ? `&vcs=${encodeURIComponent(vcsOverride)}` : "";
  return useQuery({
    queryKey: watchKeys.diff(path ?? "", rev ?? "", vcsOverride),
    queryFn: () =>
      fetchJson<DiffResponse>(
        `/api/watch/diff?path=${encodeURIComponent(path!)}&rev=${encodeURIComponent(rev!)}${vcsParam}`
      ),
    enabled: !!path && !!rev,
  });
}
