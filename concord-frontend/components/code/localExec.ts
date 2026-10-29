/**
 * Browser-local execution for the Code lens (S1, PR #1707) — the
 * main-thread half. Only this file creates the worker, following the
 * mp3-encode wrapper pattern; local-exec.worker.ts never imports it.
 *
 * What runs here (advertised scope — the UI claims exactly this set):
 * JavaScript and TypeScript files run locally in the user's browser.
 * TypeScript is transpiled with the already-shipped `typescript`
 * package, then executed in a fresh dedicated worker per run. Python
 * (standard library only) runs in a warm Pyodide worker — the runtime
 * is vendored with the frontend (public/pyodide/v0.26.4/, ~13.5 MB),
 * lazy-loaded on the first Python run and reused after; its files are
 * in-memory only and never written back to the project. The server
 * WASM sandbox stays founder/sovereign-only (no ACL change).
 *
 * Timeout discipline mirrors sandbox-exec: main-thread clock, default
 * 10s, clamp 30s. On timeout the worker is terminated — the kill never
 * depends on the runaway code cooperating — and whatever output it
 * streamed before the kill is kept and reported as partial.
 */

import type { CodeExecResult } from './codeRunReport';

export const LOCAL_RUN_DEFAULT_TIMEOUT_MS = 10_000;
export const LOCAL_RUN_MAX_TIMEOUT_MS = 30_000;

const JS_TS_LANGUAGES = new Set([
  'javascript', 'typescript', 'js', 'ts', 'mjs', 'cjs', 'node',
]);

const PYTHON_LANGUAGES = new Set(['python', 'py']);

export function isPythonLanguage(language: string | null | undefined): boolean {
  return PYTHON_LANGUAGES.has(String(language || '').trim().toLowerCase());
}

/** Languages this build can actually run locally. Exactly the advertised set. */
export function isLocallyRunnable(language: string | null | undefined): boolean {
  const lang = String(language || '').trim().toLowerCase();
  return JS_TS_LANGUAGES.has(lang) || PYTHON_LANGUAGES.has(lang);
}

/** Why a language is not locally runnable, in user words. Null when it is. */
export function localRunUnsupportedReason(language: string | null | undefined): string | null {
  const lang = String(language || '').trim().toLowerCase();
  if (isLocallyRunnable(lang)) return null;
  if (lang === 'jsx' || lang === 'tsx') {
    return 'The browser runner does not run JSX — it needs the app runtime.';
  }
  return `The browser runner runs JavaScript, TypeScript, and Python. It does not run ${lang || 'this language'}.`;
}

export interface LocalRunOutcome {
  /** The exact CodeExecResult shape CodeRunMenu / the output panel consume. */
  result: CodeExecResult;
  elapsedMs: number;
  /** True when the main-thread clock killed the worker. Output is partial. */
  timedOut: boolean;
  /** True when the code ran in the local worker (vs. an honest refusal). */
  ranLocally: boolean;
  /** Python only: this run paid the one-time runtime cold load. */
  loadedRuntime?: boolean;
  /** Python only: how long that cold load took, when it happened. */
  runtimeLoadMs?: number;
}

export type LocalRunPhase = 'loading-runtime' | 'running';

async function toPlainJs(code: string, language: string): Promise<string> {
  const lang = language.trim().toLowerCase();
  if (lang !== 'typescript' && lang !== 'ts') return code;
  const ts = await import('typescript');
  const out = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      isolatedModules: true,
    },
    reportDiagnostics: false,
  });
  return out.outputText;
}

let workerSeq = 0;

/**
 * Run one script locally. Never throws: every failure lands in the
 * result as an honest refusal or a non-zero exit, so callers render
 * facts, not exceptions.
 */
