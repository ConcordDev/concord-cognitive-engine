/// <reference lib="webworker" />
//
// concord-frontend/workers/avatar-animator.worker.ts
//
// Phase E — Web Worker that runs gait synthesis off the React/Three.js main
// thread. The worker imports `synthesizeGait` from the existing
// `lib/concordia/gait-synthesis.ts` (three.js math classes are
// worker-safe — Euler / Vector3 are pure JS) and posts back a serializable
// pose the main thread rehydrates into THREE.Euler instances before
// applying to bones.
//
// Failure mode: if any frame throws or the worker hangs, the hook on the
// main side falls back to running gait synthesis inline. The worker is a
// best-effort accelerator, never a hard dependency.

import { synthesizeGait } from '@/lib/concordia/gait-synthesis';
import {
  type WorkerInbound,
  type WorkerOutbound,
  gaitPoseToSerializable,
} from '@/lib/concordia/animator-protocol';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'animate') return;
  const t0 = performance.now();
  try {
    // synthesizeGait returns a GaitPose with THREE.Euler / THREE.Vector3
    // instances — we flatten them to plain {x,y,z} before postMessage so the
    // structured-clone serializer doesn't have to walk class internals.
    const pose = synthesizeGait(msg.params, msg.phase);
    const result: WorkerOutbound = {
      type: 'animate-result',
      avatarId: msg.avatarId,
      frameId: msg.frameId,
      pose: gaitPoseToSerializable(pose),
      computeMs: performance.now() - t0,
    };
    ctx.postMessage(result);
  } catch (err) {
    const errMsg: WorkerOutbound = {
      type: 'animate-error',
      avatarId: msg.avatarId,
      frameId: msg.frameId,
      error: (err as Error)?.message ?? String(err),
    };
    ctx.postMessage(errMsg);
  }
});

const ready: WorkerOutbound = { type: 'ready' };
ctx.postMessage(ready);
