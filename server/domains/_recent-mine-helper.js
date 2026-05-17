// server/domains/_recent-mine-helper.js
//
// Phase 2 of the 10-dimension UX completeness sprint.
//
// Factory for the standard `<domain>.recent_mine` and
// `<domain>.list_mine` macros. Eliminates the per-domain boilerplate that
// otherwise duplicates "SELECT * WHERE owner = ? ORDER BY updated_at DESC
// LIMIT ?" across 200+ files.
//
// Usage in a domain file:
//
//   import { buildRecentMineMacro, buildListMineMacro } from "./_recent-mine-helper.js";
//
//   export default function registerPharmacyMacros(register) {
//     buildRecentMineMacro(register, "pharmacy", {
//       table: "pharmacy_artifacts",
//       ownerColumn: "user_id",
//       titleColumn: "title",
//       updatedColumn: "updated_at",
//     });
//     // ... domain-specific macros below
//   }
//
// Standard return shape (Tier-1 behavior test pins this):
//   { ok: true, items: [{ id, title, createdAt, updatedAt, ...extras }], total: number }

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(input) {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * Build a standard recent_mine macro.
 *
 * @param {Function} register — the lens-domain register(domain, name, handler).
 * @param {string}   domain   — domain name (e.g. "pharmacy").
 * @param {Object}   opts
 *   table         — SQL table holding the user's artifacts.
 *   ownerColumn   — column that holds user_id. Default 'user_id'.
 *   titleColumn   — column to expose as `title`. Default 'title'.
 *   updatedColumn — column ordered DESC. Default 'updated_at'.
 *   createdColumn — column exposed as `createdAt`. Default 'created_at'.
 *   idColumn      — column exposed as `id`. Default 'id'.
 *   extraColumns  — additional columns to spread into each item.
 *                   Default [].
 *   where         — additional WHERE fragment, e.g. "status = 'active'".
 *                   Optional.
 */
export function buildRecentMineMacro(register, domain, opts) {
  const {
    table,
    ownerColumn = "user_id",
    titleColumn = "title",
    updatedColumn = "updated_at",
    createdColumn = "created_at",
    idColumn = "id",
    extraColumns = [],
    where = null,
  } = opts || {};
  if (!table) throw new Error("buildRecentMineMacro: table is required");

  const selectCols = [
    `${idColumn} AS id`,
    `${titleColumn} AS title`,
    `${createdColumn} AS createdAt`,
    `${updatedColumn} AS updatedAt`,
    ...extraColumns,
  ].join(", ");

  const extraWhere = where ? ` AND ${where}` : "";

  register(domain, "recent_mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = clampLimit(input.limit);
    try {
      const items = db.prepare(`
        SELECT ${selectCols}
        FROM ${table}
        WHERE ${ownerColumn} = ?${extraWhere}
        ORDER BY ${updatedColumn} DESC
        LIMIT ?
      `).all(userId, limit);
      const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${ownerColumn} = ?${extraWhere}`).get(userId);
      return { ok: true, items, total: totalRow?.n || 0 };
    } catch (e) {
      return { ok: false, reason: "query_failed", error: String(e?.message || e) };
    }
  }, { note: `recent ${table} for caller` });
}

/**
 * Build a list_mine macro (alias of recent_mine for now; reserved for
 * future paginated form).
 */
export function buildListMineMacro(register, domain, opts) {
  const {
    table,
    ownerColumn = "user_id",
    titleColumn = "title",
    updatedColumn = "updated_at",
    createdColumn = "created_at",
    idColumn = "id",
    extraColumns = [],
    where = null,
  } = opts || {};
  if (!table) throw new Error("buildListMineMacro: table is required");

  buildRecentMineMacro(register, domain, opts);

  const selectCols = [
    `${idColumn} AS id`,
    `${titleColumn} AS title`,
    `${createdColumn} AS createdAt`,
    `${updatedColumn} AS updatedAt`,
    ...extraColumns,
  ].join(", ");
  const extraWhere = where ? ` AND ${where}` : "";

  register(domain, "list_mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = clampLimit(input.limit);
    try {
      const items = db.prepare(`
        SELECT ${selectCols} FROM ${table}
        WHERE ${ownerColumn} = ?${extraWhere}
        ORDER BY ${updatedColumn} DESC LIMIT ?
      `).all(userId, limit);
      const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${ownerColumn} = ?${extraWhere}`).get(userId);
      return { ok: true, items, total: totalRow?.n || 0 };
    } catch (e) {
      return { ok: false, reason: "query_failed", error: String(e?.message || e) };
    }
  }, { note: `list ${table} for caller` });
}

export { DEFAULT_LIMIT, MAX_LIMIT };
