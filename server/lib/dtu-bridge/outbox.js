// server/lib/dtu-bridge/outbox.js
//
// DTU bridge — Slice 2: the bridge outbox.
//
// Pending bridge work is recorded durably before anything is applied,
// with the same honest delivery semantics as the platform's federation
// outbox (server/lib/federation-outbox.js): a row's status only ever
// reflects what actually happened, retries back off, and after the
// attempt cap the row is abandoned rather than retried forever or —
// worse — marked delivered.
//
// One outbox row = one DTU version (one bridge record). The
// idempotency key is `table:id:contentHash`: enqueueing the same
// change twice — a re-sent pack, a retried producer — is a no-op, so
// the same change can never be delivered twice. A new version of the
// same DTU has a different content hash and is a separate row.
//
// Storage sits behind a small store interface so the state machine is
// identical in tests and in production:
//   - createSqliteStore(db) — the durable path (dtu_bridge_outbox in
//     the local SQLite database; the bridge's own infrastructure
//     table, deliberately NOT part of the substrate registry);
//   - createMemoryStore() — tests and dry runs.
// All status transitions live in createOutbox, in plain JS over the
// store primitives, so what is tested is what runs.

import { parsePack } from "./pack-envelope.js";
import { assertSubstrateTable } from "./substrate-registry.js";

export const OUTBOX_MAX_ATTEMPTS = 6;
export const OUTBOX_BACKOFF_S = [60, 300, 900, 3600, 14400, 86400]; // 1m, 5m, 15m, 1h, 4h, 1d

export function outboxKeyFor(rec) {
  return `${rec.table}:${rec.id}:${rec.provenance.contentHash}`;
}

// ── Stores ──────────────────────────────────────────────────────────────────

export function createMemoryStore() {
  const rows = new Map();
  return {
    get: (key) => rows.get(key) || null,
    put: (row) => {
      if (rows.has(row.key)) return false;
      rows.set(row.key, row);
      return true;
    },
    patch: (key, fields) => {
      const row = rows.get(key);
      if (!row) return false;
      Object.assign(row, fields);
      return true;
    },
    due: (nowMs, limit) =>
      [...rows.values()]
        .filter((r) => (r.status === "pending" || r.status === "failed") && r.nextDueAt <= nowMs)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit),
    all: () => [...rows.values()],
  };
}

