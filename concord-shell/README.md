# Concord Shell

A Tauri desktop shell that launches and supervises Concord's two client
processes as one packaged app:

1. **`concord-frontend/`** (Next.js) -- launched via its own existing
   `npm run dev` / `npm start` scripts. This shell does not reimplement the
   web server; it manages the same process a developer would start by hand.
2. **The Godot binary**, pointed at `world-lens-godot/project.godot` (see
   `world-lens-godot/HOW_TO_RUN.md` -- no Godot binary ships with this repo;
   the user supplies their own Godot 4.4-stable install — exactly 4.4, not '4.4+'; see world-lens-godot/HOW_TO_RUN.md for why a newer editor breaks the project).

This is R8/CL4 of Program B's Phase 6 packaging track.

---

## Honesty ledger -- read this before trusting anything below

This was built in a sandboxed container with `cargo`/`rustc` but **no
display, no GUI toolkit, and no Godot binary**. Concretely:

| Layer | Tooling available? | What was actually done |
|---|---|---|
| `cargo`/`rustc` | **Yes** (1.94.1, verified via `cargo --version`) | Real compiles happened. |
| crates.io / npm registry | **Yes** (both reachable through the sandbox's allowlisted proxy) | Real dependency resolution happened -- this is not a guessed/offline `Cargo.toml`. |
| `tauri`/`@tauri-apps/cli` CLI | **No** -- not preinstalled; `cargo install tauri-cli` was attempted and did not finish compiling within the available time budget (its own dependency tree is large) | `tauri.conf.json` is **hand-authored against the public Tauri v2 config schema from memory, not CLI-validated or `cargo tauri init`-generated.** Treat every field name/shape in it as a best-effort draft, not a proven-correct config, until someone runs `cargo tauri dev` for real. |
| GTK3/WebKitGTK system libraries (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, `javascriptcoregtk-4.1-dev`) | **No** -- confirmed absent via `pkg-config --exists` (all missing) | `cargo check -p concord-shell` was run for real and **fails**, reproducibly, at `gdk-sys v0.18.2`'s build script: `pkg-config exited with status code 1` / `Package 'gdk-3.0' was not found`. This is the actual, current failure in this container -- not a hypothetical. See the exact transcript below. |
| Godot binary | **No** -- confirmed absent (same constraint every other Godot unit this session hit; see `world-lens-godot/HOW_TO_RUN.md`) | Nothing here spawns or renders a real Godot process. `spawn_godot()` in `process_supervisor.rs` is real `std::process::Command` code that WILL work against a real `godot` binary on PATH, but that has never been exercised end-to-end here. |

**Bottom line:** three of the four workspace crates (`concord-shell-supervisor`,
`concord-shell-health-probe`, and -- after a mid-build restructure specifically
to maximize what's verifiable here -- `concord-shell-core`, which does the
REAL `std::process::Command` spawning/killing/crash-detection against real
child processes) are **genuinely compiled and tested in this container**.
`concord-shell-core` was deliberately split out with zero dependency on
`tauri` so the actual process-lifecycle orchestration -- not just the pure
decision math -- could be proven against real OS processes here, not merely
reviewed by eye. The fourth (`concord-shell`, the thin Tauri window/command
binary in `src-tauri/`) is **real, intended-to-compile Rust that has never
successfully built here** -- it is a thin wrapper around `concord-shell-core`'s
real, tested `ShellState`, but its own correctness (does it actually link,
does the hand-authored `tauri.conf.json` actually validate, does the window
actually open) is **unverified** and requires a machine with the Tauri
prerequisites installed: https://v2.tauri.app/start/prerequisites/

### Exact reproduction of the one real build attempt

```
$ cargo check -p concord-shell
   ...
error: failed to run custom build command for `gdk-sys v0.18.2`
  pkg-config exited with status code 1
  > PKG_CONFIG_ALLOW_SYSTEM_CFLAGS=1 pkg-config --libs --cflags gdk-3.0 'gdk-3.0 >= 3.22'
  Package 'gdk-3.0', required by 'virtual:world', not found
  The system library `gdk-3.0` required by crate `gdk-sys` was not found.
```

On a real Linux dev machine, installing the Tauri prerequisites (Debian/Ubuntu
example) resolves this class of failure:

```
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

(macOS and Windows need no equivalent system packages -- this is a
Linux/GTK-specific gap, not a Tauri-wide one.)

---

## Layout

```
concord-shell/
  Cargo.toml                      workspace root
  package.json                    convenience npm scripts wrapping the (uninstalled-here) tauri CLI
  crates/
    supervisor/                   PURE process-lifecycle state machine -- REAL, TESTED (13/13)
    health-probe/                 PURE-ish TCP/HTTP liveness probe -- REAL, TESTED (8/8, against real local sockets)
    shell-core/                   REAL process orchestration, NO tauri dependency -- REAL, TESTED
      src/config.rs                env-var-driven `ShellConfig` (paths, commands, timeouts, restart policy)
      src/process_supervisor.rs    real std::process::Command spawning/killing/crash-detection +
                                    real health-probe calls, feeding results into the pure supervisor
                                    and obeying its decisions -- integration-tested against real
                                    child processes (see "The pure/glue split" below)
  src-tauri/
    Cargo.toml                    the Tauri binary crate -- UNBUILT here (see honesty ledger)
    tauri.conf.json                hand-authored, UNVALIDATED Tauri v2 config
    build.rs                       standard `tauri_build::build()`
    src/main.rs                    Tauri app entry: thin wrapper exposing concord-shell-core's
                                    ShellState through Tauri commands/events + a background tick thread
```

## The pure/glue split (same pattern as `world-lens-godot/`'s `.gd` code)

This repo's Godot client work already established the pattern: pull anything
decidable-without-I/O into a pure function/module that can be unit tested with
no engine, and keep engine-dependent glue thin and separately flagged as
unverified. This unit ports that pattern to Rust:

- **`concord-shell-supervisor`** (`crates/supervisor/src/lib.rs`) is the pure
  process-lifecycle state machine: given "spawn succeeded/failed", "health
  check passed/failed", "process exited with code N", or "shutdown requested",
  it decides the next `SupervisorAction` (spawn now, restart after a computed
  backoff delay, kill-and-restart a hung process, or give up after bounded
  attempts) with **zero OS-process or I/O dependency**. It compiles and its
  13-test suite passes in this container right now.
- **`concord-shell-health-probe`** (`crates/health-probe/src/lib.rs`) is a
  dependency-free TCP/HTTP liveness prober (`std::net` only, no `reqwest`/
  `hyper`, no `tauri`). Its 8 tests spin up real local `TcpListener`s inside
  the test itself and assert against real socket behavior -- not mocked.
- **`concord-shell-core`** (`crates/shell-core/src/process_supervisor.rs`)
  is the glue: it does the actual `Command::spawn`/`try_wait`/`kill` calls
  and the actual `concord-shell-health-probe` HTTP calls, then feeds the
  results into `ProcessSupervisor` and executes whatever `SupervisorAction`
  comes back. Unlike `main.rs`, this crate has **no dependency on `tauri`**
  -- a deliberate mid-build restructure once it became clear `config.rs` and
  `process_supervisor.rs` didn't actually need tauri at all, only `main.rs`
  did. That makes this the one piece of "glue" (as opposed to pure decision
  logic) that is **genuinely compiled and integration-tested in this
  container**, against real `sh` child processes: real crash detection,
  real bounded-backoff restart cycles, a real long-lived process staying
  reported `Healthy` across ticks, and a real graceful shutdown that kills
  the child and never restarts it afterward. See
  `crates/shell-core/src/process_supervisor.rs`'s `#[cfg(test)]` module
  (Unix-only, documented why) and the reproduction command below.
- **`src-tauri/src/main.rs`** is now a thin Tauri wrapper: it constructs a
  `concord_shell_core::ShellState`, exposes `get_status`/`retry_frontend`/
  `retry_godot` as Tauri commands, ticks the state on a background thread,
  and emits status snapshots as a `concord-shell://status` event. This file
  (and only this file) has never compiled in this container, since it's the
  one place that actually pulls in `tauri`.

## Process lifecycle design (G29)

Each managed process (`Frontend`, `Godot`) gets its own
`concord_shell_supervisor::ProcessSupervisor` with an independent bounded
restart policy (`RestartPolicy`: max attempts, base/max backoff delay,
consecutive-failure threshold before a hung process is force-killed, and a
sustained-health window that resets the attempt counter so an old, long-since-
resolved crash streak doesn't permanently lock out future restarts).

A background thread in `main.rs` ticks both supervisors on an interval
(`CONCORD_SHELL_HEALTH_INTERVAL_MS`, default 2000ms):

- **Frontend health** = a real `GET /` against `CONCORD_SHELL_FRONTEND_HOST:PORT`
  (default `127.0.0.1:3000`); any non-5xx response counts as healthy (a 404 on
  a bad route is still "alive and serving"; only "nothing answered" or a 5xx
  count against it).
- **Godot health** = the OS process simply still existing (`try_wait()`
  returning `None`). Godot has no HTTP/diagnostics surface to probe (it's a
  raw WebSocket *client*, not a server -- see `docs/GODOT_INTEGRATION.md`), so
  there is no richer signal to fake; this is reported honestly rather than
  inventing a fabricated deeper health check.
- A crash (`try_wait()` returns `Some(exit_status)`) schedules a bounded,
  backed-off restart. Exceeding `max_attempts` (default 5) is a **terminal**
  `GaveUp` state -- the shell stops retrying and says so (via `eprintln!` logs
  today; the `retry_frontend`/`retry_godot` Tauri commands exist for a future
  UI "Retry" button to call). It never silently keeps a crashed process
  reported as "running".
- A graceful shell shutdown (`RunEvent::ExitRequested`) calls
  `ShellState::shutdown()`, which marks both supervisors `Stopped` (so their
  own process exits are never misread as crashes) and kills both children.

## Cross-runtime error recovery (G30) -- composing with the Godot client's own reconnect

`world-lens-godot/net/gateway_client.gd` **already** implements
connection-level reconnect-with-backoff (1s..30s exponential, jittered) for
the WebSocket *inside* a running Godot process -- this was built in an earlier
unit this session and is unchanged here. `boot.gd`'s `_ready()` calls
`_gateway.connect_to_gateway()` unconditionally on every scene load, so a
freshly (re)spawned Godot process reconnects from scratch automatically.

This unit's supervisor operates one layer up and answers a **different**
question: is the Godot **OS process** itself still alive, and if it crashed
outright, should the shell relaunch the binary. The two layers never fight
each other:

- Socket drops, process survives (server restart, brief network blip) -->
  handled entirely inside GDScript's own backoff; the shell-level supervisor
  sees a healthy `try_wait()` throughout and does nothing.
- The Godot **process itself** crashes or is killed --> the shell-level
  supervisor detects the exit via `try_wait()`, applies its own independent
  backoff, and relaunches the binary. The freshly spawned process boots
  `boot.gd` from scratch, which starts its OWN fresh reconnect sequence --
  functionally identical to what a human closing and reopening the app would
  produce.

No duplication: the shell never touches WebSocket state, and the GDScript
client never tracks OS process health.

## Configuration (env vars, `crates/shell-core/src/config.rs`)

| Var | Default | Meaning |
|---|---|---|
| `CONCORD_SHELL_REPO_ROOT` | two levels above `src-tauri/`'s compile-time manifest dir | repo root |
| `CONCORD_SHELL_FRONTEND_DIR` | `<repo_root>/concord-frontend` | frontend cwd |
| `CONCORD_SHELL_FRONTEND_MODE` | `dev` | `dev` -> `npm run dev`; `prod` -> `npm start` (needs a prior `npm run build`) |
| `CONCORD_SHELL_FRONTEND_HOST` / `_PORT` | `127.0.0.1` / `3000` | health-check target |
| `CONCORD_SHELL_GODOT_DIR` | `<repo_root>/world-lens-godot` | passed as `godot --path <dir>` |
| `CONCORD_SHELL_GODOT_BIN` | `godot` (resolved via PATH) | Godot binary; no binary ships with this repo |
| `CONCORD_SHELL_HEALTH_INTERVAL_MS` | `2000` | supervisor tick cadence |
| `CONCORD_SHELL_HEALTH_TIMEOUT_MS` | `1500` | single HTTP health-check timeout |
| `CONCORD_SHELL_MAX_RESTART_ATTEMPTS` | `5` | bounded restarts before `GaveUp` |
| `CONCORD_SHELL_RESTART_BASE_MS` / `_MAX_MS` | `1000` / `30000` | backoff bounds |

These are first-draft, untuned defaults in the same spirit as the "Phase D
first-draft constants" table in the root `CLAUDE.md` -- reasoned placeholders,
not playtested numbers. Override via env; don't treat them as gospel.

## How to actually build and run this (on a real machine)

1. Install Rust (stable) and the Tauri prerequisites for your OS:
   https://v2.tauri.app/start/prerequisites/
2. Install a Godot **4.4-stable** binary (exactly 4.4, not "4.4+" or newer --
   see `world-lens-godot/HOW_TO_RUN.md` for why a newer editor breaks the
   project) and put it on `PATH` (or set `CONCORD_SHELL_GODOT_BIN` to its
   absolute path).
3. `cd concord-shell && npm install` (pulls `@tauri-apps/cli`).
4. `npm run dev` (== `tauri dev`) -- this builds `concord-shell` for real for
   the first time and should surface exactly what (if anything) needs fixing
   in `tauri.conf.json` (expect the config schema to need at least a once-over
   against a real `cargo tauri` run, per the honesty ledger above).
5. Confirm: does a window open loading the Next.js dev server, does a Godot
   process actually launch alongside it, does killing the Godot process
   (e.g. `pkill godot`) produce a visible restart within
   `CONCORD_SHELL_HEALTH_INTERVAL_MS + backoff delay`. **None of this has been
   observed anywhere yet** -- log the outcome in
   `world-lens-godot/VISUAL_QA.md`'s new "Desktop shell" section.

## Running the parts that ARE verified, right now, in any environment

```bash
cd concord-shell
cargo test -p concord-shell-supervisor -p concord-shell-health-probe -p concord-shell-core
# All passing -- no display, no GUI toolkit, no Godot binary, and no
# external network service required (concord-shell-core's tests spawn real
# throwaway `sh` processes and a real short-lived shell-script fixture, not
# the actual npm/Godot binaries -- see that crate's own module docs for why
# that substitution is a fair one: try_wait()/kill() behave identically
# regardless of what the child process is).
```
