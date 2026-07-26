//! Glue between the pure `concord-shell-supervisor` state machine and real
//! OS processes / real health probes.
//!
//! **Honesty note:** everything in this file performs I/O (process spawn,
//! `try_wait`, TCP/HTTP probing via `concord-shell-health-probe`) -- but,
//! unlike `src-tauri/src/main.rs`, this file lives in `concord-shell-core`,
//! which has NO dependency on `tauri` at all. That means this is the one
//! layer of glue that genuinely compiles and integration-tests in this
//! sandboxed container (no display, no GTK/WebKit, no Godot binary) against
//! REAL child processes -- see the `#[cfg(test)]` module at the bottom for
//! real crash-detection/backoff/give-up cycles run against real `sh`
//! invocations, not synthetic booleans. The two things this file's tests do
//! NOT prove: that the real `npm run dev` / real Godot binary behave the
//! same way `sh -c "exit N"` does under this harness (a fair assumption --
//! `try_wait()` and `kill()` work identically regardless of what the child
//! process is), and anything Tauri-side (windows, commands, events), which
//! is `main.rs`'s job and remains unverified per `../../README.md`.
//!
//! # How this composes with the Godot client's own reconnect logic
//!
//! `world-lens-godot/net/gateway_client.gd` already reconnects its
//! WebSocket to the Concord server with exponential backoff (1s..30s,
//! jittered) whenever the SOCKET drops but the Godot PROCESS keeps running
//! (e.g. the server restarts, or a network blip). That layer is untouched
//! by this file and does not need to be -- `boot.gd`'s `_ready()` calls
//! `_gateway.connect_to_gateway()` unconditionally, so a freshly (re)spawned
//! Godot process reconnects on its own the instant it boots.
//!
//! This file's job is one layer up: deciding whether the Godot *process
//! itself* is alive, and relaunching it (with its own, independent backoff)
//! if it crashes outright. The two backoffs never fight each other because
//! they answer different questions -- "is the socket connected" (GDScript,
//! inside a running process) vs. "does the process exist at all" (this
//! file, the OS level) -- and a process restart always produces a clean
//! GatewayClient that starts its own backoff sequence from scratch, exactly
//! as if a human had relaunched the app.

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use concord_shell_supervisor::{
    ProcessKind, ProcessStatus, ProcessStatusView, RestartPolicy, ShellSupervisor, SupervisorAction,
};

use crate::config::ShellConfig;

struct ManagedProcess {
    child: Option<Child>,
    /// Backoff gate: don't attempt anything for this process before this
    /// instant. `None` means "attempt now" (first boot, or no pending
    /// restart). The pure `ProcessSupervisor` decides the *delay*; this
    /// struct is the glue layer's own timer honoring it -- the pure crate
    /// deliberately owns no clock (see its own doc comments).
    not_before: Option<Instant>,
}

impl ManagedProcess {
    fn new() -> Self {
        Self { child: None, not_before: None }
    }

    fn due(&self) -> bool {
        self.not_before.map(|t| Instant::now() >= t).unwrap_or(true)
    }
}

pub struct ShellState {
    config: ShellConfig,
    supervisor: ShellSupervisor,
    frontend_proc: ManagedProcess,
    godot_proc: ManagedProcess,
    /// Monotonic clock origin for the `now: Duration` the pure supervisor's
    /// `record_health_check` expects. Must be a single fixed origin for the
    /// lifetime of this `ShellState` -- using `Instant::now().elapsed()`
    /// fresh each call (a bug caught while writing this file) would always
    /// yield ~0 and silently defeat the sustained-health attempt-counter
    /// reset in `concord_shell_supervisor::ProcessSupervisor`.
    start_instant: Instant,
}

