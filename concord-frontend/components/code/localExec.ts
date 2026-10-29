/**
 * Browser-local execution for the Code lens (S1, PR #1707) — the
 * main-thread half. Only this file creates the worker, following the
 * mp3-encode wrapper pattern; local-exec.worker.ts never imports it.
 *
 * What runs here (advertised scope — the UI claims exactly this set):
 * JavaScript and TypeScript files run locally in the user's browser.
 * TypeScript is transpiled with the already-shipped `typescript`
 * package, then executed in a fresh dedicated worker per run. Python
 * joins this same surface in S1b (vendored Pyodide); until then it is
 * honestly not runnable here, and the server WASM sandbox stays
 * founder/sovereign-only (no ACL change).
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

/** Languages this build can actually run locally. Exactly the advertised set. */
export function isLocallyRunnable(language: string | null | undefined): boolean {
  return JS_TS_LANGUAGES.has(String(language || '').trim().toLowerCase());
}

/** Why a language is not locally runnable, in user words. Null when it is. */
export function localRunUnsupportedReason(language: string | null | undefined): string | null {
  const lang = String(language || '').trim().toLowerCase();
  if (isLocallyRunnable(lang)) return null;
  if (lang === 'python' || lang === 'py') {
    return 'The browser runner does not run Python yet.';
  }
  if (lang === 'jsx' || lang === 'tsx') {
    return 'The browser runner does not run JSX — it needs the app runtime.';
  }
  return `The browser runner runs JavaScript and TypeScript. It does not run ${lang || 'this language'}.`;
}

export interface LocalRunOutcome {
  /** The exact CodeExecResult shape CodeRunMenu / the output panel consume. */
  result: CodeExecResult;
  elapsedMs: number;
  /** True when the main-thread clock killed the worker. Output is partial. */
  timedOut: boolean;
  /** True when the code ran in the local worker (vs. an honest refusal). */
  ranLocally: boolean;
}

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
}): Promise<LocalRunOutcome> {
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
