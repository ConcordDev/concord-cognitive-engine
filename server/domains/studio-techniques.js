// server/domains/studio-techniques.js
//
// Studio Sprint B Item #12 — Production technique citation lineage.
//
// A producer documents a technique they used ("sidechain the bass to
// the kick on the and-of-3") and mints it as a
// kind='production_technique' DTU. When another producer cites the
// technique on their track, the royalty cascade flows CC back to the
// technique's author every time the citing track sells.
//
// kind='production_technique' joins the kind-agnostic cascade —
// no schema change required.

import crypto from "node:crypto";

const MAX_TITLE_LEN = 120;
const MAX_DESC_LEN = 4000;
const MAX_RECIPE_BYTES = 16 * 1024;

function clampStr(s, n) {
  return String(s ?? "").trim().slice(0, n);
}

export default function registerStudioTechniqueMacros(register) {
  // Mint a technique as a DTU.
  register("studio", "mint_technique", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };

    const title = clampStr(input.title, MAX_TITLE_LEN);
    if (!title) return { ok: false, reason: "title_required" };
    const description = clampStr(input.description, MAX_DESC_LEN);
    const tags = Array.isArray(input.tags) ? input.tags.filter(t => typeof t === "string").slice(0, 20) : [];
    const recipe = input.recipe_data && typeof input.recipe_data === "object" ? input.recipe_data : {};
    const recipeJson = JSON.stringify(recipe);
    if (recipeJson.length > MAX_RECIPE_BYTES) return { ok: false, reason: "recipe_too_large" };

    const dtuId = `pt_${crypto.randomUUID()}`;
    const meta = {
      type: "production_technique",
      title,
      description,
      tags,
      recipe_data: recipe,
      source_track_dtu_id: input.source_track_dtuId ? String(input.source_track_dtuId) : null,
    };

    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
        VALUES (?, 'production_technique', ?, ?, ?, unixepoch())
      `).run(dtuId, title, userId, JSON.stringify(meta));
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }

    // If the technique was extracted from an existing track DTU,
    // register the technique as a derivative of that track so
    // royalty flow correctly cascades. Best-effort.
    if (meta.source_track_dtu_id) {
      try {
        const cascade = await import("../economy/royalty-cascade.js");
        const parent = db.prepare(`SELECT id, creator_id FROM dtus WHERE id = ?`).get(meta.source_track_dtu_id);
        if (parent && cascade?.registerCitation) {
          cascade.registerCitation(db, {
            childId: dtuId,
            parentId: parent.id,
            creatorId: userId,
            parentCreatorId: parent.creator_id,
            parentDtu: { ...parent, visibility: "public" },
            generation: 1,
          });
        }
      } catch { /* cascade optional */ }
    }

    return { ok: true, dtuId, kind: "production_technique", title, meta };
  }, { note: "mint a documented production technique as a citable DTU" });

  // Cite a technique on a track — child = the citing track DTU,
  // parent = the technique DTU. The cascade pays the technique's
  // author whenever the citing track gets sold or further-cited.
  register("studio", "cite_technique", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const trackDtuId = String(input.track_dtuId || "");
    const techniqueDtuId = String(input.technique_dtuId || "");
    if (!trackDtuId || !techniqueDtuId) return { ok: false, reason: "missing_ids" };
    try {
      const cascade = await import("../economy/royalty-cascade.js");
      if (typeof cascade.registerCitation !== "function") {
        return { ok: false, reason: "cascade_unavailable" };
      }
      const parent = db.prepare(`SELECT id, creator_id FROM dtus WHERE id = ?`).get(techniqueDtuId);
      if (!parent) return { ok: false, reason: "technique_not_found" };
      const child = db.prepare(`SELECT id, creator_id FROM dtus WHERE id = ?`).get(trackDtuId);
      if (!child) return { ok: false, reason: "track_not_found" };
      if (child.creator_id !== userId) return { ok: false, reason: "not_track_owner" };
      return cascade.registerCitation(db, {
        childId: trackDtuId,
        parentId: techniqueDtuId,
        creatorId: userId,
        parentCreatorId: parent.creator_id,
        parentDtu: { ...parent, visibility: "public" },
        generation: 1,
      });
    } catch (err) {
      return { ok: false, reason: "cite_failed", error: err?.message };
    }
  }, { note: "cite an existing production technique on a track" });

  register("studio", "list_techniques", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const scope = input.scope === "mine" ? "mine" : "all";
    const limit = Math.max(1, Math.min(200, parseInt(input.limit) || 50));
    try {
      const sql = scope === "mine"
        ? `SELECT id, title, meta_json, created_at, creator_id FROM dtus
             WHERE kind = 'production_technique' AND creator_id = ?
             ORDER BY created_at DESC LIMIT ?`
        : `SELECT id, title, meta_json, created_at, creator_id FROM dtus
             WHERE kind = 'production_technique'
             ORDER BY created_at DESC LIMIT ?`;
      const rows = scope === "mine"
        ? db.prepare(sql).all(userId, limit)
        : db.prepare(sql).all(limit);
      return {
        ok: true,
        techniques: rows.map(r => {
          let meta = {};
          try { meta = JSON.parse(r.meta_json || "{}"); } catch { /* meta optional */ }
          return { id: r.id, title: r.title, creator_id: r.creator_id, meta, created_at: r.created_at };
        }),
      };
    } catch (err) {
      return { ok: false, reason: "query_failed", error: err?.message };
    }
  }, { note: "list production techniques (scope: 'mine' | 'all')" });
}
