use std::process::Command;
use std::time::Duration;

use rusqlite::Connection;

use crate::db::{gate_repo, task_repo};
use crate::error::{OsError, Result};
use crate::id::{ReviewId, TaskId};
use crate::types::{Gate, GateResult, GateStatus, GateType};

const OUTPUT_CAP: usize = 64 * 1024; // 64KB per gate

pub struct GateExecutor<'a> {
    conn: &'a Connection,
}

impl<'a> GateExecutor<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Run all applicable gates for a task. Called by the worker process.
    /// Executes gates sequentially in ordering, writing results as it goes.
    pub fn run_all(
        &self,
        task_id: &TaskId,
        commit_sha: Option<&str>,
        review_id: Option<&ReviewId>,
    ) -> Result<Vec<GateResult>> {
        let task = task_repo::get_task(self.conn, task_id)?
            .ok_or_else(|| OsError::TaskNotFound(task_id.clone()))?;
        let depth = task_repo::get_task_depth(self.conn, task_id)?;

        let gates = gate_repo::resolve_gates(self.conn, task_id, depth, "complete")?;
        let mut results = Vec::new();

        for gate in &gates {
            gate_repo::set_result(
                self.conn,
                &gate.id,
                task_id,
                GateStatus::Running,
                None,
                None,
                commit_sha,
                1,
                review_id,
            )?;

            let result = self.run_one(gate, task_id, commit_sha, review_id)?;
            results.push(result);
        }

        let _ = task;
        Ok(results)
    }

    fn run_one(
        &self,
        gate: &Gate,
        task_id: &TaskId,
        commit_sha: Option<&str>,
        review_id: Option<&ReviewId>,
    ) -> Result<GateResult> {
        match gate.gate_type {
            GateType::Shell => self.execute_shell_with_retry(gate, task_id, commit_sha, review_id),
            GateType::Metadata => {
                let (status, output) = self.evaluate_metadata(gate, task_id)?;
                gate_repo::set_result(
                    self.conn,
                    &gate.id,
                    task_id,
                    status,
                    Some(&cap_output(&output)),
                    None,
                    commit_sha,
                    1,
                    review_id,
                )
            }
            GateType::Manual => {
                gate_repo::set_result(
                    self.conn,
                    &gate.id,
                    task_id,
                    GateStatus::Skip,
                    Some("manual gate — use `os gate pass`"),
                    None,
                    commit_sha,
                    1,
                    review_id,
                )
            }
        }
    }

    /// Execute a shell gate with retry logic.
    /// Retries on Fail/Error up to max_retries. Breaks on Pass or Pending (exit 75).
    fn execute_shell_with_retry(
        &self,
        gate: &Gate,
        task_id: &TaskId,
        commit_sha: Option<&str>,
        review_id: Option<&ReviewId>,
    ) -> Result<GateResult> {
        let max_retries = gate
            .config
            .get("max_retries")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
            .unwrap_or(1)
            .max(1);
        let mut last_result = None;

        for attempt in 1..=max_retries {
            let (status, output, exit_code) = self.execute_shell(gate, task_id, attempt);
            last_result = Some(gate_repo::set_result(
                self.conn,
                &gate.id,
                task_id,
                status,
                Some(&cap_output(&output)),
                exit_code,
                commit_sha,
                attempt,
                review_id,
            )?);

            match status {
                GateStatus::Pass | GateStatus::Pending => break,
                GateStatus::Fail | GateStatus::Error if attempt < max_retries => continue,
                _ => break,
            }
        }

        last_result.ok_or_else(|| OsError::GateNotFound(gate.id.clone()))
    }

    fn execute_shell(
        &self,
        gate: &Gate,
        task_id: &TaskId,
        attempt: i32,
    ) -> (GateStatus, String, Option<i32>) {
        let command = gate
            .config
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("echo 'no command configured'");
        let timeout_secs = gate
            .config
            .get("timeout_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(300);

        let resolved_command = self.resolve_templates(command, task_id);
        let cwd = gate
            .config
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(|c| self.resolve_templates(c, task_id));

        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(&resolved_command);

        cmd.env("OVERSEER_TASK_ID", task_id.to_string());
        cmd.env("OVERSEER_GATE_NAME", &gate.name);
        cmd.env("OVERSEER_GATE_ID", gate.id.to_string());
        cmd.env("OVERSEER_ATTEMPT", attempt.to_string());

        if let Some(ref cwd_path) = cwd {
            let expanded = shellexpand::tilde(cwd_path);
            cmd.current_dir(expanded.as_ref());
        }

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        match cmd.spawn() {
            Err(e) => (
                GateStatus::Error,
                format!("Failed to spawn command: {e}"),
                None,
            ),
            Ok(child) => {
                let timeout = Duration::from_secs(timeout_secs);
                match wait_with_timeout(child, timeout) {
                    WaitResult::Completed {
                        code,
                        stdout,
                        stderr,
                    } => {
                        let output = format_output(&stdout, &stderr);
                        let status = match code {
                            0 => GateStatus::Pass,
                            75 => GateStatus::Pending,
                            _ => GateStatus::Fail,
                        };
                        (status, output, Some(code))
                    }
                    WaitResult::TimedOut => (
                        GateStatus::Error,
                        format!("Timed out after {timeout_secs}s"),
                        None,
                    ),
                    WaitResult::Error(e) => {
                        (GateStatus::Error, format!("Process error: {e}"), None)
                    }
                }
            }
        }
    }

    fn evaluate_metadata(&self, gate: &Gate, task_id: &TaskId) -> Result<(GateStatus, String)> {
        let metadata = task_repo::get_metadata(self.conn, task_id)?;
        let metadata = metadata.unwrap_or(serde_json::json!({}));

        let checks = gate
            .config
            .get("checks")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut failures = Vec::new();
        for check in &checks {
            let key = check.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let op = check.get("op").and_then(|v| v.as_str()).unwrap_or("exists");
            let expected = check.get("value");

            let actual = metadata.get(key);
            let passed = match op {
                "exists" => actual.is_some() && !actual.unwrap().is_null(),
                "not_empty" => match actual {
                    Some(serde_json::Value::Array(a)) => !a.is_empty(),
                    Some(serde_json::Value::String(s)) => !s.is_empty(),
                    Some(serde_json::Value::Null) | None => false,
                    _ => true,
                },
                "eq" => actual.is_some() && actual == expected,
                "neq" => actual.is_none() || actual != expected,
                "in" => {
                    if let (Some(actual_val), Some(expected_arr)) =
                        (actual, expected.and_then(|v| v.as_array()))
                    {
                        expected_arr.contains(actual_val)
                    } else {
                        false
                    }
                }
                _ => false,
            };

            if !passed {
                failures.push(format!(
                    "{key} {op}: expected {:?}, got {:?}",
                    expected.unwrap_or(&serde_json::Value::Null),
                    actual.unwrap_or(&serde_json::Value::Null)
                ));
            }
        }

        if failures.is_empty() {
            Ok((
                GateStatus::Pass,
                format!("All {} checks passed", checks.len()),
            ))
        } else {
            Ok((GateStatus::Fail, failures.join("\n")))
        }
    }

    fn resolve_templates(&self, template: &str, task_id: &TaskId) -> String {
        let mut result = template.to_string();
        result = result.replace("{{task_id}}", &task_id.to_string());

        if result.contains("{{workspace}}") || result.contains("{{bookmark}}") {
            if let Ok(Some(task)) = task_repo::get_task(self.conn, task_id) {
                if let Some(ref bookmark) = task.bookmark {
                    result = result.replace("{{bookmark}}", bookmark);
                }
                if let Ok(Some(meta)) = task_repo::get_metadata(self.conn, task_id) {
                    if let Some(ws) = meta.get("workspacePath").and_then(|v| v.as_str()) {
                        result = result.replace("{{workspace}}", ws);
                    }
                }
                if let Some(ref desc) = Some(&task.description) {
                    result = result.replace("{{task_description}}", desc);
                }
            }
        }

        result
    }
}

