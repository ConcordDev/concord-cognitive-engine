// server/domains/nemesis.js
//
// Phase 5 — Nemesis surfacing. Exposes the npc-asymmetry substrate
// (mig 128: npc_grudges + npc_preoccupations + npc_desires; mig 152:
// npc_stress; mig 155: npc_schemes) so the world HUD can render
// per-NPC nemesis glyphs over the entities the player is near.
//
// Read-only. The actual writes happen in routes/worlds.js combat path,
// faction-strategy cycle, and npc-scheme-cycle.
//
// Macro nemesis.nearby
//   Input: { worldId, x?, z?, radius? }
//   Returns: { ok: true, npcs: [{ npcId, name, grudge, stress, scheme,
//              preoccupation, opinion, isNemesis }] }
//
// Macro nemesis.for_npc
//   Input: { npcId }
//   Returns full asymmetry context for a single NPC. Used by dialogue
//   hover previews.

import { composeAsymmetryContext } from "../lib/npc-asymmetry.js";

const DEFAULT_RADIUS = 30;

function getNemesisRowsForWorld(db, worldId, userId, originX, originZ, radius) {
  // Pull all NPCs in the world; filter by distance in JS so we don't
  // need a spatial index. Heartbeat already caps per-world creature
  // counts; nearby query is bounded by the world's NPC count.
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id AS npcId, x, z FROM world_npcs
      WHERE world_id = ?
        AND is_dead = 0
        AND archetype NOT LIKE 'creature:%'
      LIMIT 200
    `).all(worldId);
  } catch {
    return [];
  }

  const r2 = (radius || DEFAULT_RADIUS) ** 2;
  const inRange = (typeof originX === "number" && typeof originZ === "number")
    ? rows.filter((r) => {
        if (r.x == null || r.z == null) return false;
        const dx = r.x - originX;
        const dz = r.z - originZ;
        return dx * dx + dz * dz <= r2;
      })
    : rows;

  // Hoist the per-NPC lookups out of the loop — prepared once, reused per row
  // (was an N+1 re-preparing three statements per nearby NPC on this HUD path).
  const stressStmt = db.prepare(`SELECT stress, updated_at, coping_trait FROM npc_stress WHERE npc_id = ?`);
  const schemeStmt = db.prepare(`
          SELECT id, kind, phase FROM npc_schemes
          WHERE plotter_kind = 'npc' AND plotter_id = ?
            AND target_kind = 'player' AND target_id = ?
            AND resolved_at IS NULL
          ORDER BY id DESC LIMIT 1
        `);
  const nameStmt = db.prepare(`SELECT name FROM authored_npcs WHERE id = ?`);

  const out = [];
  for (const r of inRange) {
    let asym = null;
    try { asym = composeAsymmetryContext(db, r.npcId, userId, null); } catch { /* skip */ }
    if (!asym) continue;

    // Stress (mig 152) — column is `stress` 0..100, surfaced as level 0..10
    // for HUD parity with other readouts.
    let stress = null;
    try {
      const s = stressStmt.get(r.npcId);
      if (s) {
        stress = {
          level: Math.round((s.stress ?? 0) / 10),
          raw: s.stress,
          copingTrait: s.coping_trait,
          updatedAt: s.updated_at,
        };
      }
    } catch { /* npc_stress may be absent */ }

    // Active scheme against this player (mig 155). Schemer is keyed via
    // (plotter_kind='npc', plotter_id). Phase is the scheme stage.
    let scheme = null;
    if (userId) {
      try {
        const sc = schemeStmt.get(r.npcId, userId);
        if (sc) scheme = { id: sc.id, kind: sc.kind, stage: sc.phase };
      } catch { /* schemes may be absent */ }
    }

    // Lookup name (best-effort)
    let name = r.npcId;
    try {
      const n = nameStmt.get(r.npcId);
      if (n?.name) name = n.name;
    } catch { /* absent */ }

    const isNemesis =
      (asym.persistent_grudge && /sever/.test(JSON.stringify(asym)) ) ||
      !!scheme ||
      (stress && typeof stress.level === "number" && stress.level >= 7);

    out.push({
      npcId: r.npcId,
      name,
      x: r.x,
      z: r.z,
      grudge: asym.persistent_grudge || null,
      preoccupation: asym.current_preoccupation || null,
      desire: asym.desire_for_this_player || null,
      opinion: asym.current_opinion || null,
      stress,
      scheme,
      isNemesis: Boolean(isNemesis),
    });
  }
  return out;
}

export default function registerNemesisMacros(register) {
  register("nemesis", "nearby", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, x, z, radius } = input || {};
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    const npcs = getNemesisRowsForWorld(db, worldId, userId, x, z, radius);
    return { ok: true, worldId, npcs, count: npcs.length };
  }, { note: "Per-NPC nemesis state for HUD glyphs over nearby NPCs." });

  register("nemesis", "for_npc", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    const { npcId } = input || {};
    if (!npcId) return { ok: false, reason: "missing_npcId" };
    const ctxRow = composeAsymmetryContext(db, npcId, userId, null);
    return { ok: true, npcId, ...ctxRow };
  }, { note: "Full nemesis context for a single NPC. Used by hover previews." });
}

export { getNemesisRowsForWorld };
