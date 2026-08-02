# ADR 010: Real Python execution for ConKay/Concord chat via Pyodide

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Status     | Accepted                                               |
| Date       | 2026-08-02                                             |
| Authors    | ConKay/chat agent-loop tooling pass                    |
| Supersedes | N/A                                                    |
| Scope      | server runtime dependency                               |

## Context

`code.exec` (`server/domains/code.js`) and the agent loop's tool set
(`server/lib/chat-agent.js`) had no Python capability at all — the only
"run code" tool available to ConKay or Concord chat's LLM was JS/TS via
`node:vm`, which that file's own header already documents as "NOT a
security boundary." General-purpose scripting/data-wrangling (stringing
together results from other tool calls, quick data transforms) had no
real path other than asking the LLM to reason it out in prose or misuse
`run_lens_action` for something it wasn't built for.

## Decision

Add **`pyodide`** (CPython compiled to WebAssembly) as a server runtime
dependency, run inside a fresh `node:worker_threads` Worker per call
(`server/lib/python-sandbox.js`), wired into `code.exec` as
`language: "python"` and exposed as a first-class `run_python` tool in
the agent loop's tool schema.

Every claim below was verified by hand before writing production code —
real `npm install`, real load/run/kill tests against the actual package,
not assumed from documentation:

- The `pyodide` npm package bundles the WASM binary + the Python stdlib
  locally (~14MB). No network access or CDN fetch is needed to load and
  run base Python.
- Network access is **blocked by default**: `urllib.request.urlopen(...)`
  inside Pyodide throws, because this integration never wires up
  Pyodide's optional `pyfetch` bridge.
- Real host filesystem access is **blocked by default**: Pyodide's
  `open()` only ever sees its own in-memory virtual filesystem
  (Emscripten MEMFS) — `open("/etc/passwd")` raises a genuine
  `FileNotFoundError` inside that virtual FS, not a read of the real host
  file (confirmed the error text, not just that it threw).
- `worker.terminate()` reliably kills a Worker stuck in a genuine Python
  `while True: pass` busy-loop, in milliseconds.
- Cold `loadPyodide()` takes ~2 seconds per Worker instance. There is no
  pooling/warm-worker optimization — every call pays this cost. A known,
  documented latency tradeoff, not hidden.

### Where this is weaker than the existing plugin sandbox, stated plainly

`server/lib/plugin-sandbox.js` (JS plugin execution) runs its Worker under
Node's `--experimental-permission` model with zero `--allow-*` flags, a
second defense layer on top of Worker isolation. Pyodide's Node loader is
**structurally incompatible** with that flag — it calls
`process.binding(...)` internally during setup, which
`--experimental-permission` blocks unconditionally, with no `--allow-*`
combination that fixes it (tried `--allow-fs-read=*`, `--allow-wasi`,
`--allow-addons` together — still `Error: process.binding`). So the
Python sandbox runs its Worker **without** that layer, relying instead on
Pyodide's own WASM sandboxing (verified above: no real fs, no real
network) plus Worker isolation (separate V8 isolate + hard
`terminate()`).

Separately, V8's `resourceLimits` heap caps do **not** reliably bound
Pyodide's WASM linear memory — a Python loop appending 10MB bytearrays in
a Worker capped at `maxOldGenerationSizeMb: 128` was still running,
unstopped by the cap, 6+ seconds in. Consequence: the wall-clock run
timeout (`PYTHON_SANDBOX_RUN_TIMEOUT_MS`, 8s) is the **primary** defense
against both infinite loops and memory exhaustion, not a resource cap. The
operator's own process-level memory ceiling (pm2 `max_memory_restart`,
`--max-old-space-size`) is the real backstop for a memory spike inside
that window, same as it is for any other memory spike in the process.

## Why not the alternatives

- **A real subprocess (`child_process.spawn('python3', ...)`):** full
  library compatibility (including native C extensions numpy/scipy would
  need), but requires genuinely hardened isolation to be safe — network
  disabled, filesystem jailed, ideally a separate container/gVisor sandbox
  per call — which is real infrastructure work, not a quick wrapper.
  Rejected for this pass: this repo already fixed one command-injection-
  adjacent RCE this year (SEC-1, `domains/invariant.js`), and a real
  subprocess with a full syscall surface is a categorically bigger attack
  surface than a WASM interpreter with no ambient authority.
- **A remote code-execution service (Judge0/Piston-style):** breaks
  local-first sovereignty (ADR 003) for this subsystem, adds an external
  network dependency and a process to operate, for a capability that's
  fundamentally about stringing together already-local results.
- **No Python at all, JS-only via `code.exec`:** the honest baseline this
  ADR replaces. Real scripting/data-wrangling needs a real general-purpose
  language; asking the LLM to fake it in prose or misuse
  `run_lens_action` is worse than a well-scoped, verified sandbox.

## Consequences

- One new dependency (`pyodide`, MPL-2.0 — already on this repo's
  `docs/LICENSING.md` allowlist; `node scripts/audit/gates/license-scan.mjs`
  passes clean with it installed).
- Two independent kill-switches, deliberately not shared with the existing
  JS path: `CONCORD_PYTHON_EXEC_ENABLED` (defaults to the same
  dev/test-on, production-off posture as `CONCORD_CODE_EXEC_ENABLED`, but
  is a separate env var since the two paths have genuinely different
  risk/resource profiles).
- ~2s added latency per `run_python` tool call (cold Pyodide load, no
  pooling). Acceptable for the "quick script" use case this tool targets;
  not suitable for a tight request loop.
- The security detector suite (`node scripts/run-detectors.js --diff --ci`)
  reports zero new findings from this integration.
- 19 new tests: `server/tests/python-sandbox.test.js` (9, real Pyodide
  execution, no mocking — proves the isolation claims above at runtime),
  `server/tests/depth/code-exec-python-behavior.test.js` (1, end-to-end
  macro-registry wiring via `lensRun`), `server/tests/chat-agent.test.js`
  (+5, tool dispatch with a mocked `runMacro`).
