// server/lib/yjs-realtime.js
//
// Lightweight Yjs CRDT layer for realtime collaborative editing.
//
// Wraps Yjs's binary-update protocol around Concord's existing
// Socket.IO room infrastructure: each `(scope, docId)` pair has its
// own server-side Y.Doc, and any update emitted from a client is
// rebroadcast to every other client in the same room AND merged into
// the server's authoritative doc. Late-joining clients receive the
// current doc state via a `sync:request` → `sync:state` handshake.
//
// The CRDT properties (associative, commutative, idempotent merge)
// are what give us conflict-free editing for free — concurrent
// overlapping edits merge structurally instead of last-write-wins.
//
// Scopes today:
//   - 'code:liveshare' — Code lens Live Share sessions, keyed by code
//   - 'collab:doc'      — Collab lens documents, keyed by docId
//   - 'law:contract'    — Law lens collaborative contract redlining, keyed
//                          by contract id. Reuses this same layer end to
//                          end (getDoc/attachYjsSync/useYjsDoc on the
//                          client) — no parallel realtime transport was
//                          built for it. See server/domains/law.js
//                          (contract-redline-init/-link) and
//                          concord-frontend/components/law/ContractRedline.tsx.
//
// Persistence is in-process (`Y.Doc` lives in a Map). When the server
// restarts the doc state is lost — for now this matches the existing
// op-log persistence (which is also in-memory STATE). Future work:
// LevelDB-backed y-leveldb provider to survive restarts.
//
// MU1 (V1.1 R6 multi-user collaboration) — live cursors + presence.
// Extends the same layer with Yjs's own Awareness protocol
// (`y-protocols/awareness`, already on disk as a transitive dependency
// of `y-websocket` — which IS a direct dependency of this package —
// so no new npm install was needed). One `Awareness` instance per
// (scope, docId), mirroring the one-`Y.Doc`-per-(scope,docId) pattern
// above. Awareness state is intentionally NOT persisted (matches the
// protocol's own design: "awareness states must be updated every 30s
// or they're dropped") — it's ephemeral presence, not document content.

import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";

// Known (scope, purpose) pairs — informational only. `getDoc`/`applyUpdate`
// work with any (scope, docId) string pair (there is no enforced
// whitelist); this constant exists so a new consumer copies an existing
// scope-naming convention (`"<domain>:<kind>"`) instead of inventing a
// one-off shape, and so call sites don't hand-type the string in more
// than one place.
export const KNOWN_SCOPES = Object.freeze({
  CODE_LIVESHARE: "code:liveshare",
  COLLAB_DOC: "collab:doc",
  LAW_CONTRACT: "law:contract",
});

// scope → Map<docId, Y.Doc>
const DOCS = new Map();

function bucket(scope) {
  let b = DOCS.get(scope);
  if (!b) { b = new Map(); DOCS.set(scope, b); }
  return b;
}

/** Get or create the authoritative Y.Doc for a (scope, docId) pair. */
export function getDoc(scope, docId) {
  const b = bucket(scope);
  let doc = b.get(docId);
  if (!doc) {
    doc = new Y.Doc();
    b.set(docId, doc);
  }
  return doc;
}

/** Drop a Y.Doc — used when a Live Share session ends or a doc is deleted. */
export function disposeDoc(scope, docId) {
  const b = bucket(scope);
  const doc = b.get(docId);
  if (doc) { try { doc.destroy(); } catch (_) { /* ignore */ } b.delete(docId); }
  // The doc's own 'destroy' handler (see getAwareness below) already
  // calls awareness.destroy() when the Y.Doc is destroyed — this just
  // drops our cache entry so a later getAwareness() call builds a
  // fresh instance instead of returning the destroyed one.
  const ab = awarenessBucket(scope);
  ab.delete(docId);
}

// scope → Map<docId, Awareness> — parallels DOCS above, one per doc.
const AWARENESS = new Map();

function awarenessBucket(scope) {
  let b = AWARENESS.get(scope);
  if (!b) { b = new Map(); AWARENESS.set(scope, b); }
  return b;
}