enum WaitResult {
    Completed {
        code: i32,
        stdout: String,
        stderr: String,
    },
    TimedOut,
    Error(String),
}

fn wait_with_timeout(mut child: std::process::Child, timeout: Duration) -> WaitResult {
    use std::sync::mpsc;
    use std::thread;

    let (tx, rx) = mpsc::channel();

    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let child_thread = thread::spawn(move || {
        let status = child.wait();
        let _ = tx.send(status);
        child
    });

    let (stdout, stderr) = thread::scope(|s| {
        let stdout_thread = s.spawn(|| {
            stdout_handle
                .map(|mut h| {
                    let mut buf = String::new();
                    use std::io::Read;
                    let _ = h.read_to_string(&mut buf);
                    buf
                })
                .unwrap_or_default()
        });
        let stderr_thread = s.spawn(|| {
            stderr_handle
                .map(|mut h| {
                    let mut buf = String::new();
                    use std::io::Read;
                    let _ = h.read_to_string(&mut buf);
                    buf
                })
                .unwrap_or_default()
        });
        (
            stdout_thread.join().unwrap_or_default(),
            stderr_thread.join().unwrap_or_default(),
        )
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(status)) => {
            let _ = child_thread.join();
            WaitResult::Completed {
                code: status.code().unwrap_or(-1),
                stdout,
                stderr,
            }
        }
        Ok(Err(e)) => {
            let _ = child_thread.join();
            WaitResult::Error(e.to_string())
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            if let Ok(mut child) = child_thread.join() {
                let _ = child.kill();
                let _ = child.wait();
            }
            WaitResult::TimedOut
        }
        Err(e) => WaitResult::Error(e.to_string()),
    }
}

fn format_output(stdout: &str, stderr: &str) -> String {
    let mut output = String::new();
    if !stdout.is_empty() {
        output.push_str(stdout);
    }
    if !stderr.is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(stderr);
    }
    output
}

fn cap_output(output: &str) -> String {
    if output.len() > OUTPUT_CAP {
        let mut capped = output[..OUTPUT_CAP].to_string();
        capped.push_str(&format!(
            "\n... truncated ({} bytes total)",
            output.len()
        ));
        capped
    } else {
        output.to_string()
    }
}