export function createSqliteStore(db) {
  if (!db) throw new TypeError("createSqliteStore: a better-sqlite3 db handle is required");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_bridge_outbox (
      key TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      dtu_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      pack_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_due_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  const stmts = {
    get: db.prepare("SELECT * FROM dtu_bridge_outbox WHERE key = ?"),
    insert: db.prepare(`
      INSERT OR IGNORE INTO dtu_bridge_outbox
        (key, table_name, dtu_id, content_hash, pack_json, status, attempts, last_error, next_due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    due: db.prepare(`
      SELECT * FROM dtu_bridge_outbox
      WHERE status IN ('pending', 'failed') AND next_due_at <= ?
      ORDER BY created_at ASC LIMIT ?
    `),
    all: db.prepare("SELECT * FROM dtu_bridge_outbox ORDER BY created_at ASC"),
  };
  const toRow = (r) =>
    r && {
      key: r.key,
      table: r.table_name,
      dtuId: r.dtu_id,
      contentHash: r.content_hash,
      packJson: r.pack_json,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      nextDueAt: r.next_due_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  return {
    get: (key) => toRow(stmts.get.get(key)),
    put: (row) =>
      stmts.insert.run(
        row.key, row.table, row.dtuId, row.contentHash, row.packJson,
        row.status, row.attempts, row.lastError, row.nextDueAt, row.createdAt, row.updatedAt
      ).changes > 0,
    patch: (key, fields) => {
      const cols = {
        status: "status", attempts: "attempts", lastError: "last_error",
        nextDueAt: "next_due_at", updatedAt: "updated_at",
      };
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(fields)) {
        if (!(k in cols)) throw new TypeError(`sqlite store: unpatchable field "${k}"`);
        sets.push(`${cols[k]} = ?`);
        vals.push(v);
      }
      if (!sets.length) return false;
      return db.prepare(`UPDATE dtu_bridge_outbox SET ${sets.join(", ")} WHERE key = ?`).run(...vals, key).changes > 0;
    },
    due: (nowMs, limit) => stmts.due.all(nowMs, limit).map(toRow),
    all: () => stmts.all.all().map(toRow),
  };
}

// ── Outbox state machine ────────────────────────────────────────────────────

export function createOutbox(store, { maxAttempts = OUTBOX_MAX_ATTEMPTS, backoffS = OUTBOX_BACKOFF_S, now = () => Date.now() } = {}) {
  if (!store) throw new TypeError("createOutbox: a store is required");

  return {
    /**
     * Queue every record of a pack. The pack is verified first — an
     * invalid pack queues nothing. Returns per-record outcomes:
     * { ok, enqueued, deduped, keys }.
     */
    enqueuePack(packInput) {
      const parsed = parsePack(packInput);
      if (!parsed.ok) return { ok: false, reason: parsed.reason, enqueued: 0, deduped: 0, keys: [] };
      let enqueued = 0;
      let deduped = 0;
      const keys = [];
      for (const rec of parsed.pack.records) {
        assertSubstrateTable(rec.table);
        const key = outboxKeyFor(rec);
        keys.push(key);
        const t = now();
        const single = { ...parsed.pack, records: [rec] };
        const inserted = store.put({
          key,
          table: rec.table,
          dtuId: rec.id,
          contentHash: rec.provenance.contentHash,
          packJson: JSON.stringify(single),
          status: "pending",
          attempts: 0,
          lastError: null,
          nextDueAt: t,
          createdAt: t,
          updatedAt: t,
        });
        if (inserted) enqueued++;
        else deduped++;
      }
      return { ok: true, enqueued, deduped, keys };
    },

    /** Rows due for a delivery attempt, marked in-flight. */
    claim(limit = 25) {
      const rows = store.due(now(), limit);
      for (const row of rows) store.patch(row.key, { status: "in_flight", updatedAt: now() });
      return rows.map((r) => ({ ...r, status: "in_flight" }));
    },

    /** The change reached the other side and was applied (or ruled a duplicate there). */
    ack(key) {
      return store.patch(key, { status: "delivered", lastError: null, updatedAt: now() });
    },

    /**
     * Terminally abandon a row without further attempts — for changes
     * that can never apply (an invalid chain, an incomparable fork).
     * Distinct from "delivered": the change did NOT arrive, and the
     * reason says why, so a human can reconcile.
     */
    abandon(key, error) {
      const row = store.get(key);
      if (!row) return false;
      return store.patch(key, {
        status: "abandoned",
        attempts: row.attempts + 1,
        lastError: String(error || "abandoned"),
        updatedAt: now(),
      });
    },

    /**
     * A delivery attempt failed. Backs off honestly; after the attempt
     * cap the row is abandoned (terminal) rather than marked delivered.
     */
    fail(key, error) {
      const row = store.get(key);
      if (!row) return false;
      const attempts = row.attempts + 1;
      const t = now();
      if (attempts >= maxAttempts) {
        return store.patch(key, { status: "abandoned", attempts, lastError: String(error || "unknown"), updatedAt: t });
      }
      const backoffMs = backoffS[Math.min(attempts - 1, backoffS.length - 1)] * 1000;
      return store.patch(key, {
        status: "failed",
        attempts,
        lastError: String(error || "unknown"),
        nextDueAt: t + backoffMs,
        updatedAt: t,
      });
    },

    stats() {
      const counts = { pending: 0, in_flight: 0, failed: 0, delivered: 0, abandoned: 0 };
      for (const r of store.all()) counts[r.status] = (counts[r.status] || 0) + 1;
      return counts;
    },
  };
}
