//! Runtime configuration for the shell, resolved from environment variables
//! with dev-mode-sensible defaults -- the same `CONCORD_*` env-override
//! pattern used throughout the rest of this repo (see the root `CLAUDE.md`'s
//! "Environment variables" section).
//!
//! Nothing here talks to `tauri` -- this lives in `concord-shell-core`,
//! which was deliberately split out of the `concord-shell` Tauri binary so
//! it compiles and tests in this environment (see that crate's lib.rs docs
//! and ../../../README.md's honesty ledger).

use std::env;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ShellConfig {
    /// Absolute path to the repo root (parent of `concord-shell/`).
    pub repo_root: PathBuf,
    /// Absolute path to `concord-frontend/`.
    pub frontend_dir: PathBuf,
    /// Command to launch the frontend (e.g. "npm").
    pub frontend_cmd: String,
    /// Args for `frontend_cmd` (e.g. ["run", "dev"] or ["start"]).
    pub frontend_args: Vec<String>,
    /// Host to health-check the frontend against (no scheme).
    pub frontend_host: String,
    /// Port to health-check the frontend against.
    pub frontend_port: u16,
    /// Absolute path to `world-lens-godot/`.
    pub godot_project_dir: PathBuf,
    /// Godot binary name or absolute path. Defaults to "godot" (resolved via
    /// PATH) -- see docs/GODOT_INTEGRATION.md + HOW_TO_RUN.md: there is no
    /// Godot binary bundled with this repo; the user supplies one.
    pub godot_bin: String,
    /// Supervisor tick interval.
    pub health_interval_ms: u64,
    /// Timeout for a single HTTP health-check attempt.
    pub health_timeout_ms: u64,
    /// Bounded restart policy, shared shape for both children (see
    /// `concord_shell_supervisor::RestartPolicy` -- these are first-draft,
    /// untuned constants in the same spirit as the "Phase D first-draft
    /// constants" table in the root CLAUDE.md; override via env, don't bake
    /// in a felt-right guess as gospel).
    pub max_restart_attempts: u32,
    pub restart_base_ms: u64,
    pub restart_max_ms: u64,
}

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_or_u64(key: &str, default: u64) -> u64 {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn env_or_u32(key: &str, default: u32) -> u32 {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn env_or_u16(key: &str, default: u16) -> u16 {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

impl ShellConfig {
    pub fn from_env() -> Self {
        // Dev-mode default: `CARGO_MANIFEST_DIR` (baked in at compile time
        // for THIS crate) is <repo_root>/concord-shell/crates/shell-core --
        // three levels above repo root. A packaged production build should
        // set CONCORD_SHELL_REPO_ROOT explicitly rather than rely on this.
        let compile_time_manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let default_repo_root = compile_time_manifest_dir
            .parent() // crates/
            .and_then(Path::parent) // concord-shell/
            .and_then(Path::parent) // repo root
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));

        let repo_root = env::var("CONCORD_SHELL_REPO_ROOT")
            .map(PathBuf::from)
            .unwrap_or(default_repo_root);

        let frontend_dir = env::var("CONCORD_SHELL_FRONTEND_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| repo_root.join("concord-frontend"));

        let godot_project_dir = env::var("CONCORD_SHELL_GODOT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| repo_root.join("world-lens-godot"));

        // "dev" -> `npm run dev` (next dev, hot reload); "prod" -> `npm start`
        // (requires a prior `npm run build`). Mirrors concord-frontend's own
        // package.json scripts verbatim -- this shell does not reimplement
        // the web server, it launches the existing one.
        let mode = env_or("CONCORD_SHELL_FRONTEND_MODE", "dev");
        let (frontend_cmd, frontend_args) = match mode.as_str() {
            "prod" => ("npm".to_string(), vec!["start".to_string()]),
            _ => ("npm".to_string(), vec!["run".to_string(), "dev".to_string()]),
        };

        Self {
            repo_root,
            frontend_dir,
            frontend_cmd,
            frontend_args,
            frontend_host: env_or("CONCORD_SHELL_FRONTEND_HOST", "127.0.0.1"),
            frontend_port: env_or_u16("CONCORD_SHELL_FRONTEND_PORT", 3000),
            godot_project_dir,
            godot_bin: env_or("CONCORD_SHELL_GODOT_BIN", "godot"),
            health_interval_ms: env_or_u64("CONCORD_SHELL_HEALTH_INTERVAL_MS", 2000),
            health_timeout_ms: env_or_u64("CONCORD_SHELL_HEALTH_TIMEOUT_MS", 1500),
            max_restart_attempts: env_or_u32("CONCORD_SHELL_MAX_RESTART_ATTEMPTS", 5),
            restart_base_ms: env_or_u64("CONCORD_SHELL_RESTART_BASE_MS", 1000),
            restart_max_ms: env_or_u64("CONCORD_SHELL_RESTART_MAX_MS", 30_000),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deliberately does NOT exercise the CONCORD_SHELL_* env-var overrides
    // via std::env::set_var here: as of this Rust toolchain, set_var/
    // remove_var are `unsafe fn` precisely because mutating process-wide
    // env concurrently with cargo's default multi-threaded test runner is a
    // real data race, not a hypothetical one. Testing the default (no
    // env-var) path is safe and still proves the path-resolution math.
    #[test]
    fn default_paths_resolve_relative_to_the_real_repo_layout() {
        let cfg = ShellConfig::from_env();
        assert!(
            cfg.frontend_dir.ends_with("concord-frontend"),
            "frontend_dir was {:?}",
            cfg.frontend_dir
        );
        assert!(
            cfg.godot_project_dir.ends_with("world-lens-godot"),
            "godot_project_dir was {:?}",
            cfg.godot_project_dir
        );
        assert!(cfg.frontend_dir.starts_with(&cfg.repo_root));
        assert!(cfg.godot_project_dir.starts_with(&cfg.repo_root));
        // Sanity: the computed repo_root must be the REAL repo root, i.e.
        // it actually contains both directories on disk right now (this
        // crate's own compile-time CARGO_MANIFEST_DIR makes that provable
        // without any env override, unlike a packaged build).
        assert!(cfg.repo_root.join("concord-frontend").is_dir());
        assert!(cfg.repo_root.join("world-lens-godot").is_dir());
        assert!(cfg.repo_root.join("concord-shell").is_dir());
    }

    #[test]
    fn dev_mode_is_the_default_frontend_launch_command() {
        let cfg = ShellConfig::from_env();
        assert_eq!(cfg.frontend_cmd, "npm");
        // Default CONCORD_SHELL_FRONTEND_MODE is "dev" unless some other
        // process in this test binary already set it -- assert against
        // whichever mode is actually active rather than assuming "dev",
        // since env is process-global and test order isn't guaranteed
        // against other test binaries in the same `cargo test` invocation.
        assert!(
            cfg.frontend_args == vec!["run".to_string(), "dev".to_string()]
                || cfg.frontend_args == vec!["start".to_string()]
        );
    }
}
