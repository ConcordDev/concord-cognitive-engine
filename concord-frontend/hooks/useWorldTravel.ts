// concord-frontend/hooks/useWorldTravel.ts
//
// Phase J — single source of truth for the cross-world travel flow.
//
// travel(worldId) returns a Promise that resolves when:
//   1. POST /api/worlds/travel returns 200.
//   2. Previous ConcordiaScene fully disposed (window event
//      `concordia:scene-disposed`).
//   3. localStorage.concordia:activeWorldId set to the new id.
//   4. New ConcordiaScene's first frame painted (`concordia:scene-ready`).
//
// The hook also exposes the current `phase` so the portal load screen
// can show what's happening: requesting → spawning → loading-assets →
// complete.

import { useCallback, useEffect, useRef, useState } from 'react';

export type TravelPhase = 'idle' | 'requesting' | 'spawning' | 'loading-assets' | 'complete' | 'error';

interface TravelState {
  phase: TravelPhase;
  targetWorldId: string | null;
  error: string | null;
  shardStatus: string | null;
  firstTickEtaMs: number | null;
}

interface TravelResponse {
  ok: boolean;
  worldId?: string;
  error?: string;
  shardStatus?: { ok: boolean; status: string; firstTickEtaMs?: number; error?: string };
  sharded?: boolean;
}

export const ACTIVE_WORLD_KEY = 'concordia:activeWorldId';

export function useWorldTravel() {
  const [state, setState] = useState<TravelState>({
    phase: 'idle',
    targetWorldId: null,
    error: null,
    shardStatus: null,
    firstTickEtaMs: null,
  });

  const sceneDisposedRef = useRef<(() => void) | null>(null);
  const sceneReadyRef = useRef<(() => void) | null>(null);

  // Listen for scene lifecycle events from ConcordiaScene + AvatarSystem3D.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onDisposed = () => { sceneDisposedRef.current?.(); };
    const onReady = () => { sceneReadyRef.current?.(); };
    window.addEventListener('concordia:scene-disposed', onDisposed);
    window.addEventListener('concordia:scene-ready', onReady);
    return () => {
      window.removeEventListener('concordia:scene-disposed', onDisposed);
      window.removeEventListener('concordia:scene-ready', onReady);
    };
  }, []);

  const travel = useCallback(async (worldId: string): Promise<void> => {
    if (!worldId) throw new Error('worldId required');
    setState({ phase: 'requesting', targetWorldId: worldId, error: null, shardStatus: null, firstTickEtaMs: null });

    // 1. POST /api/worlds/travel — backend ensures the shard is active.
    let resp: TravelResponse | null = null;
    try {
      // Move to spawning phase the moment we kick off the request — the
      // user sees "Awakening cyber…" immediately, even while we wait.
      setState((s) => ({ ...s, phase: 'spawning' }));
      const r = await fetch('/api/worlds/travel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId }),
      });
      resp = (await r.json()) as TravelResponse;
      if (!r.ok || !resp.ok) {
        setState({
          phase: 'error',
          targetWorldId: worldId,
          error: resp.error || `HTTP ${r.status}`,
          shardStatus: resp.shardStatus?.status || null,
          firstTickEtaMs: resp.shardStatus?.firstTickEtaMs ?? null,
        });
        throw new Error(resp.error || `travel_failed_${r.status}`);
      }
    } catch (err) {
      setState({
        phase: 'error',
        targetWorldId: worldId,
        error: (err as Error)?.message ?? String(err),
        shardStatus: null,
        firstTickEtaMs: null,
      });
      throw err;
    }

    setState((s) => ({ ...s, shardStatus: resp?.shardStatus?.status ?? null, firstTickEtaMs: resp?.shardStatus?.firstTickEtaMs ?? null, phase: 'loading-assets' }));

    // 2. Wait for the previous scene to be disposed. ConcordiaScene fires
    //    `concordia:scene-disposed` at the end of its cleanup block. If no
    //    prior scene is mounted (first load), the event won't fire — so we
    //    resolve the wait after 800ms regardless.
    const prevActive = (typeof window !== 'undefined') ? window.localStorage.getItem(ACTIVE_WORLD_KEY) : null;
    if (prevActive && prevActive !== worldId) {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const finish = () => { if (!resolved) { resolved = true; sceneDisposedRef.current = null; resolve(); } };
        sceneDisposedRef.current = finish;
        // Safety timeout — scene cleanup MUST finish quickly; 1.5s is generous.
        setTimeout(finish, 1500);
      });
    }

    // 3. Write the new active world. Downstream readers (ConcordiaScene,
    //    AvatarSystem3D, SoundscapeEngine) pick this up on next render.
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_WORLD_KEY, worldId);
      window.dispatchEvent(new CustomEvent('concordia:active-world-changed', { detail: { worldId } }));
    }

    // 4. Wait for the new scene to render its first frame.
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => { if (!resolved) { resolved = true; sceneReadyRef.current = null; resolve(); } };
      sceneReadyRef.current = finish;
      // Safety timeout — if the scene hasn't mounted in 8s, give up and
      // assume the user will see the portal load screen until it does.
      setTimeout(finish, 8000);
    });

    setState({ phase: 'complete', targetWorldId: worldId, error: null, shardStatus: resp?.shardStatus?.status ?? null, firstTickEtaMs: resp?.shardStatus?.firstTickEtaMs ?? null });
  }, []);

  return { ...state, travel };
}
