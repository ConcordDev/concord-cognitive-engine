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

## Addendum (2026-08-02): scientific packages (numpy/pandas/matplotlib/scipy/sympy)

The base `pyodide` npm install bundles only the core runtime + stdlib —
numpy/pandas/matplotlib/scipy are NOT included. Hand-verified: Pyodide's own
`loadPackage()` fetches them from `cdn.jsdelivr.net` on first use by
default, which would have silently made `run_python` depend on a live
third-party CDN, breaking this ADR's "no network needed" property. Instead:

- **Vendored, not CDN-fetched.** `server/lib/pyodide-packages.js` resolves
  the exact package closure (16 wheel files including transitive
  dependencies) off the *installed* pyodide's own `pyodide-lock.json` —
  never a hand-maintained list. `server/scripts/fetch-pyodide-packages.mjs`
  downloads them once (SHA-256-verified against that same lockfile) into
  `server/data/pyodide-packages/` (gitignored, regenerated artifact — same
  convention as the Godot web export). `python-sandbox.js#runPython(code,
  {packages})` then loads them via `pyodide.loadPackage([absoluteLocalPath,
  ...])` — genuinely zero network at call time.
- **Honest-by-construction, no fallback.** A requested package that hasn't
  been vendored fails with `python_package_not_vendored` and the exact
  missing-file list, resolved on the main thread BEFORE a worker even
  spawns. It never silently falls back to a CDN fetch — that fallback would
  reintroduce the exact dependency this design removes.
- **Not independently verifiable end-to-end in this sandboxed dev
  environment.** Its outbound-network proxy allowlists only a short list of
  hosts (`pypi.org`, `registry.npmjs.org`, this session's own GitHub repo,
  a few others) — `cdn.jsdelivr.net` is not on it (confirmed: a real fetch
  attempt gets a 403 from the proxy itself, `CONNECT tunnel failed`), and
  browsing `pyodide/pyodide`'s GitHub releases was blocked by this
  environment's own repo-scoping (`add_repo` refused a cross-tier add). A
  normal CI runner or production box with standard outbound HTTPS should
  reach `cdn.jsdelivr.net` without issue — a materially different network
  posture than this dev sandbox's narrow proxy. What IS verified end-to-end
  here, for real: the local-wheel-loading mechanism itself, proven with a
  small hand-built fixture wheel (`server/tests/fixtures/pyodide-test-wheel/`)
  that genuinely installs and imports via the exact call shape production
  uses (`server/tests/pyodide-packages.test.js`); the exact jsdelivr URL the
  fetch script constructs, byte-for-byte matched against the real URL the
  installed pyodide library itself attempted to fetch before this vendoring
  mechanism existed; and every honest-failure path (unknown package,
  not-yet-vendored package, kill-switch), all of which reproduce for real
  in this environment since nothing has been vendored here yet.
- **matplotlib gets a headless Agg backend** (`matplotlib.use("Agg")`, set
  right after `loadPackage` succeeds and before any user code runs — Agg
  must be selected before `pyplot` is imported for real) and a best-effort
  figure-capture step after user code runs (`savefig` to an in-memory
  `BytesIO`, base64-encoded, never touching the real filesystem). Wired
  into the agent loop as real image artifacts (`chat-agent.js`'s
  `run_python` tool), not inlined as base64 text into what the brain reads
  back — same discipline `generate_image` already uses. Live figure
  rendering is one of the two things this addendum could NOT verify
  end-to-end here (real matplotlib isn't vendored/reachable in this
  sandbox); the capture code itself was written to the same care and
  documented residual-risk standard as the rest of this file, not tested
  live.
- **`finance.cashflow-projection-python`** (`server/domains/finance.js`) is
  the first real macro built on this: a deterministic pandas/numpy-powered
  month-by-month savings trajectory (irregular one-time events + a fixed
  monthly rate), distinct from the two pre-existing JS calculators in that
  file (`compoundInterest` — single flat-rate path, no irregular cash
  flows; `retirement-monte-carlo` — stochastic simulation with random
  returns). Its core compounding formula is verified correct via an
  equivalent plain-Python (zero packages, genuinely executes in this
  sandbox) computation checked against hand-computed values
  (`server/tests/finance-cashflow-projection-python.test.js`) — the
  pandas/numpy translation of that verified formula is a mechanical,
  low-risk step flagged as the one residual untested layer, same as the
  matplotlib capture code above.
- 15 more new tests across this addendum: `server/tests/pyodide-packages.test.js`
  (12 — closure resolution, whitelist enforcement, the real local-wheel
  mechanism, the URL match), `server/tests/finance-cashflow-projection-python.test.js`
  (4), plus extensions to `chat-agent.test.js` and `code-domain-parity.test.js`
  for the `packages`/image-artifact plumbing.
