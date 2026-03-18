// Allow unreachable_patterns for serde rename conflict (context vs context_chain)
#![allow(unreachable_patterns)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::db::learning_repo::Learning;
use crate::id::{GateId, ReviewId, TaskId};

/// Task lifecycle state - computed from field values
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LifecycleState {
    Pending,
    InProgress,
    Completed,
    Cancelled,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub own: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InheritedLearnings {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub milestone: Vec<Learning>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parent: Vec<Learning>,
}

/// Task struct with dual-purpose context fields:
/// - `context`: raw string stored in DB (never serialized)
/// - `context_chain`: structured chain for JSON output (serializes as "context")
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: TaskId,
    pub parent_id: Option<TaskId>,
    pub description: String,
    #[serde(default, skip_serializing)]
    pub context: String,
    #[serde(rename = "context", skip_serializing_if = "Option::is_none")]
    pub context_chain: Option<TaskContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub learnings: Option<InheritedLearnings>,
    pub result: Option<String>,
    pub priority: i32,
    pub completed: bool,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bookmark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_by: Vec<TaskId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<TaskId>,
    /// Computed field: true if task or any ancestor has incomplete blockers
    #[serde(default)]
    pub effectively_blocked: bool,
    /// Arbitrary JSON metadata stored in task_metadata table
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub cancelled: bool,
    pub cancelled_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub archived: bool,
    pub archived_at: Option<DateTime<Utc>>,
}

impl Task {
    /// Compute lifecycle state from field values (single source of truth)
    /// Precedence: archived > cancelled > completed > started > pending
    pub fn lifecycle_state(&self) -> LifecycleState {
        if self.archived {
            LifecycleState::Archived
        } else if self.cancelled {
            LifecycleState::Cancelled
        } else if self.completed {
            LifecycleState::Completed
        } else if self.started_at.is_some() {
            LifecycleState::InProgress
        } else {
            LifecycleState::Pending
        }
    }

    /// Task is active for work (not finished or archived)
    pub fn is_active_for_work(&self) -> bool {
        matches!(
            self.lifecycle_state(),
            LifecycleState::Pending | LifecycleState::InProgress
        )
    }

    /// Task is finished for hierarchy (completed OR cancelled, regardless of archived)
    pub fn is_finished_for_hierarchy(&self) -> bool {
        self.completed || self.cancelled
    }

    /// Task satisfies blocker (completed only, not cancelled)
    /// Note: archived is a visibility filter, doesn't affect blocker semantics
    pub fn satisfies_blocker(&self) -> bool {
        self.completed && !self.cancelled
    }

