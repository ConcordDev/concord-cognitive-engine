// server/emergent/nemesis-cycle.js
//
// Phase AB — Nemesis NPC↔NPC rule engine.
//
// Heartbeat (scope: 'world', frequency 40 ≈ 10 min). Per-world:
//   1. Scan recent significant events from the existing substrate:
//      - kin-of-killed-npc rows in npc_grudges (Phase 2)
//      - bodyguard pairings that haven't yet rivalled the player
//      - npc_schemes betrayals where character_opinions has soured
//      - mentor/apprentice candidate pairs (authored ≥ 20 + procgen
//        same archetype + co-located dialogue ticks)
//   2. For each candidate, call formRelationship / escalate.
//
// The cycle never throws — all queries are best-effort, every error
// path returns { ok:false, reason } so the heartbeat dispatcher records
// it without blowing up the tick.

import logger from "../logger.js";
import {
  formRelationship,
  escalate,
  decay,
  RELATIONSHIP_KINDS,
} from "../lib/npc-relationships.js";

const KIND_FOR_KIN_GRIEF = "family_enemy";
const KIND_FOR_BODYGUARD = "bodyguard";
const KIND_FOR_MENTOR = "mentor";
const KIND_FOR_RIVAL = "rival";

// Decay sweep cadence vs. the cycle's other work. Decay always runs;
// it's cheap and idempotent.
const DECAY_THRESHOLD_S = 60 * 24 * 60 * 60; // 60 days

/**
 * Does the table exist? Cheap check; minimal builds may be missing
 * substrate that this cycle wants to consult.
 */
