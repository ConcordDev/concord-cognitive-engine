// server/lib/kingdom-rebellion.js
//
// Sprint C / Track D4 — rebellion risk eval + scheme spawn.
//
// Risk score = sum of penalties:
//   avg loyalty < 35       → +30
//   avg loyalty < 25       → +20 extra
//   recent decree popularity_delta < -10 (last 24h, count) × 15
//   any internal-faction faction-strategy momentum ≤ -0.5 → +20
//   citizens with stress > 60 → +5 each, capped at +30
//
// At ≥70 risk, spawn an `assassinate` scheme via npc-schemes.proposeScheme
// with a coalition of accomplices = top-3 lowest-loyalty NPCs whose
// opinion of the ruler ≤ -50.

import logger from "../logger.js";
import { getKingdom } from "./kingdoms.js";
import { proposeScheme } from "./npc-schemes.js";

const REBELLION_THRESHOLD = 70;

export function evaluateRebellionRisk(db, kingdomId) {
  if (!db || !kingdomId) return { ok: false };
  const k = getKingdom(db, kingdomId);
  if (!k || !k.ruler_id) return { ok: false, reason: "no_ruler" };

  let score = 0;
  const factors = {};

  // Avg loyalty.
  let avgLoyalty = 50;
  try {
    const r = db.prepare(`SELECT AVG(loyalty) AS avg FROM realm_citizens WHERE kingdom_id = ?`).get(kingdomId);
    avgLoyalty = Math.round(r?.avg ?? 50);
  } catch { /* noop */ }
  if (avgLoyalty < 25) { score += 50; factors.loyalty_critical = true; }
  else if (avgLoyalty < 35) { score += 30; factors.loyalty_low = true; }

  // Recent unpopular decrees.
  let unpopularRecent = 0;
  try {
    const rows = db.prepare(`
      SELECT COUNT(*) AS n FROM realm_decrees
      WHERE kingdom_id = ? AND popularity_delta <= -10 AND issued_at > unixepoch() - 86400
    `).get(kingdomId);
    unpopularRecent = rows?.n ?? 0;
  } catch { /* noop */ }
  score += unpopularRecent * 15;
  if (unpopularRecent > 0) factors.unpopular_decrees = unpopularRecent;

  // Internal faction strategy momentum (best-effort).
  try {
    const fs = db.prepare(`
      SELECT momentum FROM faction_strategy_state WHERE faction_id = ?
    `).get(k.faction_id);
    if (Number(fs?.momentum) <= -0.5) {
      score += 20;
      factors.faction_morale_low = true;
    }
  } catch { /* faction_strategy table absent */ }

  // High-stress citizens.
  try {
    const stress = db.prepare(`
      SELECT COUNT(*) AS n FROM npc_stress s
      JOIN realm_citizens c ON c.npc_id = s.npc_id
      WHERE c.kingdom_id = ? AND s.stress > 60
    `).get(kingdomId);
    const stressBoost = Math.min(30, (stress?.n ?? 0) * 5);
    score += stressBoost;
    if (stressBoost > 0) factors.stressed_citizens = stress.n;
  } catch { /* noop */ }

  // Cap and decide.
  score = Math.min(100, score);

  let spawned = false, schemeId = null;
  if (score >= REBELLION_THRESHOLD) {
    // Find a leader: most-hostile, most-stressed citizen.
    let leader = null;
    try {
      // Pick the citizen who hates the ruler most (lowest opinion). Use
      // COALESCE in ORDER BY too so missing-row NPCs (opinion=0) don't
      // sort before negative-opinion NPCs.
      const r = db.prepare(`
        SELECT s.npc_id, s.stress, COALESCE(o.score, 0) AS score
        FROM npc_stress s
        LEFT JOIN character_opinions o ON o.npc_id = s.npc_id
                                 AND o.target_kind = 'npc'
                                 AND o.target_id = ?
        JOIN realm_citizens c ON c.npc_id = s.npc_id AND c.kingdom_id = ?
        WHERE s.stress >= 50
        ORDER BY COALESCE(o.score, 0) ASC, s.stress DESC LIMIT 1
      `).get(k.ruler_id, kingdomId);
      leader = r;
    } catch { /* noop */ }

    if (leader?.npc_id) {
      const scheme = proposeScheme(db, {
        plotterNpcId: leader.npc_id,
        targetKind: k.ruler_kind === "player" ? "player" : "npc",
        targetId: k.ruler_id,
        kind: "assassinate",
      });
      if (scheme?.action === "proposed") {
        spawned = true;
        schemeId = scheme.schemeId;
        try { logger.info?.("kingdom_rebellion_spawned", { kingdomId, leaderId: leader.npc_id, schemeId, score }); } catch { /* noop */ }
      }
    }
  }

  return { ok: true, score, factors, spawned, schemeId, threshold: REBELLION_THRESHOLD };
}

/**
 * List active rebellion schemes targeting a kingdom's ruler. Used by
 * RulerHUD to show "Rebellion brewing" warning.
 */
export function listRebellionsForKingdom(db, kingdomId) {
  if (!db || !kingdomId) return [];
  const k = getKingdom(db, kingdomId);
  if (!k?.ruler_id) return [];
  try {
    return db.prepare(`
      SELECT id, plotter_id, kind, phase, success_pct, discovery_pct, evidence_count, accomplice_count
      FROM npc_schemes
      WHERE target_kind = ? AND target_id = ?
        AND kind IN ('assassinate', 'sabotage_decree')
        AND phase NOT IN ('complete','abandoned')
      ORDER BY discovery_pct DESC, created_at DESC LIMIT 10
    `).all(k.ruler_kind === "player" ? "player" : "npc", k.ruler_id);
  } catch { return []; }
}

export const REBELLION_CONSTANTS = Object.freeze({ REBELLION_THRESHOLD });
