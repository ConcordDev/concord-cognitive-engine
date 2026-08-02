/**
 * Python Sandbox — real Python execution for `code.exec` (language: "python")
 * and the agent loop's `run_python` tool, via Pyodide (CPython compiled to
 * WebAssembly) running inside a Node `worker_threads` Worker.
 *
 * ── What this actually is, verified by hand before writing this file ──
 * (`npm view pyodide` + a real local install + real load/run/kill tests —
 * see the commit that introduced this file for the exact commands. Every
 * claim below was checked, not assumed.)
 *
 *   - The `pyodide` npm package bundles the WASM binary + the Python stdlib
 *     locally (~14MB). No network access or CDN fetch is needed to load and
 *     run base Python — confirmed by loading with a local `indexURL`.
 *   - Cold `loadPyodide()` takes ~2 seconds per Worker instance. There is no
 *     pooling/warm-worker optimization here — every call pays this cost.
 *     Flagged as a real, known latency cost, not hidden.
 *   - Network access is BLOCKED by default: `urllib.request.urlopen(...)`
 *     inside Pyodide throws, because Pyodide never gets a `pyfetch` bridge
 *     wired up here (that bridge is opt-in on the host side and this file
 *     never provides it).
 *   - Real host filesystem access is BLOCKED by default: Pyodide's `open()`
 *     only ever sees its own in-memory virtual filesystem (Emscripten
 *     MEMFS) — `open("/etc/passwd")` raises a genuine `FileNotFoundError`
 *     inside that virtual FS, not a read of the real host file.
 *   - `worker.terminate()` reliably kills a Worker stuck in a genuine
 *     Python `while True: pass` busy-loop, in milliseconds — verified with
 *     a real busy-loop + external terminate() call.
 *
 * ── Where this is WEAKER than `plugin-sandbox.js`, stated plainly ──
 *
 *   1. NO Node permission-model layer. `plugin-sandbox.js`'s second defense
 *      layer runs its worker with `--experimental-permission` and zero
 *      `--allow-*` flags, blocking `fs`/`child_process`/native-addons at
 *      the Node binding layer regardless of what the sandboxed code tries.
 *      Pyodide's own Node loader is STRUCTURALLY INCOMPATIBLE with that
 *      flag — it calls `process.binding(...)` internally during setup,
 *      which `--experimental-permission` blocks unconditionally with NO
 *      `--allow-*` combination that fixes it (tried `--allow-fs-read=*`,
 *      `--allow-wasi`, `--allow-addons` together — still `Error:
 *      process.binding`). So this sandbox runs its Worker WITHOUT that
 *      layer. The practical safety this file relies on instead is
 *      Pyodide's own WASM sandboxing (verified above: no real fs, no real
 *      network) plus Worker isolation (separate V8 isolate + hard
 *      terminate()) — real, but one layer thinner than the JS plugin path.
 *   2. `resourceLimits` (V8 heap caps) do NOT reliably bound Pyodide's WASM
 *      linear memory. Verified: a Python loop appending 10MB bytearrays in
 *      a worker capped at `maxOldGenerationSizeMb: 128` was still running,
 *      unstopped by the cap, 6+ seconds in — V8's generational heap
 *      accounting doesn't cover WASM ArrayBuffer growth the same way it
 *      covers JS object allocation. Consequence: the wall-clock timeout
 *      below (`PYTHON_SANDBOX_RUN_TIMEOUT_MS`) is the PRIMARY defense
 *      against both infinite loops AND memory exhaustion, not a resource
 *      cap. A determined memory-bomb inside the timeout window can still
 *      pressure the host process's real RSS before the timeout fires — the
 *      operator's own process-level memory ceiling (pm2 `max_memory_restart`,
 *      `--max-old-space-size`, see CLAUDE.md "Heap & cap tuning") is the
 *      real backstop for that, same as it is for any other memory spike.
 *
 * Every call is stateless: a fresh Worker loads Pyodide, runs one snippet
 * of code, captures stdout/stderr via Pyodide's own `setStdout`/`setStderr`
 * hooks (not by intercepting real OS file descriptors — there are none to
 * intercept), and is torn down. No state persists between calls.
 */

import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const PYTHON_SANDBOX_LOAD_TIMEOUT_MS = 15_000; // cold pyodide load is ~2s; generous margin for a loaded host
export const PYTHON_SANDBOX_RUN_TIMEOUT_MS = 8_000; // the PRIMARY defense — see file header
export const PYTHON_SANDBOX_MAX_OUTPUT_CHARS = 12_000; // matches chat-agent.js's MAX_TOOL_RESULT_LEN

export const PYTHON_SANDBOX_RESOURCE_LIMITS = Object.freeze({
  // Deliberately larger than plugin-sandbox.js's 64/32MB — Pyodide's own
  // JS-side runtime (not the WASM heap, which these caps don't reliably
  // bound per the file header) needs real headroom just to load.
  maxOldGenerationSizeMb: 512,
  maxYoungGenerationSizeMb: 128,
  codeRangeSizeMb: 32,
  stackSizeMb: 8,
});

// No --experimental-permission — see file header point 1 for why it's
// structurally incompatible with Pyodide's Node loader. --no-warnings only
// silences the two harmless "must be used with extreme caution" notices
// that don't apply here anyway (this file never passes --allow-addons or
// --allow-wasi, since it never enables the permission model at all).
const WORKER_EXEC_ARGV = Object.freeze(["--no-warnings"]);

