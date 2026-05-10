// server/emergent/kingdom-decree-cycle.js
//
// Sprint C / Tracks D2 + D4 — kingdom heartbeat.
//
// Frequency: 16 ticks (~4 min). Per pass:
//   1. Sweep expired decrees → effect_state='expired'.
//   2. Recompute citizen loyalty for kingdoms whose ruler changed or
//      whose tax_rate changed since last review.
//   3. For each NPC-ruled kingdom past cooldown, pickRulerDecree +
//      proposeDecree + issueDecree.
//   4. Evaluate rebellion risk + spawn rebellion schemes when threshold hit.
//
// Kill-switch: CONCORD_KINGDOMS=0.

import logger from "../logger.js";
import {
  proposeDecree,
  issueDecree,
  expireDueDecrees,
  pickRulerDecree,
  setRulerCooldown,
} from "../lib/kingdom-decrees.js";
import { recomputeCitizenLoyalty } from "../lib/kingdoms.js";
import { evaluateRebellionRisk } from "../lib/kingdom-rebellion.js";

export async function runKingdomDecreeCycle({ db, state: _state, tickCount: _t } = {}) {
  if (process.env.CONCORD_KINGDOMS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, expired: 0, decreed: 0, rebellionRisks: 0, recomputed: 0 };

  // 1) Sweep expired.
  try {
    const r = expireDueDecrees(db);
    stats.expired = r.expired || 0;
  } catch { /* table absent */ }

  // 2) Per-kingdom recompute + NPC-ruler decision.
  let kingdoms = [];
  try {
    kingdoms = db.prepare(`SELECT id, ruler_kind, ruler_id, next_decree_at FROM realms`).all();
  } catch {
    return { ok: true, ...stats, reason: "no_kingdoms" };
  }

  for (const k of kingdoms) {
    try {
      // Recompute (cheap; stat-only when nothing changed).
      try { recomputeCitizenLoyalty(db, k.id); stats.recomputed++; } catch { /* noop */ }

      // 3) NPC ruler decree pick.
      if (k.ruler_kind === "npc" && k.next_decree_at <= Math.floor(Date.now() / 1000)) {
        const kind = pickRulerDecree(db, k.id);
        if (kind) {
          const prop = proposeDecree(db, k.id, { kind, issuedByKind: "npc", issuedById: k.ruler_id });
          if (prop?.ok && prop.id) {
            issueDecree(db, prop.id);
            setRulerCooldown(db, k.id);
            stats.decreed++;
          }
        }
      }

      // 4) Rebellion eval.
      try {
        const r = evaluateRebellionRisk(db, k.id);
        if (r?.spawned) stats.rebellionRisks++;
      } catch { /* rebellion module optional */ }
    } catch (err) {
      try { logger.debug?.("kingdom_decree_cycle_failed", { kingdomId: k.id, error: err?.message }); } catch { /* noop */ }
    }
  }

  return stats;
}
