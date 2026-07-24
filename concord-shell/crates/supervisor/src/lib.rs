//! Pure process-lifecycle state machine for the Concord desktop shell.
//!
//! # Why this crate exists, separately from `src-tauri`
//!
//! This crate has **zero I/O and zero OS-process dependencies by design**.
//! It never spawns a process, never opens a socket, never touches a clock
//! except through values the caller passes in. Every public function is a
//! pure `fn(&mut self, ...) -> SupervisorAction` that can be unit tested
//! with no engine, no display, no webview library, no network -- which
//! matters concretely for this repo: the sandboxed container this crate was
//! authored in has `cargo`/`rustc` but **no** `webkit2gtk`/`gtk3`/`libsoup`
//! system libraries, so the `tauri` crate in `../src-tauri` cannot be built
//! (linking fails) here. This crate can, and its test suite is real,
//! reproducible proof -- not aspirational scaffolding.
//!
//! The glue code in `../shell-core/src/process_supervisor.rs` is a thin
//! adapter: it does the real `std::process::Command` spawning and real
//! TCP/HTTP health probing, then feeds the *results* of that I/O into a
//! [`ProcessSupervisor`] here and obeys whatever [`SupervisorAction`] comes
//! back. Same split this session already used throughout
//! `world-lens-godot/` (pure `.gd` math functions vs. engine-dependent
//! glue) -- ported to the Rust/Tauri side.
//!
//! # What this does NOT duplicate
//!
//! `world-lens-godot/net/gateway_client.gd` already implements
//! connection-level reconnect-with-backoff for the Godot *process's own*
//! WebSocket to the Concord gateway (1s..30s exponential backoff with
//! jitter, restarting at `boot.gd`'s `_ready()` on every fresh scene load).
//! That is a *different layer* from what this crate manages: this crate
//! only decides whether the **OS process itself** (the Godot binary, the
//! Next.js server binary) is alive and whether the shell should restart
//! it. It has no opinion about, and never touches, the WebSocket inside
//! either process. See the crate-level docs in `../shell-core/src/process_supervisor.rs`
//! for exactly how the two compose.

use std::time::Duration;

/// Which managed child process a [`ProcessSupervisor`] is tracking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessKind {
    /// `concord-frontend` (Next.js), started via its existing `npm start`
    /// (or `npm run dev`) script -- the shell does not reimplement the web
    /// server, it manages the same process a developer would launch by
    /// hand.
    Frontend,
    /// The Godot 4 binary, pointed at `world-lens-godot/project.godot`.
    Godot,
}

impl ProcessKind {
    pub fn label(&self) -> &'static str {
        match self {
            ProcessKind::Frontend => "frontend",
            ProcessKind::Godot => "godot",
        }
    }
}

/// Honest lifecycle status. Nothing in this enum can be misread as "running"
/// when it isn't -- `is_reportable_as_running` is the single chokepoint the
/// UI-facing status surface must call through (see [`ProcessSupervisor::is_running_honestly`]).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ProcessStatus {
    /// The shell has not attempted to start this process yet.
    NotStarted,
    /// A spawn was just issued; the glue layer is waiting for the process
    /// to come up (and, for the frontend, for its health endpoint to
    /// respond).
    Starting,
    /// Confirmed alive and healthy as of the last check.
    Healthy,
    /// Still running (or at least not reported exited) but failing health
    /// checks. Distinct from `Crashed` -- the OS process exists, it's just
    /// not answering. Tracked separately so a hung-not-dead process can be
    /// force-killed rather than silently ignored forever.
    Unhealthy { consecutive_failures: u32 },
    /// The OS process exited (crash or unexpected clean exit) and a restart
    /// has NOT yet been scheduled (transient state; a restart decision
    /// follows in the same call).
    Crashed { exit_code: Option<i32> },
    /// A restart is queued for `delay` from the moment it was scheduled.
    /// The glue layer owns the actual timer; this crate only records the
    /// decision.
    RestartScheduled { attempt: u32, delay_ms: u64 },
    /// Bounded restart attempts were exhausted. This is a **terminal**
    /// state (short of an explicit external reset) -- the supervisor will
    /// not try again on its own, and the status surface must say so
    /// honestly rather than imply "trying forever".
    GaveUp { attempts: u32 },
    /// Intentionally stopped (user quit the shell, or the shell is
    /// shutting down). Distinct from `Crashed` so a graceful stop never
    /// triggers a restart.
    Stopped,
}