    /// Validate lifecycle invariants (call at DB hydrate in debug/tests)
    #[cfg(debug_assertions)]
    pub fn validate_lifecycle_invariants(&self) -> Result<(), String> {
        // Invalid: completed AND cancelled
        if self.completed && self.cancelled {
            return Err("Task cannot be both completed and cancelled".into());
        }
        // Invalid: archived but not finished
        if self.archived && !self.is_finished_for_hierarchy() {
            return Err("Archived task must be completed or cancelled".into());
        }
        // Invalid: state flag without timestamp
        if self.cancelled && self.cancelled_at.is_none() {
            return Err("Cancelled task must have cancelled_at timestamp".into());
        }
        if self.archived && self.archived_at.is_none() {
            return Err("Archived task must have archived_at timestamp".into());
        }
        if self.completed && self.completed_at.is_none() {
            return Err("Completed task must have completed_at timestamp".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct CreateTaskInput {
    pub description: String,
    pub context: Option<String>,
    pub parent_id: Option<TaskId>,
    pub priority: Option<i32>,
    pub blocked_by: Vec<TaskId>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateTaskInput {
    pub description: Option<String>,
    pub context: Option<String>,
    pub priority: Option<i32>,
    pub parent_id: Option<TaskId>,
}

#[derive(Debug, Clone)]
pub struct ListTasksFilter {
    pub parent_id: Option<TaskId>,
    pub ready: bool,
    pub completed: Option<bool>,
    /// Filter by task depth: 0=milestones, 1=tasks, 2=subtasks
    pub depth: Option<i32>,
    /// Filter by archived state:
    /// - None: include all (no filter)
    /// - Some(true): only archived
    /// - Some(false): hide archived (default)
    pub archived: Option<bool>,
}

// ============ Gate Types ============

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GateType {
    Shell,
    Metadata,
    Manual,
}

impl std::fmt::Display for GateType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GateType::Shell => write!(f, "shell"),
            GateType::Metadata => write!(f, "metadata"),
            GateType::Manual => write!(f, "manual"),
        }
    }
}

impl std::str::FromStr for GateType {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "shell" => Ok(GateType::Shell),
            "metadata" => Ok(GateType::Metadata),
            "manual" => Ok(GateType::Manual),
            _ => Err(format!("Invalid gate type: {s} (expected shell, metadata, or manual)")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GateStatus {
    Pending,
    Running,
    Pass,
    Fail,
    Error,
    Skip,
}

impl std::fmt::Display for GateStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GateStatus::Pending => write!(f, "pending"),
            GateStatus::Running => write!(f, "running"),
            GateStatus::Pass => write!(f, "pass"),
            GateStatus::Fail => write!(f, "fail"),
            GateStatus::Error => write!(f, "error"),
            GateStatus::Skip => write!(f, "skip"),
        }
    }
}

impl std::str::FromStr for GateStatus {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "pending" => Ok(GateStatus::Pending),
            "running" => Ok(GateStatus::Running),
            "pass" => Ok(GateStatus::Pass),
            "fail" => Ok(GateStatus::Fail),
            "error" => Ok(GateStatus::Error),
            "skip" => Ok(GateStatus::Skip),
            _ => Err(format!("Invalid gate status: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gate {
    pub id: GateId,
    pub task_id: Option<TaskId>,
    pub name: String,
    pub description: String,
    pub gate_type: GateType,
    pub config: serde_json::Value,
    pub required: bool,
    pub applies_to: String,
    pub depth_filter: Option<i32>,
    pub ordering: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateResult {
    pub gate_id: GateId,
    pub task_id: TaskId,
    pub status: GateStatus,
    pub output: Option<String>,
    pub exit_code: Option<i32>,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub commit_sha: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerifiedBy {
    Overseer,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateStatusEntry {
    pub gate: Gate,
    pub result: Option<GateResult>,
    pub satisfied: bool,
    pub verified_by: VerifiedBy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateStatusReport {
    pub task_id: TaskId,
    pub running: bool,
    pub gates: Vec<GateStatusEntry>,
    pub can_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsatisfiedGate {
    pub gate: Gate,
    pub result: Option<GateResult>,
    pub reason: String,
}

#[derive(Debug, Clone, Default)]
pub struct CreateGateInput {
    pub name: String,
    pub description: String,
    pub gate_type: String,
    pub task_id: Option<TaskId>,
    pub config: Option<serde_json::Value>,
    pub required: Option<bool>,
    pub depth_filter: Option<i32>,
    pub ordering: Option<i32>,
}

#[derive(Debug, Clone, Default)]
pub struct GateFilter {
    pub task_id: Option<TaskId>,
    pub project_only: bool,
}

// ============ Review Types ============

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatus {
    GatesPending,
    AgentPending,
    HumanPending,
    Approved,
    ChangesRequested,
}

impl ReviewStatus {
    /// Active statuses (not terminal)
    pub fn is_active(self) -> bool {
        matches!(
            self,
            ReviewStatus::GatesPending | ReviewStatus::AgentPending | ReviewStatus::HumanPending
        )
    }
}

impl std::fmt::Display for ReviewStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReviewStatus::GatesPending => write!(f, "gates_pending"),
            ReviewStatus::AgentPending => write!(f, "agent_pending"),
            ReviewStatus::HumanPending => write!(f, "human_pending"),
            ReviewStatus::Approved => write!(f, "approved"),
            ReviewStatus::ChangesRequested => write!(f, "changes_requested"),
        }
    }
}

impl std::str::FromStr for ReviewStatus {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "gates_pending" => Ok(ReviewStatus::GatesPending),
            "agent_pending" => Ok(ReviewStatus::AgentPending),
            "human_pending" => Ok(ReviewStatus::HumanPending),
            "approved" => Ok(ReviewStatus::Approved),
            "changes_requested" => Ok(ReviewStatus::ChangesRequested),
            _ => Err(format!(
                "Invalid review status: {s} (expected gates_pending, agent_pending, human_pending, approved, or changes_requested)"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: ReviewId,
    pub task_id: TaskId,
    pub status: ReviewStatus,
    pub submitted_at: DateTime<Utc>,
    pub gates_completed_at: Option<DateTime<Utc>>,
    pub agent_completed_at: Option<DateTime<Utc>>,
    pub human_completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default)]
pub struct ReviewFilter {
    pub task_id: Option<TaskId>,
    pub status: Option<ReviewStatus>,
}

impl Default for ListTasksFilter {
    fn default() -> Self {
        Self {
            parent_id: None,
            ready: false,
            completed: None,
            depth: None,
            archived: Some(false), // Default: hide archived
        }
    }
}
