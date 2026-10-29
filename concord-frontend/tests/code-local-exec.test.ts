import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLocallyRunnable,
  localRunUnsupportedReason,
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

  constructor() { FakeWorker.instances.push(this); }

  postMessage(msg: { type: string; id: number; code: string }) {
    this.postedCode = msg.code;
    const id = msg.id;
    const emit = (data: unknown) => queueMicrotask(() => this.onmessage?.({ data }));
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
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
});
afterEach(() => {
  globalThis.Worker = realWorker;
  vi.restoreAllMocks();
});

describe('advertised language scope', () => {
  it('runs exactly the JS/TS family locally', () => {
    for (const lang of ['javascript', 'typescript', 'js', 'ts', 'mjs', 'cjs', 'JavaScript', ' TS ']) {
      expect(isLocallyRunnable(lang)).toBe(true);
    }
    for (const lang of ['python', 'py', 'jsx', 'tsx', 'ruby', '', null, undefined]) {
      expect(isLocallyRunnable(lang)).toBe(false);
    }
  });

  it('gives user-word reasons for languages it does not run', () => {
    expect(localRunUnsupportedReason('python')).toMatch(/does not run Python yet/);
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

  it('refuses Python honestly without ever starting a worker', async () => {
    const outcome = await runLocalScript({ code: 'print("hi")', language: 'python' });
    expect(outcome.ranLocally).toBe(false);
    expect(outcome.result.supported).toBe(false);
    expect(outcome.result.stderr).toMatch(/does not run Python yet/);
    expect(FakeWorker.instances.length).toBe(0);
  });
});
