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

/** The languages a member can pick for a tab — exactly the locally runnable set. */
export const RUNNABLE_LANGUAGE_OPTIONS: { id: string; label: string }[] = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
];

const FILENAME_LANGUAGES: Record<string, string> = {
  py: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
};

/** The language a filename's extension names, or null when it names none. */
export function languageForFilename(name: string | null | undefined): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
  if (!m) return null;
  return FILENAME_LANGUAGES[m[1].toLowerCase()] ?? null;
}

/**
 * The language a tab actually runs as (F1-Python, PR #1707 re-review).
 *
 * Until this resolver existed, every creation/open default in the chain was
 * 'javascript' and no surface could set anything else — so a file NAMED .py
 * ran as JavaScript and wore a JS error. The rules, in order:
 *  1. A language the member explicitly chose (the toolbar selector, persisted
 *     as languageChosen) always wins.
 *  2. A stored NON-default language wins — it could only have been set
 *     deliberately (API/snippet creation carries an explicit language).
 *  3. A stored chain default (absent / 'javascript' / 'plaintext' / 'text')
 *     yields to the filename's extension — those stored values are defaults
 *     the old chain stamped, never choices.
 *  4. Otherwise the stored/default value, normalised.
 */
export function resolveTabLanguage(
  name: string | null | undefined,
  stored: string | null | undefined,
  languageChosen?: boolean,
): string {
  const s = String(stored || '').trim().toLowerCase();
  if (languageChosen && s) return s;
  const CHAIN_DEFAULTS = new Set(['', 'javascript', 'plaintext', 'text']);
  if (!CHAIN_DEFAULTS.has(s)) return s;
  return languageForFilename(name) ?? (s || 'javascript');
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

export interface GeneratedTestRun {
  outcome: LocalRunOutcome;
  /** Present only when the tests actually executed and were counted. */
  summary: import('./testHarness').TestSummary | null;
}

const MODULE_SYNTAX = /^\s*(import\s|export\s)/m;

/**
 * The single-file module scope a run gets. A file that exports things (most
 * real modules do) is compiled to CommonJS, so it needs `exports`/`module`;
 * an import of another file cannot be satisfied in a one-file run, and says so.
 */
export const SINGLE_FILE_PRELUDE = 'var exports = {}; var module = { exports: exports }; function require(name) { throw new Error("Cannot import \\"" + name + "\\" here: a run executes this one file in your browser, without the rest of the project."); }\n';

/** Strip types and module syntax so the worker can evaluate the file as a plain script. */
export async function toPlainJs(code: string, language: string): Promise<string> {
  const lang = language.trim().toLowerCase();
  const isTs = lang === 'typescript' || lang === 'ts';
  if (!isTs && !MODULE_SYNTAX.test(code)) return code;
  const ts = await import('typescript');
  const out = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      isolatedModules: true,
      allowJs: true,
      esModuleInterop: true,
    },
    fileName: isTs ? 'run.ts' : 'run.js',
    reportDiagnostics: false,
  });
  return SINGLE_FILE_PRELUDE + out.outputText;
}

let workerSeq = 0;

/**
 * How long a worker may take to load before the run is abandoned. This is
 * separate from the run's own timeout, which only starts once the program is
 * sent: loading the runner (cold bundles, a slow device) is not the user's
 * code running long, and must never be reported as their code timing out.
 */
export const LOCAL_RUNNER_START_LIMIT_MS = 60_000;
const RUNNER_DID_NOT_START = 'The local runner did not start in time, so nothing ran. Try again.';

/** How long one runner gets to say it is listening before it is replaced. */
export const LOCAL_RUNNER_READY_WAIT_MS = 4_000;

/**
 * Start the JS runner and resolve once it says it is listening
 * ({ type: 'worker-ready' }, the worker's last top-level statement), or null if
 * no runner came up within LOCAL_RUNNER_START_LIMIT_MS.
 *
 * Why it waits instead of posting straight away: a runner whose script load
 * stalls never runs the program, and the old code then reported the user's
 * code as having timed out. Two real stalls were found (both fixed at their
 * source): a module-type worker cannot load Turbopack's importScripts
 * bootstrap, and the PWA service worker answered worker scripts from cache in
 * a way Chromium never completed (public/sw-policy.js now passes them
 * through). So the program is only ever sent to a runner that has announced
 * itself, a silent runner is replaced, and the run's own timeout starts after
 * this, so loading is never counted as the user's code running long.
 */
