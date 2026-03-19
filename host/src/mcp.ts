/**
 * MCP Server - registers execute tool with type definitions
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execute, ExecutionError } from "./executor.js";
import { CliError, CliTimeoutError } from "./types.js";

const TOOL_DESCRIPTION = `
Execute JavaScript code to interact with Overseer task management.

Available APIs in sandbox:

\`\`\`typescript
interface Task {
  id: string;
  parentId: string | null;
  description: string;
  priority: 0 | 1 | 2;
  completed: boolean;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;            // ISO 8601
  updatedAt: string;
  result: string | null;        // Completion notes
  commitSha: string | null;     // Auto-populated on complete
  depth: 0 | 1 | 2;             // 0=milestone, 1=task, 2=subtask
  blockedBy?: string[];          // Omitted if empty
  blocks?: string[];             // Omitted if empty
  bookmark?: string;            // VCS bookmark name (if started)
  startCommit?: string;         // Commit SHA at start
  effectivelyBlocked: boolean;  // True if task OR ancestor has incomplete blockers
  metadata?: Record<string, unknown>;  // Arbitrary JSON metadata
  cancelled: boolean;           // Task was cancelled (does NOT satisfy blockers)
  cancelledAt: string | null;
  archived: boolean;            // Task is archived (hidden from default list)
  archivedAt: string | null;
}

interface TaskWithContext extends Task {
  context: { own: string; parent?: string; milestone?: string };
  learnings: { own: Learning[]; parent: Learning[]; milestone: Learning[] };
}

interface Learning {
  id: string;
  taskId: string;
  content: string;
  sourceTaskId: string | null;
  createdAt: string;
}

interface TaskTree {
  task: Task;
  children: TaskTree[];
}

interface TaskProgress {
  total: number;
  completed: number;
  ready: number;     // !completed && !effectivelyBlocked
  blocked: number;   // !completed && effectivelyBlocked
}

type TaskType = "milestone" | "task" | "subtask";

// Tasks API
// Note: VCS (jj or git) is REQUIRED for start/complete. CRUD ops work without VCS.
declare const tasks: {
  list(filter?: { parentId?: string; ready?: boolean; completed?: boolean; depth?: 0 | 1 | 2; type?: TaskType; archived?: boolean | "all" }): Promise<Task[]>;
  get(id: string): Promise<TaskWithContext>;
  create(input: {
    description: string;
    context?: string;
    parentId?: string;
    priority?: 0 | 1 | 2;
    blockedBy?: string[];
  }): Promise<Task>;
  update(id: string, input: {
    description?: string;
    context?: string;
    priority?: 0 | 1 | 2;
    parentId?: string;
  }): Promise<Task>;
  start(id: string, options?: { bookmark?: string; workspace?: string }): Promise<Task>;  // VCS required: creates bookmark, records start commit. workspace creates isolated jj workspace / git worktree.
  complete(id: string, options?: { result?: string; learnings?: string[] }): Promise<Task>;  // VCS required: commits changes (NothingToCommit = success)
  reopen(id: string): Promise<Task>;
  cancel(id: string): Promise<Task>;  // Cancel task (does NOT satisfy blockers)
  archive(id: string): Promise<Task>;  // Archive completed/cancelled task (hides from default list)
  delete(id: string): Promise<void>;  // Best-effort VCS bookmark cleanup
  block(taskId: string, blockerId: string): Promise<void>;
  unblock(taskId: string, blockerId: string): Promise<void>;
  nextReady(milestoneId?: string): Promise<TaskWithContext | null>;
  tree(rootId?: string): Promise<TaskTree | TaskTree[]>;  // Returns single tree if rootId, array of all milestone trees if not
  search(query: string): Promise<Task[]>;  // Search by description/context/result (case-insensitive)
  progress(rootId?: string): Promise<TaskProgress>;  // Aggregate counts for milestone or all tasks
  getMetadata(id: string): Promise<Record<string, unknown> | null>;  // Get task metadata
  setMetadata(id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null>;  // Set (upsert) task metadata
  deleteMetadata(id: string): Promise<void>;  // Delete task metadata
};

// Learnings API (learnings are added via tasks.complete)
declare const learnings: {
  list(taskId: string): Promise<Learning[]>;
};

// Gates API (quality gates: shell, metadata, manual)
interface Gate {
  id: string;
  taskId: string | null;
  name: string;
  description: string;
  gateType: "shell" | "metadata" | "manual";
  config: Record<string, unknown>;
  command?: string;
  timeoutSecs?: number;
  maxRetries: number;
  required: boolean;
  appliesTo: string;
  depthFilter: number | null;
  ordering: number;
  createdAt: string;
}

interface GateResult {
  gateId: string;
  taskId: string;
  status: "pending" | "running" | "pass" | "fail" | "error" | "skip";
  output: string | null;
  exitCode: number | null;
  startedAt: string;
  completedAt: string | null;
  commitSha: string | null;
  reviewId?: string;
  attempt: number;
}

interface GateStatusEntry {
  gate: Gate;
  result: GateResult | null;
  satisfied: boolean;
  verifiedBy: "overseer" | "external";
}

interface GateStatusReport {
  taskId: string;
  running: boolean;
  gates: GateStatusEntry[];
  canComplete: boolean;
}

interface UnsatisfiedGate {
  gate: Gate;
  result: GateResult | null;
  reason: string;
}

// Reviews API (3-phase review pipeline: gates -> agent -> human)
interface Review {
  id: string;
  taskId: string;
  status: "gates_pending" | "agent_pending" | "human_pending" | "approved" | "changes_requested";
  submittedAt: string;
  gatesCompletedAt: string | null;
  agentCompletedAt: string | null;
  humanCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

declare const reviews: {
  submit(taskId: string): Promise<Review>;                    // Submit for review (GatesPending)
  get(reviewId: string): Promise<Review>;
  active(taskId: string): Promise<Review | null>;             // Get active review for task
  list(filter?: { taskId?: string; status?: string }): Promise<Review[]>;
  approveGates(reviewId: string): Promise<Review>;            // GatesPending -> AgentPending
  approveAgent(reviewId: string): Promise<Review>;            // AgentPending -> HumanPending
  approveHuman(reviewId: string): Promise<Review>;            // HumanPending -> Approved (bridges to gates.pass on manual gates)
  requestChanges(reviewId: string): Promise<Review>;          // Active -> ChangesRequested (bridges to gates.fail on manual gates)
};

declare const gates: {
  add(input: {
    name: string;
    type: "shell" | "metadata" | "manual";
    taskId?: string;          // omit for project-level
    config?: Record<string, unknown>;
    command?: string;
    timeoutSecs?: number;
    maxRetries?: number;
    required?: boolean;       // default: true
    depthFilter?: 0 | 1 | 2;
    ordering?: number;
    description?: string;
  }): Promise<Gate>;
  list(taskId?: string): Promise<Gate[]>;
  delete(id: string): Promise<void>;
  run(taskId: string, gateId?: string): Promise<GateStatusReport>;   // Runs shell gates synchronously. Manual gates skipped (use pass/fail).
  status(taskId: string): Promise<GateStatusReport>;                  // Get per-gate status + canComplete
  output(taskId: string, gateId: string): Promise<string | null>;     // Get stored gate output
  pass(taskId: string, gateId: string, output?: string): Promise<GateResult>;   // Pass manual gate
  fail(taskId: string, gateId: string, output?: string): Promise<GateResult>;   // Fail manual gate
  check(taskId: string): Promise<UnsatisfiedGate[]>;                  // Pre-flight: empty = can complete
};
\`\`\`

**VCS Requirement:** \`start\` and \`complete\` require jj or git. Fails with NotARepository error if none found. CRUD operations work without VCS.

Examples:

\`\`\`javascript
// List all ready tasks
return await tasks.list({ ready: true });

// List only milestones (two equivalent ways)
return await tasks.list({ depth: 0 });
return await tasks.list({ type: "milestone" });

// Get progress summary
return await tasks.progress(milestoneId);

// Search tasks
return await tasks.search("authentication");

// Get task tree
return await tasks.tree(milestoneId);

// Create milestone with subtask
const milestone = await tasks.create({
  description: "Build authentication system",
  context: "JWT-based auth with refresh tokens",
  priority: 1
});

const subtask = await tasks.create({
  description: "Implement token refresh logic",
  parentId: milestone.id,
  context: "Handle 7-day expiry",
  priority: 2
});

// Start working on task (VCS required - creates bookmark, records start commit)
await tasks.start(subtask.id);

// Get task with full context
const task = await tasks.get(subtask.id);
console.log(task.context.milestone); // inherited from root

// Complete task (VCS required - commits changes)
await tasks.complete(task.id, { result: "Implemented using jose library" });

// Cancel a task if abandoning (does NOT satisfy blockers)
await tasks.cancel(task.id);

// Archive a finished task (hides from default list)
await tasks.archive(task.id);

// Show only archived tasks
const archivedOnly = await tasks.list({ archived: true });

// Include all tasks (archived and non-archived)
const allTasks = await tasks.list({ archived: "all" });

// Register a project-level shell gate
await gates.add({
  name: "tests",
  type: "shell",
  depthFilter: 1,
  ordering: 10,
  config: { command: "npm test", cwd: "{{workspace}}" }
});

// Register a per-task manual gate
await gates.add({ name: "code-review", type: "manual", taskId: task.id, ordering: 30 });

// Run shell gates for a task
const status = await gates.run(task.id);

// Pass a manual gate after review
await gates.pass(task.id, gateId, "Approved: no issues found");

// Pre-flight check before completing
const unsatisfied = await gates.check(task.id);
if (unsatisfied.length === 0) {
  await tasks.complete(task.id, { result: "Done" });
}

// Submit task for review (3-phase pipeline)
const review = await reviews.submit(task.id);
// Phase 1: Gates pass
const afterGates = await reviews.approveGates(review.id);
// Phase 2: Agent approves
const afterAgent = await reviews.approveAgent(afterGates.id);
// Phase 3: Human approves (bridges to gates.pass on manual gates)
const approved = await reviews.approveHuman(afterAgent.id);

// Or request changes (terminal, bridges to gates.fail)
const review2 = await reviews.submit(task.id);
await reviews.requestChanges(review2.id);
\`\`\`
`.trim();

/**
 * Create and configure MCP server
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "overseer-mcp",
      version: "0.10.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "execute",
        description: TOOL_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript code to execute (async/await supported)",
            },
          },
          required: ["code"],
        },
      },
    ],
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "execute") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const code = request.params.arguments?.code;
    if (typeof code !== "string") {
      throw new Error("Missing or invalid 'code' argument");
    }

    try {
      const result = await execute(code);
      // JSON.stringify can return undefined for: undefined, functions, symbols
      // MCP requires text to always be a string
      const serialized = result === undefined ? undefined : JSON.stringify(result, null, 2);
      const text = serialized ?? "undefined";
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    } catch (err) {
      let errorMessage: string;
      if (err instanceof ExecutionError) {
        errorMessage = `Execution error: ${err.message}${err.stackTrace ? `\n${err.stackTrace}` : ""}`;
      } else if (err instanceof CliTimeoutError) {
        errorMessage = `CLI timeout: ${err.message}`;
      } else if (err instanceof CliError) {
        errorMessage = `CLI error (exit ${err.exitCode}): ${err.message}`;
      } else if (err instanceof Error) {
        errorMessage = `Error: ${err.message}`;
      } else {
        errorMessage = `Unknown error: ${String(err)}`;
      }

      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start MCP server with stdio transport
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Overseer MCP server running on stdio");
}