function _hasTable(db, name) {
  try {
    const r = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name = ?
    `).get(name);
    return !!r;
  } catch {
    return false;
  }
}

/**
 * Player killed an NPC → form family_enemy among that NPC's surviving
 * kin if they aren't already bonded. This is the "mutual grief bond"
 * rule from Shadow of Mordor — relatives of the slain unite (or feud,
 * if intensity flips negative later).
 */
function _processGriefBonds(db, worldId, opts) {
  if (!_hasTable(db, "npc_grudges")) return { processed: 0 };
  if (!_hasTable(db, "world_npcs")) return { processed: 0 };

  let processed = 0;
  try {
    // Recent kill-by-player grudges (created in the last 24h).
    const cutoff = Math.floor(Date.now() / 1000) - (opts?.windowS || 24 * 60 * 60);
    // npc_grudges (asymmetry schema) records a player kill as target_kind='player'
    // with the eventKind baked into the narrative ("killed by player — …") + event_at.
    const grudges = db.prepare(`
      SELECT npc_id FROM npc_grudges
      WHERE target_kind = 'player' AND narrative LIKE 'killed by player%' AND event_at >= ?
      LIMIT 100
    `).all(cutoff);

    for (const g of grudges) {
      // Find the slain NPC's faction + family. Same-faction-and-archetype
      // is the proxy for kin until we have explicit family edges.
      const slain = db.prepare(`
        SELECT faction AS faction_id, archetype, world_id FROM world_npcs WHERE id = ?
      `).get(g.npc_id);
      if (!slain || slain.world_id !== worldId) continue;

      const kin = db.prepare(`
        SELECT id FROM world_npcs
        WHERE faction = ? AND archetype = ? AND world_id = ? AND id != ?
        LIMIT 20
      `).all(slain.faction_id, slain.archetype, worldId, g.npc_id);

      // Pair them up — every pair gets a family_enemy edge.
      for (let i = 0; i < kin.length; i++) {
        for (let j = i + 1; j < kin.length; j++) {
          const r = formRelationship(
            db, kin[i].id, kin[j].id, KIND_FOR_KIN_GRIEF, 0.3,
            { worldId, formedFromEvent: "grief_bond" }
          );
          if (r.ok) processed++;
        }
      }
    }
  } catch (err) {
    logger.warn?.("nemesis-cycle", "grief_bond_error", { error: err?.message });
  }
  return { processed };
}

/**
 * Scheme-betrayal escalation: if NPC X betrayed NPC Y in a scheme AND
 * character_opinions[X→Y] < -50, ensure a rival relationship exists or
 * escalate the existing one. The scheme substrate already records the
 * betrayal — we just lift it into the NPC↔NPC graph.
 */
function _processSchemeBetrayals(db, worldId, opts) {
  if (!_hasTable(db, "npc_schemes")) return { processed: 0 };
  if (!_hasTable(db, "character_opinions")) return { processed: 0 };

  let processed = 0;
  try {
    const cutoff = Math.floor(Date.now() / 1000) - (opts?.windowS || 24 * 60 * 60);
    const rows = db.prepare(`
      SELECT s.plotter_id AS actor_npc_id, s.target_id AS target_npc_id
      FROM npc_schemes s JOIN world_npcs n ON n.id = s.plotter_id
      WHERE s.phase IN ('exposed','complete') AND s.resolved_at >= ? AND n.world_id = ?
      LIMIT 100
    `).all(cutoff, worldId);

    for (const row of rows) {
      const op = db.prepare(`
        SELECT score FROM character_opinions
        WHERE from_npc_id = ? AND to_npc_id = ?
      `).get(row.actor_npc_id, row.target_npc_id);

      if (op && op.score < -50) {
        const r = formRelationship(
          db, row.actor_npc_id, row.target_npc_id, KIND_FOR_RIVAL, 0.4,
          { worldId, formedFromEvent: "scheme_betrayal" }
        );
        if (r.ok && r.relationshipId) {
          if (r.alreadyExisted) {
            escalate(db, r.relationshipId, "scheme_betrayal",
              "Betrayal in scheme — rivalry deepens.",
              { intensityDelta: 0.1 });
          }
          processed++;
        }
      }
    }
  } catch (err) {
    logger.warn?.("nemesis-cycle", "scheme_betrayal_error", { error: err?.message });
  }
  return { processed };
}

/**
 * Mentor/apprentice formation: an authored NPC of level ≥ 20 plus a
 * procgen NPC of the same archetype who has shared dialogue ticks in
 * the same district. We use a lightweight proxy: any two NPCs in the
 * same world, same archetype, level gap ≥ 15.
 */
function _processMentorPairs(db, worldId, _opts) {
  if (!_hasTable(db, "world_npcs")) return { processed: 0 };

  let processed = 0;
  try {
    const rows = db.prepare(`
      SELECT id, archetype, level FROM world_npcs
      WHERE world_id = ? AND archetype IS NOT NULL
      ORDER BY archetype, level DESC
      LIMIT 500
    `).all(worldId);

    // Group by archetype.
    const byArch = new Map();
    for (const r of rows) {
      if (!byArch.has(r.archetype)) byArch.set(r.archetype, []);
      byArch.get(r.archetype).push(r);
    }

    for (const list of byArch.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => (b.level || 0) - (a.level || 0));
      const elder = sorted[0];
      if ((elder.level || 0) < 20) continue;

      // Pair elder with up to 3 apprentices with level gap ≥ 15.
      let paired = 0;
      for (let i = 1; i < sorted.length && paired < 3; i++) {
        const cand = sorted[i];
        if ((elder.level || 0) - (cand.level || 0) < 15) continue;
        const r = formRelationship(
          db, elder.id, cand.id, KIND_FOR_MENTOR, 0.5,
          { worldId, formedFromEvent: "mentor_pairing" }
        );
        if (r.ok && !r.alreadyExisted) {
          processed++;
          paired++;
        }
      }
    }
  } catch (err) {
    logger.warn?.("nemesis-cycle", "mentor_pair_error", { error: err?.message });
  }
  return { processed };
}

/**
 * Heartbeat entry. Scope: 'world' — receives a per-world db handle.
 * Returns `{ ok, world, processed, decayed }` shape every time.
 */
export function runNemesisCycle({ db, worldId } = {}) {
  if (!db || !worldId) return { ok: false, reason: "no_db_or_world" };
  if (process.env.CONCORD_NEMESIS_CYCLE === "0") {
    return { ok: true, skipped: "disabled_by_env" };
  }

  let total = 0;
  let decayed = 0;
  try {
    const grief = _processGriefBonds(db, worldId, {});
    total += grief.processed;
    const betrayals = _processSchemeBetrayals(db, worldId, {});
    total += betrayals.processed;
    const mentors = _processMentorPairs(db, worldId, {});
    total += mentors.processed;

    const dec = decay(db, DECAY_THRESHOLD_S);
    decayed = dec.ok ? dec.removed : 0;

    if (total > 0 || decayed > 0) {
      logger.info?.("nemesis-cycle", "tick", { worldId, processed: total, decayed });
    }
    return { ok: true, world: worldId, processed: total, decayed };
  } catch (err) {
    logger.warn?.("nemesis-cycle", "tick_error", { error: err?.message, worldId });
    return { ok: false, reason: err?.message || "tick_error" };
  }
}

export const _internals = {
  _processGriefBonds,
  _processSchemeBetrayals,
  _processMentorPairs,
};
