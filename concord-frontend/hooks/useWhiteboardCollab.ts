/**
 * useWhiteboardCollab — real-time multiplayer for shared whiteboards.
 *
 * Subscribes to socket.io events scoped to `whiteboard:${boardId}` and
 * exposes:
 *   - peerCursors: live cursor positions of other participants
 *   - voteCounts: aggregated per-element vote tally
 *   - broadcastScene(scene): debounced scene push (last-write-wins)
 *   - broadcastOps(ops): element-granular CRDT/OT push (see below)
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
 *
 * ── Ops (CRDT/OT) sync ───────────────────────────────────────────────
 * `server/domains/whiteboard.js`'s `ops-apply`/`ops-since` macros implement
 * a real per-element last-writer-wins fold keyed on a monotonic Lamport
 * clock, broadcasting `whiteboard:ops` to the board's room on every apply.
 * Dead-event-listener sweep (DET-C batch 9) found the backend protocol
 * fully built and tested but never called from the frontend — the canvas
 * only ever used the simpler full-scene `broadcastScene` push. `broadcastOps`
 * below is the missing caller (see `CollabBoardSection.onCanvasChange`,
 * which diffs the shape array and sends the changed elements as ops), and
 * the `whiteboard:ops` subscription folds incoming remote ops into
 * `remoteScene` using the same LWW-per-element algorithm the server's
 * `foldOps` uses, so a peer's granular edit merges without waiting for a
 * full-scene refetch. `broadcastScene` is unchanged and still the
 * reconciliation path (initial join, and any caller that hasn't computed a
 * diff) — the two compose rather than replace one another.
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

/** One element-granular edit, matching server/domains/whiteboard.js's
 *  ops-apply input shape (`{type, element}` for add/update, `{type,
 *  elementId}` for delete). */
export interface WhiteboardOp {
  type: 'add' | 'update' | 'delete';
  element?: Record<string, unknown>;
  elementId?: string;
}

interface WhiteboardOpsPayload {
  boardId?: string;
  ops?: Array<{ clock: number; type: string; elementId: string; element?: Record<string, unknown> | null }>;
  clock?: number;
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
  // Ops sync bookkeeping — the Lamport clock this client has observed so far
  // (seeded from ops-apply's response / ops-since's baseline, advanced by
  // every incoming whiteboard:ops push) and, per element, the highest clock
  // already applied — mirrors the server's foldOps LWW-per-element contract
  // so a stale/out-of-order op is dropped instead of clobbering a newer edit.
  const opsClockRef = useRef(0);
  const lastOpClockByElementRef = useRef<Map<string, number>>(new Map());

  // A new board resets both — clocks/edit history from one board must never
  // leak into another.
  useEffect(() => {
    opsClockRef.current = 0;
    lastOpClockByElementRef.current = new Map();
  }, [boardId]);

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
    // Element-granular ops push (see the module header "Ops (CRDT/OT) sync"
    // note) — folds each op into remoteScene using the same LWW-per-element
    // rule server/domains/whiteboard.js's foldOps applies, so a peer's
    // single-element edit merges immediately without waiting on the
    // debounced full-scene refetch above.
    const offOps = onEvent('whiteboard:ops', (payload: unknown) => {
      const p = payload as WhiteboardOpsPayload;
      if (p.boardId !== boardId || !Array.isArray(p.ops) || p.ops.length === 0) return;
      // Ignore the echo of our own broadcast, same window broadcastScene uses.
      if (Date.now() - lastBroadcastAtRef.current < 1500) return;
      if (typeof p.clock === 'number') opsClockRef.current = Math.max(opsClockRef.current, p.clock);
      setState((prev) => {
        const prevScene = prev.remoteScene as { elements?: unknown[] } | null;
        const baseElements = Array.isArray(prevScene?.elements) ? prevScene!.elements : [];
        const byId = new Map(
          baseElements.map((el) => [String((el as { id?: string })?.id ?? ''), el]),
        );
        let changed = false;
        for (const op of p.ops!) {
          if (!op || typeof op.elementId !== 'string') continue;
          const lastClock = lastOpClockByElementRef.current.get(op.elementId) ?? 0;
          if (typeof op.clock !== 'number' || op.clock <= lastClock) continue; // stale/out-of-order — drop
          lastOpClockByElementRef.current.set(op.elementId, op.clock);
          if (op.type === 'delete') {
            if (byId.delete(op.elementId)) changed = true;
          } else if (op.element && typeof op.element === 'object') {
            byId.set(op.elementId, op.element);
            changed = true;
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          remoteScene: { ...(prevScene ?? {}), elements: Array.from(byId.values()) },
          remoteSceneUpdateCount: prev.remoteSceneUpdateCount + 1,
        };
      });
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
      offOps?.();
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

  // Element-granular ops push — the missing caller for ops-apply (see the
  // module header "Ops (CRDT/OT) sync" note). Sent immediately (no debounce;
  // the caller already knows exactly which elements changed, so there's
  // nothing to coalesce the way broadcastScene coalesces a burst of drags
  // into one full-scene payload). knownClock lets the server seed its clock
  // past whatever this client has already observed (see ops-apply's own
  // knownClock handling), so a client that's been offline briefly doesn't
  // regress the board's Lamport clock backwards.
  const broadcastOps = useCallback((ops: WhiteboardOp[]) => {
    if (!boardId || !enabled || !Array.isArray(ops) || ops.length === 0) return;
    lastBroadcastAtRef.current = Date.now(); // suppress our own ops echo, same convention as broadcastScene
    api.post('/api/lens/run', {
      domain: 'whiteboard', action: 'ops-apply',
      input: { boardId, ops, knownClock: opsClockRef.current },
    }).then((res) => {
      const clock = (res as { data?: { result?: { clock?: number } } } | undefined)?.data?.result?.clock;
      if (typeof clock === 'number') opsClockRef.current = Math.max(opsClockRef.current, clock);
    }).catch(() => { /* best effort */ });
  }, [boardId, enabled]);

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

  return { ...state, broadcastScene, broadcastOps, broadcastCursor, castVote };
}