async function startRunnerWorker(): Promise<Worker | null> {
  const deadline = performance.now() + LOCAL_RUNNER_START_LIMIT_MS;
  for (let attempt = 1; performance.now() < deadline; attempt++) {
    let worker: Worker;
    try {
      // Classic, not module: the bundler's worker bootstrap uses importScripts.
      worker = new Worker(new URL('./local-exec.worker.ts', import.meta.url));
    } catch {
      return null;
    }
    const wait = Math.min(LOCAL_RUNNER_READY_WAIT_MS * attempt, Math.max(0, deadline - performance.now()));
    const ready = await new Promise<boolean>((resolve) => {
      const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onError); };
      const onMessage = (ev: MessageEvent) => { if ((ev.data as { type?: string } | null)?.type === 'worker-ready') { cleanup(); resolve(true); } };
      const onError = () => { cleanup(); resolve(false); };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, wait);
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
    });
    if (ready) return worker;
    try { worker.terminate(); } catch { /* already gone */ }
  }
  return null;
}

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
  let started = performance.now(); // reset when the program is sent: elapsed is run time, not load time
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

  const worker = await startRunnerWorker();
  if (!worker) return done({ supported: false, stderr: RUNNER_DID_NOT_START });
  started = performance.now(); // run time, not load time

  return new Promise<LocalRunOutcome>((resolve) => {
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
      } else if (msg.type === 'unavailable') {
        // The runtime files could not be loaded: report the runner as unavailable (nothing ran), and drop
        // the worker so the next run starts fresh and can succeed once the files exist.
        finish(outcome(
          { supported: false, stderr: `Python runtime unavailable: ${String(msg.text || 'it could not be loaded.')}` },
          { ranLocally: false },
        ), true);
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

// ── Generated-test execution (S4) ────────────────────────────────────
// Executes tests produced by code.test-generate (after the
// testGenContract validation) against the file under test, in the
// same worker discipline as plain runs. The summary it returns was
// counted by the harness from tests that actually ran — it is the
// ONLY source of pass/fail anywhere in the Code lens.

export async function runGeneratedTests(input: {
  sourceCode: string;
  testCode: string;
  language: string;
  timeoutMs?: number;
  onStatus?: (phase: LocalRunPhase) => void;
}): Promise<GeneratedTestRun> {
  if (isPythonLanguage(input.language)) {
    return runPythonGeneratedTests(input);
  }
  let started = performance.now(); // reset when the tests are sent: elapsed is run time, not load time
  const timeoutMs = Math.min(
    Math.max(1_000, Math.floor(input.timeoutMs ?? LOCAL_RUN_DEFAULT_TIMEOUT_MS)),
    LOCAL_RUN_MAX_TIMEOUT_MS,
  );
  const worker = await startRunnerWorker();
  if (!worker) {
    return { outcome: { result: { supported: false, stderr: RUNNER_DID_NOT_START }, elapsedMs: 0, timedOut: false, ranLocally: false }, summary: null };
  }
  started = performance.now(); // run time, not load time
  return new Promise<GeneratedTestRun>((resolve) => {
    const id = ++workerSeq;
    let stdout = '';
    let stderr = '';
    let summary: import('./testHarness').TestSummary | null = null;
    let settled = false;
    const finish = (outcome: LocalRunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* already gone */ }
      resolve({ outcome, summary });
    };
    const timer = setTimeout(() => {
      finish({
        result: { supported: true, stdout, stderr, exitCode: undefined },
        elapsedMs: Math.round(performance.now() - started), timedOut: true, ranLocally: true,
      });
    }, timeoutMs);
    worker.onmessage = (ev: MessageEvent) => {
      const msg = (ev.data || {}) as { type?: string; id?: number; text?: string; exitCode?: number; summary?: import('./testHarness').TestSummary };
      if (msg.id !== id) return;
      if (msg.type === 'stdout') stdout += String(msg.text || '');
      else if (msg.type === 'stderr') stderr += String(msg.text || '');
      else if (msg.type === 'test-summary') summary = msg.summary || null;
      else if (msg.type === 'done') {
        finish({
          result: { supported: true, stdout, stderr, exitCode: Number.isFinite(msg.exitCode) ? Number(msg.exitCode) : 0 },
          elapsedMs: Math.round(performance.now() - started), timedOut: false, ranLocally: true,
        });
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      finish({
        result: { supported: true, stdout, stderr: stderr + (ev.message || 'The test runner stopped unexpectedly.'), exitCode: 1 },
        elapsedMs: Math.round(performance.now() - started), timedOut: false, ranLocally: true,
      });
    };
    worker.postMessage({ type: 'run-tests', id, source: input.sourceCode, testCode: input.testCode });
  });
}

function runPythonGeneratedTests(input: {
  sourceCode: string;
  testCode: string;
  timeoutMs?: number;
  onStatus?: (phase: LocalRunPhase) => void;
}): Promise<GeneratedTestRun> {
  const started = performance.now();
  if (!pythonSession) {
    pythonSession = { worker: null as unknown as Worker, ready: false, chain: Promise.resolve() };
  }
  const session = pythonSession;
  const run = session.chain.then(async (): Promise<GeneratedTestRun> => {
    // Re-check after queueing: a prior timeout may have discarded it.
    const live = pythonSession ?? (pythonSession = { worker: null as unknown as Worker, ready: false, chain: Promise.resolve() });
    if (!live.worker) {
      try {
        live.worker = new Worker(new URL('./python-exec.worker.ts', import.meta.url), { type: 'classic' });
      } catch {
        return {
          outcome: { result: { supported: false, stderr: 'The local Python runner could not start in this browser.' }, elapsedMs: 0, timedOut: false, ranLocally: false },
          summary: null,
        };
      }
    }
    const worker = live.worker;
    const id = ++workerSeq;
    const timeoutMs = Math.min(
      Math.max(1_000, Math.floor(input.timeoutMs ?? LOCAL_RUN_DEFAULT_TIMEOUT_MS)),
      LOCAL_RUN_MAX_TIMEOUT_MS,
    );
    return new Promise<GeneratedTestRun>((resolve) => {
      let stdout = '';
      let stderr = '';
      let summary: import('./testHarness').TestSummary | null = null;
      let settled = false;
      let loadedRuntime = false;
      let runtimeLoadMs: number | undefined;
      const finish = (outcome: LocalRunOutcome, kill = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        if (runTimer) clearTimeout(runTimer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (kill) {
          try { worker.terminate(); } catch { /* already gone */ }
          if (pythonSession === live) pythonSession = null;
        }
        resolve({ outcome, summary });
      };
      let runTimer: ReturnType<typeof setTimeout> | null = null;
      const armRunTimer = () => {
        if (runTimer) return;
        runTimer = setTimeout(() => {
          finish({
            result: { supported: true, stdout, stderr, exitCode: undefined },
            elapsedMs: Math.round(performance.now() - started), timedOut: true, ranLocally: true,
            ...(loadedRuntime ? { loadedRuntime, runtimeLoadMs } : {}),
          }, true);
        }, timeoutMs);
      };
      const hardTimer = setTimeout(() => {
        finish({
          result: { supported: true, stdout, stderr: stderr + 'The Python runtime did not become ready in time.\n', exitCode: undefined },
          elapsedMs: Math.round(performance.now() - started), timedOut: true, ranLocally: true,
        }, true);
      }, timeoutMs + 60_000);
      const onError = (ev: ErrorEvent) => {
        finish({
          result: { supported: true, stdout, stderr: stderr + (ev.message || 'The Python runner stopped unexpectedly.'), exitCode: 1 },
          elapsedMs: Math.round(performance.now() - started), timedOut: false, ranLocally: true,
        }, true);
      };
      const onMessage = (ev: MessageEvent) => {
        const msg = (ev.data || {}) as { type?: string; id?: number; text?: string; exitCode?: number; loadMs?: number; summary?: import('./testHarness').TestSummary };
        if (msg.id !== id && msg.type !== 'ready' && msg.type !== 'loading') return;
        if (msg.type === 'loading') { loadedRuntime = true; input.onStatus?.('loading-runtime'); }
        else if (msg.type === 'ready') {
          live.ready = true;
          runtimeLoadMs = Number.isFinite(msg.loadMs) ? Number(msg.loadMs) : undefined;
          input.onStatus?.('running');
          armRunTimer();
        } else if (msg.type === 'stdout') stdout += String(msg.text || '');
        else if (msg.type === 'stderr') stderr += String(msg.text || '');
        else if (msg.type === 'test-summary') summary = msg.summary || null;
        else if (msg.type === 'unavailable') {
          finish({
            result: { supported: false, stderr: `Python runtime unavailable: ${String(msg.text || 'it could not be loaded.')}` },
            elapsedMs: Math.round(performance.now() - started), timedOut: false, ranLocally: false,
          }, true);
        } else if (msg.type === 'done') {
          finish({
            result: { supported: true, stdout, stderr, exitCode: Number.isFinite(msg.exitCode) ? Number(msg.exitCode) : 0 },
            elapsedMs: Math.round(performance.now() - started), timedOut: false, ranLocally: true,
            ...(loadedRuntime ? { loadedRuntime, runtimeLoadMs } : {}),
          });
        }
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      if (live.ready) armRunTimer();
      worker.postMessage({ type: 'run-tests', id, source: input.sourceCode, testCode: input.testCode, indexURL: pyodideIndexURL() });
    });
  });
  session.chain = run.catch(() => undefined);
  return run;
}
