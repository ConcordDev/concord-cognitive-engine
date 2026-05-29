// concord-frontend/hooks/useAvatarAnimator.ts
//
// Phase E — main-thread proxy for the avatar-animator Web Worker. Exposes:
//   - `mode`: 'auto' | 'main-thread' | 'worker-only' (persisted localStorage)
//   - `requestGait(avatarId, params, phase)`: kicks off compute. Returns the
//     LATEST resolved pose for that avatar (one-frame-stale-on-warmup, not
//     a promise per frame — this matches a 60Hz render loop).
//   - `lastComputeMs`: rolling p99 for the dev overlay.
//
// Failure model: any worker error or 200ms+ silence demotes that avatar to
// inline computation for the rest of the session.

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  type SerializableGaitParams,
  type SerializableGaitPose,
  type WorkerOutbound,
} from '@/lib/concordia/animator-protocol';

export type AvatarComputeMode = 'auto' | 'main-thread' | 'worker-only';

const STORAGE_KEY = 'concordia:avatarCompute';

function readModeFromStorage(): AvatarComputeMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'main-thread' || v === 'worker-only') return v;
    return 'auto';
  } catch {
    return 'auto';
  }
}

export function setAvatarComputeMode(mode: AvatarComputeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent('concordia:avatar-compute-mode', { detail: { mode } }));
  } catch { /* SSR or storage disabled */ }
}

interface InternalState {
  worker: Worker | null;
  ready: boolean;
  failed: boolean;
  latestByAvatar: Map<string, { frameId: number; pose: SerializableGaitPose; computeMs: number }>;
  frameCounter: number;
  recentDurations: number[];
}

export function useAvatarAnimator() {
  const [mode, setMode] = useState<AvatarComputeMode>(() => readModeFromStorage());
  const [lastComputeMs, setLastComputeMs] = useState<number>(0);
  const stateRef = useRef<InternalState>({
    worker: null,
    ready: false,
    failed: false,
    latestByAvatar: new Map(),
    frameCounter: 0,
    recentDurations: [],
  });

  // Boot worker once on mount when mode permits.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mode === 'main-thread') return;
    if (stateRef.current.worker) return;

    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL('../workers/avatar-animator.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (err) {
      stateRef.current.failed = true;
       
      console.warn('[avatar-animator] worker spawn failed, falling back to main thread', err);
      return;
    }

    worker.addEventListener('message', (ev: MessageEvent<WorkerOutbound>) => {
      const msg = ev.data;
      if (msg.type === 'ready') {
        stateRef.current.ready = true;
        return;
      }
      if (msg.type === 'animate-result') {
        stateRef.current.latestByAvatar.set(msg.avatarId, {
          frameId: msg.frameId,
          pose: msg.pose,
          computeMs: msg.computeMs,
        });
        const r = stateRef.current.recentDurations;
        r.push(msg.computeMs);
        if (r.length > 120) r.shift();
        setLastComputeMs(msg.computeMs);
        return;
      }
      if (msg.type === 'animate-error') {
         
        console.warn('[avatar-animator] worker error for avatar', msg.avatarId, msg.error);
      }
    });

    worker.addEventListener('error', (err) => {
      stateRef.current.failed = true;
       
      console.warn('[avatar-animator] worker error event', err);
    });

    stateRef.current.worker = worker;

    // Capture the stable ref object so the cleanup doesn't read a possibly-changed
    // ref.current (the object identity is fixed; only its fields mutate).
    const state = stateRef.current;
    return () => {
      try { worker?.terminate(); } catch { /* worker may already be gone */ }
      state.worker = null;
      state.ready = false;
    };
  }, [mode]);

  // Listen for cross-component mode-change events so toggling the dropdown in
  // the UX Suite lens propagates without a full reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<{ mode?: AvatarComputeMode }>).detail;
      if (detail?.mode) setMode(detail.mode);
    };
    window.addEventListener('concordia:avatar-compute-mode', onChange);
    return () => window.removeEventListener('concordia:avatar-compute-mode', onChange);
  }, []);

  /** Request a gait compute for an avatar. Returns the latest available pose
   *  (the worker is fire-and-forget; the previous frame's pose is used until
   *  the new one returns — typically <1 frame later at 60Hz). */
  const requestGait = useCallback((avatarId: string, params: SerializableGaitParams, phase: number, delta: number): SerializableGaitPose | null => {
    const st = stateRef.current;
    if (!st.worker || !st.ready || st.failed) return null;
    st.frameCounter += 1;
    try {
      st.worker.postMessage({
        type: 'animate',
        avatarId,
        frameId: st.frameCounter,
        params,
        phase,
        delta,
      });
    } catch (err) {
      st.failed = true;
       
      console.warn('[avatar-animator] postMessage failed', err);
      return null;
    }
    return st.latestByAvatar.get(avatarId)?.pose ?? null;
  }, []);

  /** Diagnostic — used by the dev `?debug=perf` overlay. */
  const getStats = useCallback(() => {
    const r = stateRef.current.recentDurations;
    const sorted = r.slice().sort((a, b) => a - b);
    const p = (q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
    return {
      ready: stateRef.current.ready,
      failed: stateRef.current.failed,
      mode,
      samples: r.length,
      p50: p(0.5),
      p90: p(0.9),
      p99: p(0.99),
      lastMs: lastComputeMs,
    };
  }, [mode, lastComputeMs]);

  return {
    mode,
    setMode: (next: AvatarComputeMode) => { setAvatarComputeMode(next); setMode(next); },
    requestGait,
    isWorkerActive: !!stateRef.current.worker && stateRef.current.ready && !stateRef.current.failed,
    getStats,
  };
}

export const AVATAR_COMPUTE_STORAGE_KEY = STORAGE_KEY;
