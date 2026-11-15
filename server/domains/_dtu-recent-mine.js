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
//
// GB-1538 genus fix (B8): the dtus table exists in TWO shapes. The
// migration lineage (001 + 087) carries owner_user_id / body_json /
// tags_json / visibility and gains type + creator_id + data at 087. The
// live runtime bootstrap (dtu-store) creates creator_id / content /
// content_type / tier / created_at / embedding — no type, no
// updated_at, no visibility, no owner_user_id. This factory's query
// assumed the migration shape outright, so on a runtime-shaped table
// every list_mine/recent_mine (and aliases like srs.get) threw
// "no such column: type" and surfaced as a 400 on load. The handler now
// resolves the table's actual columns once (PRAGMA table_info — the
// same defensive pattern migration 087 uses) and builds the query from
// what exists: the reported type falls back to content_type, updated_at
// to created_at, visibility to NULL when absent, the owner scope uses
// whichever owner column the table carries, and the type filter applies
// only where its column exists (see the handler note).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(input) {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// Column sets are cached per db handle: the schema is fixed at boot
// (migrations and the store bootstrap both run before serving), so one
// PRAGMA per database is enough.
const _dtusColumnsCache = new WeakMap();
function dtusColumns(db) {
  let cols = _dtusColumnsCache.get(db);
  if (!cols) {
    cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map(r => r.name));
    _dtusColumnsCache.set(db, cols);
  }
  return cols;
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

  const handler = async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = clampLimit(input.limit);
    try {
      // Resolve the query plan from the columns this dtus table
      // actually has (see the header note). Every identifier below
      // comes from this fixed whitelist checked against PRAGMA output
      // — never from caller input.
      const cols = dtusColumns(db);
      const ownerCol = cols.has("creator_id") ? "creator_id"
        : (cols.has("owner_user_id") ? "owner_user_id" : null);
      if (!ownerCol) {
        return { ok: false, reason: "query_failed", error: "dtus table has no owner column" };
      }
      // The type FILTER applies only where the vocabulary's home
      // column exists: on runtime-shaped tables the filter values
      // (art_piece, srs_card, ...) live nowhere — content_type there
      // is a format field ('text', ...), so filtering on it would
      // silently empty every list. Unfiltered (the factory's type:null
      // behaviour) is the honest degradation. The item's reported
      // `type` still surfaces content_type when `type` is absent —
      // the same presentation dtu-pipeline itself uses.
      const typeCol = cols.has("type") ? "type"
        : (cols.has("content_type") ? "content_type" : null);
      const updatedCol = cols.has("updated_at") ? "updated_at" : "created_at";
      const visibilityCol = cols.has("visibility") ? "visibility" : null;
      const tagsCol = cols.has("tags_json") ? "tags_json" : null;

      const whereParts = [`${ownerCol} = ?`];
      const params = [userId];
      if (cols.has("type") && typeFilter.length > 0) {
        whereParts.push(`type IN (${typeFilter.map(() => "?").join(",")})`);
        for (const t of typeFilter) params.push(t);
      }
      if (tagsCol && tagsFilter.length > 0) {
        for (const tag of tagsFilter) {
          whereParts.push(`${tagsCol} LIKE ?`);
          params.push(`%${tag}%`);
        }
      }
      const where = whereParts.join(" AND ");
      const items = db.prepare(`
        SELECT id, title, ${typeCol ? `${typeCol} AS type` : "NULL AS type"}, created_at AS createdAt, ${updatedCol} AS updatedAt, ${visibilityCol ? `${visibilityCol} AS visibility` : "NULL AS visibility"}
        FROM dtus
        WHERE ${where}
        ORDER BY ${updatedCol} DESC
        LIMIT ?
      `).all(...params, limit);
      const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE ${where}`).get(...params);
      return { ok: true, items, total: totalRow?.n || 0 };
    } catch (e) {
      return { ok: false, reason: "query_failed", error: String(e?.message || e) };
    }
  };

  register(domain, "recent_mine", handler, { note });
  register(domain, "list_mine",   handler, { note });
}

export { DEFAULT_LIMIT, MAX_LIMIT };