/// Bounded-retry, exponential-backoff policy. Defaults are conservative
/// placeholders (see `docs/GODOT_INTEGRATION.md` / this crate's README note
/// for the "untuned constant, playtest fodder" framing already established
/// elsewhere in this repo for first-draft dials) -- callers are expected to
/// override via config/env, matching the `CONCORD_*` env-override pattern
/// used throughout the rest of the codebase.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RestartPolicy {
    /// Maximum number of restart attempts before giving up permanently.
    pub max_attempts: u32,
    /// Delay before the first restart attempt (attempt index 0).
    pub base_delay: Duration,
    /// Hard cap on backoff delay, regardless of attempt count.
    pub max_delay: Duration,
    /// Consecutive failed health checks before an alive-but-unresponsive
    /// process is treated as needing a forced kill+restart.
    pub unhealthy_failure_threshold: u32,
    /// How long a process must stay continuously healthy before the
    /// restart-attempt counter resets to zero. Without this, a process
    /// that crashed 5 times last week (already at `max_attempts`) but has
    /// been healthy for hours would incorrectly stay locked out of ever
    /// restarting again after a *new*, unrelated crash.
    pub healthy_reset_after: Duration,
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 5,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(30),
            unhealthy_failure_threshold: 3,
            healthy_reset_after: Duration::from_secs(60),
        }
    }
}

/// Pure exponential backoff with a hard cap. `attempt` is 0-indexed (the
/// first restart is attempt 0, delayed by exactly `base_delay`).
///
/// No jitter is added here deliberately -- the shell only supervises at
/// most two processes, so herd-effect jitter (which `gateway_client.gd`
/// does need, since many Godot clients could reconnect to one server at
/// once) is not a real concern at this layer. If that changes, add jitter
/// in the glue layer around the returned `Duration`, not here -- keep this
/// function deterministic so it stays trivially testable.
pub fn backoff_delay(policy: &RestartPolicy, attempt: u32) -> Duration {
    let exp: u64 = 1u64.checked_shl(attempt.min(20)).unwrap_or(u64::MAX);
    let base_ms = policy.base_delay.as_millis().min(u128::from(u64::MAX)) as u64;
    let scaled = base_ms.saturating_mul(exp);
    let capped = scaled.min(policy.max_delay.as_millis() as u64);
    Duration::from_millis(capped)
}

/// What the glue layer must do in response to a state transition. The
/// supervisor never performs I/O itself -- it only ever hands back one of
/// these for the caller to execute.
#[derive(Debug, Clone, PartialEq)]
pub enum SupervisorAction {
    /// Nothing to do this call.
    None,
    /// Caller should spawn the process now.
    SpawnNow,
    /// Caller should wait `delay` (its own timer/clock) and then spawn.
    RestartAfter { delay: Duration, attempt: u32 },
    /// Bounded restarts exhausted. The caller MUST surface this to the
    /// user honestly (e.g. a persistent "Godot crashed repeatedly and the
    /// shell stopped retrying" banner) -- never silently stop trying
    /// without saying so.
    GiveUp { attempts: u32 },
    /// The process is alive but has failed enough consecutive health
    /// checks to be considered hung. Caller should forcibly kill it; the
    /// resulting exit will be reported back via `record_process_exited`,
    /// which will then schedule the actual restart.
    KillAndRestart,
}

/// Per-process supervisor. One instance per managed child process
/// (frontend, Godot).
#[derive(Debug, Clone)]
pub struct ProcessSupervisor {
    kind: ProcessKind,
    policy: RestartPolicy,
    status: ProcessStatus,
    attempt: u32,
    consecutive_failures: u32,
    healthy_since: Option<Duration>,
}

impl ProcessSupervisor {
    pub fn new(kind: ProcessKind, policy: RestartPolicy) -> Self {
        Self {
            kind,
            policy,
            status: ProcessStatus::NotStarted,
            attempt: 0,
            consecutive_failures: 0,
            healthy_since: None,
        }
    }

    pub fn kind(&self) -> ProcessKind {
        self.kind
    }

