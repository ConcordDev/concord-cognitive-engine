// server/domains/dtu-surface.js
//
// Phase 7 of the UX completeness sprint — cross-lens narrative surface.
//
// Four macros powering ProvenanceTrail + DownstreamBadge + per-lens
// "Used downstream" panels:
//
//   dtu_surface.record           Append a surface row when a downstream
//                                lens renders a DTU.
//   dtu_surface.where_used       For one DTU, list distinct (lens, count,
//                                last_surfaced_at) — drives "Where this
//                                DTU is being read" panel on the upstream
//                                lens.
//   dtu_surface.surfaced_from    For one lens, list DTUs surfaced from
//                                elsewhere in a given window — drives the
//                                cross-lens recents tile.
//   dtu_surface.provenance_trail Walk the citation graph from a leaf DTU
//                                upstream, joining surface log + lens
//                                origin per ancestor. Returns the
//                                provenance trail the ProvenanceTrail
//                                component renders.
//
// Authorisation:
//   - record requires no auth (the user is just telling us "I'm viewing
//     this on this lens"). user_id is stored if available.
//   - where_used / surfaced_from / provenance_trail are read-only and
//     publicReadDomains-friendly.

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 25;
const MAX_TRAIL_DEPTH = 12;

function safeParseJson(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); }
  catch { return fallback; }
}

