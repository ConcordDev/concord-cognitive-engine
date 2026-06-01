// server/lib/collective-face.js
//
// Political gap #4 — an abstract collective ("the Ashen Pact schemes against
// you", "the realm declares war") must resolve to a PERSON you can confront: the
// faction/kingdom's embodied leader. Factions/kingdoms are correctly not
// walkable; their leader is the face. This maps a {kind:'faction'|'kingdom', id}
// scheme party to the embodied {kind:'npc', id} that fronts it.
//
// Leadership is fragmented across the substrate, so this tries the known sources
// in order, all guarded:
//   kingdom → realms.ruler_id (when ruler_kind='npc')   [mig 158]
//   faction → elected faction_leader office holder       [mig 207 politics_elections]
//            → else the faction's highest-level NPC        [world_npcs heuristic]
// NPC/player parties pass through unchanged. No leader found → collective with
// face:null (caller falls back to the abstract name).

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

/**
 * @returns {{kind:string, id:string, face:({kind:'npc',id:string,via:string}|null), collective:boolean}}
 */
export function resolveCollectiveFace(db, kind, id) {
  const k = String(kind || "").toLowerCase();
  if (k === "npc" || k === "player") {
    return { kind: k, id: String(id), face: { kind: k, id: String(id), via: "self" }, collective: false };
  }
  if (!db || !id) return { kind: k, id: String(id), face: null, collective: true };
  const cid = String(id);

  if (k === "kingdom" || k === "realm") {
    const face = safe(() => {
      const r = db.prepare(`SELECT ruler_kind, ruler_id FROM realms WHERE id = ?`).get(cid)
             || db.prepare(`SELECT ruler_kind, ruler_id FROM kingdoms WHERE id = ?`).get(cid);
      return (r && r.ruler_kind === "npc" && r.ruler_id) ? { kind: "npc", id: r.ruler_id, via: "kingdom_ruler" } : null;
    }, null);
    return { kind: k, id: cid, face, collective: true };
  }

  if (k === "faction") {
    // 1) an elected faction_leader office holder.
    let face = safe(() => {
      const r = db.prepare(
        `SELECT holder_id FROM political_offices WHERE office='faction_leader' AND scope_id=? AND holder_kind='npc' AND holder_id IS NOT NULL LIMIT 1`
      ).get(cid);
      return r?.holder_id ? { kind: "npc", id: r.holder_id, via: "elected_leader" } : null;
    }, null);
    // 2) else the faction's highest-level / leader-flagged NPC.
    if (!face) {face = safe(() => {
      const cols = db.prepare(`PRAGMA table_info(world_npcs)`).all().map((c) => c.name);
      const fcol = cols.includes("faction_id") ? "faction_id" : cols.includes("faction") ? "faction" : null;
      if (!fcol) return null;
      const order = cols.includes("level") ? "level DESC" : "rowid ASC";
      const r = db.prepare(`SELECT id FROM world_npcs WHERE ${fcol}=? AND (is_dead IS NULL OR is_dead=0) ORDER BY ${order} LIMIT 1`).get(cid);
      return r?.id ? { kind: "npc", id: r.id, via: "ranking_member" } : null;
    }, null);}
    return { kind: k, id: cid, face, collective: true };
  }

  return { kind: k, id: cid, face: null, collective: true };
}

export default resolveCollectiveFace;