    pub fn status(&self) -> &ProcessStatus {
        &self.status
    }

    pub fn attempt(&self) -> u32 {
        self.attempt
    }

    /// The ONLY function the UI-facing status surface should trust for
    /// "is this thing actually up". Deliberately narrow: only `Healthy` and
    /// `Starting` count. Every other state -- including `Unhealthy`, which
    /// is technically still an OS process that exists -- reports false,
    /// because "the process object exists but isn't answering" is not the
    /// same claim as "running" from a user's point of view.
    pub fn is_running_honestly(&self) -> bool {
        matches!(self.status, ProcessStatus::Healthy | ProcessStatus::Starting)
    }

    /// Call immediately after the glue layer has issued a real
    /// `std::process::Command::spawn()` that succeeded.
    pub fn record_spawn_started(&mut self) {
        self.status = ProcessStatus::Starting;
        self.consecutive_failures = 0;
        self.healthy_since = None;
    }

    /// Call when a spawn attempt itself failed (binary not found, exec
    /// permission denied, etc. -- `spawn()` returned `Err` before a
    /// process even existed).
    pub fn record_spawn_failed(&mut self) -> SupervisorAction {
        self.bump_attempt_and_decide()
    }

    /// Call on every health-check tick with whether the process currently
    /// reports healthy. For the frontend this is "did `GET /` respond with
    /// a non-5xx status"; for Godot (no HTTP surface) this degrades to
    /// "is the OS process still alive", which the glue layer determines by
    /// polling `try_wait()` -- see `process_supervisor.rs`.
    pub fn record_health_check(&mut self, now: Duration, healthy: bool) -> SupervisorAction {
        if matches!(self.status, ProcessStatus::Stopped | ProcessStatus::GaveUp { .. }) {
            return SupervisorAction::None;
        }

        if healthy {
            self.consecutive_failures = 0;
            if !matches!(self.status, ProcessStatus::Healthy) {
                self.healthy_since = Some(now);
            }
            self.status = ProcessStatus::Healthy;

            if let Some(since) = self.healthy_since {
                if now.checked_sub(since).unwrap_or_default() >= self.policy.healthy_reset_after {
                    self.attempt = 0;
                }
            }
            SupervisorAction::None
        } else {
            self.consecutive_failures += 1;
            self.healthy_since = None;
            self.status = ProcessStatus::Unhealthy {
                consecutive_failures: self.consecutive_failures,
            };
            if self.consecutive_failures >= self.policy.unhealthy_failure_threshold {
                SupervisorAction::KillAndRestart
            } else {
                SupervisorAction::None
            }
        }
    }

    /// Call when the glue layer observes the OS process has actually
    /// exited (via `try_wait()` returning `Some(status)`, or after a
    /// `KillAndRestart` kill completes). This is the ONLY crash-detection
    /// signal for Godot, which has no health endpoint to poll.
    pub fn record_process_exited(&mut self, exit_code: Option<i32>) -> SupervisorAction {
        if matches!(self.status, ProcessStatus::Stopped) {
            // Intentional stop -- an exit here is expected, not a crash.
            return SupervisorAction::None;
        }
        self.status = ProcessStatus::Crashed { exit_code };
        self.bump_attempt_and_decide()
    }

    /// Call once the glue layer's own timer confirms a scheduled restart
    /// delay has elapsed, to get the go-ahead to actually spawn.
    pub fn record_restart_due(&mut self) -> SupervisorAction {
        match self.status {
            ProcessStatus::RestartScheduled { .. } => SupervisorAction::SpawnNow,
            _ => SupervisorAction::None,
        }
    }

    /// User quit the shell (or the shell is shutting down). No further
    /// restarts should be attempted for this process.
    pub fn record_shutdown_requested(&mut self) {
        self.status = ProcessStatus::Stopped;
    }

    /// Explicit external reset (e.g. a "Retry" button in the UI after a
    /// `GaveUp`). Clears the attempt counter and returns to `NotStarted`
    /// so the glue layer can spawn fresh.
    pub fn reset(&mut self) {
        self.status = ProcessStatus::NotStarted;
        self.attempt = 0;
        self.consecutive_failures = 0;
        self.healthy_since = None;
    }

