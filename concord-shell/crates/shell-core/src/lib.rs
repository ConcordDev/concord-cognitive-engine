//! Real process-orchestration logic for the Concord desktop shell.
//!
//! This crate does REAL I/O (`std::process::Command` spawn/kill/`try_wait`,
//! real TCP/HTTP health probes via `concord-shell-health-probe`) but has
//! **no dependency on `tauri`** -- that split is deliberate. `tauri` pulls
//! in `wry`/GTK/WebKit on Linux, which requires system libraries this
//! sandboxed container does not have (see `../../README.md`'s honesty
//! ledger, including the exact `gdk-sys` pkg-config failure transcript).
//! Keeping this crate tauri-free means the *entire* process-lifecycle
//! orchestration -- not just the pure decision math in
//! `concord-shell-supervisor` -- compiles and integration-tests for real in
//! this environment, against real child processes. Only the thin Tauri
//! window/command wrapper in `src-tauri/src/main.rs` is left unverified.

pub mod config;
pub mod process_supervisor;

pub use config::ShellConfig;
pub use process_supervisor::ShellState;
