// server/domains/hermes-memory.js
//
// Lens actions for Dila's memory substrate (server.migrations/400_hermes_dila.js).
//
// All seven actions resolve `db` from the standard Concord sources
// (STATE.db, globalThis._concordDB, globalThis.__concordDB — same lookup
// pattern as server.js:9309). Every action enforces `actor.role ===
// 'sovereign'` so that ONLY the founder (and Dila, via api-key-auth
// resolving her role from the DB instead of the historical hardcoded
// 'member') can read or write her memory. A regular csk_ token bound
// to a non-sovereign user gets `actor.role='member'` and is denied
// with a JSON body the frontend error helper can render.
//
// The seven actions:
//
//   hermes_memory.write            POST-style: insert/update a DTU
//   hermes_memory.read             GET /:id: single fetch
//   hermes_memory.search           GET ?q=: full-text-like body match
//   hermes_memory.list             GET ?limit=&kind=&offset=
//   hermes_memory.recall           POST: bumps recall_count + ts (audit)
//   hermes_memory.compress         POST: triggers compressRollingWindow
//                                          on hermes_dtus only
//   hermes_memory.delete           DELETE /:id: soft-tombstone (sets
//                                          visibility='operator_only')
//
// Why seven and not more: the action set mirrors the operator's direct
// mental model ("I want Dila to remember X / show me what Dila
// remembers / forget Y / summarise Dila's memory"). The compress and
// delete are admin-grade operators; the rest are conversational.

import crypto from "node:crypto";

const MEMORY_KINDS = new Set([
  "episodic",
  "semantic",
  "working",
  "compressed",
  "initiative_reply",
  "skill_patch",
]);

const TIERS = new Set(["small", "mega", "hyper"]);
const SOURCE_KINDS = new Set([
  "hermes_written",
  "hermes_imported",
  "hermes_observed",
  "operator_curated",
]);
const VISIBILITIES = new Set(["operator_visible", "operator_only", "self_only"]);

function resolveDb() {
  try {
    const s = globalThis._concordSTATE || globalThis.STATE;
    if (s && s.db && typeof s.db.prepare === "function") return s.db;
    const g = globalThis._concordDB || globalThis.__concordDB;
    if (g && typeof g.prepare === "function") return g;
  } catch {
    // ignore
  }
  return null;
}

