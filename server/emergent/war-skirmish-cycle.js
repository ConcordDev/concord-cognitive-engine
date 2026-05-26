// server/emergent/war-skirmish-cycle.js
//
// Heartbeat-driven skirmish advance. Every pass, iterate every
// non-resolved war_campaign whose next_skirmish_at <= now and call
// advanceCampaign(). The lib handles state transitions + skirmish
// resolution + town capture + auto-kidnaps.
//
// Frequency: 2 ticks (~30s) — fast enough that a player declaring war
// sees a skirmish play out within seconds. Bounded by MAX_PER_PASS.
//
// Kill-switch: CONCORD_WAR_SKIRMISH=0.
// Heartbeat invariant: never throws.

import logger from "../logger.js";

const MAX_PER_PASS = 12;

/**
 * Compute the centroid of a faction's NPCs in a world. Used to give the
 * army-march emit a visible anchor position so the EmergentEventFeed can
 * report "Sovereign army marches from (x,z) toward Lattice-Crucible".
 * Returns null when the faction has no living NPCs.
 */
export function factionAnchor(db, worldId, factionId) {
  try {
    const row = db.prepare(`
      SELECT AVG(x) AS cx, AVG(z) AS cz, COUNT(*) AS n
      FROM world_npcs
      WHERE world_id = ? AND faction = ? AND COALESCE(is_dead, 0) = 0
    `).get(worldId, factionId);
    if (!row || row.n === 0) return null;
    return { x: row.cx ?? 0, z: row.cz ?? 0, troopCount: row.n };
  } catch {
    return null;
  }
}

export async function runWarSkirmishCycle({ db, state: _s, tickCount: _t } = {}) {
  if (process.env.CONCORD_WAR_SKIRMISH === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM war_campaigns
      WHERE resolved_at IS NULL
        AND (next_skirmish_at IS NULL OR next_skirmish_at <= unixepoch())
      ORDER BY next_skirmish_at ASC
      LIMIT ?
    `).all(MAX_PER_PASS);
  } catch {
    return { ok: true, scanned: 0, advanced: 0, reason: "no_war_table" };
  }

  if (rows.length === 0) return { ok: true, scanned: 0, advanced: 0 };

  const { advanceCampaign } = await import("../lib/war-campaign.js");

  let advanced = 0, errored = 0;
  let armyEmits = 0;
  const realtime = globalThis._concordRealtimeEmit;

  for (const c of rows) {
    try {
      const prevState = c.state;
      const r = advanceCampaign(db, c);
      if (r?.transitioned) advanced++;

      // Wave 5 / T2.4 — visible armies. On every state transition that
      // means "troops are moving" (marching / engaging) OR every
      // resolved skirmish, emit world:army-march with the centroids of
      // both factions' NPCs so the player sees the war as movement, not
      // numbers. The EmergentEventFeed and any future map renderer
      // subscribe to this channel.
      try {
        const updated = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(c.id);
        if (updated && realtime) {
          const aggressorAnchor = factionAnchor(db, updated.world_id, updated.aggressor_id);
          const defenderAnchor  = factionAnchor(db, updated.world_id, updated.defender_id);
          if (aggressorAnchor && defenderAnchor) {
            realtime("world:army-march", {
              worldId: updated.world_id,
              campaignId: updated.id,
              aggressorId: updated.aggressor_id,
              defenderId:  updated.defender_id,
              prevState,
              state: updated.state,
              transitioned: !!r?.transitioned,
              skirmishResolved: !!r?.skirmish,
              aggressor: { ...aggressorAnchor, troops: updated.attacker_troops },
              defender:  { ...defenderAnchor,  troops: updated.defender_troops },
            });
            armyEmits++;
          }
        }
      } catch { /* visualization emit best-effort */ }
    } catch (err) {
      errored++;
      logger?.warn?.("war-skirmish-cycle: campaign failed", { id: c.id, err: err?.message });
    }
  }

  return { ok: true, scanned: rows.length, advanced, errored, armyEmits };
}
