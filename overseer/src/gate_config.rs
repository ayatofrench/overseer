//! File-based gate configuration loader.
//!
//! Reads `.overseer/gates.json` from the repository root (or any parent of the
//! working directory) and returns the gates as `Vec<Gate>` with synthetic IDs.
//! File gates are read-only from Overseer's perspective.

use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Deserialize;

use crate::id::GateId;
use crate::types::{Gate, GateSource, GateType};

/// JSON shape for a single gate entry in `.overseer/gates.json`.
#[derive(Debug, Deserialize)]
struct FileGateEntry {
    name: String,
    #[serde(rename = "type")]
    gate_type: String,
    #[serde(default)]
    config: serde_json::Value,
    #[serde(default = "default_required")]
    required: bool,
    depth_filter: Option<i32>,
    #[serde(default)]
    ordering: i32,
    #[serde(default)]
    description: String,
}

fn default_required() -> bool {
    true
}

#[derive(Debug, Deserialize)]
struct FileGateConfig {
    gates: Vec<FileGateEntry>,
}

/// Walk from `search_dir` upward to find `.overseer/gates.json`.
fn find_gates_file(search_dir: &Path) -> Option<PathBuf> {
    let mut dir = search_dir.to_path_buf();
    loop {
        let candidate = dir.join(".overseer").join("gates.json");
        if candidate.exists() {
            return Some(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

/// Load file-based gates from `.overseer/gates.json` found at or above `search_dir`.
///
/// Returns an empty vec when no file is found (backwards-compatible).
pub fn load_file_gates(search_dir: &Path) -> crate::error::Result<Vec<Gate>> {
    let Some(path) = find_gates_file(search_dir) else {
        return Ok(vec![]);
    };

    let content = std::fs::read_to_string(&path)?;
    let config: FileGateConfig =
        serde_json::from_str(&content).map_err(crate::error::OsError::Json)?;

    let now = Utc::now();
    let gates = config
        .gates
        .into_iter()
        .map(|entry| Gate {
            id: GateId::from_file_gate(&entry.name),
            task_id: None,
            name: entry.name,
            description: entry.description,
            gate_type: entry.gate_type.parse().unwrap_or(GateType::Shell),
            config: entry.config,
            required: entry.required,
            applies_to: "complete".to_string(),
            depth_filter: entry.depth_filter,
            ordering: entry.ordering,
            created_at: now,
            source: GateSource::File,
        })
        .collect();

    Ok(gates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_gates_json(dir: &Path, json: &str) {
        fs::create_dir_all(dir.join(".overseer")).unwrap();
        fs::write(dir.join(".overseer/gates.json"), json).unwrap();
    }

    #[test]
    fn test_no_file_returns_empty() {
        let dir = TempDir::new().unwrap();
        let gates = load_file_gates(dir.path()).unwrap();
        assert!(gates.is_empty());
    }

    #[test]
    fn test_load_basic_file_gate() {
        let dir = TempDir::new().unwrap();
        write_gates_json(
            dir.path(),
            r#"{"gates": [{"name": "build", "type": "shell", "config": {"command": "make build"}, "depth_filter": 1, "ordering": 10, "description": "Build step"}]}"#,
        );

        let gates = load_file_gates(dir.path()).unwrap();
        assert_eq!(gates.len(), 1);
        let g = &gates[0];
        assert_eq!(g.name, "build");
        assert_eq!(g.gate_type, GateType::Shell);
        assert_eq!(g.source, GateSource::File);
        assert_eq!(g.id, GateId::from_file_gate("build"));
        assert_eq!(g.depth_filter, Some(1));
        assert_eq!(g.ordering, 10);
        assert_eq!(g.description, "Build step");
        assert!(g.required);
        assert!(g.task_id.is_none());
        assert_eq!(g.applies_to, "complete");
    }

    #[test]
    fn test_load_multiple_gates() {
        let dir = TempDir::new().unwrap();
        write_gates_json(
            dir.path(),
            r#"{"gates": [{"name": "build", "type": "shell"}, {"name": "tests", "type": "shell"}, {"name": "review", "type": "manual", "required": false}]}"#,
        );

        let gates = load_file_gates(dir.path()).unwrap();
        assert_eq!(gates.len(), 3);
        assert_eq!(gates[2].name, "review");
        assert_eq!(gates[2].gate_type, GateType::Manual);
        assert!(!gates[2].required);
    }

    #[test]
    fn test_search_parent_directory() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("subdir/nested");
        fs::create_dir_all(&nested).unwrap();
        write_gates_json(dir.path(), r#"{"gates": [{"name": "tests", "type": "shell"}]}"#);

        // Search from nested directory — should find parent's gates.json
        let gates = load_file_gates(&nested).unwrap();
        assert_eq!(gates.len(), 1);
        assert_eq!(gates[0].name, "tests");
    }

    #[test]
    fn test_invalid_json_returns_error() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join(".overseer")).unwrap();
        fs::write(dir.path().join(".overseer/gates.json"), "not json").unwrap();

        let result = load_file_gates(dir.path());
        assert!(result.is_err());
    }
}
