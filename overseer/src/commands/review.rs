use clap::{Args, Subcommand};
use rusqlite::Connection;

use crate::core::TaskService;
use crate::error::Result;
use crate::id::{ReviewId, TaskId};
use crate::types::{Review, ReviewFilter, ReviewStatus};

/// Parse TaskId from CLI string
fn parse_task_id(s: &str) -> std::result::Result<TaskId, String> {
    s.parse().map_err(|e| format!("{e}"))
}

/// Parse ReviewId from CLI string
fn parse_review_id(s: &str) -> std::result::Result<ReviewId, String> {
    s.parse().map_err(|e| format!("{e}"))
}

#[derive(Subcommand)]
pub enum ReviewCommand {
    /// Submit a task for review
    Submit {
        #[arg(value_parser = parse_task_id)]
        task_id: TaskId,
    },
    /// Get a review by ID
    Get {
        #[arg(value_parser = parse_review_id)]
        id: ReviewId,
    },
    /// Get the active review for a task
    Active {
        #[arg(value_parser = parse_task_id)]
        task_id: TaskId,
    },
    /// List reviews
    List(ListArgs),
    /// Approve gates phase (GatesPending -> AgentPending)
    ApproveGates {
        #[arg(value_parser = parse_review_id)]
        id: ReviewId,
    },
    /// Approve agent phase (AgentPending -> HumanPending)
    ApproveAgent {
        #[arg(value_parser = parse_review_id)]
        id: ReviewId,
    },
    /// Approve human phase (HumanPending -> Approved)
    ApproveHuman {
        #[arg(value_parser = parse_review_id)]
        id: ReviewId,
    },
    /// Request changes (any active -> ChangesRequested)
    RequestChanges {
        #[arg(value_parser = parse_review_id)]
        id: ReviewId,
    },
}

#[derive(Args)]
pub struct ListArgs {
    /// Filter by task ID
    #[arg(long, value_parser = parse_task_id)]
    pub task: Option<TaskId>,

    /// Filter by status
    #[arg(long)]
    pub status: Option<String>,
}

pub enum ReviewResultType {
    One(Review),
    MaybeOne(Option<Review>),
    Many(Vec<Review>),
}

pub fn handle(conn: &Connection, cmd: ReviewCommand) -> Result<ReviewResultType> {
    let svc = TaskService::new(conn);

    match cmd {
        ReviewCommand::Submit { task_id } => {
            Ok(ReviewResultType::One(svc.submit_review(&task_id)?))
        }

        ReviewCommand::Get { id } => {
            Ok(ReviewResultType::One(svc.get_review(&id)?))
        }

        ReviewCommand::Active { task_id } => {
            Ok(ReviewResultType::MaybeOne(svc.get_active_review(&task_id)?))
        }

        ReviewCommand::List(args) => {
            let status = args
                .status
                .map(|s| {
                    s.parse::<ReviewStatus>()
                        .map_err(|e| crate::error::OsError::Internal(e))
                })
                .transpose()?;

            let filter = ReviewFilter {
                task_id: args.task,
                status,
            };
            Ok(ReviewResultType::Many(svc.list_reviews(&filter)?))
        }

        ReviewCommand::ApproveGates { id } => {
            Ok(ReviewResultType::One(svc.approve_gates(&id)?))
        }

        ReviewCommand::ApproveAgent { id } => {
            Ok(ReviewResultType::One(svc.approve_agent(&id)?))
        }

        ReviewCommand::ApproveHuman { id } => {
            Ok(ReviewResultType::One(svc.approve_human(&id)?))
        }

        ReviewCommand::RequestChanges { id } => {
            Ok(ReviewResultType::One(svc.request_changes(&id)?))
        }
    }
}
