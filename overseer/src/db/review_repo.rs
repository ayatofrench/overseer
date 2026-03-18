use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

use crate::error::Result;
use crate::id::{ReviewId, TaskId};
use crate::types::{Review, ReviewFilter, ReviewStatus};

use rusqlite::OptionalExtension;

fn parse_review_status(s: &str) -> ReviewStatus {
    match s {
        "gates_pending" => ReviewStatus::GatesPending,
        "agent_pending" => ReviewStatus::AgentPending,
        "human_pending" => ReviewStatus::HumanPending,
        "approved" => ReviewStatus::Approved,
        "changes_requested" => ReviewStatus::ChangesRequested,
        _ => ReviewStatus::GatesPending,
    }
}

fn parse_datetime(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn parse_optional_datetime(s: Option<String>) -> Option<DateTime<Utc>> {
    s.and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .map(|dt| dt.with_timezone(&Utc))
            .ok()
    })
}

fn row_to_review(row: &rusqlite::Row) -> rusqlite::Result<Review> {
    let status_str: String = row.get("status")?;
    let submitted_str: String = row.get("submitted_at")?;
    let gates_completed_str: Option<String> = row.get("gates_completed_at")?;
    let agent_completed_str: Option<String> = row.get("agent_completed_at")?;
    let human_completed_str: Option<String> = row.get("human_completed_at")?;
    let created_str: String = row.get("created_at")?;
    let updated_str: String = row.get("updated_at")?;

    Ok(Review {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        status: parse_review_status(&status_str),
        submitted_at: parse_datetime(&submitted_str),
        gates_completed_at: parse_optional_datetime(gates_completed_str),
        agent_completed_at: parse_optional_datetime(agent_completed_str),
        human_completed_at: parse_optional_datetime(human_completed_str),
        created_at: parse_datetime(&created_str),
        updated_at: parse_datetime(&updated_str),
    })
}

const SELECT_COLS: &str =
    "id, task_id, status, submitted_at, gates_completed_at, agent_completed_at, human_completed_at, created_at, updated_at";

pub fn create_review(conn: &Connection, task_id: &TaskId) -> Result<Review> {
    let id = ReviewId::new();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        &format!(
            "INSERT INTO reviews ({}) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, ?6)",
            SELECT_COLS
        ),
        params![
            id,
            task_id,
            ReviewStatus::GatesPending.to_string(),
            now,
            now,
            now,
        ],
    )?;

    get_review(conn, &id)?.ok_or_else(|| crate::error::OsError::ReviewNotFound(id))
}

pub fn get_review(conn: &Connection, id: &ReviewId) -> Result<Option<Review>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM reviews WHERE id = ?1",
        SELECT_COLS
    ))?;

    let review = stmt.query_row(params![id], row_to_review).optional()?;
    Ok(review)
}

/// Get the active review for a task (status in gates_pending, agent_pending, human_pending)
pub fn get_active_for_task(conn: &Connection, task_id: &TaskId) -> Result<Option<Review>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM reviews WHERE task_id = ?1 AND status IN ('gates_pending', 'agent_pending', 'human_pending') ORDER BY created_at DESC LIMIT 1",
        SELECT_COLS
    ))?;

    let review = stmt
        .query_row(params![task_id], row_to_review)
        .optional()?;
    Ok(review)
}

pub fn list_for_task(conn: &Connection, task_id: &TaskId) -> Result<Vec<Review>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM reviews WHERE task_id = ?1 ORDER BY created_at DESC",
        SELECT_COLS
    ))?;

    let reviews = stmt
        .query_map(params![task_id], row_to_review)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(reviews)
}

pub fn list_reviews(conn: &Connection, filter: &ReviewFilter) -> Result<Vec<Review>> {
    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
        match (&filter.task_id, &filter.status) {
            (Some(tid), Some(status)) => (
                format!(
                    "SELECT {} FROM reviews WHERE task_id = ?1 AND status = ?2 ORDER BY created_at DESC",
                    SELECT_COLS
                ),
                vec![
                    Box::new(tid.clone()) as Box<dyn rusqlite::types::ToSql>,
                    Box::new(status.to_string()),
                ],
            ),
            (Some(tid), None) => (
                format!(
                    "SELECT {} FROM reviews WHERE task_id = ?1 ORDER BY created_at DESC",
                    SELECT_COLS
                ),
                vec![Box::new(tid.clone())],
            ),
            (None, Some(status)) => (
                format!(
                    "SELECT {} FROM reviews WHERE status = ?1 ORDER BY created_at DESC",
                    SELECT_COLS
                ),
                vec![Box::new(status.to_string())],
            ),
            (None, None) => (
                format!(
                    "SELECT {} FROM reviews ORDER BY created_at DESC",
                    SELECT_COLS
                ),
                vec![],
            ),
        };

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let reviews = stmt
        .query_map(param_refs.as_slice(), row_to_review)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(reviews)
}

/// Update review status, setting appropriate phase timestamps.
pub fn update_status(
    conn: &Connection,
    id: &ReviewId,
    new_status: ReviewStatus,
) -> Result<Review> {
    let now = Utc::now().to_rfc3339();

    // Set phase-specific timestamp based on the new status
    let (gates_col, agent_col, human_col) = match new_status {
        ReviewStatus::AgentPending => (Some(&now as &str), None, None),
        ReviewStatus::HumanPending => (None, Some(&now as &str), None),
        ReviewStatus::Approved => (None, None, Some(&now as &str)),
        _ => (None, None, None),
    };

    conn.execute(
        "UPDATE reviews SET status = ?1, updated_at = ?2,
         gates_completed_at = COALESCE(?3, gates_completed_at),
         agent_completed_at = COALESCE(?4, agent_completed_at),
         human_completed_at = COALESCE(?5, human_completed_at)
         WHERE id = ?6",
        params![
            new_status.to_string(),
            now,
            gates_col,
            agent_col,
            human_col,
            id,
        ],
    )?;

    get_review(conn, id)?.ok_or_else(|| crate::error::OsError::ReviewNotFound(id.clone()))
}
