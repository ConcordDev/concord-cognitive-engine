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

export interface UseYjsDocOptions {
  scope: string;     // e.g. 'code:liveshare' or 'collab:doc'
  docId: string | null;
  enabled?: boolean;
}

export interface UseYjsDocReturn {
  doc: Y.Doc | null;
  synced: boolean;   // true after server sync-state received
  socketReady: boolean;
}

export function useYjsDoc({ scope, docId, enabled = true }: UseYjsDocOptions): UseYjsDocReturn {
  const [synced, setSynced] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    if (!enabled || !docId || typeof window === 'undefined') return;

    const doc = new Y.Doc();
    docRef.current = doc;
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
        socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true });
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
      docRef.current = null;
    };
  }, [enabled, scope, docId]);

  return { doc: docRef.current, synced, socketReady };
}
