use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

use crate::error::Result;
use crate::id::{GateId, ReviewId, TaskId};
use crate::types::{
    CreateGateInput, Gate, GateFilter, GateResult, GateStatus, GateType, UnsatisfiedGate,
};

fn parse_gate_type(s: &str) -> GateType {
    match s {
        "shell" => GateType::Shell,
        "metadata" => GateType::Metadata,
        "manual" => GateType::Manual,
        _ => GateType::Shell,
    }
}

fn parse_gate_status(s: &str) -> GateStatus {
    match s {
        "pending" => GateStatus::Pending,
        "running" => GateStatus::Running,
        "pass" => GateStatus::Pass,
        "fail" => GateStatus::Fail,
        "error" => GateStatus::Error,
        "skip" => GateStatus::Skip,
        _ => GateStatus::Pending,
    }
}

fn row_to_gate(row: &rusqlite::Row) -> rusqlite::Result<Gate> {
    let gate_type_str: String = row.get("gate_type")?;
    let config_str: String = row.get("config")?;
    let created_str: String = row.get("created_at")?;

    Ok(Gate {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        gate_type: parse_gate_type(&gate_type_str),
        config: serde_json::from_str(&config_str).unwrap_or(serde_json::json!({})),
        required: row.get::<_, i32>("required")? != 0,
        applies_to: row.get("applies_to")?,
        depth_filter: row.get("depth_filter")?,
        ordering: row.get("ordering")?,
        created_at: DateTime::parse_from_rfc3339(&created_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
    })
}

fn row_to_gate_result(row: &rusqlite::Row) -> rusqlite::Result<GateResult> {
    let status_str: String = row.get("status")?;
    let started_str: String = row.get("started_at")?;
    let completed_str: Option<String> = row.get("completed_at")?;

    let review_id_str: String = row.get::<_, String>("review_id").unwrap_or_default();
    let review_id = if review_id_str.is_empty() {
        None
    } else {
        review_id_str.parse::<ReviewId>().ok()
    };

    Ok(GateResult {
        gate_id: row.get("gate_id")?,
        task_id: row.get("task_id")?,
        status: parse_gate_status(&status_str),
        output: row.get("output")?,
        exit_code: row.get("exit_code")?,
        started_at: DateTime::parse_from_rfc3339(&started_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        completed_at: completed_str.and_then(|s| {
            DateTime::parse_from_rfc3339(&s)
                .map(|dt| dt.with_timezone(&Utc))
                .ok()
        }),
        commit_sha: row.get("commit_sha")?,
        review_id,
        attempt: row.get::<_, i32>("attempt").unwrap_or(1),
    })
}

pub fn create_gate(conn: &Connection, input: &CreateGateInput) -> Result<Gate> {
    let id = GateId::new();
    let now = Utc::now().to_rfc3339();
    let gate_type = &input.gate_type;
    let config = input
        .config
        .as_ref()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "{}".to_string());
    let required = input.required.unwrap_or(true) as i32;
    let ordering = input.ordering.unwrap_or(0);

    conn.execute(
        "INSERT INTO gates (id, task_id, name, description, gate_type, config, required, applies_to, depth_filter, ordering, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'complete', ?8, ?9, ?10)",
        params![
            id,
            input.task_id,
            input.name,
            input.description,
            gate_type,
            config,
            required,
            input.depth_filter,
            ordering,
            now,
        ],
    )?;

    get_gate(conn, &id)?.ok_or_else(|| crate::error::OsError::GateNotFound(id))
}

pub fn get_gate(conn: &Connection, id: &GateId) -> Result<Option<Gate>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, name, description, gate_type, config, required, applies_to, depth_filter, ordering, created_at
         FROM gates WHERE id = ?1",
    )?;

    let gate = stmt.query_row(params![id], row_to_gate).optional()?;
    Ok(gate)
}

pub fn list_gates(conn: &Connection, filter: &GateFilter) -> Result<Vec<Gate>> {
    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if filter.project_only {
        (
            "SELECT id, task_id, name, description, gate_type, config, required, applies_to, depth_filter, ordering, created_at
             FROM gates WHERE task_id IS NULL ORDER BY ordering, name".to_string(),
            vec![],
        )
    } else if let Some(ref task_id) = filter.task_id {
        (
            "SELECT id, task_id, name, description, gate_type, config, required, applies_to, depth_filter, ordering, created_at
             FROM gates WHERE task_id = ?1 ORDER BY ordering, name".to_string(),
            vec![Box::new(task_id.clone())],
        )
    } else {
        (
            "SELECT id, task_id, name, description, gate_type, config, required, applies_to, depth_filter, ordering, created_at
             FROM gates ORDER BY ordering, name".to_string(),
            vec![],
        )
    };

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let gates = stmt
        .query_map(param_refs.as_slice(), row_to_gate)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(gates)
}

pub fn delete_gate(conn: &Connection, id: &GateId) -> Result<()> {
    let rows = conn.execute("DELETE FROM gates WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(crate::error::OsError::GateNotFound(id.clone()));
    }
    Ok(())
}

