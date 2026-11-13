import { describe, it, expect } from 'vitest';
import { createKeyedSerialWriter, type LensUpdatePatch } from '@/components/board/board-shared';

// FIX-board-004 — progress slider set to 50 read back 49 after reload.
// Every layer of the round trip passes the number through untouched; the
// defect was ordering. A slider drag fires one update per tick and the
// panel fired them concurrently, so an earlier tick could land after the
// final one and win on the server. createKeyedSerialWriter serializes
// writes per task and coalesces patches queued behind an in-flight write,
// so the last value issued is the last value stored.

interface Deferred { promise: Promise<unknown>; resolve: (v?: unknown) => void; reject: (e?: unknown) => void }
function deferred(): Deferred {
  let resolve!: (v?: unknown) => void; let reject!: (e?: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const progressPatch = (n: number): LensUpdatePatch => ({ data: { progress: n } });

describe('FIX-board-004 — createKeyedSerialWriter', () => {
  it('control: the old concurrent fire-and-forget loses the final tick when writes land out of order', async () => {
    // The pre-fix panel behaviour, reproduced: every tick fires immediately
    // and the stored value is whatever lands last.
    let stored = 0;
    const inFlight: { d: Deferred; value: number }[] = [];
    const naiveWrite = (value: number) => {
      const d = deferred();
      inFlight.push({ d, value });
      return d.promise.then(() => { stored = value; });
    };
    void naiveWrite(49);
    void naiveWrite(50);
    // The 49 write lands after the 50 write (slow first request).
    inFlight[1].d.resolve(); await tick();
    inFlight[0].d.resolve(); await tick();
    expect(stored).toBe(49); // the bug, pinned as the control
  });

  it('serializes per key: the final tick is the final value stored, however the network orders raw requests', async () => {
    let stored = 0;
    let active = 0; let maxActive = 0;
    const calls: number[] = [];
    const gates: Deferred[] = [];
    const write = async (_key: string, patch: LensUpdatePatch) => {
      active += 1; maxActive = Math.max(maxActive, active);
      calls.push(patch.data.progress as number);
      const d = deferred(); gates.push(d);
      await d.promise;
      stored = patch.data.progress as number;
      active -= 1;
    };
    const enqueue = createKeyedSerialWriter(write);

    enqueue('task1', progressPatch(49)); // starts immediately
    enqueue('task1', progressPatch(50)); // queued behind it
    await tick();
    expect(calls).toEqual([49]); // 50 not even sent yet — cannot land early
    expect(maxActive).toBe(1);

    gates[0].resolve(); await tick(); await tick();
    expect(calls).toEqual([49, 50]); // sent only after 49 settled
    gates[1].resolve(); await tick();
    expect(stored).toBe(50); // the value the user left is the value stored
    expect(maxActive).toBe(1);
  });

  it('coalesces patches queued behind an in-flight write, merging data with newest fields winning', async () => {
    const calls: LensUpdatePatch[] = [];
    const gates: Deferred[] = [];
    const write = async (_key: string, patch: LensUpdatePatch) => {
      calls.push(patch);
      const d = deferred(); gates.push(d);
      await d.promise;
    };
    const enqueue = createKeyedSerialWriter(write);

    enqueue('task1', progressPatch(48));
    enqueue('task1', progressPatch(49));
    enqueue('task1', { data: { progress: 50, status: 'in_progress' } });
    await tick();
    expect(calls.length).toBe(1);

    gates[0].resolve(); await tick(); await tick();
    expect(calls.length).toBe(2); // two queued ticks became one write
    expect(calls[1].data).toEqual({ progress: 50, status: 'in_progress' });
    gates[1].resolve(); await tick();
  });

  it('a failed write does not jam the queue, and different keys still write in parallel', async () => {
    const calls: string[] = [];
    const gates = new Map<string, Deferred>();
    const write = async (key: string, patch: LensUpdatePatch) => {
      calls.push(`${key}:${patch.data.progress}`);
      const d = deferred(); gates.set(`${key}:${patch.data.progress}`, d);
      await d.promise;
    };
    const enqueue = createKeyedSerialWriter(write);

    enqueue('taskA', progressPatch(10));
    enqueue('taskA', progressPatch(11)); // queued behind A:10
    enqueue('taskB', progressPatch(20)); // different key — starts at once
    await tick();
    expect(calls).toEqual(['taskA:10', 'taskB:20']);

    gates.get('taskA:10')!.reject(new Error('network')); await tick(); await tick();
    expect(calls).toEqual(['taskA:10', 'taskB:20', 'taskA:11']); // queue moved on despite the failure
    gates.get('taskA:11')!.resolve(); gates.get('taskB:20')!.resolve(); await tick();
  });
});
