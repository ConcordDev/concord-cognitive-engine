// server/emergent/scheme-overhear-cycle.js
//
// T2.3 — scheme barge-in heartbeat (~every 2 min, frequency 8).
//
// For each world with active NPC schemes, find players standing near a plotting
// NPC and let them "overhear" the plot: one discovered evidence row + a
// `scheme:overheard` socket event. Feeds the existing discover/expose pipeline.
//
// Heartbeat-compatible: always returns { ok, ... }, never throws.
// Kill-switch: CONCORD_SCHEME_OVERHEAR=0.

import * as cityPresence from "../lib/city-presence.js";
import { overhearForWorld, OVERHEAR_RADIUS_M } from "../lib/scheme-overhear.js";

export async function runSchemeOverhearCycle({ db, io } = {}) {
  if (process.env.CONCORD_SCHEME_OVERHEAR === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT n.world_id AS world_id
      FROM npc_schemes s JOIN world_npcs n ON n.id = s.plotter_id
      WHERE s.plotter_kind = 'npc'
        AND s.phase IN ('recruiting','gathering_evidence','moving')
    `).all();
  } catch {
    return { ok: true, fired: 0, reason: "no_table" };
  }

  let totalFired = 0;
  for (const { world_id: worldId } of worlds) {
    // Build the proximity closure: for a plotter NPC id, return the user ids
    // standing within OVERHEAR_RADIUS_M of it in this world.
    const nearbyPlayersForPlotter = (plotterId) => {
      try {
        const npc = db.prepare(`SELECT x, z FROM world_npcs WHERE id = ?`).get(plotterId);
        if (!npc || typeof npc.x !== "number") return [];
        const userIds = cityPresence.getUserIdsInWorld?.(worldId) || [];
        const out = [];
        for (const uid of userIds) {
          const pos = cityPresence.getUserPosition?.(uid);
          if (!pos || typeof pos.x !== "number") continue;
          const d = Math.hypot(pos.x - npc.x, (pos.z ?? 0) - (npc.z ?? 0));
          if (d <= OVERHEAR_RADIUS_M) out.push(uid);
        }
        return out;
      } catch { return []; }
    };

    let res;
    try {
      res = overhearForWorld(db, worldId, nearbyPlayersForPlotter);
    } catch { continue; }

    for (const f of res.fired || []) {
      totalFired++;
      try {
        // T2.3 — enrich the payload with who + why so the toast/bubble can say
        // "Sandrun smith ↔ Medici guard: a debt that ends in a knife" without
        // a second lookup. Secrets stay out (only archetype/faction/kind).
        let ctx = null;
        try {
          ctx = db.prepare(`
            SELECT p.archetype AS plotter_archetype, p.faction AS plotter_faction,
                   t.archetype AS target_archetype, t.faction AS target_faction,
                   s.kind AS scheme_kind, s.target_kind
            FROM npc_schemes s
            LEFT JOIN world_npcs p ON p.id = s.plotter_id
            LEFT JOIN world_npcs t ON t.id = s.target_id AND s.target_kind = 'npc'
            WHERE s.id = ?
          `).get(f.schemeId);
        } catch { /* enrichment best-effort */ }
        // Targeted emit to the player who overheard (their socket room is the
        // userId; fall back to the world room). Carries the snippet + scheme id
        // so the client can surface a "you overheard something" prompt that
        // opens the discover/expose/intervene flow.
        const payload = {
          schemeId: f.schemeId,
          plotterId: f.plotterId,
          worldId,
          snippet: f.snippet,
          plotterArchetype: ctx?.plotter_archetype || null,
          plotterFaction: ctx?.plotter_faction || null,
          targetArchetype: ctx?.target_archetype || null,
          targetFaction: ctx?.target_faction || null,
          schemeKind: ctx?.scheme_kind || null,
          ts: Date.now(),
        };
        io?.to?.(`user:${f.userId}`)?.emit?.("scheme:overheard", payload);
        io?.to?.(`world:${worldId}`)?.emit?.("scheme:overheard-ambient", {
          plotterId: f.plotterId, worldId, ts: payload.ts,
        });
      } catch { /* emit best-effort */ }
    }
  }

  return { ok: true, fired: totalFired, worlds: worlds.length };
}