const WORKER_BOOTSTRAP_SRC = [
  "const { parentPort, workerData } = require('node:worker_threads');",
  "const { loadPyodide } = require('pyodide');",
  "const path = require('node:path');",
  "",
  "(async () => {",
  "  let pyodide;",
  "  try {",
  "    pyodide = await loadPyodide({ indexURL: workerData.pyodideIndexURL });",
  "  } catch (err) {",
  "    parentPort.postMessage({ type: 'load_error', error: String(err && err.message || err) });",
  "    return;",
  "  }",
  "",
  "  const stdout = [];",
  "  const stderr = [];",
  "  pyodide.setStdout({ batched: (s) => stdout.push(s) });",
  "  pyodide.setStderr({ batched: (s) => stderr.push(s) });",
  "",
  "  parentPort.postMessage({ type: 'ready' });",
  "",
  "  parentPort.on('message', async (msg) => {",
  "    if (!msg || msg.type !== 'run') return;",
  "    try {",
  "      const result = await pyodide.runPythonAsync(msg.code);",
  "      let resultStr = null;",
  "      try { resultStr = result === undefined ? null : String(result); } catch (_e) { resultStr = '<unrepresentable result>'; }",
  "      parentPort.postMessage({",
  "        type: 'result', id: msg.id, ok: true,",
  "        value: { result: resultStr, stdout: stdout.join('\\n'), stderr: stderr.join('\\n') },",
  "      });",
  "    } catch (err) {",
  "      parentPort.postMessage({",
  "        type: 'result', id: msg.id, ok: false,",
  "        error: String(err && err.message || err),",
  "        value: { stdout: stdout.join('\\n'), stderr: stderr.join('\\n') },",
  "      });",
  "    }",
  "  });",
  "})();",
].join("\n");

function resolvePyodideIndexURL() {
  // Resolve to the installed package's own directory so loadPyodide reads
  // the local WASM+stdlib bundle instead of reaching for a CDN default.
  const pkgPath = require.resolve("pyodide/package.json");
  return `${path_dirname(pkgPath)}/`;
}

function path_dirname(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "." : p.slice(0, i);
}

function truncate(s) {
  if (typeof s !== "string") return s;
  return s.length > PYTHON_SANDBOX_MAX_OUTPUT_CHARS
    ? `${s.slice(0, PYTHON_SANDBOX_MAX_OUTPUT_CHARS)}\n…[truncated]`
    : s;
}

/**
 * Runs one Python snippet in a fresh, isolated Worker and tears it down.
 * Never throws — always resolves to a plain result object, matching
 * `code.exec`'s existing JS-path shape (`{ok, result:{stdout,stderr,
 * exitCode,supported}}` at the macro layer; this function returns the
 * inner piece the macro wraps).
 *
 * @param {string} code
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, result: string|null, error?: string}>}
 */
export function runPython(code) {
  return new Promise((resolve) => {
    let settled = false;
    let worker;
    const settle = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      clearTimeout(runTimer);
      resolve(val);
      if (worker) { try { worker.terminate(); } catch (_e) { /* already gone */ } }
    };

    let loadTimer;
    let runTimer;

    let pyodideIndexURL;
    try {
      pyodideIndexURL = resolvePyodideIndexURL();
    } catch (err) {
      settle({ ok: false, stdout: "", stderr: "", result: null, error: `pyodide_not_installed: ${String(err?.message || err)}` });
      return;
    }

    try {
      worker = new Worker(WORKER_BOOTSTRAP_SRC, {
        eval: true,
        execArgv: [...WORKER_EXEC_ARGV],
        workerData: { pyodideIndexURL },
        resourceLimits: { ...PYTHON_SANDBOX_RESOURCE_LIMITS },
      });
    } catch (err) {
      settle({ ok: false, stdout: "", stderr: "", result: null, error: `python_sandbox_spawn_failed: ${String(err?.message || err)}` });
      return;
    }

    loadTimer = setTimeout(() => {
      settle({ ok: false, stdout: "", stderr: "", result: null, error: `python_sandbox_load_timeout: exceeded ${PYTHON_SANDBOX_LOAD_TIMEOUT_MS}ms` });
    }, PYTHON_SANDBOX_LOAD_TIMEOUT_MS);

    worker.on("error", (err) => {
      settle({ ok: false, stdout: "", stderr: "", result: null, error: String(err?.message || err) });
    });
    worker.on("exit", (code_) => {
      if (!settled) {
        settle({ ok: false, stdout: "", stderr: "", result: null, error: `python_sandbox_exited: code ${code_}` });
      }
    });

    worker.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "load_error") {
        settle({ ok: false, stdout: "", stderr: "", result: null, error: msg.error || "python_sandbox_load_failed" });
        return;
      }

      if (msg.type === "ready") {
        clearTimeout(loadTimer);
        // The PRIMARY defense — see file header point 2. Fires regardless
        // of whether the running code is looping, allocating, or hung.
        runTimer = setTimeout(() => {
          settle({ ok: false, stdout: "", stderr: "", result: null, error: `python_sandbox_run_timeout: exceeded ${PYTHON_SANDBOX_RUN_TIMEOUT_MS}ms` });
        }, PYTHON_SANDBOX_RUN_TIMEOUT_MS);
        worker.postMessage({ type: "run", id: 1, code });
        return;
      }

      if (msg.type === "result") {
        const v = msg.value || {};
        settle({
          ok: !!msg.ok,
          stdout: truncate(v.stdout || ""),
          stderr: truncate(v.stderr || ""),
          result: v.result ?? null,
          error: msg.ok ? undefined : (msg.error || "python_exec_failed"),
        });
      }
    });
  });
}
