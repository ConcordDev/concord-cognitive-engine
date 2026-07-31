'use client';

/**
 * useYjsDoc — Yjs CRDT document wired to Concord's Socket.IO room.
 *
 * Replaces the prior lamport-clock last-write op-log with real CRDT merge
 * semantics for concurrent overlapping edits. Used by Code Live Share
 * and Collab co-editing; can be reused by any future realtime editor.
 *
 * Wire protocol (server: server/lib/yjs-realtime.js#attachYjsSync):
 *   - room:join          { room: `${scope}:${docId}` }   (existing handler)
 *   - yjs:sync-request   { scope, docId }                → yjs:sync-state
 *   - yjs:sync-state     { scope, docId, update: b64 }   ← server snapshot
 *   - yjs:update         { scope, docId, update: b64 }   ↔ bidirectional
 *
 * Doc state lives in the returned Y.Doc handle. Callers typically pull a
 * `Y.Text` out and bind it to a textarea/Monaco model. Local edits to the
 * Y.Text emit `yjs:update` automatically through the doc's observer.
 *
 * On scope/docId change or unmount the socket is disconnected and the
 * doc destroyed cleanly.
 */

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Socket } from 'socket.io-client';
// Single source of truth for where the socket server actually lives — see the
// comment on SOCKET_URL. Importing it (rather than re-deriving) is what keeps
// this hook from drifting back to a same-origin connection.
import { SOCKET_URL } from '@/lib/realtime/socket';

export interface UseYjsDocOptions {
  scope: string;     // e.g. 'code:liveshare' or 'collab:doc'
  docId: string | null;
  enabled?: boolean;
}

export interface UseYjsDocReturn {
  doc: Y.Doc | null;
  synced: boolean;   // true after server sync-state received
  socketReady: boolean;
  /** Bumps each time the server emits `yjs:doc-reset` (CRDT-restore). */
  resetVersion: number;
}

export function useYjsDoc({ scope, docId, enabled = true }: UseYjsDocOptions): UseYjsDocReturn {
  const [synced, setSynced] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  // Real state (not a ref) so the returned `doc` re-renders consumers the
  // moment it changes — on mount, `synced`/`socketReady` are already false,
  // so setSynced(false)/setSocketReady(false) below are no-ops that would
  // NOT have triggered a render, leaving a ref-based `doc` stale (null)
  // until the socket happened to connect and flip socketReady later.
  const [docInstance, setDocInstance] = useState<Y.Doc | null>(null);

  useEffect(() => {
    if (!enabled || !docId || typeof window === 'undefined') return;

    const doc = new Y.Doc();
    setDocInstance(doc);
    setSynced(false);
    setSocketReady(false);

    let socket: Socket | null = null;
    let disposed = false;

    // Update listener — forwarded to socket as base64.
    const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      // Origin === 'remote' marks updates we just applied from the
      // network; don't echo them back.
      if (origin === 'remote') return;
      if (!socket || disposed) return;
      try {
        const b64 = btoa(String.fromCharCode(...update));
        socket.emit('yjs:update', { scope, docId, update: b64 });
      } catch { /* ignore */ }
    };
    doc.on('update', onLocalUpdate);

    (async () => {
      try {
        const { io } = await import('socket.io-client');
        if (disposed) return;
        // Connect to the SAME resolved backend the rest of the app uses.
        // This was `io({ path: '/socket.io', ... })` — no URL, so socket.io
        // defaulted to SAME-ORIGIN (the Next dev server on :3000), which has
        // no socket server: `next.config.js`'s rewrites proxy HTTP but not
        // WebSocket upgrades. Every attempt died with "WebSocket is closed
        // before the connection is established", and with `reconnection: true`
        // it retried forever. Measured on `/lenses/world` (2026-07-25): the
        // shared :5050 socket carried 79 frames while six of these same-origin
        // sockets failed at 0 frames, which is what lit the "Disconnected"
        // badge even though realtime was in fact working.
        socket = io(SOCKET_URL, { path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true });
        const room = `${scope}:${docId}`;
        socket.on('connect', () => {
          if (disposed) return;
          setSocketReady(true);
          socket?.emit('room:join', { room });
          socket?.emit('yjs:sync-request', { scope, docId });
        });
        socket.on('yjs:sync-state', (payload: { scope: string; docId: string; update: string }) => {
          if (disposed || payload?.scope !== scope || payload?.docId !== docId) return;
          try {
            const bytes = Uint8Array.from(atob(payload.update), c => c.charCodeAt(0));
            Y.applyUpdate(doc, bytes, 'remote');
            setSynced(true);
          } catch { /* malformed sync-state */ }
        });
        socket.on('yjs:update', (payload: { scope: string; docId: string; update: string }) => {
          if (disposed || payload?.scope !== scope || payload?.docId !== docId) return;
          try {
            const bytes = Uint8Array.from(atob(payload.update), c => c.charCodeAt(0));
            Y.applyUpdate(doc, bytes, 'remote');
          } catch { /* malformed update */ }
        });
        // CRDT-aware snapshot restore: server says "throw away your
        // local state, here is the new state". We can't rewind a Y.Doc
        // in place (Yjs merges are monotonic), so the cleanest move is
        // to bump `resetVersion` and let callers remount their UI
        // bindings against the freshly-replaced doc. We also apply the
        // new state so the doc is immediately consistent for callers
        // that read `doc.getText(...)` synchronously.
        socket.on('yjs:doc-reset', (payload: { scope: string; docId: string; update: string }) => {
          if (disposed || payload?.scope !== scope || payload?.docId !== docId) return;
          try {
            // Drop existing state by recreating the doc. We swap the ref
            // contents so consumers that hold the same Y.Doc reference
            // keep working — Yjs supports applying a "reset" by clearing
            // shared types in a transaction, then applying the snapshot.
            const bytes = Uint8Array.from(atob(payload.update), c => c.charCodeAt(0));
            doc.transact(() => {
              for (const [key, shared] of doc.share) {
                // Clear each top-level shared type so the snapshot's
                // structure becomes authoritative.
                try {
                  if (shared instanceof Y.Text) shared.delete(0, shared.length);
                  else if (shared instanceof Y.Array) shared.delete(0, shared.length);
                  else if (shared instanceof Y.Map) shared.clear();
                } catch { /* ignore unknown type */ }
                void key;
              }
            }, 'remote');
            Y.applyUpdate(doc, bytes, 'remote');
            setResetVersion(v => v + 1);
          } catch { /* malformed reset */ }
        });
        socket.on('disconnect', () => {
          if (!disposed) setSocketReady(false);
        });
      } catch {
        // socket.io-client unavailable — caller falls back to whatever
        // pre-CRDT sync path the existing UI had.
      }
    })();

    return () => {
      disposed = true;
      try { doc.off('update', onLocalUpdate); } catch { /* ignore */ }
      try { socket?.disconnect(); } catch { /* ignore */ }
      try { doc.destroy(); } catch { /* ignore */ }
      setDocInstance(null);
    };
  }, [enabled, scope, docId]);

  return { doc: docInstance, synced, socketReady, resetVersion };
}
