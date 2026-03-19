import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Task,
  TaskWithContext,
  UpdateTaskRequest,
  CompleteTaskRequest,
  Learning,
  TaskFilter,
  ApiError,
  GateStatusReport,
  Review,
} from "../../types.js";

/** Default refetch interval (5 seconds) */
const REFETCH_INTERVAL = 5000;

/** Base URL for API calls */
const API_BASE = "";

/** Type guard for API error responses */
function isApiError(err: unknown): err is ApiError {
  return (
    err !== null &&
    typeof err === "object" &&
    "error" in err &&
    typeof (err as Record<string, unknown>)["error"] === "string"
  );
}

/** Extract error message from response or unknown error */
function getErrorMessage(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.error;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

/** Query keys for cache management */
export const queryKeys = {
  tasks: {
    all: ["tasks"] as const,
    list: (filter?: TaskFilter) => ["tasks", "list", filter] as const,
    detail: (id: string) => ["tasks", "detail", id] as const,
    nextReady: (milestoneId?: string) => ["tasks", "next-ready", milestoneId] as const,
  },
  learnings: {
    byTask: (taskId: string) => ["learnings", taskId] as const,
  },
  gates: {
    status: (taskId: string) => ["gates", "status", taskId] as const,
  },
  reviews: {
    byTask: (taskId: string) => ["reviews", taskId] as const,
    active: (taskId: string) => ["reviews", "active", taskId] as const,
  },
} as const;

/**
 * Fetch all tasks with optional filters
 */
export function useTasks(filter?: TaskFilter) {
  return useQuery({
    queryKey: queryKeys.tasks.list(filter),
    queryFn: async (): Promise<Task[]> => {
      const params = new URLSearchParams();
      if (filter?.parentId) params.set("parentId", filter.parentId);
      if (filter?.ready !== undefined) params.set("ready", String(filter.ready));
      if (filter?.completed !== undefined) params.set("completed", String(filter.completed));
      if (filter?.includeArchived !== undefined) params.set("includeArchived", String(filter.includeArchived));

      const url = `${API_BASE}/api/tasks${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch tasks"));
      }

      return res.json() as Promise<Task[]>;
    },
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Fetch single task with full context
 */
export function useTask(id: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(id ?? ""),
    queryFn: async (): Promise<TaskWithContext | null> => {
      if (!id) return null;

      const res = await fetch(`${API_BASE}/api/tasks/${id}`);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch task"));
      }

      return res.json() as Promise<TaskWithContext>;
    },
    enabled: !!id,
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Fetch next ready task
 */
export function useNextReadyTask(milestoneId?: string) {
  return useQuery({
    queryKey: queryKeys.tasks.nextReady(milestoneId),
    queryFn: async (): Promise<TaskWithContext | null> => {
      const params = milestoneId ? `?milestoneId=${milestoneId}` : "";
      const res = await fetch(`${API_BASE}/api/tasks/next-ready${params}`);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch next ready task"));
      }

      return res.json() as Promise<TaskWithContext | null>;
    },
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Update task mutation
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTaskRequest }): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to update task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: (_data: Task, { id }: { id: string; data: UpdateTaskRequest }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
    },
  });
}

/**
 * Complete task mutation
 */
export function useCompleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data?: CompleteTaskRequest }): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data ?? {}),
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to complete task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/**
 * Reopen task mutation
 */
export function useReopenTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}/reopen`, {
        method: "POST",
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to reopen task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: (_data: Task, id: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
    },
  });
}

/**
 * Cancel task mutation (abandon incomplete task)
 */
export function useCancelTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}/cancel`, {
        method: "POST",
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to cancel task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: (_data: Task, id: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
    },
  });
}

/**
 * Archive task mutation (soft delete completed/cancelled task)
 */
export function useArchiveTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}/archive`, {
        method: "POST",
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to archive task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: (_data: Task, id: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
    },
  });
}

/**
 * Delete task mutation
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<{ deleted: boolean }> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to delete task"));
      }

      return res.json() as Promise<{ deleted: boolean }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/**
 * Fetch learnings for a task
 */
export function useLearnings(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.learnings.byTask(taskId ?? ""),
    queryFn: async (): Promise<Learning[]> => {
      if (!taskId) return [];

      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/learnings`);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch learnings"));
      }

      return res.json() as Promise<Learning[]>;
    },
    enabled: !!taskId,
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Fetch gate status report for a task.
 * Returns per-gate status entries and overall canComplete flag.
 * Silently returns null on error (gates may not be configured).
 */
export function useGateStatus(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.gates.status(taskId ?? ""),
    queryFn: async (): Promise<GateStatusReport | null> => {
      if (!taskId) return null;

      const res = await fetch(`${API_BASE}/api/gates/status/${taskId}`);

      if (!res.ok) {
        // Gates may not exist for this task - return null instead of throwing
        return null;
      }

      return res.json() as Promise<GateStatusReport>;
    },
    enabled: !!taskId,
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Fetch the active review for a task (if any).
 * Returns null if no active review exists.
 */
export function useActiveReview(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.reviews.active(taskId ?? ""),
    queryFn: async (): Promise<Review | null> => {
      if (!taskId) return null;

      const res = await fetch(`${API_BASE}/api/gates/reviews/${taskId}/active`);

      if (!res.ok) {
        return null;
      }

      return res.json() as Promise<Review | null>;
    },
    enabled: !!taskId,
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Fetch all reviews for a task.
 */
export function useReviews(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.reviews.byTask(taskId ?? ""),
    queryFn: async (): Promise<Review[]> => {
      if (!taskId) return [];

      const res = await fetch(`${API_BASE}/api/gates/reviews/${taskId}`);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch reviews"));
      }

      return res.json() as Promise<Review[]>;
    },
    enabled: !!taskId,
    refetchInterval: REFETCH_INTERVAL,
  });
}
