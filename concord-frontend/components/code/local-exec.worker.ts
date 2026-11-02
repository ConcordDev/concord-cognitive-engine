/// <reference lib="webworker" />
import { buildTestProgram, createAssertShim, createTestShim } from './testHarness';
import type { TestSummary } from './testHarness';
/**
 * Browser-local script runner — the worker half (S1 + S4, PR #1707).
 *
 * Runs the user's own JavaScript in a dedicated worker that is spawned
 * per run and terminated by the caller (localExec.ts owns the timeout
 * clock; a runaway loop cannot veto its own kill). The worker's world
 * is deliberately small: no DOM, no network (fetch / XHR / WebSocket /
 * EventSource / importScripts are shadowed to undefined before the
 * script sees them), no storage, no lensRun, no API keys. That is a
 * DevTools-console threat model — the code runs with the user's own
 * browser privileges, in the user's own browser, and Concord's server
 * never executes it. UI copy says exactly that ("runs locally in your
 * browser"), never "secure sandbox."
 *
 * Protocol:
 *   in : { type: 'run', id, code }        (code is already plain JS —
 *        localExec.ts transpiles TypeScript before posting)
 *        { type: 'run-tests', id, source, testCode }
 *        (S4: source = the file under test; testCode = generated
 *        node:test tests; testHarness.ts assembles them into one
 *        program against node:test / node:assert shims)
 *   out: { type: 'stdout' | 'stderr', id, text }   streamed chunks
 *        { type: 'test-summary', id, summary }    run-tests only,
 *        posted only when the tests actually executed
 *        { type: 'done', id, exitCode }            exactly one, last
 */

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_k, v: unknown) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      if (typeof v === 'bigint') return `${v}n`;
      if (typeof v === 'function') return `[Function ${(v as { name?: string }).name || 'anonymous'}]`;
      return v;
    }) ?? String(value);
  } catch {
    return String(value);
  }
}

// Shadow the network / loading / storage surface BEFORE user code is
// constructed, by binding those names to undefined parameters of the
// generated function. Anything not listed here (timers, Math, JSON,
// typed arrays, Atomics) is ordinary language surface.
const SHADOWED: Record<string, undefined> = {
  fetch: undefined,
  XMLHttpRequest: undefined,
  WebSocket: undefined,
  EventSource: undefined,
  importScripts: undefined,
  indexedDB: undefined,
  caches: undefined,
  localStorage: undefined,
  sessionStorage: undefined,
  navigator: undefined,
  location: undefined,
  postMessage: undefined,
};

interface RunExtras {
  names: string[];
  values: unknown[];
}

function runProgram(id: number, code: string, extras: RunExtras): void {
  const post = (type: 'stdout' | 'stderr', text: string) => scope.postMessage({ type, id, text });
  const capture = (kind: 'stdout' | 'stderr') => (...args: unknown[]) => {
    post(kind, args.map(formatArg).join(' ') + '\n');
  };
  const fakeConsole = {
    log: capture('stdout'),
    info: capture('stdout'),
    debug: capture('stdout'),
    warn: capture('stderr'),
    error: capture('stderr'),
  };
  const shadowNames = Object.keys(SHADOWED);

  let fn: (...args: unknown[]) => Promise<unknown>;
  try {
    fn = new Function(
      ...shadowNames,
      ...extras.names,
      'console',
      `"use strict"; return (async () => {\n${code}\n})();`,
    ) as (...args: unknown[]) => Promise<unknown>;
  } catch (err) {
    post('stderr', `${err instanceof Error ? err.message : String(err)}\n`);
    scope.postMessage({ type: 'done', id, exitCode: 1 });
    return;
  }

  Promise.resolve()
    .then(() => fn(...shadowNames.map((n) => SHADOWED[n]), ...extras.values, fakeConsole))
    .then(() => scope.postMessage({ type: 'done', id, exitCode: 0 }))
    .catch((err: unknown) => {
      post('stderr', `${formatArg(err)}\n`);
      scope.postMessage({ type: 'done', id, exitCode: 1 });
    });
}

scope.onmessage = (ev: MessageEvent) => {
  const msg = (ev.data || {}) as {
    type?: string; id?: number; code?: string; source?: string; testCode?: string;
  };
  const id = Number(msg.id);
  if (!Number.isFinite(id)) return;

  if (msg.type === 'run') {
    runProgram(id, String(msg.code || ''), { names: [], values: [] });
    return;
  }

  if (msg.type === 'run-tests') {
    const built = buildTestProgram(String(msg.source || ''), String(msg.testCode || ''));
    if ('error' in built) {
      scope.postMessage({ type: 'stderr', id, text: `${built.error}\n` });
      scope.postMessage({ type: 'done', id, exitCode: 1 });
      return;
    }
    const shim = createTestShim();
    const report = (summary: TestSummary) => scope.postMessage({ type: 'test-summary', id, summary });
    runProgram(id, built.program, {
      names: ['test', 'describe', 'it', 'assert', '__tests', '__reportTests'],
      values: [shim.test, shim.describe, shim.it, createAssertShim(), shim.registry, report],
    });
  }
};
