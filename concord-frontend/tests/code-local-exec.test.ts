import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLocallyRunnable,
  localRunUnsupportedReason,
  resetPythonSessionForTests,
  runLocalScript,
  toPlainJs,
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
  /** How long the fake takes to load before it announces worker-ready. */
  static loadMs = 0;
  /** How many freshly constructed JS workers stay silent (never announce worker-ready). */
  static silentStarts = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  terminated = false;
  postedCode = '';
  url = '';
  private listeners = new Map<string, Set<(ev: { data: unknown }) => void>>();

  /** Messages posted before the worker announced worker-ready (a real module worker would drop them). */
  earlyPosts = 0;
  readySent = false;

  constructor(url?: URL | string) {
    this.url = String(url || '');
    FakeWorker.instances.push(this);
    // Like local-exec.worker.ts: announce the handler once the module has run.
    if (!this.url.includes('python-exec') && FakeWorker.silentStarts > 0) { FakeWorker.silentStarts -= 1; return; }
    if (!this.url.includes('python-exec')) {
      const announce = () => { this.readySent = true; this.dispatch({ type: 'worker-ready' }); };
      if (FakeWorker.loadMs > 0) setTimeout(announce, FakeWorker.loadMs); else queueMicrotask(announce);
    }
  }

  private dispatch(data: unknown) {
    this.onmessage?.({ data });
    for (const fn of this.listeners.get('message') || []) fn({ data });
  }

  addEventListener(type: string, fn: (ev: { data: unknown }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    if (type === 'message' && this.isPython) this.onmessage = fn;
  }
  removeEventListener(type: string, fn: (ev: { data: unknown }) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  get isPython() { return this.url.includes('python-exec'); }
  private pyReady = false;

  postMessage(msg: { type: string; id: number; code: string }) {
    this.postedCode = msg.code;
    const id = msg.id;
    if (!this.isPython && !this.readySent) this.earlyPosts += 1;
    const emit = (data: unknown) => queueMicrotask(() => (this.isPython ? this.onmessage?.({ data }) : this.dispatch(data)));
    if (this.isPython) {
      if (!this.pyReady) {
        emit({ type: 'loading', id });
        queueMicrotask(() => { this.pyReady = true; emit({ type: 'ready', id, loadMs: 1234 }); });
        queueMicrotask(() => queueMicrotask(() => {
          if (msg.code.includes('PYTHROW')) { emit({ type: 'stderr', id, text: 'Traceback: ValueError\n' }); emit({ type: 'done', id, exitCode: 1 }); }
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
    expect(localRunUnsupportedReason('ruby')).toMatch(/runs JavaScript, TypeScript, and Python/);
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

  it('sends the program only after the worker says its handler is installed (no lost first message)', async () => {
    const outcome = await runLocalScript({ code: 'GOOD console.log("hello")', language: 'javascript' });
    const w = FakeWorker.instances[FakeWorker.instances.length - 1];
    expect(w.earlyPosts).toBe(0);
    expect(w.postedCode).toContain('GOOD');
    expect(outcome.result.stdout).toBe('hello\n');
  });

  it('a slow-loading runner is not the code timing out: the clock starts when the program is sent', async () => {
    FakeWorker.loadMs = 1500;
    try {
      const outcome = await runLocalScript({ code: 'GOOD console.log("hello")', language: 'javascript', timeoutMs: 1000 });
      expect(outcome.timedOut).toBe(false);
      expect(outcome.result.exitCode).toBe(0);
      expect(outcome.result.stdout).toBe('hello\n');
      expect(outcome.elapsedMs).toBeLessThan(1000); // run time, not load time
    } finally {
      FakeWorker.loadMs = 0;
    }
  });

  it('replaces a runner that never says it is listening, and runs on the next one', async () => {
    FakeWorker.silentStarts = 1;
    const before = FakeWorker.instances.length;
    const outcome = await runLocalScript({ code: 'GOOD console.log("hello")', language: 'javascript' });
    const made = FakeWorker.instances.slice(before);
    expect(made.length).toBe(2);
    expect(made[0].terminated).toBe(true);
    expect(made[0].postedCode).toBe(''); // nothing was ever sent to the silent one
    expect(outcome.result.stdout).toBe('hello\n');
    expect(outcome.timedOut).toBe(false);
  }, 15000);

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

  it('gives a module its own exports, so a file with `export` runs instead of failing on `exports is not defined`', async () => {
    const plain = await toPlainJs('export function sum(a: number, b: number) { return a + b; }\nconsole.log(sum(2, 3));', 'typescript');
    // Evaluate the compiled program the way the worker does: as a function body.
    const logs: unknown[] = [];
    new Function('console', plain)({ log: (...a: unknown[]) => logs.push(a.join(' ')) });
    expect(logs).toEqual(['5']);
    const js = await toPlainJs('export const x = 1; console.log(x);', 'javascript');
    expect(js).toContain('var exports = {}');
    expect(js).not.toMatch(/^export /m);
    // A plain script with no module syntax is left exactly as written.
    expect(await toPlainJs('console.log(1)', 'javascript')).toBe('console.log(1)');
  });

  it('says plainly that importing another project file cannot work in a one-file run', async () => {
    const plain = await toPlainJs("import { sum } from './sum';\nconsole.log(sum(1, 2));", 'typescript');
    expect(() => new Function('console', plain)({ log: () => {} })).toThrow(/Cannot import "\.\/sum" here/);
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

describe('runner worker construction', () => {
  it('starts the JS runner as a classic worker: a bundler bootstrap that uses importScripts crashes module workers', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../components/code/localExec.ts'), 'utf8');
    const ctors = src.match(/new Worker\(new URL\('\.\/local-exec\.worker\.ts', import\.meta\.url\)[^;]*;/g) || [];
    expect(ctors.length).toBe(1); // one start path (startRunnerWorker), shared by runs and tests
    for (const c of ctors) expect(c).not.toMatch(/type:\s*'module'/);
  });
});

