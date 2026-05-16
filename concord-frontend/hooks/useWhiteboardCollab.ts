/**
 * useWhiteboardCollab — real-time multiplayer for shared whiteboards.
 *
 * Subscribes to socket.io events scoped to `whiteboard:${boardId}` and
 * exposes:
 *   - peerCursors: live cursor positions of other participants
 *   - voteCounts: aggregated per-element vote tally
 *   - broadcastScene(scene): debounced scene push (last-write-wins)
 *   - broadcastCursor(x, y): rate-limited cursor ping
 *   - castVote(elementId): toggle a vote on an element
 *
 * Lifecycle:
 *   - On mount: POST /api/lens/run whiteboard.join-shared
 *   - On unmount: POST /api/lens/run whiteboard.leave-shared
 *
 * The hook is purely additive — it doesn't replace the local Canvas
 * state, it mirrors remote scene-updates into a `remoteScene` accumulator
 * that the host component can choose to merge on conflict.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { onEvent } from '@/lib/realtime/event-bus';

export interface PeerCursor {
  userId: string;
  x: number;
  y: number;
  lastSeenMs: number;
}

export interface WhiteboardCollabState {
  peerCursors: Record<string, PeerCursor>;
  voteCounts: Record<string, number>;
  remoteScene: unknown | null;
  remoteSceneUpdateCount: number;
}

interface UseWhiteboardCollabOpts {
  boardId: string | null;
  enabled?: boolean;
  cursorThrottleMs?: number;
  sceneDebounceMs?: number;
  cursorStaleMs?: number;
}

export function useWhiteboardCollab({
  boardId,
  enabled = true,
  cursorThrottleMs = 60,
  sceneDebounceMs = 200,
  cursorStaleMs = 4000,
}: UseWhiteboardCollabOpts) {
  const [state, setState] = useState<WhiteboardCollabState>({
    peerCursors: {},
    voteCounts: {},
    remoteScene: null,
    remoteSceneUpdateCount: 0,
  });

  const lastCursorPushRef = useRef(0);
  const sceneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSceneRef = useRef<unknown | null>(null);

  // Join on mount, leave on unmount.
  useEffect(() => {
    if (!enabled || !boardId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/api/lens/run', {
          domain: 'whiteboard', action: 'join-shared', input: { id: boardId },
        });
        if (cancelled) return;
        const remoteScene = res.data?.result?.board?.scene;
        if (remoteScene) {
          setState((prev) => ({ ...prev, remoteScene, remoteSceneUpdateCount: prev.remoteSceneUpdateCount + 1 }));
        }
      } catch (_e) { /* join is best-effort */ }
    })();
    return () => {
      cancelled = true;
      api.post('/api/lens/run', {
        domain: 'whiteboard', action: 'leave-shared', input: { id: boardId },
      }).catch(() => { /* leave is best-effort */ });
    };
  }, [boardId, enabled]);

  // Subscribe to realtime events. Filter by boardId.
  useEffect(() => {
    if (!enabled || !boardId) return;
    const offScene = onEvent('whiteboard:scene-update', (payload: unknown) => {
      const p = payload as { boardId?: string; userId?: string; elementCount?: number };
      if (p.boardId !== boardId) return;
      // The event itself carries metadata only; re-fetch the full scene.
      // We do this lazily — the next remote-driven render can call
      // whiteboard.join-shared again to pull the latest scene.
      // For now we increment a counter so callers can re-fetch.
      setState((prev) => ({ ...prev, remoteSceneUpdateCount: prev.remoteSceneUpdateCount + 1 }));
    });
    const offCursor = onEvent('whiteboard:cursor', (payload: unknown) => {
      const p = payload as { boardId?: string; userId?: string; x?: number; y?: number };
      if (p.boardId !== boardId || typeof p.userId !== 'string' || typeof p.x !== 'number' || typeof p.y !== 'number') return;
      setState((prev) => ({
        ...prev,
        peerCursors: {
          ...prev.peerCursors,
          [p.userId!]: { userId: p.userId!, x: p.x!, y: p.y!, lastSeenMs: Date.now() },
        },
      }));
    });
    const offVote = onEvent('whiteboard:vote-cast', (payload: unknown) => {
      const p = payload as { boardId?: string; elementId?: string; voteCount?: number };
      if (p.boardId !== boardId || typeof p.elementId !== 'string' || typeof p.voteCount !== 'number') return;
      setState((prev) => ({
        ...prev,
        voteCounts: { ...prev.voteCounts, [p.elementId!]: p.voteCount! },
      }));
    });
    return () => {
      offScene?.();
      offCursor?.();
      offVote?.();
    };
  }, [boardId, enabled]);

  // GC stale peer cursors.
  useEffect(() => {
    if (!enabled) return;
    const i = setInterval(() => {
      setState((prev) => {
        const now = Date.now();
        const fresh: Record<string, PeerCursor> = {};
        let changed = false;
        for (const [id, c] of Object.entries(prev.peerCursors)) {
          if (now - c.lastSeenMs < cursorStaleMs) fresh[id] = c;
          else changed = true;
        }
        return changed ? { ...prev, peerCursors: fresh } : prev;
      });
    }, 1000);
    return () => clearInterval(i);
  }, [enabled, cursorStaleMs]);

  // Debounced scene push.
  const broadcastScene = useCallback((scene: unknown) => {
    if (!boardId || !enabled) return;
    pendingSceneRef.current = scene;
    if (sceneDebounceRef.current) clearTimeout(sceneDebounceRef.current);
    sceneDebounceRef.current = setTimeout(() => {
      const payload = pendingSceneRef.current;
      pendingSceneRef.current = null;
      sceneDebounceRef.current = null;
      api.post('/api/lens/run', {
        domain: 'whiteboard', action: 'broadcast-scene',
        input: { id: boardId, scene: payload },
      }).catch(() => { /* best effort */ });
    }, sceneDebounceMs);
  }, [boardId, enabled, sceneDebounceMs]);

  // Rate-limited cursor push.
  const broadcastCursor = useCallback((x: number, y: number) => {
    if (!boardId || !enabled) return;
    const now = Date.now();
    if (now - lastCursorPushRef.current < cursorThrottleMs) return;
    lastCursorPushRef.current = now;
    api.post('/api/lens/run', {
      domain: 'whiteboard', action: 'broadcast-cursor',
      input: { id: boardId, x, y },
    }).catch(() => { /* best effort */ });
  }, [boardId, enabled, cursorThrottleMs]);

  const castVote = useCallback(async (elementId: string) => {
    if (!boardId || !enabled) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'whiteboard', action: 'shared-vote-cast',
        input: { id: boardId, elementId },
      });
    } catch (_e) { /* best effort */ }
  }, [boardId, enabled]);

  return { ...state, broadcastScene, broadcastCursor, castVote };
}
