// server/lib/conkay/cad/kernel-queue.js
//
// External CAD kernels (OpenCascade via Python) run for seconds to minutes,
// so they never run on the solver path. Solvers are synchronous by design
// (the design engine's dependency tracking needs that); a solver that needs a
// kernel result asks this queue for it:
//   - a result already computed (this process) is returned at once;
//   - otherwise the request is queued and the caller gets { pending: true },
//     which the solver reports as NOT_COMPUTED "kernel run pending".
// settleKernels() then runs every queued request asynchronously (child
// process, async file I/O; the event loop stays free) and stores the results;
// DesignSession.settle() reruns the solvers that were waiting, and their
// dependents, until nothing is pending. Results are keyed by the request
// hash (which includes the kernel script), so a changed request or script is
// a new run.

export const KERNEL_PENDING = "kernel run pending";

const results = new Map(); // key -> result
const pending = new Map(); // key -> async () => result

/** Result for `key`, or queue `runner` and return { ok:false, pending:true }. */
export function requestKernel(key, runner, label = "kernel") {
  if (results.has(key)) return results.get(key);
  if (!pending.has(key)) pending.set(key, runner);
  return { ok: false, pending: true, reason: `${KERNEL_PENDING}: ${label} (await session.settle() to run it off the request path)` };
}

export function hasPendingKernels() {
  return pending.size > 0;
}

/** Run every queued kernel request (`concurrency` at a time) and store the results. */
export async function settleKernels({ concurrency = 2 } = {}) {
  const jobs = [...pending.entries()];
  pending.clear();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const [key, run] = jobs[i++];
      let r;
      try { r = await run(); } catch (e) { r = { ok: false, error: `kernel run failed: ${e instanceof Error ? e.message : String(e)}` }; }
      results.set(key, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
  return jobs.length;
}

/** Store a result computed elsewhere (e.g. a direct async run) under its key. */
export function rememberKernel(key, result) {
  results.set(key, result);
}

/** Forget results (tests that change the kernel environment). */
export function clearKernelResults() {
  results.clear();
  pending.clear();
}

/**
 * Run a Python kernel script asynchronously: JSON request on stdin, JSON result on stdout.
 * Never blocks the event loop. Returns the parsed JSON or { ok:false, error }.
 */
export async function runPythonKernel({ python, script, input, timeoutMs = 1800000, env = process.env }) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(python, [script], { env: { ...env, PYTHONUNBUFFERED: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, error: `kernel run failed: timed out after ${timeoutMs} ms` }); }, timeoutMs);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => finish({ ok: false, error: `kernel run failed: ${e.message}` }));
    child.on("close", (code) => {
      const text = Buffer.concat(out).toString("utf8");
      try { finish(JSON.parse(text)); } catch {
        const last = Buffer.concat(err).toString("utf8").split("\n").filter(Boolean).slice(-1)[0];
        finish({ ok: false, error: `kernel run failed (exit ${code}): ${last || "no JSON on stdout"}` });
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
