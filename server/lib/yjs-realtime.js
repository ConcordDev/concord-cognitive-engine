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
//
// Persistence is in-process (`Y.Doc` lives in a Map). When the server
// restarts the doc state is lost — for now this matches the existing
// op-log persistence (which is also in-memory STATE). Future work:
// LevelDB-backed y-leveldb provider to survive restarts.

import * as Y from "yjs";

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
 *
 * Rooms used: `${scope}:${docId}` (e.g. "code:liveshare:ABC123" or
 * "collab:doc:doc-uuid"). Clients must already have joined that room
 * via the canonical `room:join` flow before the sync events work.
 */
export function attachYjsSync(io) {
  if (!io || typeof io.on !== "function") return;
  io.on("connection", (socket) => {
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
