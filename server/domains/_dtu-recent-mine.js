// server/domains/_dtu-recent-mine.js
//
// Phase 2 of the 10-dimension UX completeness sprint — the DTU-backed
// recent_mine factory.
//
// Most lens artifacts ARE DTUs (the universal user-content store), keyed
// by `dtus.type` (or `dtus.kind` where present) and scoped by
// `dtus.creator_id` (or `owner_user_id` as a fallback).
//
// This factory wires a recent_mine macro against the dtus table for any
// (domain, [type/kind]) combo so a lens whose artifacts are DTUs can
// surface "my last N X" without a bespoke query.
//
// Usage:
//
//   import { buildDtuRecentMineMacro } from "./_dtu-recent-mine.js";
//
//   export default function registerArtMacros(register) {
//     buildDtuRecentMineMacro(register, "art", {
//       // Optional: filter by dtus.type. Defaults to no filter (all DTUs).
//       type: "art_piece",
//     });
//     // ... rest of the art macros
//   }
//
// Return shape (matches _recent-mine-helper.js):
//   { ok: true, items: [{ id, title, type, createdAt, updatedAt, visibility }], total: number }

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(input) {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * Build a DTU-backed recent_mine + list_mine pair.
 *
 * @param {Function} register — register(domain, name, handler).
 * @param {string}   domain   — lens domain name (e.g. "art", "music").
 * @param {Object}   opts
 *   type     — optional DTU type filter (string or array of strings).
 *   tags     — optional tags-includes filter (array of tag substrings).
 *   note     — descriptive note.
 */
export function buildDtuRecentMineMacro(register, domain, opts = {}) {
  const { type = null, tags = null, note = `recent DTUs for ${domain} lens` } = opts;

  const typeFilter = Array.isArray(type) ? type : (type ? [type] : []);
  const tagsFilter = Array.isArray(tags) ? tags : (tags ? [tags] : []);

  const buildWhere = (placeholders) => {
    const parts = ["creator_id = ?"];
    if (typeFilter.length > 0) {
      parts.push(`type IN (${typeFilter.map(() => "?").join(",")})`);
    }
    if (tagsFilter.length > 0) {
      for (const _ of tagsFilter) {
        parts.push("tags_json LIKE ?");
      }
    }
    return parts.join(" AND ");
  };

  const buildParams = (userId, limit = null) => {
    const params = [userId];
    for (const t of typeFilter) params.push(t);
    for (const tag of tagsFilter) params.push(`%${tag}%`);
    if (limit !== null) params.push(limit);
    return params;
  };

  const handler = async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = clampLimit(input.limit);
    try {
      const where = buildWhere();
      const items = db.prepare(`
        SELECT id, title, type, created_at AS createdAt, updated_at AS updatedAt, visibility
        FROM dtus
        WHERE ${where}
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(...buildParams(userId, limit));
      const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE ${where}`).get(...buildParams(userId));
      return { ok: true, items, total: totalRow?.n || 0 };
    } catch (e) {
      // Fallback to owner_user_id if creator_id is unpopulated in this env.
      try {
        const wherePart = buildWhere().replace("creator_id = ?", "owner_user_id = ?");
        const items = db.prepare(`
          SELECT id, title, type, created_at AS createdAt, updated_at AS updatedAt, visibility
          FROM dtus
          WHERE ${wherePart}
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(...buildParams(userId, limit));
        const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE ${wherePart}`).get(...buildParams(userId));
        return { ok: true, items, total: totalRow?.n || 0 };
      } catch (e2) {
        return { ok: false, reason: "query_failed", error: String(e2?.message || e2) };
      }
    }
  };

  register(domain, "recent_mine", handler, { note });
  register(domain, "list_mine",   handler, { note });
}

export { DEFAULT_LIMIT, MAX_LIMIT };
