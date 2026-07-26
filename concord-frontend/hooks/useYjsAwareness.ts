'use client';

/**
 * useYjsAwareness — live cursors + presence on top of the existing Yjs
 * CRDT layer (server/lib/yjs-realtime.js).
 *
 * MU1 (V1.1 R6 multi-user collaboration). Extends the same
 * (scope, docId) pattern `useYjsDoc` already uses for document
 * content, but for EPHEMERAL presence — who else is here, and where
 * their cursor/selection is right now — via Yjs's own Awareness
 * protocol (`y-protocols/awareness`, already a transitive dependency
 * of the existing `y-websocket` dependency; no new npm package was
 * added for this).
 *
 * Deliberately reuses the app-wide Socket.IO singleton (`useSocket`)
 * rather than opening a second private connection: `useYjsDoc` already
 * opens its own dedicated socket for document sync, and this hook
 * can't reach into that connection (useYjsDoc.ts is a separate,
 * untouched file), so it rides the shared connection instead — one
 * extra connection avoided, at the cost of two sockets total being in
 * the room for a session that uses both hooks. A future refactor that
 * has `useYjsDoc` expose its socket could unify this.
 *
 * Wire protocol (server: server/lib/yjs-realtime.js#attachYjsSync):
 *   - room:join              { room: `${scope}:${docId}` }
 *   - yjs:awareness-request  { scope, docId }             → awareness-state
 *   - yjs:awareness-state    { scope, docId, update: b64 } ← full snapshot
 *   - yjs:awareness-update   { scope, docId, clientId, update: b64 } ↔ both ways
 *
 * HONESTY: `collaborators` only ever reflects real Awareness protocol
 * messages that have actually been applied to a local Awareness
 * instance bound to the real `doc` passed in. There is no synthetic
 * timer, no demo data, and no entry without a `userId` string —
 * malformed or field-less states are filtered out, never rendered as
 * a fabricated participant.
 *
 * Privacy: setting `hidden: true` calls `awareness.setLocalState(null)`
 * — the Yjs-native "I'm not here" signal — rather than merely tagging
 * a `hidden` field for peers to respect. This mirrors the intent of
 * `server/lib/city-presence.js`'s `setUserVisibility`/`getUserVisibility`
 * ("hidden excludes you from what others see, never changes what you
 * see") without importing that module: city-presence keys its presence
 * table by world-avatar userId in a completely different subsystem
 * (3D world position), and reaching into it here would couple two
 * unrelated systems for no real gain. This hook's privacy affordance
 * is self-contained and Yjs-native instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { useSocket } from '@/hooks/useSocket';

export interface AwarenessCursor {
  /** Which sub-artifact the cursor is in, when the doc holds more than
   *  one (e.g. a Live Share session's per-file Y.Text map). Omitted
   *  for single-artifact docs. */
  path?: string;
  /** Character offset of the selection anchor. */
  anchor: number;
  /** Character offset of the selection head (== anchor when there's
   *  no selection, just a caret). */
  head: number;
}

export interface AwarenessCollaborator {
  userId: string;
  displayName: string;
  color: string;
  cursor: AwarenessCursor | null;
  /** Epoch ms this collaborator's state was last (re-)published. */
  lastSeen: number;
}

export interface UseYjsAwarenessOptions {
  /** Same scope string used for the paired useYjsDoc call, e.g. 'code:liveshare'. */
  scope: string;
  docId: string | null;
  /** The Y.Doc from useYjsDoc — awareness rides on its clientID so a
   *  peer's cursor and their document edits share one identity. */
  doc: Y.Doc | null;
  userId: string;
  displayName: string;
  /** Deterministic per-user color if omitted (hash of userId). */
  color?: string;
  enabled?: boolean;
  /** When true, this client publishes no presence at all — see the
   *  privacy note above. Defaults to false (visible). */
  hidden?: boolean;
}