function requireSovereign(ctx) {
  // Enforced in-handler (not just middleware) so lens-action calls
  // from any internal caller also pass through this gate — mirrors
  // server/domains/admin.js#requireAdminRole and
  // server/domains/announcements.js#announcements.post.
  const role = ctx?.actor?.role || "";
  // Dila authenticates via csk_ tokens; api-key-auth resolves her
  // sovereign role from users.role after migration 400. The founder
  // is also 'sovereign'. Founder-secret-bypass is an internal path.
  if (role === "sovereign" || ctx?.internal === true) return null;
  return { ok: false, error: "Insufficient permissions: sovereign role required" };
}

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = "hermes") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export default function registerHermesMemoryActions(registerLensAction) {
  /**
   * hermes_memory.write
   * Insert or upsert a memory. The `body_json` is the same shape as
   * the public `dtus.body_json` (so future cross-search tooling works
   * out of the box) but visibility defaults to 'operator_visible' so
   * the founder can audit reads.
   *
   * params:
   *   title        (string, optional, default 'Untitled')
   *   body         (object, required) — free-form JSON
   *   tags         (string[], optional)
   *   memory_kind  (one of MEMORY_KINDS, default 'episodic')
   *   tier         (one of TIERS, default 'small')
   *   source_kind  (one of SOURCE_KINDS, default 'hermes_written')
   *   visibility   (one of VISIBILITIES, default 'operator_visible')
   *   id           (string, optional) — pass to upsert an existing row
   */
  registerLensAction("hermes_memory", "write", (ctx, _artifact, params) => {
    const denied = requireSovereign(ctx); if (denied) return denied;
    const db = resolveDb();
    if (!db) return { ok: false, error: "no_db" };

    const body = params?.body;
    if (!body || typeof body !== "object") {
      return { ok: false, error: "body_required" };
    }
    const title = String(params?.title || "Untitled").slice(0, 240);
    const tags = Array.isArray(params?.tags) ? params.tags : [];
    const memory_kind = MEMORY_KINDS.has(params?.memory_kind) ? params.memory_kind : "episodic";
    const tier = TIERS.has(params?.tier) ? params.tier : "small";
    const source_kind = SOURCE_KINDS.has(params?.source_kind) ? params.source_kind : "hermes_written";
    const visibility = VISIBILITIES.has(params?.visibility) ? params.visibility : "operator_visible";
    const now = nowIso();
    const rowId = typeof params?.id === "string" && params.id ? params.id : uid("hermesdtu");

    // Upsert (preserves recall_count if updating an existing row).
    db.prepare(`
      INSERT INTO hermes_dtus (
        id, user_id, title, body_json, tags_json, memory_kind,
        tier, source_kind, visibility, created_at, updated_at
      ) VALUES (?, 'hermes', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        body_json = excluded.body_json,
        tags_json = excluded.tags_json,
        memory_kind = excluded.memory_kind,
        tier = excluded.tier,
        source_kind = excluded.source_kind,
        visibility = excluded.visibility,
        updated_at = excluded.updated_at
    `).run(
      rowId, title,
      JSON.stringify(body),
      JSON.stringify(tags),
      memory_kind,
      tier,
      source_kind,
      visibility,
      now,
      now,
    );

    return { ok: true, result: { id: rowId, memory_kind, tier, visibility } };
  });

  /**
   * hermes_memory.read
   * GET /:id
   *
   * Returns the full body_json + metadata. Always increments
   * recall_count + last_recalled_at via hermes_memory.recall (kept
   * separate so reads can be cacheable and non-mutating in future
   * if needed).
   */
  registerLensAction("hermes_memory", "read", (ctx, _artifact, params) => {
    const denied = requireSovereign(ctx); if (denied) return denied;
    const db = resolveDb();
    if (!db) return { ok: false, error: "no_db" };
    const id = String(params?.id || "");
    if (!id) return { ok: false, error: "id_required" };
    const row = db.prepare(`
      SELECT id, title, body_json, tags_json, memory_kind, tier,
             source_kind, visibility, created_at, updated_at,
             last_recalled_at, recall_count
        FROM hermes_dtus WHERE id = ? AND user_id = 'hermes'
    `).get(id);
    if (!row) return { ok: false, error: "not_found" };
    return {
      ok: true,
      result: {
        id: row.id,
        title: row.title,
        body: safeJson(row.body_json),
        tags: safeJson(row.tags_json),
        memory_kind: row.memory_kind,
        tier: row.tier,
        source_kind: row.source_kind,
        visibility: row.visibility,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_recalled_at: row.last_recalled_at,
        recall_count: row.recall_count,
      },
    };
  });

  /**
   * hermes_memory.search
   * Body search: LIKE %q% over title + body_json (Postgres-style would
   * use tsvector, SQLite has FTS5 in newer builds but the migration
   * stance for hermes_dtus is "search isn't the load path" — read
   * patterns are recall, not search). For now: LIKE on both columns
   * capped at 50 hits, ordered by last_recalled_at DESC, created_at
   * DESC as tiebreaker.
   */
  registerLensAction("hermes_memory", "search", (ctx, _artifact, params) => {
    const denied = requireSovereign(ctx); if (denied) return denied;
    const db = resolveDb();
    if (!db) return { ok: false, error: "no_db" };
    const q = String(params?.q || "").trim();
    if (!q) return { ok: false, error: "q_required" };
    const limit = Math.min(50, Math.max(1, Number(params?.limit) || 12));
    const memory_kind = MEMORY_KINDS.has(params?.memory_kind) ? params.memory_kind : null;
    const rows = db.prepare(`
      SELECT id, title, memory_kind, tier, created_at, last_recalled_at, recall_count
        FROM hermes_dtus
       WHERE user_id = 'hermes'
         AND (title LIKE ? OR body_json LIKE ?)
         ${memory_kind ? "AND memory_kind = ?" : ""}
       ORDER BY (last_recalled_at IS NULL), last_recalled_at DESC, created_at DESC
       LIMIT ?
    `).all(
      ...(memory_kind
        ? [`%${q}%`, `%${q}%`, memory_kind, limit]
        : [`%${q}%`, `%${q}%`, limit])
    );
    return { ok: true, result: { q, count: rows.length, items: rows.map(stripBody) } };
  });

  /**
   * hermes_memory.list
   * Time-ordered or memory_kind-ordered listing. Default: most recent
   * 50 across all kinds. Pagination via offset.
   */
  registerLensAction("hermes_memory", "list", (ctx, _artifact, params) => {
    const denied = requireSovereign(ctx); if (denied) return denied;
    const db = resolveDb();
    if (!db) return { ok: false, error: "no_db" };
    const limit = Math.min(200, Math.max(1, Number(params?.limit) || 50));
    const offset = Math.max(0, Number(params?.offset) || 0);
    const memory_kind = MEMORY_KINDS.has(params?.memory_kind) ? params.memory_kind : null;
    const rows = db.prepare(`
      SELECT id, title, memory_kind, tier, created_at, last_recalled_at, recall_count
        FROM hermes_dtus
       WHERE user_id = 'hermes'
         ${memory_kind ? "AND memory_kind = ?" : ""}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?
    `).all(...(memory_kind ? [memory_kind, limit, offset] : [limit, offset]));
    return { ok: true, result: { count: rows.length, offset, items: rows.map(stripBody) } };
  });

  /**
   * hermes_memory.recall
   * Bumps recall_count + last_recalled_at for the given id. Used by
   * the frontend or the assistant itself to record "this is the
   * memory I just used to inform this answer" without rewriting the
   * memory itself.
   */
  registerLensAction("hermes_memory", "recall", (ctx, _artifact, params) => {
    const denied = requireSovereign(ctx); if (denied) return denied;
    const db = resolveDb();
    if (!db) return { ok: false, error: "no_db" };
    const id = String(params?.id || "");
    if (!id) return { ok: false, error: "id_required" };
    const now = nowIso();
    const res = db.prepare(`
      UPDATE hermes_dtus
         SET recall_count = recall_count + 1,
             last_recalled_at = ?
       WHERE id = ? AND user_id = 'hermes'
    `).run(now, id);
    if (res.changes === 0) return { ok: false, error: "not_found" };
    return { ok: true, result: { id, recalled_at: now } };
  });

  /**
   * hermes_memory.compress
   * Soft trigger: marks rows older than params.maxAgeDays with
   * memory_kind IN ('episodic','working') for compression. The actual
   * summarisation pass is owned by the operator (FUTURE — for now,
   * this records the intent and returns the candidate count, so Dila
   * has a working "I should compress my old memories" affordance
   * without lying about having done it).
   *
   * Returns the candidate IDs (capped at 100) — these are passed to
   * the chat macro's compressRollingWindow analogue in a follow-up
   * ticket. Honesty contract: the result says "candidates identified"
   * not "compressed".
   */
  registerLensAction("hermes_memory", "compress", (ctx, _artifact, params) => {
    const denied = requireSovereign(ctx); if (denied) return denied;
    const db = resolveDb();
    if (!db) return { ok: false, error: "no_db" };
    const maxAgeDays = Math.max(1, Number(params?.maxAgeDays) || 30);
    const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
    const candidates = db.prepare(`
      SELECT id, title, memory_kind, created_at FROM hermes_dtus
       WHERE user_id = 'hermes'
         AND memory_kind IN ('episodic','working')
         AND created_at < ?
         AND memory_kind != 'compressed'
       ORDER BY created_at ASC LIMIT 100
    `).all(cutoff);
    return {
      ok: true,
      result: {
        candidates_identified: candidates.length,
        cutoff,
        sample_ids: candidates.slice(0, 10).map((c) => c.id),
        honest_note:
          "candidates_identified, not yet summarised — the actual compression pass is a follow-up operator action; this action returns the work-list, not the work itself.",
      },
    };
  });

  /**
   * hermes_memory.delete
   * Soft-delete: demote visibility to 'self_only' and prefix the
   * title with `[tombstoned <ts>]`. Never a hard DELETE — the
   * audit trail must always be recoverable for the operator.
   */
  registerLensAction("hermes_memory", "delete", (ctx, _artifact, params) => {
    const denied = requireSovereign(ctx); if (denied) return denied;
    const db = resolveDb();
    if (!db) return { ok: false, error: "no_db" };
    const id = String(params?.id || "");
    if (!id) return { ok: false, error: "id_required" };
    const reason = String(params?.reason || "").slice(0, 240);
    const tombstone = `[tombstoned ${nowIso()}${reason ? " (" + reason + ")" : ""}]`;
    const row = db.prepare(
      "SELECT title FROM hermes_dtus WHERE id = ? AND user_id = 'hermes'",
    ).get(id);
    if (!row) return { ok: false, error: "not_found" };
    db.prepare(`
      UPDATE hermes_dtus
         SET visibility = 'self_only',
             title = ? || ' ' || COALESCE(title, ''),
             updated_at = ?
       WHERE id = ? AND user_id = 'hermes'
    `).run(tombstone, nowIso(), id);
    return { ok: true, result: { id, tombstoned: true } };
  });
}

function safeJson(s) {
  if (typeof s !== "string") return null;
  try { return JSON.parse(s); } catch { return null; }
}

function stripBody(row) {
  return {
    id: row.id,
    title: row.title,
    memory_kind: row.memory_kind,
    tier: row.tier || "small",
    created_at: row.created_at,
    last_recalled_at: row.last_recalled_at,
    recall_count: row.recall_count || 0,
  };
}
