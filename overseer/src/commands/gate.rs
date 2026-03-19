use clap::{Args, Subcommand};
use rusqlite::Connection;

use crate::core::{TaskService, TaskWorkflowService};
use crate::error::Result;
use crate::id::{GateId, TaskId};
use crate::types::{CreateGateInput, GateFilter, GateStatusReport};
use crate::vcs::backend::VcsBackend;

/// Parse TaskId from CLI string
fn parse_task_id(s: &str) -> std::result::Result<TaskId, String> {
    s.parse().map_err(|e| format!("{e}"))
}

/// Parse GateId from CLI string
fn parse_gate_id(s: &str) -> std::result::Result<GateId, String> {
    s.parse().map_err(|e| format!("{e}"))
}

#[derive(Subcommand)]
pub enum GateCommand {
    /// Add a gate definition
    Add(AddArgs),
    /// List gate definitions
    List(ListGateArgs),
    /// Delete a gate definition
    Delete {
        #[arg(value_parser = parse_gate_id)]
        id: GateId,
    },
    /// Run all applicable gates for a task
    Run(RunArgs),
    /// Get gate status for a task
    Status {
        #[arg(value_parser = parse_task_id)]
        task_id: TaskId,
    },
    /// Get stored output for a specific gate result
    Output(OutputArgs),
    /// Pass a manual gate
    Pass(PassFailArgs),
    /// Fail a manual gate
    Fail(PassFailArgs),
    /// Pre-flight check: would complete() succeed?
    Check {
        #[arg(value_parser = parse_task_id)]
        task_id: TaskId,
    },
}

#[derive(Args)]
pub struct AddArgs {
    /// Gate name (e.g., "tests", "code-review")
    #[arg(long)]
    pub name: String,

    /// Gate type: shell, metadata, or manual
    #[arg(long = "type")]
    pub gate_type: String,

    /// Task ID for task-specific gate (omit for project-level)
    #[arg(long, value_parser = parse_task_id)]
    pub task: Option<TaskId>,

    /// JSON configuration for the gate
    #[arg(long)]
    pub config: Option<String>,

    /// Whether the gate is required (default: true)
    #[arg(long)]
    pub required: Option<bool>,

    /// Depth filter: 0=milestones, 1=tasks, 2=subtasks (default: all)
    #[arg(long)]
    pub depth: Option<i32>,

    /// Execution order (lower = first, default: 0)
    #[arg(long)]
    pub order: Option<i32>,

    /// Human-readable description
    #[arg(long)]
    pub description: Option<String>,

    /// Shell command to execute (for shell gates)
    #[arg(long)]
    pub command: Option<String>,

    /// Timeout in seconds (for shell gates, default: 300)
    #[arg(long)]
    pub timeout: Option<i64>,

    /// Max retries on failure (default: 1)
    #[arg(long)]
    pub max_retries: Option<i32>,
}

#[derive(Args)]
pub struct ListGateArgs {
    /// Filter by task ID (omit for all gates)
    #[arg(long, value_parser = parse_task_id)]
    pub task: Option<TaskId>,

    /// Show only project-level gates
    #[arg(long)]
    pub project: bool,
}

#[derive(Args)]
pub struct RunArgs {
    #[arg(value_parser = parse_task_id)]
    pub task_id: TaskId,

    /// Run a specific gate only
    #[arg(long, value_parser = parse_gate_id)]
    pub gate: Option<GateId>,
}

#[derive(Args)]
pub struct OutputArgs {
    #[arg(value_parser = parse_task_id)]
    pub task_id: TaskId,

    #[arg(value_parser = parse_gate_id)]
    pub gate_id: GateId,
}

#[derive(Args)]
pub struct PassFailArgs {
    #[arg(value_parser = parse_task_id)]
    pub task_id: TaskId,

    #[arg(value_parser = parse_gate_id)]
    pub gate_id: GateId,

    /// Output text (reason for pass/fail)
    #[arg(long)]
    pub output: Option<String>,
}

pub enum GateResultType {
    Gate(crate::types::Gate),
    Gates(Vec<crate::types::Gate>),
    GateResult(crate::types::GateResult),
    Status(GateStatusReport),
    Unsatisfied(Vec<crate::types::UnsatisfiedGate>),
    Output(Option<String>),
    Deleted,
}

/// Handle gate commands that don't require VCS
pub fn handle(conn: &Connection, cmd: GateCommand) -> Result<GateResultType> {
    let svc = TaskService::new(conn);

    match cmd {
        GateCommand::Add(args) => {
            let mut config: serde_json::Value = args
                .config
                .map(|c| serde_json::from_str(&c))
                .transpose()
                .map_err(|e| crate::error::OsError::Json(e))?
                .unwrap_or_else(|| serde_json::json!({}));

            // Merge convenience CLI args into config JSON
            if let Some(cmd) = args.command {
                config["command"] = serde_json::Value::String(cmd);
            }
            if let Some(timeout) = args.timeout {
                config["timeout_secs"] = serde_json::Value::Number(timeout.into());
            }
            if let Some(retries) = args.max_retries {
                config["max_retries"] = serde_json::Value::Number(retries.into());
            }

            let input = CreateGateInput {
                name: args.name,
                description: args.description.unwrap_or_default(),
                gate_type: args.gate_type,
                task_id: args.task,
                config: Some(config),
                required: args.required,
                depth_filter: args.depth,
                ordering: args.order,
            };
            Ok(GateResultType::Gate(svc.create_gate(&input)?))
        }

        GateCommand::List(args) => {
            let filter = GateFilter {
                task_id: args.task,
                project_only: args.project,
            };
            Ok(GateResultType::Gates(svc.list_gates(&filter)?))
        }

        GateCommand::Delete { id } => {
            svc.delete_gate(&id)?;
            Ok(GateResultType::Deleted)
        }

        GateCommand::Status { task_id } => {
            Ok(GateResultType::Status(svc.get_gate_status(&task_id)?))
        }

        GateCommand::Output(args) => {
            Ok(GateResultType::Output(svc.get_gate_output(&args.task_id, &args.gate_id)?))
        }

        GateCommand::Pass(args) => {
            let result = svc.pass_gate(&args.task_id, &args.gate_id, args.output.as_deref(), None::<&crate::id::ReviewId>)?;
            Ok(GateResultType::GateResult(result))
        }

        GateCommand::Fail(args) => {
            let result = svc.fail_gate(&args.task_id, &args.gate_id, args.output.as_deref(), None::<&crate::id::ReviewId>)?;
            Ok(GateResultType::GateResult(result))
        }

        GateCommand::Check { task_id } => {
            let unsatisfied = svc.check_gates(&task_id)?;
            Ok(GateResultType::Unsatisfied(unsatisfied))
        }

        GateCommand::Run(_) => {
            // Run requires VCS — caller must use handle_workflow
            Err(crate::error::OsError::NotARepository)
        }
    }
}

/// Handle gate run command (requires VCS for commit SHA)
pub fn handle_workflow(
    conn: &Connection,
    cmd: GateCommand,
    vcs: Box<dyn VcsBackend>,
) -> Result<GateResultType> {
    match cmd {
        GateCommand::Run(args) => {
            let workflow = TaskWorkflowService::new(conn, vcs);
            let commit_sha = workflow
                .vcs_ref()
                .current_commit_id()
                .ok();
            let status = workflow.run_gates(
                &args.task_id,
                commit_sha.as_deref(),
            )?;
            Ok(GateResultType::Status(status))
        }
        _ => handle(conn, cmd),
    }
}
