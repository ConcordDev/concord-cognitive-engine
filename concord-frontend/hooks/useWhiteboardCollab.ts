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
import { joinRoom, leaveRoom, onReconnected } from '@/lib/realtime/socket';

export interface PeerCursor {
  userId: string;
  x: number;
  y: number;
  lastSeenMs: number;
}

export interface LivePresence {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  updatedAt: number;
}

export interface LiveReaction {
  id: string;
  emoji: string;
  x: number;
  y: number;
  authorId: string;
  authorName: string;
  ts: number;
}

export interface WhiteboardCollabState {
  peerCursors: Record<string, PeerCursor>;
  voteCounts: Record<string, number>;
  remoteScene: unknown | null;
  remoteSceneUpdateCount: number;
  livePresence: Record<string, LivePresence>;
  lastPeerReaction: LiveReaction | null;
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
    livePresence: {},
    lastPeerReaction: null,
  });

  const lastCursorPushRef = useRef(0);
  const lastPresencePingRef = useRef(0);
  const sceneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSceneRef = useRef<unknown | null>(null);
  const lastBroadcastAtRef = useRef(0);

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

  // Join the board's socket.io room so the server's io.to(`whiteboard:${boardId}`)
  // broadcasts (scene-update/cursor/vote-cast/reaction/presence — all emitted from
  // server/domains/whiteboard.js) actually reach this client. This was previously
  // missing entirely: the `join-shared` call above is a plain HTTP macro (it runs
  // over POST /api/lens/run and has no socket to join with), and nothing else in
  // this hook ever called `room:join`. Every server-side broadcast to the room was
  // reaching zero listeners — the collaboration UI subscribed correctly (see the
  // event-bus listeners below) but the underlying socket was never actually in the
  // room, so live multiplayer was cosmetically wired but functionally dead.
  // Socket.io room membership is per-connection, so re-join on every reconnect
  // (mirrors the wire protocol `useYjsDoc.ts` documents for Code Live Share).
  useEffect(() => {
    if (!enabled || !boardId) return;
    const room = `whiteboard:${boardId}`;
    joinRoom(room);
    const offReconnected = onReconnected(() => joinRoom(room));
    return () => {
      offReconnected();
      leaveRoom(room);
    };
  }, [boardId, enabled]);

  // Subscribe to realtime events. Filter by boardId.
  useEffect(() => {
    if (!enabled || !boardId) return;
    const offScene = onEvent('whiteboard:scene-update', (payload: unknown) => {
      const p = payload as { boardId?: string; userId?: string; elementCount?: number };
      if (p.boardId !== boardId) return;
      // Ignore the echo of our own broadcast (io.to(room) reaches the sender too).
      if (Date.now() - lastBroadcastAtRef.current < 1500) return;
      // The event carries metadata only — re-fetch the full scene (join-shared returns
      // board.scene and is idempotent) and surface it as remoteScene for the host to apply.
      api.post('/api/lens/run', { domain: 'whiteboard', action: 'join-shared', input: { id: boardId } })
        .then((res) => {
          const remoteScene = res.data?.result?.board?.scene;
          if (remoteScene) setState((prev) => ({ ...prev, remoteScene, remoteSceneUpdateCount: prev.remoteSceneUpdateCount + 1 }));
        })
        .catch(() => { setState((prev) => ({ ...prev, remoteSceneUpdateCount: prev.remoteSceneUpdateCount + 1 })); });
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
    // Dead-event-listener fix (verification-audit campaign): the "Live" tab's
    // named-participant presence list (server/domains/whiteboard.js
    // presence-ping/presence-list) was poll-only and never received a push
    // update — surfacing it here so it updates instantly instead of on the
    // next 10s poll tick.
    const offPresence = onEvent('whiteboard:presence', (payload: unknown) => {
      const p = payload as Partial<LivePresence> & { boardId?: string };
      if (p.boardId !== boardId || typeof p.userId !== 'string') return;
      setState((prev) => ({
        ...prev,
        livePresence: {
          ...prev.livePresence,
          [p.userId!]: {
            userId: p.userId!,
            name: String(p.name ?? p.userId),
            color: String(p.color ?? '#7dd3fc'),
            x: Number(p.x) || 0,
            y: Number(p.y) || 0,
            updatedAt: Number(p.updatedAt) || Date.now(),
          },
        },
      }));
    });
    // Reactions were broadcast server-side but nothing ever subscribed —
    // the sender saw their own "Sent 😀" confirmation, no one else saw it.
    const offReaction = onEvent('whiteboard:reaction', (payload: unknown) => {
      const p = payload as Partial<LiveReaction> & { boardId?: string };
      if (p.boardId !== boardId || typeof p.id !== 'string') return;
      setState((prev) => ({
        ...prev,
        lastPeerReaction: {
          id: p.id!,
          emoji: String(p.emoji ?? ''),
          x: Number(p.x) || 0,
          y: Number(p.y) || 0,
          authorId: String(p.authorId ?? ''),
          authorName: String(p.authorName ?? p.authorId ?? 'Someone'),
          ts: Number(p.ts) || Date.now(),
        },
      }));
    });
    return () => {
      offScene?.();
      offCursor?.();
      offVote?.();
      offPresence?.();
      offReaction?.();
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
      lastBroadcastAtRef.current = Date.now(); // suppress our own scene-update echo
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
    if (now - lastCursorPushRef.current >= cursorThrottleMs) {
      lastCursorPushRef.current = now;
      api.post('/api/lens/run', {
        domain: 'whiteboard', action: 'broadcast-cursor',
        input: { id: boardId, x, y },
      }).catch(() => { /* best effort */ });
    }
    // Dead-event-listener fix (verification-audit campaign): the "Live" tab's
    // named-participant presence list (presence-ping/presence-list) was
    // never pinged from anywhere, so it always polled empty. Piggyback a
    // slower-cadence presence heartbeat onto the same real cursor position
    // already being tracked here — well under the 30s server-side TTL.
    const PRESENCE_PING_MS = 8000;
    if (now - lastPresencePingRef.current >= PRESENCE_PING_MS) {
      lastPresencePingRef.current = now;
      api.post('/api/lens/run', {
        domain: 'whiteboard', action: 'presence-ping',
        input: { boardId, x, y },
      }).catch(() => { /* best effort */ });
    }
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
