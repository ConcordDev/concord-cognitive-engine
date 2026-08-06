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
 *
 * ── Scientific packages (numpy/pandas/matplotlib/scipy/sympy), added 2026-08-02 ──
 *
 * These are NOT bundled in the base `pyodide` npm install (only core +
 * stdlib are). Pyodide's own `loadPackage()` fetches them from
 * `cdn.jsdelivr.net` by default, which would silently turn `run_python`
 * into something that depends on a live third-party CDN — breaking the
 * "no network needed" property documented above. Instead:
 * `scripts/fetch-pyodide-packages.mjs` vendors the exact pinned wheels
 * (checksum-verified against the installed pyodide's own lockfile) into
 * `server/data/pyodide-packages/`; `lib/pyodide-packages.js` is the single
 * source of truth for which files that is (package-closure resolution
 * off the real lockfile's `depends` graph, never hand-maintained).
 *
 * `runPython(code, {packages})` resolves the request on the MAIN thread
 * BEFORE spawning a worker: if any requested package (or a transitive
 * dependency) hasn't been vendored, it fails honestly
 * (`python_package_not_vendored`) with no worker spawned and no attempt
 * to fall back to a network fetch — that fallback would silently
 * reintroduce the exact CDN dependency this design removes. Hand-verified
 * end-to-end with a real (small, hand-built) local wheel: `pyodide.
 * loadPackage([absoluteLocalPath])` genuinely installs and makes a local
 * package importable with zero network access — see
 * server/tests/pyodide-packages.test.js.
 *
 * matplotlib gets one extra step: immediately after `loadPackage` succeeds
 * (and before any user code runs), the worker sets the headless Agg
 * backend (`matplotlib.use("Agg")`) — Pyodide has no display to render
 * to, and Agg must be selected before `pyplot` is ever imported for real.
 * After user code runs, if matplotlib was loaded, the worker captures any
 * open figures as base64 PNGs (`savefig` to an in-memory `BytesIO`, never
 * touching the (blocked) real filesystem) and returns them alongside
 * stdout/stderr — best-effort: a capture failure never fails the whole
 * call, matching this file's existing never-throw discipline.
 */

import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import {
  PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES,
  resolvePackageClosure, packageFileInfo,
} from "./pyodide-packages.js";

const require = createRequire(import.meta.url);

export { PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES };

export const PYTHON_SANDBOX_LOAD_TIMEOUT_MS = 30_000; // cold pyodide load is ~2s with no packages; bumped from 15s to give scipy/matplotlib's larger local-disk wasm parses (dozens of MB, still zero network) real headroom on a loaded host
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

// Best-effort matplotlib figure capture, run AFTER user code. Never touches
// the real filesystem (savefig targets an in-memory BytesIO); wrapped in its
// own try/except so a capture problem can never fail the whole call. Kept as
// ONE JS string (not split across array lines) so its embedded '\n's stay
// real Python newlines inside a single runPythonAsync() call — the exact
// double-escaping mistake documented in this file's own commit history
// (a sed pass once turned '\\n' into a literal embedded newline and broke
// the worker source's own JS syntax) only bites when a string like this is
// built by find/replace; written directly here, it's just a normal string.
const MATPLOTLIB_CAPTURE_SNIPPET =
  "import json as __concord_json, base64 as __concord_b64, io as __concord_io\n" +
  "def __concord_capture_figures():\n" +
  "    try:\n" +
  "        import matplotlib.pyplot as __concord_plt\n" +
  "    except Exception:\n" +
  "        return '[]'\n" +
  "    out = []\n" +
  "    try:\n" +
  "        for num in __concord_plt.get_fignums():\n" +
  "            fig = __concord_plt.figure(num)\n" +
  "            buf = __concord_io.BytesIO()\n" +
  "            fig.savefig(buf, format='png', bbox_inches='tight', dpi=110)\n" +
  "            out.append(__concord_b64.b64encode(buf.getvalue()).decode('ascii'))\n" +
  "        __concord_plt.close('all')\n" +
  "    except Exception:\n" +
  "        pass\n" +
  "    return __concord_json.dumps(out)\n" +
  "__concord_capture_figures()";

const WORKER_BOOTSTRAP_SRC = [
  "const { parentPort, workerData } = require('node:worker_threads');",
  "const { loadPyodide } = require('pyodide');",
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
  "  const packagePaths = Array.isArray(workerData.packagePaths) ? workerData.packagePaths : [];",
  "  const packageNames = Array.isArray(workerData.packageNames) ? workerData.packageNames : [];",
  "  const hasMatplotlib = packageNames.includes('matplotlib');",
  "  if (packagePaths.length) {",
  "    try {",
  "      // NOTE (hand-verified): pyodide.loadPackage() does NOT reject just",
  "      // because one of the given local paths is missing/unreadable — it",
  "      // logs the failure into ITS OWN stderr channel and returns normally.",
  "      // The user-visible failure surfaces later, honestly, as a real",
  "      // Python ImportError/ModuleNotFoundError the moment their code",
  "      // tries to `import` the package that silently failed to load. This",
  "      // try/catch still matters for genuinely thrown exceptions (e.g. a",
  "      // malformed path list) — it just isn't the only failure surface.",
  "      await pyodide.loadPackage(packagePaths);",
  "      if (hasMatplotlib) {",
  "        // MUST run before any user import of matplotlib.pyplot — Agg is a",
  "        // headless raster backend; Pyodide has no display to render to.",
  "        await pyodide.runPythonAsync(\"import matplotlib; matplotlib.use('Agg')\");",
  "      }",
  "    } catch (err) {",
  "      parentPort.postMessage({ type: 'load_error', error: `package_load_failed: ${String(err && err.message || err)}` });",
  "      return;",
  "    }",
  "  }",
  "",
  "  parentPort.postMessage({ type: 'ready' });",
  "",
  "  parentPort.on('message', async (msg) => {",
  "    if (!msg || msg.type !== 'run') return;",
  "    try {",
  "      const result = await pyodide.runPythonAsync(msg.code);",
  "      let resultStr = null;",
  "      try { resultStr = result === undefined ? null : String(result); } catch (_e) { resultStr = '<unrepresentable result>'; }",
  "      let images = [];",
  "      if (hasMatplotlib) {",
  "        try {",
  "          const raw = await pyodide.runPythonAsync(workerData.matplotlibCaptureSnippet);",
  "          images = JSON.parse(String(raw)).map((b64) => ({ mime: 'image/png', dataB64: b64 }));",
  "        } catch (_captureErr) { /* best-effort — never fails the call */ }",
  "      }",
  "      parentPort.postMessage({",
  "        type: 'result', id: msg.id, ok: true,",
  "        value: { result: resultStr, stdout: stdout.join('\\n'), stderr: stderr.join('\\n'), images },",
  "      });",
  "    } catch (err) {",
  "      parentPort.postMessage({",
  "        type: 'result', id: msg.id, ok: false,",
  "        error: String(err && err.message || err),",
  "        value: { stdout: stdout.join('\\n'), stderr: stderr.join('\\n'), images: [] },",
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
 * Resolves a requested top-level package list into local vendored file
 * paths, on the MAIN thread, before any worker is spawned. Never touches
 * the network — a package that hasn't been vendored (scripts/
 * fetch-pyodide-packages.mjs hasn't been run, or the operator hasn't
 * opted into scientific packages at all) is reported as a plain, honest
 * gap, not silently skipped or fetched live.
 * @param {string[]} packages
 * @returns {{ok:true, paths:string[], names:string[]}|{ok:false, error:string, missing?:string[], unknown?:string[]}}
 */
async function resolveRequestedPackages(packages) {
  if (!packages || !packages.length) return { ok: true, paths: [], names: [] };
  let closure;
  try {
    closure = await resolvePackageClosure(packages);
  } catch (err) {
    return { ok: false, error: `pyodide_lockfile_unreadable: ${String(err?.message || err)}` };
  }
  if (!closure.ok) {
    if (closure.error === "package_not_allowed") {
      return { ok: false, error: "python_package_not_allowed", unknown: closure.unknown };
    }
    return { ok: false, error: closure.error, unknown: closure.unknown };
  }
  const files = await packageFileInfo(closure.names);
  const missing = files.filter((f) => !f.exists).map((f) => f.name);
  if (missing.length) {
    return { ok: false, error: "python_package_not_vendored", missing };
  }
  return { ok: true, paths: files.map((f) => f.vendoredPath), names: closure.names };
}

/**
 * Runs one Python snippet in a fresh, isolated Worker and tears it down.
 * Never throws — always resolves to a plain result object, matching
 * `code.exec`'s existing JS-path shape (`{ok, result:{stdout,stderr,
 * exitCode,supported}}` at the macro layer; this function returns the
 * inner piece the macro wraps).
 *
 * @param {string} code
 * @param {object} [opts]
 * @param {string[]} [opts.packages] — top-level package names from
 *   PYODIDE_ALLOWED_TOP_LEVEL_PACKAGES (numpy/pandas/matplotlib/scipy/sympy).
 *   Transitive dependencies are resolved automatically. Any package not
 *   already vendored (scripts/fetch-pyodide-packages.mjs) fails honestly —
 *   never falls back to a live fetch.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, result: string|null, images?: Array<{mime:string, dataB64:string}>, error?: string, missing?: string[]}>}
 */
export async function runPython(code, opts = {}) {
  const packages = Array.isArray(opts.packages) ? opts.packages : [];
  const pkgResolution = await resolveRequestedPackages(packages);
  if (!pkgResolution.ok) {
    // No worker spawned — a doomed-to-fail request shouldn't pay the ~2s
    // cold-load cost, and the failure should be immediate and legible.
    return Promise.resolve({
      ok: false, stdout: "", stderr: "", result: null,
      error: pkgResolution.error,
      ...(pkgResolution.missing ? { missing: pkgResolution.missing } : {}),
      ...(pkgResolution.unknown ? { unknown: pkgResolution.unknown } : {}),
    });
  }
  return _runInWorker(code, { packagePaths: pkgResolution.paths, packageNames: pkgResolution.names });
}

/**
 * TEST-ONLY: drives the exact same worker path as runPython(), but with
 * caller-supplied local wheel paths instead of the production whitelist +
 * vendored-directory resolution. Used to prove the local-wheel-loading
 * mechanism itself (pyodide.loadPackage([absoluteLocalPath]) really
 * installs a package with zero network access) against a small, hand-built
 * fixture wheel — see server/tests/pyodide-packages.test.js. Never called
 * from production code; the public runPython() always goes through
 * resolveRequestedPackages()'s whitelist + vendored-file check.
 */
export function __runPythonWithRawPackagePathsForTests(code, packagePaths, packageNames = []) {
  return _runInWorker(code, { packagePaths, packageNames });
}

function _runInWorker(code, { packagePaths, packageNames }) {
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
        workerData: {
          pyodideIndexURL,
          packagePaths,
          packageNames,
          matplotlibCaptureSnippet: MATPLOTLIB_CAPTURE_SNIPPET,
        },
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
          images: Array.isArray(v.images) ? v.images : [],
          error: msg.ok ? undefined : (msg.error || "python_exec_failed"),
        });
      }
    });
  });
}