/// Resolve the effective gate set for a task: project-level + task-specific,
/// with task-specific overriding project-level by name.
pub fn resolve_gates(
    conn: &Connection,
    task_id: &TaskId,
    depth: i32,
    transition: &str,
) -> Result<Vec<Gate>> {
    // Project-level gates matching depth and transition
    let mut stmt = conn.prepare(
        "SELECT id, task_id, name, description, gate_type, config, required, applies_to, depth_filter, ordering, created_at
         FROM gates
         WHERE task_id IS NULL
           AND applies_to = ?1
           AND (depth_filter IS NULL OR depth_filter = ?2)
         ORDER BY ordering, name",
    )?;
    let project_gates: Vec<Gate> = stmt
        .query_map(params![transition, depth], row_to_gate)?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    // Task-specific gates
    let mut stmt = conn.prepare(
        "SELECT id, task_id, name, description, gate_type, config, required, applies_to, depth_filter, ordering, created_at
         FROM gates
         WHERE task_id = ?1
           AND applies_to = ?2
         ORDER BY ordering, name",
    )?;
    let task_gates: Vec<Gate> = stmt
        .query_map(params![task_id, transition], row_to_gate)?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    // Merge: task-specific overrides project-level by name
    let mut by_name: std::collections::HashMap<String, Gate> = std::collections::HashMap::new();
    for gate in project_gates {
        by_name.insert(gate.name.clone(), gate);
    }
    for gate in task_gates {
        by_name.insert(gate.name.clone(), gate);
    }

    let mut gates: Vec<Gate> = by_name.into_values().collect();
    gates.sort_by_key(|g| (g.ordering, g.name.clone()));
    Ok(gates)
}

// ============ Gate Results ============

pub fn set_result(
    conn: &Connection,
    gate_id: &GateId,
    task_id: &TaskId,
    status: GateStatus,
    output: Option<&str>,
    exit_code: Option<i32>,
    commit_sha: Option<&str>,
    attempt: i32,
    review_id: Option<&ReviewId>,
) -> Result<GateResult> {
    let now = Utc::now().to_rfc3339();
    let status_str = status.to_string();
    let completed_at = match status {
        GateStatus::Pending | GateStatus::Running => None,
        _ => Some(now.clone()),
    };
    let review_id_str = review_id.map(|r| r.to_string()).unwrap_or_default();

    conn.execute(
        "INSERT INTO gate_results (gate_id, task_id, status, output, exit_code, started_at, completed_at, commit_sha, review_id, attempt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT (gate_id, task_id, review_id)
         DO UPDATE SET status = ?3, output = ?4, exit_code = ?5, started_at = ?6, completed_at = ?7, commit_sha = ?8, attempt = ?10",
        params![gate_id, task_id, status_str, output, exit_code, now, completed_at, commit_sha, review_id_str, attempt],
    )?;

    get_result(conn, gate_id, task_id, review_id)?
        .ok_or_else(|| crate::error::OsError::GateNotFound(gate_id.clone()))
}

pub fn get_result(
    conn: &Connection,
    gate_id: &GateId,
    task_id: &TaskId,
    review_id: Option<&ReviewId>,
) -> Result<Option<GateResult>> {
    let review_id_str = review_id.map(|r| r.to_string()).unwrap_or_default();
    let mut stmt = conn.prepare(
        "SELECT gate_id, task_id, status, output, exit_code, started_at, completed_at, commit_sha, review_id, attempt
         FROM gate_results WHERE gate_id = ?1 AND task_id = ?2 AND review_id = ?3",
    )?;

    let result = stmt
        .query_row(params![gate_id, task_id, review_id_str], row_to_gate_result)
        .optional()?;
    Ok(result)
}

pub fn get_results(
    conn: &Connection,
    task_id: &TaskId,
    review_id: Option<&ReviewId>,
) -> Result<Vec<GateResult>> {
    let review_id_str = review_id.map(|r| r.to_string()).unwrap_or_default();
    let mut stmt = conn.prepare(
        "SELECT gate_id, task_id, status, output, exit_code, started_at, completed_at, commit_sha, review_id, attempt
         FROM gate_results WHERE task_id = ?1 AND review_id = ?2",
    )?;

    let results = stmt
        .query_map(params![task_id, review_id_str], row_to_gate_result)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(results)
}

pub fn has_active_run(conn: &Connection, task_id: &TaskId) -> Result<bool> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM gate_results WHERE task_id = ?1 AND status IN ('pending', 'running')",
        params![task_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn delete_results(conn: &Connection, task_id: &TaskId) -> Result<()> {
    conn.execute(
        "DELETE FROM gate_results WHERE task_id = ?1",
        params![task_id],
    )?;
    Ok(())
}

/// Check if all required gates are satisfied for a task.
/// Returns list of unsatisfied gates.
pub fn check_gates(
    conn: &Connection,
    task_id: &TaskId,
    depth: i32,
    transition: &str,
    review_id: Option<&ReviewId>,
) -> Result<Vec<UnsatisfiedGate>> {
    let gates = resolve_gates(conn, task_id, depth, transition)?;
    let results = get_results(conn, task_id, review_id)?;

    let result_map: std::collections::HashMap<GateId, GateResult> = results
        .into_iter()
        .map(|r| (r.gate_id.clone(), r))
        .collect();

    let mut unsatisfied = Vec::new();
    for gate in gates {
        if !gate.required {
            continue;
        }

        let result = result_map.get(&gate.id);
        let (is_satisfied, reason) = match result {
            None => (false, "never run".to_string()),
            Some(r) => match r.status {
                GateStatus::Pass => (true, String::new()),
                GateStatus::Skip => {
                    if gate.gate_type == GateType::Manual {
                        (false, "requires explicit pass".to_string())
                    } else {
                        (true, String::new())
                    }
                }
                GateStatus::Pending => (false, "still pending".to_string()),
                GateStatus::Running => (false, "still running".to_string()),
                GateStatus::Fail => (false, "failed".to_string()),
                GateStatus::Error => (false, "errored".to_string()),
            },
        };

        if !is_satisfied {
            unsatisfied.push(UnsatisfiedGate {
                gate,
                result: result.cloned(),
                reason,
            });
        }
    }

    Ok(unsatisfied)
}

// Make query_row.optional() available
use rusqlite::OptionalExtension;