impl ShellState {
    pub fn new(config: ShellConfig) -> Self {
        let policy = RestartPolicy {
            max_attempts: config.max_restart_attempts,
            base_delay: Duration::from_millis(config.restart_base_ms),
            max_delay: Duration::from_millis(config.restart_max_ms),
            unhealthy_failure_threshold: 3,
            healthy_reset_after: Duration::from_secs(60),
        };
        Self {
            config,
            supervisor: ShellSupervisor::new(policy, policy),
            frontend_proc: ManagedProcess::new(),
            godot_proc: ManagedProcess::new(),
            start_instant: Instant::now(),
        }
    }

    pub fn config(&self) -> &ShellConfig {
        &self.config
    }

    fn spawn_frontend(&mut self) {
        let mut cmd = Command::new(&self.config.frontend_cmd);
        cmd.args(&self.config.frontend_args)
            .current_dir(&self.config.frontend_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        match cmd.spawn() {
            Ok(child) => {
                self.frontend_proc.child = Some(child);
                self.frontend_proc.not_before = None;
                self.supervisor.frontend.record_spawn_started();
                eprintln!(
                    "[concord-shell] frontend started: {} {:?} (cwd {})",
                    self.config.frontend_cmd,
                    self.config.frontend_args,
                    self.config.frontend_dir.display()
                );
            }
            Err(err) => {
                eprintln!("[concord-shell] frontend spawn FAILED: {err}");
                let action = self.supervisor.frontend.record_spawn_failed();
                self.apply_action(ProcessKind::Frontend, action);
            }
        }
    }

    fn spawn_godot(&mut self) {
        let mut cmd = Command::new(&self.config.godot_bin);
        cmd.arg("--path")
            .arg(&self.config.godot_project_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        match cmd.spawn() {
            Ok(child) => {
                self.godot_proc.child = Some(child);
                self.godot_proc.not_before = None;
                self.supervisor.godot.record_spawn_started();
                eprintln!(
                    "[concord-shell] godot started: {} --path {}",
                    self.config.godot_bin,
                    self.config.godot_project_dir.display()
                );
            }
            Err(err) => {
                // The realistic case: no Godot binary on PATH (this repo
                // ships no binary -- see world-lens-godot/HOW_TO_RUN.md).
                // Reported honestly, never silently swallowed.
                eprintln!(
                    "[concord-shell] godot spawn FAILED ({} --path {}): {err}",
                    self.config.godot_bin,
                    self.config.godot_project_dir.display()
                );
                let action = self.supervisor.godot.record_spawn_failed();
                self.apply_action(ProcessKind::Godot, action);
            }
        }
    }

    /// One supervisor tick. Call this on an interval (`config.health_interval_ms`)
    /// from the background thread in `main.rs`.
    pub fn tick(&mut self) {
        self.tick_frontend();
        self.tick_godot();
    }

    fn tick_frontend(&mut self) {
        if let Some(child) = self.frontend_proc.child.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    self.frontend_proc.child = None;
                    let action = self.supervisor.frontend.record_process_exited(status.code());
                    self.apply_action(ProcessKind::Frontend, action);
                }
                Ok(None) => {
                    let healthy = concord_shell_health_probe::http_get_status(
                        &self.config.frontend_host,
                        self.config.frontend_port,
                        "/",
                        Duration::from_millis(self.config.health_timeout_ms),
                    )
                    .map(concord_shell_health_probe::is_healthy_status)
                    .unwrap_or(false);
                    let now = self.start_instant.elapsed();
                    let action = self.supervisor.frontend.record_health_check(now, healthy);
                    self.apply_action(ProcessKind::Frontend, action);
                }
                Err(err) => {
                    eprintln!("[concord-shell] frontend try_wait error: {err}");
                }
            }
        } else if self.frontend_proc.due() {
            match self.supervisor.frontend.status() {
                ProcessStatus::RestartScheduled { .. } => {
                    if let SupervisorAction::SpawnNow = self.supervisor.frontend.record_restart_due() {
                        self.spawn_frontend();
                    }
                }
                ProcessStatus::NotStarted => self.spawn_frontend(),
                _ => {}
            }
        }
    }

    fn tick_godot(&mut self) {
        if let Some(child) = self.godot_proc.child.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    self.godot_proc.child = None;
                    let action = self.supervisor.godot.record_process_exited(status.code());
                    self.apply_action(ProcessKind::Godot, action);
                }
                Ok(None) => {
                    // Godot has no HTTP/diagnostics surface to probe (see
                    // docs/GODOT_INTEGRATION.md -- the client is a raw
                    // WebSocket consumer, not a server). Liveness for this
                    // process IS "the OS process hasn't exited" -- reporting
                    // that honestly as "healthy" rather than inventing a
                    // fake richer signal.
                    let now = self.start_instant.elapsed();
                    let action = self.supervisor.godot.record_health_check(now, true);
                    self.apply_action(ProcessKind::Godot, action);
                }
                Err(err) => {
                    eprintln!("[concord-shell] godot try_wait error: {err}");
                }
            }
        } else if self.godot_proc.due() {
            match self.supervisor.godot.status() {
                ProcessStatus::RestartScheduled { .. } => {
                    if let SupervisorAction::SpawnNow = self.supervisor.godot.record_restart_due() {
                        self.spawn_godot();
                    }
                }
                ProcessStatus::NotStarted => self.spawn_godot(),
                _ => {}
            }
        }
    }

    fn apply_action(&mut self, kind: ProcessKind, action: SupervisorAction) {
        match action {
            SupervisorAction::None | SupervisorAction::SpawnNow => {}
            SupervisorAction::RestartAfter { delay, attempt } => {
                eprintln!(
                    "[concord-shell] {} will restart in {:?} (attempt {})",
                    kind.label(),
                    delay,
                    attempt
                );
                let not_before = Instant::now() + delay;
                match kind {
                    ProcessKind::Frontend => self.frontend_proc.not_before = Some(not_before),
                    ProcessKind::Godot => self.godot_proc.not_before = Some(not_before),
                }
            }
            SupervisorAction::GiveUp { attempts } => {
                eprintln!(
                    "[concord-shell] {} crashed {} times in a row -- giving up automatic restarts. \
                     Call retry_{}() (or the UI's Retry action) to try again manually.",
                    kind.label(),
                    attempts,
                    kind.label()
                );
            }
            SupervisorAction::KillAndRestart => {
                eprintln!(
                    "[concord-shell] {} failed {} consecutive health checks -- killing and restarting",
                    kind.label(),
                    self.supervisor_failure_count(kind)
                );
                let proc = match kind {
                    ProcessKind::Frontend => &mut self.frontend_proc,
                    ProcessKind::Godot => &mut self.godot_proc,
                };
                if let Some(mut child) = proc.child.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                let action = match kind {
                    ProcessKind::Frontend => self.supervisor.frontend.record_process_exited(None),
                    ProcessKind::Godot => self.supervisor.godot.record_process_exited(None),
                };
                self.apply_action(kind, action);
            }
        }
    }

    fn supervisor_failure_count(&self, kind: ProcessKind) -> u32 {
        let status = match kind {
            ProcessKind::Frontend => self.supervisor.frontend.status(),
            ProcessKind::Godot => self.supervisor.godot.status(),
        };
        match status {
            ProcessStatus::Unhealthy { consecutive_failures } => *consecutive_failures,
            _ => 0,
        }
    }

    pub fn status_report(&self) -> Vec<ProcessStatusView> {
        self.supervisor.status_report()
    }

    /// Manual retry after a `GaveUp` terminal state (e.g. a UI "Retry"
    /// button). Clears the pure supervisor's attempt counter and lets the
    /// next tick spawn fresh.
    pub fn retry(&mut self, kind: ProcessKind) {
        match kind {
            ProcessKind::Frontend => {
                self.supervisor.frontend.reset();
                self.frontend_proc.not_before = None;
            }
            ProcessKind::Godot => {
                self.supervisor.godot.reset();
                self.godot_proc.not_before = None;
            }
        }
    }

    pub fn shutdown(&mut self) {
        self.supervisor.request_shutdown();
        if let Some(mut child) = self.frontend_proc.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(mut child) = self.godot_proc.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Real integration tests against real child processes (`sh`, plus a
/// throwaway shell-script fixture). Unix-only: they rely on `sh` being on
/// `PATH` and on setting the executable bit via
/// `std::os::unix::fs::PermissionsExt`, neither of which is a portable
/// assumption on Windows. This is an honest scope limit, not an oversight
/// -- the sandboxed container this was authored in is Linux, and these are
/// the only tests in this workspace that talk to the real OS process table.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_path(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("concord-shell-test-{name}-{nanos}-{}", std::process::id()))
    }

    /// A script that ignores whatever argv it's called with (in particular
    /// Godot's hardcoded `--path <dir>`) and just sleeps -- a stand-in for
    /// "the real binary stayed up".
    fn write_long_lived_script() -> std::path::PathBuf {
        let path = fixture_path("long-lived");
        let mut f = fs::File::create(&path).expect("create fixture script");
        f.write_all(b"#!/bin/sh\nsleep 30\n").expect("write fixture script");
        drop(f);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod +x");
        path
    }

    fn tiny_policy() -> RestartPolicy {
        RestartPolicy {
            max_attempts: 2,
            base_delay: Duration::from_millis(15),
            max_delay: Duration::from_millis(60),
            unhealthy_failure_threshold: 2,
            healthy_reset_after: Duration::from_secs(30),
        }
    }

    fn test_config(frontend_cmd: &str, frontend_args: &[&str], godot_bin: &str) -> ShellConfig {
        ShellConfig {
            repo_root: std::env::temp_dir(),
            frontend_dir: std::env::temp_dir(),
            frontend_cmd: frontend_cmd.to_string(),
            frontend_args: frontend_args.iter().map(|s| s.to_string()).collect(),
            frontend_host: "127.0.0.1".to_string(),
            frontend_port: 0, // no real HTTP server in these tests; health check will honestly fail
            godot_project_dir: std::env::temp_dir(),
            godot_bin: godot_bin.to_string(),
            health_interval_ms: 10,
            health_timeout_ms: 50,
            max_restart_attempts: 2,
            restart_base_ms: 15,
            restart_max_ms: 60,
        }
    }

    fn shell_state_with(cfg: ShellConfig) -> ShellState {
        let policy = tiny_policy();
        ShellState {
            config: cfg,
            supervisor: ShellSupervisor::new(policy, policy),
            frontend_proc: ManagedProcess::new(),
            godot_proc: ManagedProcess::new(),
            start_instant: Instant::now(),
        }
    }

    fn tick_until<F: Fn(&ShellState) -> bool>(state: &mut ShellState, predicate: F, max_iters: u32) -> bool {
        for _ in 0..max_iters {
            state.tick();
            if predicate(state) {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        predicate(state)
    }

    #[test]
    fn real_frontend_crash_is_detected_bounded_restarted_and_gives_up() {
        // `sh -c "exit 7"` is a REAL child process that runs and exits(7)
        // almost instantly -- a faithful proxy for "the real `npm run dev`
        // process crashed", exercising the exact same Command/try_wait/kill
        // machinery `spawn_frontend`/`tick_frontend` use in production.
        let cfg = test_config("sh", &["-c", "exit 7"], "sh");
        let mut state = shell_state_with(cfg);

        let gave_up = tick_until(
            &mut state,
            |s| matches!(s.supervisor.frontend.status(), ProcessStatus::GaveUp { .. }),
            100,
        );
        assert!(
            gave_up,
            "expected frontend to reach GaveUp after real repeated crashes, got {:?}",
            state.supervisor.frontend.status()
        );
        // Never silently reads as running once given up -- the exact
        // invariant this whole crate exists to guarantee.
        assert!(!state.supervisor.frontend.is_running_honestly());
        let report = state.status_report();
        assert_eq!(report[0].kind, "frontend");
        assert!(!report[0].running);
    }

    #[test]
    fn real_godot_binary_crash_via_hardcoded_arg_shape_is_detected() {
        // Exercises the ACTUAL production code path in `spawn_godot`
        // (`<godot_bin> --path <project_dir>`) rather than a proxy shape --
        // `sh --path <dir>` is a real invocation of that exact argv layout,
        // and POSIX sh reliably rejects the unrecognized long option and
        // exits nonzero immediately (verified interactively: exit code 2).
        let cfg = test_config("sh", &[], "sh");
        let mut state = shell_state_with(cfg);

        let gave_up = tick_until(
            &mut state,
            |s| matches!(s.supervisor.godot.status(), ProcessStatus::GaveUp { .. }),
            100,
        );
        assert!(
            gave_up,
            "expected godot to reach GaveUp after real repeated crashes, got {:?}",
            state.supervisor.godot.status()
        );
        assert!(!state.supervisor.godot.is_running_honestly());
    }

    #[test]
    fn real_long_lived_process_is_reported_healthy_across_ticks_then_stops_cleanly() {
        let script = write_long_lived_script();
        // Route the "godot" slot at the long-lived script (its hardcoded
        // `--path <dir>` argv is simply ignored by the script body).
        let cfg = test_config("sh", &["-c", "exit 0"], script.to_str().unwrap());
        let mut state = shell_state_with(cfg);

        // First tick spawns it (NotStarted -> Starting); subsequent ticks
        // should settle on Healthy and STAY there (no restart storm) as
        // long as the real OS process keeps running.
        let became_healthy = tick_until(
            &mut state,
            |s| matches!(s.supervisor.godot.status(), ProcessStatus::Healthy),
            50,
        );
        assert!(became_healthy, "expected godot to become Healthy while the real process is alive");

        for _ in 0..5 {
            state.tick();
            assert!(
                state.supervisor.godot.is_running_honestly(),
                "a still-alive real process must keep reporting as running, got {:?}",
                state.supervisor.godot.status()
            );
        }

        // Graceful shutdown must kill the real OS process and never
        // schedule a restart afterward -- proven by ticking several more
        // times post-shutdown and confirming it stays Stopped, not
        // Starting/RestartScheduled/Healthy again.
        state.shutdown();
        assert_eq!(state.supervisor.godot.status(), &ProcessStatus::Stopped);
        for _ in 0..5 {
            state.tick();
            assert_eq!(state.supervisor.godot.status(), &ProcessStatus::Stopped);
        }

        let _ = fs::remove_file(&script);
    }

    #[test]
    fn manual_retry_after_give_up_spawns_again() {
        let cfg = test_config("sh", &["-c", "exit 9"], "sh");
        let mut state = shell_state_with(cfg);

        let gave_up = tick_until(
            &mut state,
            |s| matches!(s.supervisor.frontend.status(), ProcessStatus::GaveUp { .. }),
            100,
        );
        assert!(gave_up);

        // Further ticks must NOT resurrect it on their own -- GaveUp is
        // terminal until an explicit retry.
        for _ in 0..5 {
            state.tick();
            assert!(matches!(state.supervisor.frontend.status(), ProcessStatus::GaveUp { .. }));
        }

        state.retry(ProcessKind::Frontend);
        assert_eq!(state.supervisor.frontend.status(), &ProcessStatus::NotStarted);

        // After a manual retry it must actually attempt to spawn again on
        // the next tick (and then crash again, since the fixture command
        // is still "exit 9" -- proving retry re-arms the real spawn path,
        // not just the in-memory status enum).
        state.tick();
        assert_ne!(state.supervisor.frontend.status(), &ProcessStatus::NotStarted);
    }
}
