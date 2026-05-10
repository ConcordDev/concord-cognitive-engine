// server/lib/kingdom-decrees.js
//
// Sprint C / Track D2 — kingdom decrees pipeline.
//
// proposeDecree → issueDecree (state pending → active + popularity_delta)
//   → applyDecreeEffect (per-kind side effects)
//   → expireDecree (auto by next-tick sweep)
//
// NPC ruler: kingdom-decree-cycle calls pickRulerDecree() to choose a
// next move (deterministic from ruler stress + faction pressure +
// rebellion signal). Cooldown 24h between NPC-ruler decisions.
//
// Player ruler: caller (RulerHUD → /api/lens/run kingdoms.propose_decree)
// drives proposeDecree directly.

import crypto from "node:crypto";
import logger from "../logger.js";
import { getKingdom, cascadeOpinionToCitizens, adjustTreasury } from "./kingdoms.js";
import { recordOpinionEvent } from "./npc-opinions.js";
import { getStress } from "./npc-stress.js";

const NPC_RULER_COOLDOWN_S = 24 * 3600; // one in-game day

// Per-kind: default duration, base popularity_delta (positive=popular).
const KIND_DEFAULTS = {
  tax_change:    { duration_h: 0,   popularity_delta: -10 },  // permanent until repealed
  conscription:  { duration_h: 72,  popularity_delta: -8 },
  trade_embargo: { duration_h: 168, popularity_delta: -5 },
  recipe_grant:  { duration_h: 0,   popularity_delta: +10 },
  pardon:        { duration_h: 0,   popularity_delta: +5 },
  exile:         { duration_h: 0,   popularity_delta: -3 },
  construction:  { duration_h: 240, popularity_delta: +6 },
  festival:      { duration_h: 24,  popularity_delta: +12 },
};

/**
 * Validate + persist a decree in pending state. Caller (issueDecree)
 * flips it to active + applies effect.
 */
