/// <reference lib="webworker" />
/**
 * Browser-local Python runner — the worker half (S1b, PR #1707).
 *
 * Loads the vendored Pyodide runtime (public/pyodide/v0.26.4/ — served
 * from Concord's own origin, never a CDN) once per worker instance and
 * runs the user's Python with the standard library only. The wrapper
 * (localExec.ts) keeps one warm instance across runs and terminates it
 * on timeout, so a killed run's next run pays the cold start again —
 * reported honestly, never hidden.
 *
 * Python's filesystem here is Pyodide's in-memory FS: files a script
 * writes live only inside this worker and are gone when it is
 * terminated or the page closes. Nothing is written back to the
 * project. The UI says so; this worker makes it true by construction.
 *
 * Protocol:
 *   in : { type: 'run', id, code, indexURL }   (indexURL on first run)
 *   out: { type: 'loading', id }               runtime load started
 *        { type: 'ready', id, loadMs }         runtime ready (once)
 *        { type: 'stdout' | 'stderr', id, text }
 *        { type: 'done', id, exitCode }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const scope: DedicatedWorkerGlobalScope & { loadPyodide?: any } = self as any;

let pyodide: any = null;
let loadingPromise: Promise<void> | null = null;

function ensureRuntime(id: number, indexURL: string): Promise<void> {
  if (pyodide) return Promise.resolve();
  if (!loadingPromise) {
    loadingPromise = (async () => {
      scope.postMessage({ type: 'loading', id });
      const started = performance.now();
      scope.importScripts(`${indexURL}pyodide.js`);
      pyodide = await scope.loadPyodide({ indexURL });
      pyodide.setStdout({ batched: (text: string) => scope.postMessage({ type: 'stdout', id: currentRunId, text: `${text}\n` }) });
      pyodide.setStderr({ batched: (text: string) => scope.postMessage({ type: 'stderr', id: currentRunId, text: `${text}\n` }) });
      scope.postMessage({ type: 'ready', id, loadMs: Math.round(performance.now() - started) });
    })();
  }
  return loadingPromise;
}

let currentRunId = 0;

scope.onmessage = (ev: MessageEvent) => {
  const msg = (ev.data || {}) as { type?: string; id?: number; code?: string; indexURL?: string };
  if (msg.type !== 'run') return;
  const id = Number(msg.id);
  currentRunId = id;
  void (async () => {
    try {
      await ensureRuntime(id, String(msg.indexURL || ''));
    } catch (err) {
      scope.postMessage({
        type: 'stderr', id,
        text: `The Python runtime could not load. Its files are served with Concord — if this persists, the deployment is missing them. (${err instanceof Error ? err.message : String(err)})\n`,
      });
      scope.postMessage({ type: 'done', id, exitCode: 1 });
      return;
    }
    try {
      await pyodide.runPythonAsync(String(msg.code || ''));
      scope.postMessage({ type: 'done', id, exitCode: 0 });
    } catch (err) {
      // Pyodide's error message carries the Python traceback — that IS
      // the user's stderr, verbatim.
      scope.postMessage({ type: 'stderr', id, text: `${err instanceof Error ? err.message : String(err)}\n` });
      scope.postMessage({ type: 'done', id, exitCode: 1 });
    }
  })();
};
