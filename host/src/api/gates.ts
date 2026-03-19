/**
 * Gates API - typed wrapper around os gate commands
 */
import { callCli } from "../cli.js";
import {
  decodeGate,
  decodeGates,
  decodeGateOutput,
  decodeGateResult,
  decodeGateStatusReport,
  decodeUnsatisfiedGates,
} from "../decoder.js";
import type {
  Gate,
  GateResult,
  GateStatusReport,
  UnsatisfiedGate,
  CreateGateInput,
} from "../types.js";

/**
 * Gates API exposed to VM sandbox
 */
export const gates = {
  /**
   * Add a gate definition.
   * Omit taskId for project-level gates.
   */
  async add(input: CreateGateInput): Promise<Gate> {
    const args = ["gate", "add", "--name", input.name, "--type", input.type];
    if (input.taskId) args.push("--task", input.taskId);
    if (input.config) args.push("--config", JSON.stringify(input.config));
    if (input.required !== undefined) args.push("--required", String(input.required));
    if (input.depthFilter !== undefined) args.push("--depth", String(input.depthFilter));
    if (input.ordering !== undefined) args.push("--order", String(input.ordering));
    if (input.description) args.push("--description", input.description);
    return decodeGate(await callCli(args)).unwrap("gates.add");
  },

  /**
   * List gate definitions.
   * If taskId provided, list gates for that task.
   * If project=true, list only project-level gates.
   */
  async list(taskId?: string): Promise<Gate[]> {
    const args = ["gate", "list"];
    if (taskId) args.push("--task", taskId);
    return decodeGates(await callCli(args)).unwrap("gates.list");
  },

  /**
   * Delete a gate definition.
   */
  async delete(id: string): Promise<void> {
    await callCli(["gate", "delete", id]);
  },

  /**
   * Run all applicable gates for a task.
   * Shell gates execute synchronously. Manual gates are skipped (use pass/fail).
   * Returns full status report after execution.
   */
  async run(taskId: string, gateId?: string): Promise<GateStatusReport> {
    const args = ["gate", "run", taskId];
    if (gateId) args.push("--gate", gateId);
    return decodeGateStatusReport(await callCli(args)).unwrap("gates.run");
  },

  /**
   * Get gate status for a task.
   * Returns per-gate status entries and overall canComplete flag.
   */
  async status(taskId: string): Promise<GateStatusReport> {
    return decodeGateStatusReport(await callCli(["gate", "status", taskId])).unwrap("gates.status");
  },

  /**
   * Get stored output for a specific gate result.
   */
  async output(taskId: string, gateId: string): Promise<string | null> {
    return decodeGateOutput(await callCli(["gate", "output", taskId, gateId])).unwrap("gates.output");
  },

  /**
   * Pass a manual gate with optional output.
   * Only works for manual gates. Records approval.
   */
  async pass(taskId: string, gateId: string, output?: string): Promise<GateResult> {
    const args = ["gate", "pass", taskId, gateId];
    if (output) args.push("--output", output);
    return decodeGateResult(await callCli(args)).unwrap("gates.pass");
  },

  /**
   * Fail a manual gate with optional output.
   * Only works for manual gates. Records rejection.
   */
  async fail(taskId: string, gateId: string, output?: string): Promise<GateResult> {
    const args = ["gate", "fail", taskId, gateId];
    if (output) args.push("--output", output);
    return decodeGateResult(await callCli(args)).unwrap("gates.fail");
  },

  /**
   * Pre-flight check: would complete() succeed?
   * Returns list of unsatisfied gates. Empty = can complete.
   */
  async check(taskId: string): Promise<UnsatisfiedGate[]> {
    return decodeUnsatisfiedGates(await callCli(["gate", "check", taskId])).unwrap("gates.check");
  },
};