/**
 * Get or create the server-side Awareness instance for a (scope, docId)
 * pair, bound to that pair's authoritative Y.Doc (so its `clientID`
 * lives in the same id-space other server code already uses).
 *
 * The Awareness constructor seeds a local state (`{}`) keyed by the
 * *server's* own `doc.clientID` — but the server is a relay, not a
 * collaborator, so that state is cleared immediately. Without this,
 * every late-joiner sync would include one extra, field-less "ghost"
 * participant that no real user is behind — exactly the kind of
 * fabricated presence the honest-by-construction rule forbids.
 */
export function getAwareness(scope, docId) {
  const b = awarenessBucket(scope);
  let awareness = b.get(docId);
  if (!awareness) {
    const doc = getDoc(scope, docId);
    awareness = new Awareness(doc);
    awareness.setLocalState(null);
    b.set(docId, awareness);
  }
  return awareness;
}

/**
 * Encode the current full state of the doc for a late-joining client.
 * Returns a binary `Uint8Array` that the client applies via
 * `Y.applyUpdate(localDoc, state)` to catch up.
 */
export function encodeStateAsUpdate(scope, docId) {
  const doc = getDoc(scope, docId);
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Apply a client's update to the server's authoritative doc. The
 * caller is expected to also rebroadcast the update binary to other
 * room members (this function doesn't touch sockets — it's pure
 * persistence) so server + clients converge.
 */
export function applyUpdate(scope, docId, update) {
  const doc = getDoc(scope, docId);
  try {
    Y.applyUpdate(doc, update);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Wire Yjs sync into Concord's existing Socket.IO room. Call once at
 * boot from server.js after the `io` instance is available.
 *
 * Events on the per-client socket:
 *   - sync:request { scope, docId }  → server replies with sync:state
 *   - sync:update  { scope, docId, update: base64 } → server applies +
 *     broadcasts to the room (excluding sender). Update payload is
 *     base64-encoded for clean JSON transport over Socket.IO.
 *   - yjs:awareness-request { scope, docId } → server replies with
 *     yjs:awareness-state, encoding every currently-known collaborator
 *     (cursor/presence) for a late joiner to bootstrap from.
 *   - yjs:awareness-update { scope, docId, clientId, update: base64 } →
 *     server applies the (already-encoded, client-produced) Awareness
 *     update to its own Awareness instance, then rebroadcasts to the
 *     room (excluding sender) so peers converge — mirrors the
 *     sync:update relay above, just for ephemeral presence instead of
 *     document content. `clientId` is the numeric Yjs client id the
 *     update is FOR (used only for this-socket's disconnect cleanup
 *     below, never trusted as an identity claim — the update bytes
 *     themselves are the actual awareness payload).
 *
 * Rooms used: `${scope}:${docId}` (e.g. "code:liveshare:ABC123" or
 * "collab:doc:doc-uuid"). Clients must already have joined that room
 * via the canonical `room:join` flow before the sync events work.
 */
export function attachYjsSync(io) {
  if (!io || typeof io.on !== "function") return;
  io.on("connection", (socket) => {
    // Tracks which (scope, docId, awareness-clientId) tuples THIS
    // socket has announced, so a disconnect (tab close, network
    // loss, crash — not just a graceful "I'm leaving") can retract
    // that collaborator's presence instead of leaving a stale cursor
    // visible to everyone else forever.
    const announced = [];

    socket.on("yjs:sync-request", ({ scope, docId } = {}) => {
      if (!scope || !docId) return;
      try {
        const update = encodeStateAsUpdate(String(scope), String(docId));
        socket.emit("yjs:sync-state", {
          scope, docId,
          update: Buffer.from(update).toString("base64"),
        });
      } catch (_) { /* never fail the socket on sync error */ }
    });

    socket.on("yjs:update", ({ scope, docId, update } = {}) => {
      if (!scope || !docId || typeof update !== "string") return;
      try {
        const bytes = Buffer.from(update, "base64");
        applyUpdate(String(scope), String(docId), bytes);
        const room = `${scope}:${docId}`;
        // Rebroadcast to every OTHER socket in the room so peers
        // converge. The sender already has the update locally.
        socket.to(room).emit("yjs:update", { scope, docId, update });
      } catch (_) { /* drop malformed update */ }
    });

    socket.on("yjs:awareness-request", ({ scope, docId } = {}) => {
      if (!scope || !docId) return;
      try {
        const awareness = getAwareness(String(scope), String(docId));
        const clientIds = Array.from(awareness.getStates().keys());
        const update = encodeAwarenessUpdate(awareness, clientIds);
        socket.emit("yjs:awareness-state", {
          scope, docId,
          update: Buffer.from(update).toString("base64"),
        });
      } catch (_) { /* never fail the socket on awareness error */ }
    });

    socket.on("yjs:awareness-update", ({ scope, docId, clientId, update } = {}) => {
      if (!scope || !docId || typeof update !== "string") return;
      try {
        const awareness = getAwareness(String(scope), String(docId));
        const bytes = Buffer.from(update, "base64");
        applyAwarenessUpdate(awareness, bytes, socket.id);
        const numericClientId = Number(clientId);
        if (Number.isFinite(numericClientId)) {
          announced.push({ scope: String(scope), docId: String(docId), clientId: numericClientId });
        }
        const room = `${scope}:${docId}`;
        // Rebroadcast the (already-encoded) update to every OTHER
        // socket in the room. We never re-derive or reshape the
        // payload here — it's relayed byte-for-byte, same as
        // yjs:update above.
        socket.to(room).emit("yjs:awareness-update", { scope, docId, update });
      } catch (_) { /* drop malformed awareness update */ }
    });

    socket.on("disconnect", () => {
      if (announced.length === 0) return;
      for (const { scope, docId, clientId } of announced) {
        try {
          const awareness = getAwareness(scope, docId);
          if (!awareness.getStates().has(clientId)) continue; // already gone / superseded
          removeAwarenessStates(awareness, [clientId], "disconnect");
          const update = encodeAwarenessUpdate(awareness, [clientId]);
          const room = `${scope}:${docId}`;
          // The disconnecting socket is already gone, so broadcast at
          // the io level (not socket.to) — there is no "sender to
          // exclude" anymore.
          io.to(room).emit("yjs:awareness-update", {
            scope, docId,
            update: Buffer.from(update).toString("base64"),
          });
        } catch (_) { /* best-effort cleanup */ }
      }
      announced.length = 0;
    });
  });
}

/**
 * Lightweight observer for server-side handlers that want to react to
 * a doc's textual state (e.g. snapshot the current text into a
 * persistence row when a Live Share session ends). Returns the current
 * text of `Y.Text("content")` if present, else empty string.
 */
export function getDocText(scope, docId, key = "content") {
  try {
    const doc = getDoc(scope, docId);
    const text = doc.getText(key);
    return text.toString();
  } catch { return ""; }
}

/**
 * Replace the in-memory doc with a fresh one initialised from the given
 * binary update. Used by CRDT-aware snapshot restore: rewinding a Y.Doc
 * in place isn't well-defined (merges are monotonic), so we dispose the
 * existing doc and rebuild it from the snapshot bytes.
 *
 * Returns the new state's binary so the caller can broadcast it to
 * clients. Clients should listen for `yjs:doc-reset`, drop their local
 * doc, and re-bind to the new state.
 */
export function replaceDoc(scope, docId, updateBytes) {
  const b = bucket(scope);
  const old = b.get(docId);
  if (old) { try { old.destroy(); } catch (_) { /* ignore */ } }
  const fresh = new Y.Doc();
  try { Y.applyUpdate(fresh, updateBytes); } catch (e) {
    // If the update is malformed, restore the old doc to avoid losing state.
    if (old) b.set(docId, old);
    return { ok: false, error: String(e?.message || e) };
  }
  b.set(docId, fresh);
  return { ok: true, state: Y.encodeStateAsUpdate(fresh) };
}

/**
 * Emit a `yjs:doc-reset` to every client in the room. Each client should
 * drop its local Y.Doc, request a fresh sync, and re-bind any UI state
 * (textarea content, cursor positions) from the new doc.
 */
export function broadcastDocReset(io, scope, docId, newStateBytes) {
  if (!io) return;
  const room = `${scope}:${docId}`;
  try {
    io.to(room).emit("yjs:doc-reset", {
      scope, docId,
      update: Buffer.from(newStateBytes).toString("base64"),
    });
  } catch (_) { /* best effort */ }
}

/** Diagnostics — total live doc count per scope. */
export function stats() {
  const out = {};
  for (const [scope, b] of DOCS) out[scope] = b.size;
  return out;
}