export interface UseYjsAwarenessReturn {
  /** Every OTHER collaborator currently known to be present. Never
   *  includes this client's own state, never contains a fabricated
   *  entry, and is `[]` whenever nobody else is actually connected. */
  collaborators: AwarenessCollaborator[];
  /** Publish (or clear, with `null`) this client's current cursor/selection. */
  setCursor: (cursor: AwarenessCursor | null) => void;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function bytesFromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Deterministic hash → HSL color string, stable for a given userId
 *  across sessions/tabs so the same person always gets the same color. */
export function colorForCollaborator(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export function useYjsAwareness({
  scope,
  docId,
  doc,
  userId,
  displayName,
  color,
  enabled = true,
  hidden = false,
}: UseYjsAwarenessOptions): UseYjsAwarenessReturn {
  const [collaborators, setCollaborators] = useState<AwarenessCollaborator[]>([]);
  const { socket, connect, emit, on, off } = useSocket({ autoConnect: true });

  const awarenessRef = useRef<InstanceType<typeof Awareness> | null>(null);
  const cursorRef = useRef<AwarenessCursor | null>(null);
  const hiddenRef = useRef(hidden);
  const publishRef = useRef<() => void>(() => {});
  const resolvedColor = color || colorForCollaborator(userId || 'anonymous');

  useEffect(() => { hiddenRef.current = hidden; publishRef.current(); }, [hidden]);

  useEffect(() => {
    if (!enabled || !doc || !docId || !scope || typeof window === 'undefined') {
      setCollaborators([]);
      return;
    }

    const awareness = new Awareness(doc);
    awarenessRef.current = awareness;
    const room = `${scope}:${docId}`;

    const publishLocalState = () => {
      if (hiddenRef.current) {
        awareness.setLocalState(null);
      } else {
        awareness.setLocalState({
          userId,
          displayName,
          color: resolvedColor,
          cursor: cursorRef.current,
          lastSeen: Date.now(),
        });
      }
    };
    publishRef.current = publishLocalState;

    // Forward OUR OWN state changes to the network. `origin === 'local'`
    // is set by Yjs whenever setLocalState/setLocalStateField runs —
    // never for changes applied from applyAwarenessUpdate below — so
    // this never re-broadcasts a remote peer's update back out.
    const onAwarenessNetworkableChange = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (origin !== 'local') return;
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      if (changed.length === 0) return;
      try {
        const update = encodeAwarenessUpdate(awareness, changed);
        emit('yjs:awareness-update', {
          scope, docId, clientId: awareness.clientID, update: base64FromBytes(update),
        });
      } catch { /* ignore */ }
    };
    awareness.on('update', onAwarenessNetworkableChange);

    // Recompute the public `collaborators` list from real awareness
    // state whenever it changes (local publish OR a remote apply).
    const recomputeCollaborators = () => {
      const next: AwarenessCollaborator[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return; // never include ourselves
        if (!state || typeof state !== 'object') return;
        const s = state as Record<string, unknown>;
        if (typeof s.userId !== 'string' || !s.userId) return; // never fabricate
        const rawCursor = s.cursor as Record<string, unknown> | null | undefined;
        const cursor: AwarenessCursor | null =
          rawCursor && typeof rawCursor === 'object' && typeof rawCursor.anchor === 'number' && typeof rawCursor.head === 'number'
            ? { path: typeof rawCursor.path === 'string' ? rawCursor.path : undefined, anchor: rawCursor.anchor, head: rawCursor.head }
            : null;
        next.push({
          userId: s.userId,
          displayName: typeof s.displayName === 'string' && s.displayName ? s.displayName : s.userId,
          color: typeof s.color === 'string' && s.color ? s.color : colorForCollaborator(s.userId),
          cursor,
          lastSeen: typeof s.lastSeen === 'number' ? s.lastSeen : 0,
        });
      });
      setCollaborators(next);
    };
    awareness.on('change', recomputeCollaborators);

    const onAwarenessState = (payload: { scope: string; docId: string; update: string }) => {
      if (!payload || payload.scope !== scope || payload.docId !== docId) return;
      try { applyAwarenessUpdate(awareness, bytesFromBase64(payload.update), 'remote'); } catch { /* ignore */ }
    };
    const onAwarenessUpdate = (payload: { scope: string; docId: string; update: string }) => {
      if (!payload || payload.scope !== scope || payload.docId !== docId) return;
      try { applyAwarenessUpdate(awareness, bytesFromBase64(payload.update), 'remote'); } catch { /* ignore */ }
    };
    on('yjs:awareness-state', onAwarenessState as (...args: unknown[]) => void);
    on('yjs:awareness-update', onAwarenessUpdate as (...args: unknown[]) => void);

    const joinAndRequest = () => {
      emit('room:join', { room });
      emit('yjs:awareness-request', { scope, docId });
      publishLocalState();
    };
    const onConnect = () => joinAndRequest();
    on('connect', onConnect as (...args: unknown[]) => void);
    if (socket?.connected) joinAndRequest();
    else connect();

    return () => {
      off('connect', onConnect as (...args: unknown[]) => void);
      off('yjs:awareness-state', onAwarenessState as (...args: unknown[]) => void);
      off('yjs:awareness-update', onAwarenessUpdate as (...args: unknown[]) => void);
      // Announce departure BEFORE detaching the local-update listener
      // (Yjs Observable emits synchronously) so peers see us leave.
      try { awareness.setLocalState(null); } catch { /* ignore */ }
      awareness.off('update', onAwarenessNetworkableChange);
      awareness.off('change', recomputeCollaborators);
      try { awareness.destroy(); } catch { /* ignore */ }
      awarenessRef.current = null;
      publishRef.current = () => {};
      setCollaborators([]);
    };
  }, [enabled, doc, scope, docId, userId, displayName, resolvedColor, socket, on, off, emit, connect]);

  const setCursor = useCallback((cursor: AwarenessCursor | null) => {
    cursorRef.current = cursor;
    publishRef.current();
  }, []);

  return { collaborators, setCursor };
}
