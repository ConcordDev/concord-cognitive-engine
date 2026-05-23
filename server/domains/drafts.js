// server/domains/drafts.js
//
// Phase 1 — macro surface for per-lens auto-save drafts.
//
// Four macros powering the useLensDraft hook + the "Reopen recent"
// LoadFromSubstrate panel in every lens:
//
//   drafts.save        — UPSERT a draft payload by (user, lens, key).
//   drafts.load        — fetch one draft by (user, lens, key).
//   drafts.list_mine   — most-recent N drafts for the caller (whole
//                        fleet, or filtered to one lens).
//   drafts.delete      — drop a draft (used post-mint, or on user clear).
//
// Authorisation:
//   - Every macro requires ctx.actor.userId. Anonymous calls return
//     {ok:false, reason:'no_user'} so the public-read gate doesn't leak
//     anyone's drafts to anonymous reads.
//   - `load` and `list_mine` ARE listed in publicReadDomains because the
//     handler self-scopes by ctx.actor.userId — no anonymous read, but
//     authenticated cookie callers don't need to go through the heavy
//     mutation gate.
//
// Payload contract:
//   - payload_json: caller-defined opaque JSON (server stores as TEXT).
//     Max 256 KiB enforced server-side to prevent runaway draft growth.
//   - schema_version: optional caller integer; lets a lens bump and
//     migrate stored drafts in-app when its shape evolves.

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

function payloadByteLength(json) {
  try { return Buffer.byteLength(json, "utf8"); }
  catch { return Infinity; }
}

export default function registerDraftsMacros(register) {
  /**
   * drafts.save — UPSERT a draft payload.
   * input: { lensId, draftKey, payload, schemaVersion? }
   */
  register("drafts", "save", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const lensId = String(input.lensId || "").trim();
    const draftKey = String(input.draftKey || "").trim();
    if (!lensId || !draftKey) return { ok: false, reason: "missing_key" };
    if (lensId.length > 64 || draftKey.length > 128) return { ok: false, reason: "key_too_long" };

    let payloadJson;
    try {
      payloadJson = JSON.stringify(input.payload ?? null);
    } catch {
      return { ok: false, reason: "payload_not_serialisable" };
    }
    if (payloadByteLength(payloadJson) > MAX_PAYLOAD_BYTES) {
      return { ok: false, reason: "payload_too_large", max_bytes: MAX_PAYLOAD_BYTES };
    }

    const schemaVersion = Number.isFinite(Number(input.schemaVersion))
      ? Math.max(1, Math.floor(Number(input.schemaVersion)))
      : 1;

    const now = Math.floor(Date.now() / 1000);

    // UPSERT keyed by UNIQUE (user_id, lens_id, draft_key).
    const stmt = db.prepare(`
      INSERT INTO lens_drafts (user_id, lens_id, draft_key, payload_json, schema_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, lens_id, draft_key)
      DO UPDATE SET
        payload_json   = excluded.payload_json,
        schema_version = excluded.schema_version,
        updated_at     = excluded.updated_at
    `);
    const info = stmt.run(userId, lensId, draftKey, payloadJson, schemaVersion, now, now);

    return { ok: true, savedAt: now, rowId: info.lastInsertRowid || null };
  }, { note: "upsert a per-lens draft" });

  /**
   * drafts.load — fetch a single draft.
   * input: { lensId, draftKey }
   */
  register("drafts", "load", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const lensId = String(input.lensId || "").trim();
    const draftKey = String(input.draftKey || "").trim();
    if (!lensId || !draftKey) return { ok: false, reason: "missing_key" };

    const row = db.prepare(`
      SELECT payload_json, schema_version, created_at, updated_at
      FROM lens_drafts
      WHERE user_id = ? AND lens_id = ? AND draft_key = ?
    `).get(userId, lensId, draftKey);

    if (!row) return { ok: true, draft: null };

    let payload = null;
    try { payload = JSON.parse(row.payload_json); } catch { payload = null; }

    return {
      ok: true,
      draft: {
        payload,
        schemaVersion: row.schema_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  }, { note: "load a per-lens draft" });

  /**
   * drafts.list_mine — recent drafts for the caller.
   * input: { lensId?, limit? }
   *   - lensId omitted: whole-fleet recent (powers "your recent unfinished work")
   *   - lensId set: per-lens recent (powers the LoadFromSubstrate panel)
   */
  register("drafts", "list_mine", async (ctx, input = {}) => {
  try {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const lensId = input.lensId ? String(input.lensId).trim() : null;

    const rows = lensId
      ? db.prepare(`
          SELECT lens_id, draft_key, schema_version, created_at, updated_at,
                 LENGTH(payload_json) AS payload_bytes
          FROM lens_drafts
          WHERE user_id = ? AND lens_id = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(userId, lensId, limit)
      : db.prepare(`
          SELECT lens_id, draft_key, schema_version, created_at, updated_at,
                 LENGTH(payload_json) AS payload_bytes
          FROM lens_drafts
          WHERE user_id = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(userId, limit);

    const items = rows.map(r => ({
      lensId: r.lens_id,
      draftKey: r.draft_key,
      schemaVersion: r.schema_version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      payloadBytes: r.payload_bytes,
    }));

    const totalRow = lensId
      ? db.prepare(`SELECT COUNT(*) AS n FROM lens_drafts WHERE user_id = ? AND lens_id = ?`).get(userId, lensId)
      : db.prepare(`SELECT COUNT(*) AS n FROM lens_drafts WHERE user_id = ?`).get(userId);

    return { ok: true, items, total: totalRow?.n || 0 };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
}, { note: "list caller's recent drafts (whole-fleet or per-lens)" });

  /**
   * drafts.delete — drop a draft. Called post-mint (graduated to DTU)
   * or when the user explicitly clears.
   * input: { lensId, draftKey }
   */
  register("drafts", "delete", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const lensId = String(input.lensId || "").trim();
    const draftKey = String(input.draftKey || "").trim();
    if (!lensId || !draftKey) return { ok: false, reason: "missing_key" };

    const info = db.prepare(`
      DELETE FROM lens_drafts
      WHERE user_id = ? AND lens_id = ? AND draft_key = ?
    `).run(userId, lensId, draftKey);

    return { ok: true, removed: info.changes };
  }, { note: "delete a per-lens draft" });
}