    fn bump_attempt_and_decide(&mut self) -> SupervisorAction {
        self.attempt += 1;
        if self.attempt > self.policy.max_attempts {
            self.status = ProcessStatus::GaveUp { attempts: self.attempt };
            return SupervisorAction::GiveUp { attempts: self.attempt };
        }
        let delay = backoff_delay(&self.policy, self.attempt - 1);
        self.status = ProcessStatus::RestartScheduled {
            attempt: self.attempt,
            delay_ms: delay.as_millis() as u64,
        };
        SupervisorAction::RestartAfter { delay, attempt: self.attempt }
    }
}

/// Serializable snapshot for sending to the Tauri frontend (a Tauri event
/// payload or command return value). Kept separate from `ProcessStatus`
/// itself so the wire shape can evolve without renaming the internal enum.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProcessStatusView {
    pub kind: &'static str,
    pub status: ProcessStatus,
    pub attempt: u32,
    pub running: bool,
}

impl ProcessSupervisor {
    pub fn status_view(&self) -> ProcessStatusView {
        ProcessStatusView {
            kind: self.kind.label(),
            status: self.status.clone(),
            attempt: self.attempt,
            running: self.is_running_honestly(),
        }
    }
}

/// Aggregates the frontend + Godot supervisors so the shell can answer "is
/// the whole app up" in one call without either half lying about the other.
pub struct ShellSupervisor {
    pub frontend: ProcessSupervisor,
    pub godot: ProcessSupervisor,
}

impl ShellSupervisor {
    pub fn new(frontend_policy: RestartPolicy, godot_policy: RestartPolicy) -> Self {
        Self {
            frontend: ProcessSupervisor::new(ProcessKind::Frontend, frontend_policy),
            godot: ProcessSupervisor::new(ProcessKind::Godot, godot_policy),
        }
    }

    /// Both must be honestly running for the aggregate to claim "ready".
    pub fn is_ready(&self) -> bool {
        self.frontend.is_running_honestly() && self.godot.is_running_honestly()
    }

    pub fn status_report(&self) -> Vec<ProcessStatusView> {
        vec![self.frontend.status_view(), self.godot.status_view()]
    }

