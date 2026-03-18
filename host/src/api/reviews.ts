/**
 * Reviews API - typed wrapper around os review commands
 */
import { callCli } from "../cli.js";
import {
  decodeReview,
  decodeReviews,
  decodeReviewOrNull,
} from "../decoder.js";
import type { Review } from "../types.js";

/**
 * Reviews API exposed to VM sandbox
 */
export const reviews = {
  /**
   * Submit a task for review (creates review in GatesPending).
   * Task must be in-progress with no active review.
   */
  async submit(taskId: string): Promise<Review> {
    return decodeReview(await callCli(["review", "submit", taskId])).unwrap("reviews.submit");
  },

  /**
   * Get a review by ID.
   */
  async get(reviewId: string): Promise<Review> {
    return decodeReview(await callCli(["review", "get", reviewId])).unwrap("reviews.get");
  },

  /**
   * Get the active review for a task (or null if none).
   */
  async active(taskId: string): Promise<Review | null> {
    return decodeReviewOrNull(await callCli(["review", "active", taskId])).unwrap("reviews.active");
  },

  /**
   * List reviews with optional filters.
   */
  async list(filter?: { taskId?: string; status?: string }): Promise<Review[]> {
    const args = ["review", "list"];
    if (filter?.taskId) args.push("--task", filter.taskId);
    if (filter?.status) args.push("--status", filter.status);
    return decodeReviews(await callCli(args)).unwrap("reviews.list");
  },

  /**
   * Approve gates phase (GatesPending -> AgentPending).
   */
  async approveGates(reviewId: string): Promise<Review> {
    return decodeReview(await callCli(["review", "approve-gates", reviewId])).unwrap("reviews.approveGates");
  },

  /**
   * Approve agent phase (AgentPending -> HumanPending).
   */
  async approveAgent(reviewId: string): Promise<Review> {
    return decodeReview(await callCli(["review", "approve-agent", reviewId])).unwrap("reviews.approveAgent");
  },

  /**
   * Approve human phase (HumanPending -> Approved).
   * Bridges to gates: passes all manual gates for the task.
   */
  async approveHuman(reviewId: string): Promise<Review> {
    return decodeReview(await callCli(["review", "approve-human", reviewId])).unwrap("reviews.approveHuman");
  },

  /**
   * Request changes (any active -> ChangesRequested).
   * Bridges to gates: fails all manual gates for the task.
   */
  async requestChanges(reviewId: string): Promise<Review> {
    return decodeReview(await callCli(["review", "request-changes", reviewId])).unwrap("reviews.requestChanges");
  },
};
