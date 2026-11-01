import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runLocalScript, resetPythonSessionForTests } from '@/components/code/localExec';

/**
 * Python runtime unavailable (#1707 / Ops M12). The Pyodide core is vendored under
 * public/pyodide/v0.26.4/ and may be missing on a deployment (404 / timeout). The runner must say so
 * honestly — "Python runtime unavailable", nothing fabricated, no hang — and JS/TS local exec must be
 * unaffected. Two layers: the real worker module (importScripts failure) and the localExec wrapper.
 */

describe('python-exec.worker: runtime load failure', () => {
  const posted: Array<{ type: string; id?: number; text?: string; exitCode?: number }> = [];
  let importCalls = 0;

  beforeEach(() => {
    posted.length = 0;
    importCalls = 0;
    vi.resetModules();
    // The worker file is written against DedicatedWorkerGlobalScope; give it a stub scope whose
    // importScripts fails the way a 404/timeout does (importScripts throws a NetworkError).
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.postMessage = (m: (typeof posted)[number]) => { posted.push(m); };
    scope.importScripts = () => { importCalls += 1; throw new Error('NetworkError: Failed to load /pyodide/v0.26.4/pyodide.js'); };
    scope.onmessage = null;
  });
  afterEach(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    delete scope.importScripts;
    scope.onmessage = null;
  });

  const run = async (id: number) => {
    const handler = (globalThis as unknown as { onmessage: (ev: { data: unknown }) => void }).onmessage;
    handler({ data: { type: 'run', id, code: 'print(1)', indexURL: 'http://x/pyodide/v0.26.4/' } });
    await vi.waitFor(() => expect(posted.some((m) => m.id === id && m.type === 'unavailable')).toBe(true));
  };

  it('reports "unavailable" (not a script exit code, no fake output) and does not hang', async () => {
    await import('@/components/code/python-exec.worker');
    await run(1);
    const msgs = posted.filter((m) => m.id === 1);
    expect(msgs.map((m) => m.type)).toEqual(['loading', 'unavailable']);
    expect(msgs.find((m) => m.type === 'unavailable')?.text).toMatch(/could not be loaded/);
    expect(posted.some((m) => m.type === 'stdout' || m.type === 'done' || m.type === 'ready')).toBe(false);
  });

  it('does not cache the failure: the next run retries the load', async () => {
    await import('@/components/code/python-exec.worker');
    await run(1);
    await run(2);
    expect(importCalls).toBe(2);
  });
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  terminated = false;
  url = '';
  private onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(url?: URL | string) { this.url = String(url || ''); FakeWorker.instances.push(this); }
  addEventListener(type: string, fn: (ev: { data: unknown }) => void) { if (type === 'message') this.onmessage = fn; }
  removeEventListener() { /* single listener per run */ }
  get isPython() { return this.url.includes('python-exec'); }
  postMessage(msg: { id: number }) {
    const emit = (data: unknown) => queueMicrotask(() => this.onmessage?.({ data }));
    if (this.isPython) {
      emit({ type: 'loading', id: msg.id });
      queueMicrotask(() => emit({ type: 'unavailable', id: msg.id, text: 'its files are served with Concord and could not be loaded.' }));
      return;
    }
    emit({ type: 'stdout', id: msg.id, text: 'js-ok\n' });
    emit({ type: 'done', id: msg.id, exitCode: 0 });
  }
  terminate() { this.terminated = true; }
}

describe('localExec: Python runtime unavailable', () => {
  const realWorker = globalThis.Worker;
  beforeEach(() => { FakeWorker.instances = []; resetPythonSessionForTests(); globalThis.Worker = FakeWorker as unknown as typeof Worker; });
  afterEach(() => { resetPythonSessionForTests(); globalThis.Worker = realWorker; });

  it('returns supported:false with an honest message, nothing ran locally, and drops the worker', async () => {
    const outcome = await runLocalScript({ code: 'print(1)', language: 'python' });
    expect(outcome.result.supported).toBe(false);
    expect(outcome.result.stderr).toMatch(/^Python runtime unavailable:/);
    expect(outcome.result.stdout).toBeUndefined();
    expect(outcome.result.exitCode).toBeUndefined();
    expect(outcome.ranLocally).toBe(false);
    expect(outcome.timedOut).toBe(false);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('a failed Python load does not break JavaScript local exec', async () => {
    await runLocalScript({ code: 'print(1)', language: 'python' });
    const js = await runLocalScript({ code: 'console.log("js-ok")', language: 'javascript' });
    expect(js.result.supported).toBe(true);
    expect(js.result.stdout).toContain('js-ok');
    expect(js.result.exitCode).toBe(0);
  });

  it('a second Python run starts a fresh worker (retry, no stuck session)', async () => {
    await runLocalScript({ code: 'print(1)', language: 'python' });
    await runLocalScript({ code: 'print(1)', language: 'python' });
    expect(FakeWorker.instances.filter((w) => w.isPython).length).toBe(2);
  });
});