    pub fn request_shutdown(&mut self) {
        self.frontend.record_shutdown_requested();
        self.godot.record_shutdown_requested();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fast_policy() -> RestartPolicy {
        RestartPolicy {
            max_attempts: 3,
            base_delay: Duration::from_millis(100),
            max_delay: Duration::from_millis(800),
            unhealthy_failure_threshold: 2,
            healthy_reset_after: Duration::from_secs(10),
        }
    }

    #[test]
    fn backoff_grows_exponentially_and_caps() {
        let policy = fast_policy();
        assert_eq!(backoff_delay(&policy, 0), Duration::from_millis(100));
        assert_eq!(backoff_delay(&policy, 1), Duration::from_millis(200));
        assert_eq!(backoff_delay(&policy, 2), Duration::from_millis(400));
        assert_eq!(backoff_delay(&policy, 3), Duration::from_millis(800)); // would be 800 exactly anyway
        assert_eq!(backoff_delay(&policy, 4), Duration::from_millis(800)); // capped, would be 1600 uncapped
        assert_eq!(backoff_delay(&policy, 30), Duration::from_millis(800)); // still capped, no overflow panic
    }

    #[test]
    fn new_supervisor_starts_not_started_and_not_running() {
        let sup = ProcessSupervisor::new(ProcessKind::Godot, fast_policy());
        assert_eq!(sup.status(), &ProcessStatus::NotStarted);
        assert!(!sup.is_running_honestly());
    }

    #[test]
    fn spawn_then_healthy_reports_running() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Frontend, fast_policy());
        sup.record_spawn_started();
        assert!(sup.is_running_honestly()); // Starting counts as running-ish
        let action = sup.record_health_check(Duration::from_secs(1), true);
        assert_eq!(action, SupervisorAction::None);
        assert_eq!(sup.status(), &ProcessStatus::Healthy);
        assert!(sup.is_running_honestly());
    }

    #[test]
    fn crash_schedules_bounded_restarts_then_gives_up() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Godot, fast_policy());
        sup.record_spawn_started();

        // Attempt 1
        let a1 = sup.record_process_exited(Some(1));
        assert_eq!(
            a1,
            SupervisorAction::RestartAfter { delay: Duration::from_millis(100), attempt: 1 }
        );
        assert!(!sup.is_running_honestly());

        // Simulate the glue layer's timer firing.
        assert_eq!(sup.record_restart_due(), SupervisorAction::SpawnNow);
        sup.record_spawn_started();

        // Attempt 2
        let a2 = sup.record_process_exited(Some(1));
        assert_eq!(
            a2,
            SupervisorAction::RestartAfter { delay: Duration::from_millis(200), attempt: 2 }
        );
        sup.record_spawn_started();

        // Attempt 3 (== max_attempts, still allowed)
        let a3 = sup.record_process_exited(Some(1));
        assert_eq!(
            a3,
            SupervisorAction::RestartAfter { delay: Duration::from_millis(400), attempt: 3 }
        );
        sup.record_spawn_started();

        // Attempt 4 exceeds max_attempts=3 -> give up, and it must be terminal.
        let a4 = sup.record_process_exited(Some(1));
        assert_eq!(a4, SupervisorAction::GiveUp { attempts: 4 });
        assert_eq!(sup.status(), &ProcessStatus::GaveUp { attempts: 4 });
        assert!(!sup.is_running_honestly());

        // A crashed-again call after GaveUp must not restart further or
        // silently re-arm -- the terminal state holds.
        let a5 = sup.record_process_exited(Some(1));
        // record_process_exited on a GaveUp process still runs the normal
        // path (it is not Stopped), so it will bump attempt again and stay
        // in GaveUp -- verifying it never regresses back to a restart.
        assert!(matches!(a5, SupervisorAction::GiveUp { .. }));
    }

    #[test]
    fn intentional_stop_suppresses_restart_on_exit() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Frontend, fast_policy());
        sup.record_spawn_started();
        sup.record_health_check(Duration::from_secs(1), true);
        sup.record_shutdown_requested();
        assert_eq!(sup.status(), &ProcessStatus::Stopped);

        // Process exiting after an intentional stop must NOT schedule a
        // restart -- this is the "graceful shutdown never triggers a
        // restart storm" contract.
        let action = sup.record_process_exited(Some(0));
        assert_eq!(action, SupervisorAction::None);
        assert_eq!(sup.status(), &ProcessStatus::Stopped);
    }

    #[test]
    fn sustained_unhealthy_triggers_kill_and_restart() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Frontend, fast_policy());
        sup.record_spawn_started();

        // First failure: below threshold (2), no action yet.
        let a1 = sup.record_health_check(Duration::from_secs(1), false);
        assert_eq!(a1, SupervisorAction::None);
        assert_eq!(
            sup.status(),
            &ProcessStatus::Unhealthy { consecutive_failures: 1 }
        );
        assert!(!sup.is_running_honestly()); // Unhealthy must NEVER report running

        // Second failure: hits threshold -> kill and restart.
        let a2 = sup.record_health_check(Duration::from_secs(2), false);
        assert_eq!(a2, SupervisorAction::KillAndRestart);
    }

    #[test]
    fn healthy_check_resets_failure_streak() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Frontend, fast_policy());
        sup.record_spawn_started();
        sup.record_health_check(Duration::from_secs(1), false);
        assert_eq!(
            sup.status(),
            &ProcessStatus::Unhealthy { consecutive_failures: 1 }
        );
        // A subsequent healthy check must clear the streak, not merely
        // pause it -- otherwise a single flaky check followed by years of
        // healthy checks would still be "one failure away" from a forced
        // kill forever.
        sup.record_health_check(Duration::from_secs(2), true);
        assert_eq!(sup.status(), &ProcessStatus::Healthy);
        let a = sup.record_health_check(Duration::from_secs(3), false);
        assert_eq!(a, SupervisorAction::None); // back to failure count 1, not 2
        assert_eq!(
            sup.status(),
            &ProcessStatus::Unhealthy { consecutive_failures: 1 }
        );
    }

    #[test]
    fn attempt_counter_resets_after_sustained_health() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Godot, fast_policy());
        sup.record_spawn_started();

        // One crash + restart cycle to bump attempt to 1.
        sup.record_process_exited(Some(1));
        assert_eq!(sup.attempt(), 1);
        sup.record_restart_due();
        sup.record_spawn_started();

        // Becomes healthy at t=0s, still healthy at t=11s (>= healthy_reset_after=10s).
        sup.record_health_check(Duration::from_secs(0), true);
        assert_eq!(sup.attempt(), 1); // not reset yet, just became healthy
        sup.record_health_check(Duration::from_secs(11), true);
        assert_eq!(sup.attempt(), 0); // reset after sustained health

        // A fresh crash after the reset must restart at attempt 1's delay
        // again, not continue from wherever it left off -- proving old
        // crashes don't count against a process that has since proven
        // stable.
        let action = sup.record_process_exited(Some(1));
        assert_eq!(
            action,
            SupervisorAction::RestartAfter { delay: Duration::from_millis(100), attempt: 1 }
        );
    }

    #[test]
    fn spawn_failure_before_any_process_exists_still_backs_off_and_bounds() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Godot, fast_policy());
        // Binary missing / exec denied -- no process was ever created.
        let a1 = sup.record_spawn_failed();
        assert_eq!(
            a1,
            SupervisorAction::RestartAfter { delay: Duration::from_millis(100), attempt: 1 }
        );
        let a2 = sup.record_spawn_failed();
        assert_eq!(
            a2,
            SupervisorAction::RestartAfter { delay: Duration::from_millis(200), attempt: 2 }
        );
        let a3 = sup.record_spawn_failed();
        assert_eq!(
            a3,
            SupervisorAction::RestartAfter { delay: Duration::from_millis(400), attempt: 3 }
        );
        let a4 = sup.record_spawn_failed();
        assert_eq!(a4, SupervisorAction::GiveUp { attempts: 4 });
    }

    #[test]
    fn reset_clears_gave_up_state_for_a_manual_retry() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Godot, fast_policy());
        for _ in 0..4 {
            sup.record_spawn_failed();
        }
        assert!(matches!(sup.status(), ProcessStatus::GaveUp { .. }));
        sup.reset();
        assert_eq!(sup.status(), &ProcessStatus::NotStarted);
        assert_eq!(sup.attempt(), 0);
        assert!(!sup.is_running_honestly());
    }

    #[test]
    fn health_checks_are_inert_once_given_up() {
        let mut sup = ProcessSupervisor::new(ProcessKind::Frontend, fast_policy());
        for _ in 0..4 {
            sup.record_spawn_failed();
        }
        assert!(matches!(sup.status(), ProcessStatus::GaveUp { .. }));
        let action = sup.record_health_check(Duration::from_secs(999), true);
        assert_eq!(action, SupervisorAction::None);
        // Status must stay GaveUp -- a health check must never resurrect a
        // process the supervisor never actually spawned.
        assert!(matches!(sup.status(), ProcessStatus::GaveUp { .. }));
    }

    #[test]
    fn shell_supervisor_is_ready_only_when_both_children_are_honestly_running() {
        let mut shell = ShellSupervisor::new(fast_policy(), fast_policy());
        assert!(!shell.is_ready());

        shell.frontend.record_spawn_started();
        shell.frontend.record_health_check(Duration::from_secs(1), true);
        assert!(!shell.is_ready()); // godot still NotStarted

        shell.godot.record_spawn_started();
        assert!(shell.is_ready()); // Starting counts; both sides now non-idle

        shell.godot.record_process_exited(Some(1));
        assert!(!shell.is_ready()); // one crashed child makes the whole shell not-ready

        shell.request_shutdown();
        assert_eq!(shell.frontend.status(), &ProcessStatus::Stopped);
        assert_eq!(shell.godot.status(), &ProcessStatus::Stopped);
    }

    #[test]
    fn status_report_serializes_for_the_tauri_wire() {
        let shell = ShellSupervisor::new(fast_policy(), fast_policy());
        let report = shell.status_report();
        assert_eq!(report.len(), 2);
        assert_eq!(report[0].kind, "frontend");
        assert_eq!(report[1].kind, "godot");
        // Real serde round-trip, not just "it compiles" -- proves the enum
        // shape the Tauri frontend would actually receive.
        let json = serde_json::to_string(&report[0]).expect("serializes");
        assert!(json.contains("\"kind\":\"frontend\""));
        assert!(json.contains("\"running\":false"));
    }
}