export default function registerDtuSurfaceMacros(register) {
  /**
   * dtu_surface.record — append a surface row.
   * input: { dtuId, lensId, surfaceKind, meta? }
   */
  register("dtu_surface", "record", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId || null;

    const dtuId = String(input.dtuId || "").trim();
    const lensId = String(input.lensId || "").trim();
    const surfaceKind = String(input.surfaceKind || "").trim();
    if (!dtuId || !lensId || !surfaceKind) return { ok: false, reason: "missing_field" };
    if (dtuId.length > 200 || lensId.length > 64) return { ok: false, reason: "field_too_long" };

    const ALLOWED = ["feed", "citation_chip", "quote_block", "recent_card", "downstream_panel", "search_result", "inline_link", "export"];
    if (!ALLOWED.includes(surfaceKind)) return { ok: false, reason: "invalid_surface_kind" };

    let metaJson = null;
    if (input.meta) {
      try { metaJson = JSON.stringify(input.meta); }
      catch { return { ok: false, reason: "meta_not_serialisable" }; }
      if (metaJson.length > 8192) return { ok: false, reason: "meta_too_large" };
    }

    try {
      db.prepare(`
        INSERT INTO dtu_surface_log (dtu_id, surfaced_in_lens, user_id, surface_kind, surface_meta_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(dtuId, lensId, userId, surfaceKind, metaJson);
    } catch (e) {
      return { ok: false, reason: "db_error", error: String(e?.message || e) };
    }
    return { ok: true, recordedAt: Math.floor(Date.now() / 1000) };
  }, { note: "record a DTU surface event" });

  /**
   * dtu_surface.where_used — list lenses that have surfaced this DTU.
   * input: { dtuId, sinceDays? }
   */
  register("dtu_surface", "where_used", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };

    const dtuId = String(input.dtuId || "").trim();
    if (!dtuId) return { ok: false, reason: "missing_dtu_id" };

    const sinceDays = Math.min(Math.max(Number(input.sinceDays) || 90, 1), 365);
    const sinceTs = Math.floor(Date.now() / 1000) - sinceDays * 86400;

    const rows = db.prepare(`
      SELECT surfaced_in_lens AS lensId, surface_kind AS kind, COUNT(*) AS count,
             MAX(created_at) AS lastSurfacedAt, MIN(created_at) AS firstSurfacedAt
      FROM dtu_surface_log
      WHERE dtu_id = ? AND created_at >= ?
      GROUP BY surfaced_in_lens, surface_kind
      ORDER BY lastSurfacedAt DESC
    `).all(dtuId, sinceTs);

    return {
      ok: true,
      dtuId,
      sinceDays,
      surfaces: rows.map(r => ({
        lensId: r.lensId, kind: r.kind, count: r.count,
        firstSurfacedAt: r.firstSurfacedAt, lastSurfacedAt: r.lastSurfacedAt,
      })),
      totalSurfaces: rows.reduce((acc, r) => acc + r.count, 0),
    };
  }, { note: "where this DTU has been surfaced" });

  /**
   * dtu_surface.surfaced_from — DTUs surfaced into one lens recently.
   * input: { lensId, sinceDays?, limit?, excludeOwnOrigin? }
   *
   * If excludeOwnOrigin is true (default), DTUs whose source_lens =
   * lensId are filtered out — only "from elsewhere" rows survive.
   */
  register("dtu_surface", "surfaced_from", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };

    const lensId = String(input.lensId || "").trim();
    if (!lensId) return { ok: false, reason: "missing_lens_id" };

    const sinceDays = Math.min(Math.max(Number(input.sinceDays) || 7, 1), 90);
    const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const sinceTs = Math.floor(Date.now() / 1000) - sinceDays * 86400;
    const excludeOwnOrigin = input.excludeOwnOrigin !== false;

    // Join against dtus table if it exists; otherwise return surfaces alone.
    let rows;
    try {
      const hasDtus = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dtus'`).get();
      if (hasDtus) {
        const filter = excludeOwnOrigin ? `AND (dtus.source_lens IS NULL OR dtus.source_lens != ?)` : '';
        const args = excludeOwnOrigin ? [lensId, sinceTs, lensId, limit] : [lensId, sinceTs, limit];
        rows = db.prepare(`
          SELECT sl.dtu_id, sl.surface_kind, sl.created_at,
                 dtus.title, dtus.source_lens, dtus.creator_id
          FROM dtu_surface_log sl
          LEFT JOIN dtus ON dtus.id = sl.dtu_id
          WHERE sl.surfaced_in_lens = ? AND sl.created_at >= ? ${filter}
          ORDER BY sl.created_at DESC
          LIMIT ?
        `).all(...args);
      } else {
        rows = db.prepare(`
          SELECT dtu_id, surface_kind, created_at
          FROM dtu_surface_log
          WHERE surfaced_in_lens = ? AND created_at >= ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(lensId, sinceTs, limit);
      }
    } catch (e) {
      return { ok: false, reason: "db_error", error: String(e?.message || e) };
    }

    return {
      ok: true,
      lensId,
      sinceDays,
      surfaces: rows.map(r => ({
        dtuId: r.dtu_id,
        title: r.title || null,
        sourceLens: r.source_lens || null,
        creatorId: r.creator_id || null,
        kind: r.surface_kind,
        surfacedAt: r.created_at,
      })),
    };
  }, { note: "DTUs surfaced INTO this lens recently" });

  /**
   * dtu_surface.provenance_trail — walk citation graph upstream from a
   * leaf DTU, joining surface log per ancestor.
   * input: { dtuId, maxDepth? }
   *
   * Returns ordered list from the leaf upstream: each node has dtuId,
   * sourceLens, title, citation count, and recent surfaces.
   */
  register("dtu_surface", "provenance_trail", async (ctx, input = {}) => {
  try {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };

    const dtuId = String(input.dtuId || "").trim();
    if (!dtuId) return { ok: false, reason: "missing_dtu_id" };

    const maxDepth = Math.min(Math.max(Number(input.maxDepth) || 6, 1), MAX_TRAIL_DEPTH);

    const hasDtus = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dtus'`).get();
    const hasCitations = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dtu_citations'`).get();
    if (!hasDtus) return { ok: false, reason: "dtus_table_missing" };

    const getDtu = (id) => db.prepare(`SELECT id, title, source_lens, creator_id, kind FROM dtus WHERE id = ?`).get(id);
    const getParents = hasCitations
      ? db.prepare(`SELECT parent_id FROM dtu_citations WHERE child_id = ? LIMIT 5`)
      : null;
    const surfaceCount = db.prepare(`SELECT COUNT(*) AS c FROM dtu_surface_log WHERE dtu_id = ?`);

    const trail = [];
    const visited = new Set();
    let frontier = [dtuId];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier = [];
      for (const id of frontier) {
        if (visited.has(id)) continue;
        visited.add(id);
        const d = getDtu(id);
        if (!d) continue;
        const surfaces = surfaceCount.get(id);
        trail.push({
          depth,
          dtuId: d.id,
          title: d.title || null,
          sourceLens: d.source_lens || null,
          creatorId: d.creator_id || null,
          kind: d.kind || null,
          totalSurfaces: surfaces?.c || 0,
        });
        if (getParents) {
          const parents = getParents.all(id).map(p => p.parent_id).filter(Boolean);
          nextFrontier.push(...parents);
        }
      }
      frontier = nextFrontier;
    }

    return { ok: true, dtuId, trail, depthReached: trail.length > 0 ? Math.max(...trail.map(t => t.depth)) : 0 };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
}, { note: "walk citation graph upstream + join surface counts" });
}
