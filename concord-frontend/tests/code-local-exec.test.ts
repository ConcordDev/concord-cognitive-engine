import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLocallyRunnable,
  localRunUnsupportedReason,
  resetPythonSessionForTests,
  runLocalScript,
} from '@/components/code/localExec';

/**
 * Behaviour tests for the browser-local runner (S1a). A fake Worker
 * stands in for local-exec.worker.ts: it answers by script content —
 * GOOD prints and exits 0, THROW errors with exit 1, HANG prints a
 * partial line then never finishes (the timeout must kill it and keep
 * the partial output).
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  terminated = false;
  postedCode = '';
  url = '';
  private listeners = new Map<string, Set<(ev: { data: unknown }) => void>>();

  constructor(url?: URL | string) {
    this.url = String(url || '');
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: { data: unknown }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    if (type === 'message') this.onmessage = fn;
  }
  removeEventListener(type: string, fn: (ev: { data: unknown }) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  get isPython() { return this.url.includes('python-exec'); }
  private pyReady = false;

  postMessage(msg: { type: string; id: number; code: string }) {
    this.postedCode = msg.code;
    const id = msg.id;
    const emit = (data: unknown) => queueMicrotask(() => this.onmessage?.({ data }));
    if (this.isPython) {
      if (!this.pyReady) {
        emit({ type: 'loading', id });
        queueMicrotask(() => { this.pyReady = true; emit({ type: 'ready', id, loadMs: 1234 }); });
        queueMicrotask(() => queueMicrotask(() => {
          if (msg.code.includes('PYTHROW')) { emit({ type: 'stderr', id, text: 'Traceback: ValueError
' }); emit({ type: 'done', id, exitCode: 1 }); }
          else { emit({ type: 'stdout', id, text: 'py-hello\n' }); emit({ type: 'done', id, exitCode: 0 }); }
        }));
        return;
      }
      if (msg.code.includes('PYTHROW')) { emit({ type: 'stderr', id, text: 'Traceback: ValueError\n' }); emit({ type: 'done', id, exitCode: 1 }); }
      else { emit({ type: 'stdout', id, text: 'py-hello\n' }); emit({ type: 'done', id, exitCode: 0 }); }
      return;
    }
    if (msg.code.includes('HANG')) {
      emit({ type: 'stdout', id, text: 'partial line\n' });
      return; // never done — the main-thread clock must end this run
    }
    if (msg.code.includes('THROW')) {
      emit({ type: 'stderr', id, text: 'Error: boom\n' });
      emit({ type: 'done', id, exitCode: 1 });
      return;
    }
    emit({ type: 'stdout', id, text: 'hello\n' });
    emit({ type: 'done', id, exitCode: 0 });
  }

  terminate() { this.terminated = true; }
}

const realWorker = globalThis.Worker;

beforeEach(() => {
  FakeWorker.instances = [];
  resetPythonSessionForTests();
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
});
afterEach(() => {
  resetPythonSessionForTests();
  globalThis.Worker = realWorker;
  vi.restoreAllMocks();
});

describe('advertised language scope', () => {
  it('runs exactly the JS/TS family locally', () => {
    for (const lang of ['javascript', 'typescript', 'js', 'ts', 'mjs', 'cjs', 'JavaScript', ' TS ', 'python', 'py']) {
      expect(isLocallyRunnable(lang)).toBe(true);
    }
    for (const lang of ['jsx', 'tsx', 'ruby', '', null, undefined]) {
      expect(isLocallyRunnable(lang)).toBe(false);
    }
  });

  it('gives user-word reasons for languages it does not run', () => {
    expect(localRunUnsupportedReason('python')).toBeNull();
    expect(localRunUnsupportedReason('tsx')).toMatch(/does not run JSX/);
    expect(localRunUnsupportedReason('ruby')).toMatch(/runs JavaScript and TypeScript/);
    expect(localRunUnsupportedReason('javascript')).toBeNull();
  });
});

describe('runLocalScript', () => {
  it('returns the real stdout and exit code of a successful run', async () => {
    const outcome = await runLocalScript({ code: 'GOOD console.log("hello")', language: 'javascript' });
    expect(outcome.ranLocally).toBe(true);
    expect(outcome.timedOut).toBe(false);
    expect(outcome.result.supported).toBe(true);
    expect(outcome.result.stdout).toBe('hello\n');
    expect(outcome.result.exitCode).toBe(0);
    expect(FakeWorker.instances[0].terminated).toBe(true); // per-run worker is disposed
  });

  it('reports a thrown error as exit 1 with its stderr, never as success', async () => {
    const outcome = await runLocalScript({ code: 'THROW', language: 'javascript' });
    expect(outcome.result.exitCode).toBe(1);
    expect(outcome.result.stderr).toContain('boom');
    expect(outcome.timedOut).toBe(false);
  });

  it('kills a runaway run at the timeout and keeps its partial output', async () => {
    const outcome = await runLocalScript({ code: 'HANG while(true){}', language: 'javascript', timeoutMs: 1000 });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.result.stdout).toBe('partial line\n');
    expect(outcome.result.exitCode).toBeUndefined();
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('transpiles TypeScript before the worker sees it', async () => {
    const outcome = await runLocalScript({ code: 'GOOD const x: number = 1;', language: 'typescript' });
    expect(outcome.result.exitCode).toBe(0);
    expect(FakeWorker.instances[0].postedCode).not.toContain(': number');
  });

  it('loads the Python runtime once, reports the load, then reuses the warm worker', async () => {
    const phases: string[] = [];
    const first = await runLocalScript({
      code: 'print("py-hello")', language: 'python',
      onStatus: (phase) => phases.push(phase),
    });
    expect(first.ranLocally).toBe(true);
    expect(first.result.stdout).toBe('py-hello\n');
    expect(first.result.exitCode).toBe(0);
    expect(first.loadedRuntime).toBe(true);
    expect(first.runtimeLoadMs).toBe(1234);
    expect(phases).toEqual(['loading-runtime', 'running']);
    expect(FakeWorker.instances.length).toBe(1);

    const second = await runLocalScript({ code: 'print("py-hello")', language: 'python' });
    expect(second.result.exitCode).toBe(0);
    expect(second.loadedRuntime).toBeUndefined();
    expect(FakeWorker.instances.length).toBe(1); // same warm worker, no second cold load
    expect(FakeWorker.instances[0].terminated).toBe(false);
  });

  it('reports a Python exception as exit 1 with its traceback', async () => {
    const outcome = await runLocalScript({ code: 'PYTHROW raise ValueError()', language: 'python' });
    expect(outcome.result.exitCode).toBe(1);
    expect(outcome.result.stderr).toContain('ValueError');
  });
});
