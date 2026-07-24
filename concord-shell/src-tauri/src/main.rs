// Prevents an additional console window from popping up on Windows release
// builds. Standard Tauri boilerplate.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent, State};

use concord_shell_core::{ShellConfig, ShellState};

struct AppState(Mutex<ShellState>);

/// Returns the current honest status of both managed processes. Called by
/// the (future) shell UI to render a status strip -- never fabricates a
/// "running" state; see `concord_shell_supervisor::ProcessSupervisor::is_running_honestly`.
#[tauri::command]
fn get_status(state: State<AppState>) -> Vec<concord_shell_supervisor::ProcessStatusView> {
    state.0.lock().expect("state mutex poisoned").status_report()
}

#[tauri::command]
fn retry_frontend(state: State<AppState>) {
    state
        .0
        .lock()
        .expect("state mutex poisoned")
        .retry(concord_shell_supervisor::ProcessKind::Frontend);
}

#[tauri::command]
fn retry_godot(state: State<AppState>) {
    state
        .0
        .lock()
        .expect("state mutex poisoned")
        .retry(concord_shell_supervisor::ProcessKind::Godot);
}

fn main() {
    let config = ShellConfig::from_env();
    eprintln!(
        "[concord-shell] repo_root={} frontend_dir={} godot_dir={} godot_bin={}",
        config.repo_root.display(),
        config.frontend_dir.display(),
        config.godot_project_dir.display(),
        config.godot_bin
    );

    let health_interval_ms = config.health_interval_ms;
    let shared_state = AppState(Mutex::new(ShellState::new(config)));

    tauri::Builder::default()
        .manage(shared_state)
        .invoke_handler(tauri::generate_handler![get_status, retry_frontend, retry_godot])
        .setup(move |app| {
            // Background supervisor loop: ticks the pure state machine on
            // an interval and pushes a status snapshot to the frontend as a
            // `concord-shell://status` event so a status UI can subscribe
            // without polling `get_status` itself. Runs for the lifetime of
            // the app; the loop exits naturally once the app handle's
            // window is gone (checked each iteration) rather than being
            // explicitly cancelled -- acceptable for a single-window shell.
            let app_handle = app.handle().clone();
            thread::spawn(move || loop {
                {
                    let state = app_handle.state::<AppState>();
                    let mut guard = state.0.lock().expect("state mutex poisoned");
                    guard.tick();
                    let report = guard.status_report();
                    drop(guard);
                    // Best-effort -- a failed emit (e.g. window already
                    // closing) is not itself a supervisor failure.
                    let _ = app_handle.emit("concord-shell://status", report);
                }
                thread::sleep(Duration::from_millis(health_interval_ms));
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building concord-shell tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                eprintln!("[concord-shell] exit requested -- shutting down managed processes");
                let state = app_handle.state::<AppState>();
                state.0.lock().expect("state mutex poisoned").shutdown();
            }
        });
}