export async function runLocalScript(input: {
  code: string;
  language: string;
  timeoutMs?: number;
  onStatus?: (phase: LocalRunPhase) => void;
}): Promise<LocalRunOutcome> {
  if (isPythonLanguage(input.language)) return runPythonScript(input);
  const started = performance.now();
  const done = (result: CodeExecResult, extra: Partial<LocalRunOutcome> = {}): LocalRunOutcome => ({
    result,
    elapsedMs: Math.round(performance.now() - started),
    timedOut: false,
    ranLocally: false,
    ...extra,
  });

  const reason = localRunUnsupportedReason(input.language);
  if (reason) return done({ supported: false, stderr: reason, exitCode: undefined });

  if (typeof Worker === 'undefined') {
    return done({
      supported: false,
      stderr: 'Web Workers are not available in this browser, so local runs are unavailable here.',
    });
  }

  let plainJs: string;
  try {
    plainJs = await toPlainJs(input.code, input.language);
  } catch (err) {
    return done({
      supported: true,
      stderr: `Could not prepare the script: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
    }, { ranLocally: true });
  }

  const timeoutMs = Math.min(
    Math.max(1_000, Math.floor(input.timeoutMs ?? LOCAL_RUN_DEFAULT_TIMEOUT_MS)),
    LOCAL_RUN_MAX_TIMEOUT_MS,
  );

  return new Promise<LocalRunOutcome>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./local-exec.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(done({
        supported: false,
        stderr: 'The local runner could not start in this browser.',
      }));
      return;
    }
    const id = ++workerSeq;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => LocalRunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* already gone */ }
      resolve(fn());
    };
    const timer = setTimeout(() => {
      finish(() => done(
        { supported: true, stdout, stderr, exitCode: undefined },
        { timedOut: true, ranLocally: true },
      ));
    }, timeoutMs);
    worker.onerror = (ev) => {
      finish(() => done(
        { supported: true, stdout, stderr: stderr + (ev.message || 'The runner stopped unexpectedly.'), exitCode: 1 },
        { ranLocally: true },
      ));
    };
    worker.onmessage = (ev: MessageEvent) => {
      const msg = (ev.data || {}) as { type?: string; id?: number; text?: string; exitCode?: number };
      if (msg.id !== id) return;
      if (msg.type === 'stdout') stdout += String(msg.text || '');
      else if (msg.type === 'stderr') stderr += String(msg.text || '');
      else if (msg.type === 'done') {
        finish(() => done(
          { supported: true, stdout, stderr, exitCode: Number.isFinite(msg.exitCode) ? Number(msg.exitCode) : 0 },
          { ranLocally: true },
        ));
      }
    };
    worker.postMessage({ type: 'run', id, code: plainJs });
  });
}

// ── Python (Pyodide) session ─────────────────────────────────────────
// One warm worker, reused across runs: the runtime's cold load
// (measured 5.7s on a 2 vCPU VM; plausibly 8–15s on a low-end
// Chromebook) is paid once per page session, not per run. The timeout
// discipline is identical to the JS path — main-thread clock,
// terminate on expiry — and a terminated session is discarded, so the
// next Python run pays the cold load again and says so via
// loadedRuntime/runtimeLoadMs. Runs are serialized through a promise
// chain: the shared interpreter never interleaves two scripts.

interface PythonSession {
  worker: Worker;
  ready: boolean;
  chain: Promise<unknown>;
}

let pythonSession: PythonSession | null = null;

/** Test isolation. Production code does not reset between visits. */
export function resetPythonSessionForTests(): void {
  try { pythonSession?.worker.terminate(); } catch { /* already gone */ }
  pythonSession = null;
}

function pyodideIndexURL(): string {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}/pyodide/v0.26.4/`;
}

function runPythonScript(input: {
  code: string;
  timeoutMs?: number;
  onStatus?: (phase: LocalRunPhase) => void;
}): Promise<LocalRunOutcome> {
  const started = performance.now();
  const base = pythonSession ?? (pythonSession = { worker: null as unknown as Worker, ready: false, chain: Promise.resolve() });
  const run = base.chain.then(() => runPythonOnce(input, started));
  base.chain = run.catch(() => undefined);
  return run;
}

function runPythonOnce(
  input: { code: string; timeoutMs?: number; onStatus?: (phase: LocalRunPhase) => void },
  started: number,
): Promise<LocalRunOutcome> {
  // A previous run may have killed the session (timeout) after this
  // run was queued — re-create it rather than dereferencing a discard.
  if (!pythonSession) {
    pythonSession = { worker: null as unknown as Worker, ready: false, chain: Promise.resolve() };
  }
  const session = pythonSession;
  const timeoutMs = Math.min(
    Math.max(1_000, Math.floor(input.timeoutMs ?? LOCAL_RUN_DEFAULT_TIMEOUT_MS)),
    LOCAL_RUN_MAX_TIMEOUT_MS,
  );
  // The cold load is not the script's fault: the run's clock starts
  // when the runtime is ready, but a single hard cap (load + run)
  // keeps a stuck load from hanging the panel forever.
  const hardCapMs = timeoutMs + 60_000;

  return new Promise<LocalRunOutcome>((resolve) => {
    if (!session.worker) {
      try {
        session.worker = new Worker(new URL('./python-exec.worker.ts', import.meta.url), { type: 'classic' });
      } catch {
        resolve({
          result: { supported: false, stderr: 'The local Python runner could not start in this browser.' },
          elapsedMs: Math.round(performance.now() - started), timedOut: false, ranLocally: false,
        });
        return;
      }
    }
    const worker = session.worker;
    const id = ++workerSeq;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let loadedRuntime = false;
    let runtimeLoadMs: number | undefined;
    let runClockStart: number | null = session.ready ? performance.now() : null;

    const finish = (outcome: LocalRunOutcome, kill = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (runTimer) clearTimeout(runTimer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (kill) {
        try { worker.terminate(); } catch { /* already gone */ }
        if (pythonSession === session) pythonSession = null;
      }
      resolve(outcome);
    };
    const outcome = (result: CodeExecResult, extra: Partial<LocalRunOutcome> = {}): LocalRunOutcome => ({
      result,
      elapsedMs: Math.round(performance.now() - started),
      timedOut: false,
      ranLocally: true,
      ...(loadedRuntime ? { loadedRuntime, runtimeLoadMs } : {}),
      ...extra,
    });

    let runTimer: ReturnType<typeof setTimeout> | null = null;
    const armRunTimer = () => {
      if (runTimer) return;
      runTimer = setTimeout(() => {
        finish(outcome(
          { supported: true, stdout, stderr, exitCode: undefined },
          { timedOut: true },
        ), true);
      }, timeoutMs);
    };
    const hardTimer = setTimeout(() => {
      finish(outcome(
        { supported: true, stdout, stderr: stderr + 'The Python runtime did not become ready in time.\n', exitCode: undefined },
        { timedOut: true },
      ), true);
    }, hardCapMs);

    const onError = (ev: ErrorEvent) => {
      finish(outcome(
        { supported: true, stdout, stderr: stderr + (ev.message || 'The Python runner stopped unexpectedly.'), exitCode: 1 },
      ), true);
    };
    const onMessage = (ev: MessageEvent) => {
      const msg = (ev.data || {}) as { type?: string; id?: number; text?: string; exitCode?: number; loadMs?: number };
      if (msg.id !== id && msg.type !== 'ready' && msg.type !== 'loading') return;
      if (msg.type === 'loading') {
        loadedRuntime = true;
        input.onStatus?.('loading-runtime');
      } else if (msg.type === 'ready') {
        session.ready = true;
        runtimeLoadMs = Number.isFinite(msg.loadMs) ? Number(msg.loadMs) : undefined;
        runClockStart = performance.now();
        input.onStatus?.('running');
        armRunTimer();
      } else if (msg.type === 'stdout') {
        stdout += String(msg.text || '');
      } else if (msg.type === 'stderr') {
        stderr += String(msg.text || '');
      } else if (msg.type === 'done') {
        finish(outcome({
          supported: true, stdout, stderr,
          exitCode: Number.isFinite(msg.exitCode) ? Number(msg.exitCode) : 0,
        }));
      }
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    if (session.ready) armRunTimer();
    worker.postMessage({ type: 'run', id, code: input.code, indexURL: pyodideIndexURL() });
    void runClockStart;
  });
}
