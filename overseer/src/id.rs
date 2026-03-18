//! Prefixed ULID newtypes for type-safe entity IDs.
//!
//! - `TaskId`: `task_01ARZ3NDEKTSV4RRFFQ69G5FAV`
//! - `LearningId`: `lrn_01ARZ3NDEKTSV4RRFFQ69G5FAV`

use std::fmt;
use std::str::FromStr;

use rusqlite::types::{FromSql, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, Clone, PartialEq)]
pub enum IdParseError {
    #[error("Invalid ULID format: {0}")]
    InvalidUlid(String),
    #[error("Missing prefix: expected '{expected}', got '{actual}'")]
    MissingPrefix {
        expected: &'static str,
        actual: String,
    },
}

fn validate_ulid(s: &str) -> Result<(), IdParseError> {
    ulid::Ulid::from_string(s)
        .map(|_| ())
        .map_err(|_| IdParseError::InvalidUlid(s.to_string()))
}

// ============ TaskId ============

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TaskId(String);

impl TaskId {
    pub const PREFIX: &'static str = "task_";

    /// Generate new TaskId with fresh ULID
    pub fn new() -> Self {
        Self(format!("{}{}", Self::PREFIX, ulid::Ulid::new()))
    }

    /// Create from raw ULID (no prefix). Used by FromSql.
    pub(crate) fn from_raw_ulid(ulid: String) -> Self {
        Self(format!("{}{}", Self::PREFIX, ulid))
    }

    /// Extract the ULID part (without prefix)
    #[allow(dead_code)]
    pub fn ulid_part(&self) -> &str {
        self.0.strip_prefix(Self::PREFIX).unwrap_or(&self.0)
    }

    /// Full string representation (with prefix)
    #[allow(dead_code)]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for TaskId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for TaskId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for TaskId {
    type Err = IdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let ulid = s
            .strip_prefix(Self::PREFIX)
            .ok_or_else(|| IdParseError::MissingPrefix {
                expected: Self::PREFIX,
                actual: s.to_string(),
            })?;
        validate_ulid(ulid)?;
        Ok(Self::from_raw_ulid(ulid.to_string()))
    }
}

impl ToSql for TaskId {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        // Store with prefix - single source of truth
        Ok(ToSqlOutput::from(self.0.clone()))
    }
}

impl FromSql for TaskId {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        // Read directly - no transformation needed
        let s = value.as_str()?.to_string();
        Ok(Self(s))
    }
}

// ============ GateId ============

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GateId(String);

impl GateId {
    pub const PREFIX: &'static str = "gate_";

    pub fn new() -> Self {
        Self(format!("{}{}", Self::PREFIX, ulid::Ulid::new()))
    }

    pub(crate) fn from_raw_ulid(ulid: String) -> Self {
        Self(format!("{}{}", Self::PREFIX, ulid))
    }

    #[allow(dead_code)]
    pub fn ulid_part(&self) -> &str {
        self.0.strip_prefix(Self::PREFIX).unwrap_or(&self.0)
    }

    #[allow(dead_code)]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for GateId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for GateId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for GateId {
    type Err = IdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let ulid = s
            .strip_prefix(Self::PREFIX)
            .ok_or_else(|| IdParseError::MissingPrefix {
                expected: Self::PREFIX,
                actual: s.to_string(),
            })?;
        validate_ulid(ulid)?;
        Ok(Self::from_raw_ulid(ulid.to_string()))
    }
}

impl ToSql for GateId {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.0.clone()))
    }
}

impl FromSql for GateId {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?.to_string();
        Ok(Self(s))
    }
}

// ============ ReviewId ============

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ReviewId(String);

impl ReviewId {
    pub const PREFIX: &'static str = "rev_";

    pub fn new() -> Self {
        Self(format!("{}{}", Self::PREFIX, ulid::Ulid::new()))
    }

    pub(crate) fn from_raw_ulid(ulid: String) -> Self {
        Self(format!("{}{}", Self::PREFIX, ulid))
    }

