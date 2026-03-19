/**
 * Gate & Review API routes
 *
 * Exposes gate status and review data to the React UI.
 * Read-only endpoints for display (mutations stay in CLI/MCP).
 */
import { Hono, type Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { callCli } from "../cli.js";
import {
  decodeGateStatusReport,
  decodeReviews,
  decodeReviewOrNull,
} from "../../decoder.js";
import { CliError, isTaskId, type ApiError } from "../../types.js";

/**
 * Handle CLI errors and return appropriate HTTP status
 */
function handleCliError(
  c: Context,
  err: unknown
): Response & { _data: ApiError; _status: StatusCode } {
  if (err instanceof CliError) {
    const message = err.message.toLowerCase();
    if (message.includes("not found") || message.includes("no task") || message.includes("no review")) {
      return c.json({ error: err.message }, 404);
    }
    if (
      message.includes("invalid") ||
      message.includes("validation")
    ) {
      return c.json({ error: err.message }, 400);
    }
    return c.json({ error: err.message }, 500);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
}

const gates = new Hono()
  /**
   * GET /api/gates/status/:taskId
   * Get gate status report for a task.
   * Returns per-gate status entries and overall canComplete flag.
   */
  .get("/status/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    if (!isTaskId(taskId)) {
      return c.json({ error: `Invalid task ID: ${taskId}` }, 400);
    }

    try {
      const result = decodeGateStatusReport(
        await callCli(["gate", "status", taskId])
      ).unwrap("GET /api/gates/status/:taskId");
      return c.json(result);
    } catch (err) {
      return handleCliError(c, err);
    }
  })

  /**
   * GET /api/gates/reviews/:taskId
   * List all reviews for a task.
   */
  .get("/reviews/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    if (!isTaskId(taskId)) {
      return c.json({ error: `Invalid task ID: ${taskId}` }, 400);
    }

    try {
      const result = decodeReviews(
        await callCli(["review", "list", "--task", taskId])
      ).unwrap("GET /api/gates/reviews/:taskId");
      return c.json(result);
    } catch (err) {
      return handleCliError(c, err);
    }
  })

  /**
   * GET /api/gates/reviews/:taskId/active
   * Get the active review for a task (if any).
   * Returns null (204) if no active review.
   */
  .get("/reviews/:taskId/active", async (c) => {
    const taskId = c.req.param("taskId");
    if (!isTaskId(taskId)) {
      return c.json({ error: `Invalid task ID: ${taskId}` }, 400);
    }

    try {
      const result = decodeReviewOrNull(
        await callCli(["review", "active", taskId])
      ).unwrap("GET /api/gates/reviews/:taskId/active");
      if (result === null) {
        return c.json(null, 200);
      }
      return c.json(result);
    } catch (err) {
      // "no active review" is expected - return null
      if (err instanceof CliError && err.message.toLowerCase().includes("no active review")) {
        return c.json(null, 200);
      }
      return handleCliError(c, err);
    }
  });

export { gates };