export function proposeDecree(db, kingdomId, { kind, body = {}, issuedByKind = "npc", issuedById = null }) {
  if (!db || !kingdomId || !kind) return { ok: false, reason: "missing_inputs" };
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, reason: "kingdom_not_found" };
  const defaults = KIND_DEFAULTS[kind];
  if (!defaults) return { ok: false, reason: "invalid_kind" };

  // Authority check: issuer must be the ruler OR system.
  if (issuedByKind !== "system") {
    if (issuedByKind !== k.ruler_kind || (issuedById && issuedById !== k.ruler_id)) {
      return { ok: false, reason: "not_authorised" };
    }
  }

  const id = `dcr_${crypto.randomUUID().slice(0, 16)}`;
  const expiresAt = defaults.duration_h > 0
    ? Math.floor(Date.now() / 1000) + defaults.duration_h * 3600
    : null;
  db.prepare(`
    INSERT INTO realm_decrees (id, kingdom_id, kind, body_json, issued_by_kind, issued_by_id, expires_at, effect_state, popularity_delta)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, kingdomId, kind, JSON.stringify(body || {}), issuedByKind, issuedById, expiresAt, defaults.popularity_delta);
  return { ok: true, id, kind, popularity_delta: defaults.popularity_delta };
}

/**
 * Activate a pending decree. Cascades opinion shift to citizens (toward
 * ruler) and applies the effect. Idempotent on already-active.
 */
export function issueDecree(db, decreeId, opts = {}) {
  if (!db || !decreeId) return { ok: false, reason: "missing_inputs" };
  const d = db.prepare(`SELECT * FROM realm_decrees WHERE id = ?`).get(decreeId);
  if (!d) return { ok: false, reason: "decree_not_found" };
  if (d.effect_state !== "pending") return { ok: true, action: "noop_terminal" };

  db.prepare(`UPDATE realm_decrees SET effect_state = 'active' WHERE id = ?`).run(decreeId);

  // Apply effect.
  try {
    applyDecreeEffect(db, d, opts);
  } catch (err) {
    try { logger.warn?.("decree_apply_failed", { id: decreeId, err: err?.message }); } catch { /* noop */ }
  }

  // Cascade opinion-of-ruler shift across citizens.
  cascadeOpinionToCitizens(db, d.kingdom_id, d.popularity_delta, `decree: ${d.kind}`);

  // Realtime event (best-effort).
  try {
    const io = opts?.io;
    io?.emit?.("kingdom:decree-issued", {
      kingdomId: d.kingdom_id, decreeId, kind: d.kind, popularity_delta: d.popularity_delta,
    });
  } catch { /* noop */ }

  return { ok: true, action: "issued", decreeId };
}

/** Per-kind effect resolution. */
export function applyDecreeEffect(db, decree, _opts = {}) {
  const body = (() => { try { return JSON.parse(decree.body_json || "{}"); } catch { return {}; } })();
  switch (decree.kind) {
    case "tax_change": {
      const newRate = Number(body.new_rate);
      if (Number.isFinite(newRate) && newRate >= 0 && newRate <= 0.5) {
        db.prepare(`UPDATE realms SET tax_rate = ?, updated_at = unixepoch() WHERE id = ?`).run(newRate, decree.kingdom_id);
      }
      break;
    }
    case "conscription": {
      // Recruit some authored guards; for now we touch treasury since the
      // archetype pool is content-side. -200 treasury per conscription cycle.
      adjustTreasury(db, decree.kingdom_id, -200);
      break;
    }
    case "trade_embargo": {
      // Marker only — marketplace listing filter reads decrees with effect_state='active' AND kind='trade_embargo'.
      break;
    }
    case "recipe_grant": {
      // Idempotent flag in the realm_decrees row body — dialogue / craft
      // engine reads at runtime.
      break;
    }
    case "pardon": {
      const target = body.target_npc_id;
      if (target) {
        recordOpinionEvent(db, { npcId: target, targetKind: "kingdom", targetId: decree.kingdom_id }, +30, "pardoned");
      }
      break;
    }
    case "exile": {
      const target = body.target_npc_id;
      if (target) {
        recordOpinionEvent(db, { npcId: target, targetKind: "kingdom", targetId: decree.kingdom_id }, -50, "exiled");
        try { db.prepare(`UPDATE realm_citizens SET loyalty = 0 WHERE kingdom_id = ? AND npc_id = ?`).run(decree.kingdom_id, target); } catch { /* noop */ }
        // Also cascade abandonment to schemes the exiled was leading.
        try {
          db.prepare(`
            UPDATE npc_schemes SET phase = 'abandoned', resolved_at = unixepoch()
            WHERE plotter_kind = 'npc' AND plotter_id = ? AND phase NOT IN ('complete','exposed','abandoned')
          `).run(target);
        } catch { /* npc_schemes optional */ }
      }
      break;
    }
    case "construction": {
      adjustTreasury(db, decree.kingdom_id, -300);
      break;
    }
    case "festival": {
      adjustTreasury(db, decree.kingdom_id, -150);
      break;
    }
  }
}

/** Mark expired decrees as expired (heartbeat sweep). */
export function expireDueDecrees(db) {
  if (!db) return { ok: false };
  const r = db.prepare(`
    UPDATE realm_decrees SET effect_state = 'expired'
    WHERE effect_state = 'active' AND expires_at IS NOT NULL AND expires_at < unixepoch()
  `).run();
  return { ok: true, expired: r.changes };
}

/** Revoke a decree explicitly (player ruler action / inheritance reset). */
export function revokeDecree(db, decreeId, by) {
  if (!db || !decreeId) return { ok: false };
  const d = db.prepare(`SELECT kingdom_id FROM realm_decrees WHERE id = ?`).get(decreeId);
  if (!d) return { ok: false, reason: "decree_not_found" };
  db.prepare(`UPDATE realm_decrees SET effect_state = 'revoked' WHERE id = ?`).run(decreeId);
  if (by) cascadeOpinionToCitizens(db, d.kingdom_id, +2, "decree revoked");
  return { ok: true };
}

/**
 * NPC-ruler decree picker. Deterministic from kingdom-state hash so two
 * cycles in the same hour pick consistently. Returns the kind to issue,
 * or null if cooldown not elapsed.
 */
export function pickRulerDecree(db, kingdomId) {
  const k = getKingdom(db, kingdomId);
  if (!k) return null;
  if (k.ruler_kind !== "npc") return null;
  if (k.next_decree_at > Math.floor(Date.now() / 1000)) return null;

  const stress = getStress(db, k.ruler_id);
  const coping = stress?.coping_trait;
  const stressedHigh = (stress?.stress ?? 30) >= 70;

  // Loyalty signal — low avg loyalty motivates festival/pardon; high
  // avg + low treasury motivates conscription/tax_change.
  let loyaltyAvg = 50, treasury = k.treasury;
  try {
    const r = db.prepare(`SELECT AVG(loyalty) AS avg FROM realm_citizens WHERE kingdom_id = ?`).get(kingdomId);
    loyaltyAvg = Math.round(r?.avg ?? 50);
  } catch { /* noop */ }

  if (loyaltyAvg < 35) {
    // Bleed off pressure with festival or pardon.
    return coping === "cruel" ? "exile" : "festival";
  }
  if (treasury < 300) {
    return "tax_change";
  }
  if (stressedHigh && coping === "paranoid") {
    return "conscription";
  }
  if (stressedHigh && coping === "reckless") {
    return "construction";
  }
  // Otherwise random choice biased to stable governance.
  const choices = ["recipe_grant", "construction", "festival"];
  const idx = (Number(k.updated_at) | 0) % choices.length;
  return choices[Math.abs(idx) % choices.length];
}

/** After a decree is issued, advance the cooldown timer. */
export function setRulerCooldown(db, kingdomId) {
  const next = Math.floor(Date.now() / 1000) + NPC_RULER_COOLDOWN_S;
  db.prepare(`UPDATE realms SET next_decree_at = ? WHERE id = ?`).run(next, kingdomId);
}

export const DECREE_CONSTANTS = Object.freeze({
  KIND_DEFAULTS,
  NPC_RULER_COOLDOWN_S,
});