    #[allow(dead_code)]
    pub fn ulid_part(&self) -> &str {
        self.0.strip_prefix(Self::PREFIX).unwrap_or(&self.0)
    }

    #[allow(dead_code)]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for ReviewId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for ReviewId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for ReviewId {
    type Err = IdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let ulid = s
            .strip_prefix(Self::PREFIX)
            .ok_or_else(|| IdParseError::MissingPrefix {
                expected: Self::PREFIX,
                actual: s.to_string(),
            })?;
        validate_ulid(ulid)?;
        Ok(Self::from_raw_ulid(ulid.to_string()))
    }
}

impl ToSql for ReviewId {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.0.clone()))
    }
}

impl FromSql for ReviewId {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?.to_string();
        Ok(Self(s))
    }
}

// ============ LearningId ============

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LearningId(String);

impl LearningId {
    pub const PREFIX: &'static str = "lrn_";

    pub fn new() -> Self {
        Self(format!("{}{}", Self::PREFIX, ulid::Ulid::new()))
    }

    pub(crate) fn from_raw_ulid(ulid: String) -> Self {
        Self(format!("{}{}", Self::PREFIX, ulid))
    }

    #[allow(dead_code)]
    pub fn ulid_part(&self) -> &str {
        self.0.strip_prefix(Self::PREFIX).unwrap_or(&self.0)
    }

    #[allow(dead_code)]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for LearningId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for LearningId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for LearningId {
    type Err = IdParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let ulid = s
            .strip_prefix(Self::PREFIX)
            .ok_or_else(|| IdParseError::MissingPrefix {
                expected: Self::PREFIX,
                actual: s.to_string(),
            })?;
        validate_ulid(ulid)?;
        Ok(Self::from_raw_ulid(ulid.to_string()))
    }
}

impl ToSql for LearningId {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        // Store with prefix - single source of truth
        Ok(ToSqlOutput::from(self.0.clone()))
    }
}

impl FromSql for LearningId {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        // Read directly - no transformation needed
        let s = value.as_str()?.to_string();
        Ok(Self(s))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_id_new() {
        let id = TaskId::new();
        assert!(id.as_str().starts_with("task_"));
        assert_eq!(id.ulid_part().len(), 26);
    }

    #[test]
    fn task_id_parse_with_prefix() {
        let id: TaskId = "task_01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap();
        assert_eq!(id.as_str(), "task_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    }

    #[test]
    fn task_id_parse_without_prefix_fails() {
        let result: Result<TaskId, _> = "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse();
        assert!(matches!(result, Err(IdParseError::MissingPrefix { .. })));
    }

    #[test]
    fn task_id_parse_invalid_ulid() {
        let result: Result<TaskId, _> = "task_invalid".parse();
        assert!(matches!(result, Err(IdParseError::InvalidUlid(_))));
    }

    #[test]
    fn task_id_serde() {
        let id = TaskId::new();
        let json = serde_json::to_string(&id).unwrap();
        assert!(json.starts_with("\"task_"));
        let parsed: TaskId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn learning_id_new() {
        let id = LearningId::new();
        assert!(id.as_str().starts_with("lrn_"));
    }

    #[test]
    fn learning_id_parse_with_prefix() {
        let id: LearningId = "lrn_01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap();
        assert_eq!(id.as_str(), "lrn_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    }

    #[test]
    fn learning_id_parse_without_prefix_fails() {
        let result: Result<LearningId, _> = "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse();
        assert!(matches!(result, Err(IdParseError::MissingPrefix { .. })));
    }

    #[test]
    fn review_id_new() {
        let id = ReviewId::new();
        assert!(id.as_str().starts_with("rev_"));
        assert_eq!(id.ulid_part().len(), 26);
    }

    #[test]
    fn review_id_parse_with_prefix() {
        let id: ReviewId = "rev_01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap();
        assert_eq!(id.as_str(), "rev_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    }

    #[test]
    fn review_id_parse_without_prefix_fails() {
        let result: Result<ReviewId, _> = "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse();
        assert!(matches!(result, Err(IdParseError::MissingPrefix { .. })));
    }
}
