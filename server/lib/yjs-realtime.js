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
// **Persistence (2026-05-26 fix):** Y.Docs ARE now persisted to disk.
// Dirty docs flush every PERSIST_INTERVAL_MS (30s by default) to
// `server/data/yjs-state/{scope}/{docId}.bin`. On `getDoc` for a
// previously-known (scope, docId) the saved bytes are restored into
// a fresh Y.Doc before any client sees it. Before this, a server
// restart silently wiped every open Live Share session + collab doc.

import * as Y from "yjs";
import fs from "node:fs";
import path from "node:path";

// scope → Map<docId, Y.Doc>
const DOCS = new Map();
// scope → Map<docId, dirty-flag>. Set on each applyUpdate, cleared on persist.
const DIRTY = new Map();

const PERSIST_ROOT = process.env.YJS_STATE_DIR
  || path.join(process.env.DATA_DIR || "./server/data", "yjs-state");
const PERSIST_INTERVAL_MS = Number(process.env.YJS_PERSIST_MS) || 30_000;

function bucket(scope, map = DOCS) {
  let b = map.get(scope);
  if (!b) { b = new Map(); map.set(scope, b); }
  return b;
}

function pathFor(scope, docId) {
  const safeScope = String(scope).replace(/[^a-zA-Z0-9_:-]/g, "_");
  const safeDoc = String(docId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(PERSIST_ROOT, safeScope, `${safeDoc}.bin`);
}

function markDirty(scope, docId) {
  bucket(scope, DIRTY).set(docId, true);
}

/** Periodic disk flush — runs on a setInterval started by attachYjsSync. */
let _persistTimer = null;
function flushDirty() {
  for (const [scope, b] of DIRTY) {
    for (const [docId, isDirty] of b) {
      if (!isDirty) continue;
      const doc = DOCS.get(scope)?.get(docId);
      if (!doc) { b.delete(docId); continue; }
      try {
        const fp = pathFor(scope, docId);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        const bytes = Y.encodeStateAsUpdate(doc);
        fs.writeFileSync(fp, Buffer.from(bytes));
        b.set(docId, false);
      } catch (e) {
        // Don't crash the whole flush on one doc.
        try { console.warn(`[yjs-persist] failed for ${scope}/${docId}:`, e?.message); } catch {}
      }
    }
  }
}

/** Get or create the authoritative Y.Doc for a (scope, docId) pair.
 *  On first access, attempts to restore from disk if a saved snapshot
 *  exists at `${PERSIST_ROOT}/{scope}/{docId}.bin`. Restore failure is
 *  non-fatal — caller gets a fresh empty doc and the broken file is
 *  left in place for forensics. */
export function getDoc(scope, docId) {
  const b = bucket(scope);
  let doc = b.get(docId);
  if (!doc) {
    doc = new Y.Doc();
    // Lazy-restore from disk.
    try {
      const fp = pathFor(scope, docId);
      if (fs.existsSync(fp)) {
        const bytes = fs.readFileSync(fp);
        Y.applyUpdate(doc, bytes);
      }
    } catch (e) {
      try { console.warn(`[yjs-restore] failed for ${scope}/${docId}:`, e?.message); } catch {}
    }
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
    markDirty(scope, docId);
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
  // Start the periodic disk-flush. Idempotent — if already started,
  // re-arming is a no-op. Ensures CRDT state survives server restart.
  if (!_persistTimer && PERSIST_INTERVAL_MS > 0) {
    _persistTimer = setInterval(flushDirty, PERSIST_INTERVAL_MS);
    // Allow the process to exit even when this timer is pending.
    try { _persistTimer.unref?.(); } catch { /* node version w/o unref */ }
    // Also flush on graceful shutdown so the last edits aren't lost.
    process.on("SIGTERM", () => { try { flushDirty(); } catch { /* best-effort */ } });
    process.on("SIGINT",  () => { try { flushDirty(); } catch { /* best-effort */ } });
  }
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
  // Mark dirty so the replaced state is flushed to disk on the next
  // tick. Without this, a restart between replaceDoc and the next
  // applyUpdate would revert to the pre-restore state.
  markDirty(scope, docId);
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
