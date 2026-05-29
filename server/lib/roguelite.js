// server/lib/roguelite.js
//
// Phase CB1 — roguelite meta-progression.
//
// Wraps the Phase 5e procgen-regions in a "run" concept: entering a
// region starts a run, leaving / dying ends it, meta-currency banks
// based on depth + end_reason. Unlocks gate persistent items via PK
// on (user, unlock_id).
//
// One active run per user at a time — `startRun` returns the existing
// active row if the user re-enters the same region.

import crypto from "node:crypto";
import logger from "../logger.js";
import { resolveRunDifficulty, recordRunClear, lootMultFor } from "./run-difficulty.js";

const DEATH_PENALTY_MULT = 0.5;       // half the banked currency on death
const EXTRACT_BONUS_MULT = 1.25;
const CURRENCY_PER_DEPTH = 5;

// C1 / F4.2 — meta-unlock catalog. Purchased unlocks now MODIFY a run (they were
// stored but never read — hasUnlock had no caller). Each effect is a real run
// modifier the run reads at start. Costs are catalog-driven (server-priced) so
// the client can't self-price.
export const META_UNLOCK_CATALOG = Object.freeze({
  veteran_vigor:  { id: "veteran_vigor",  name: "Veteran's Vigor",  costCc: 150, effect: { stat: "startingHpBonus", value: 25 } },
  sharp_start:    { id: "sharp_start",    name: "Sharp Start",      costCc: 200, effect: { stat: "damageMult", value: 0.10 } },
  extra_pick:     { id: "extra_pick",     name: "Extra Boon",       costCc: 300, effect: { stat: "extraDraftPicks", value: 1 } },
  fortune_finder: { id: "fortune_finder", name: "Fortune Finder",   costCc: 250, effect: { stat: "metaCurrencyMult", value: 0.25 } },
  second_chance:  { id: "second_chance",  name: "Second Chance",    costCc: 500, effect: { stat: "revives", value: 1 } },
});

/**
 * C1 — the run modifiers a player's purchased meta-unlocks grant. Reads the
 * owned unlocks (via hasUnlock) and sums their catalog effects. This is what
 * makes a purchased unlock measurably change the next run.
 */
export function runMetaModifiers(db, userId) {
  const out = { startingHpBonus: 0, damageMult: 0, extraDraftPicks: 0, metaCurrencyMult: 0, revives: 0 };
  if (!db || !userId) return out;
  for (const unlock of Object.values(META_UNLOCK_CATALOG)) {
    if (hasUnlock(db, userId, unlock.id)) {
      const { stat, value } = unlock.effect;
      if (stat in out) out[stat] += value;
    }
  }
  out.damageMult = Math.round(out.damageMult * 1000) / 1000;
  out.metaCurrencyMult = Math.round(out.metaCurrencyMult * 1000) / 1000;
  return out;
}

function _earnedCurrency(depth, reason) {
  const base = Math.max(0, depth) * CURRENCY_PER_DEPTH;
  if (reason === "death") return Math.floor(base * DEATH_PENALTY_MULT);
  if (reason === "extract") return Math.floor(base * EXTRACT_BONUS_MULT);
  return base;
}

export function startRun(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId, regionId } = opts;
  if (!worldId || !regionId) return { ok: false, error: "missing_world_or_region" };
  // C2 — resolve the run's difficulty tier (gated by a prior clear). Default
  // finder; a locked tier is rejected before the run opens.
  const tier = opts.tier || "finder";
  const diff = resolveRunDifficulty(db, userId, "roguelite", tier);
  if (!diff.ok) return { ok: false, error: diff.reason, tier, needsClearOf: diff.needsClearOf };

  try {
    // Idempotency: if user has an active run for this region, return it.
    const active = db.prepare(`
      SELECT id, region_id FROM roguelite_runs
      WHERE user_id = ? AND ended_at IS NULL
    `).get(userId);
    if (active) {
      if (active.region_id === regionId) {
        return { ok: true, runId: active.id, alreadyActive: true };
      }
      // Different region — close the prior run as timeout, start fresh.
      db.prepare(`
        UPDATE roguelite_runs
        SET ended_at = unixepoch(), end_reason = 'timeout'
        WHERE id = ?
      `).run(active.id);
    }

    const id = `rgl_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO roguelite_runs (id, user_id, world_id, region_id)
      VALUES (?, ?, ?, ?)
    `).run(id, userId, worldId, regionId);
    logger.info?.("roguelite", "run_started", { runId: id, userId, regionId, tier });
    // C1 + C2 — surface the meta-unlock modifiers + the difficulty modifier the
    // run starts with.
    return {
      ok: true, runId: id, alreadyActive: false,
      modifiers: runMetaModifiers(db, userId),
      tier, difficulty: diff.modifier,
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function endRun(db, runId, opts = {}) {
  if (!db || !runId) return { ok: false, error: "missing_inputs" };
  const { reason = "manual_exit", depthReached = 1 } = opts;
  if (!["death", "extract", "timeout", "manual_exit"].includes(reason)) {
    return { ok: false, error: "invalid_reason" };
  }

  try {
    const run = db.prepare(`SELECT * FROM roguelite_runs WHERE id = ?`).get(runId);
    if (!run) return { ok: false, error: "no_run" };
    if (run.ended_at) return { ok: false, error: "already_ended" };

    // D6 — tie the payout to the run's difficulty tier so audacity yields
    // outsized spikes. Floored at 1.0 so the default/easy (finder, loot_mult
    // 0.5) path is NEVER reduced — only heroic/mythic amplify the banked
    // currency. Keeps the pre-D6 default payout intact while rewarding risk.
    const lootMult = Math.max(1.0, lootMultFor(resolveRunDifficulty(db, run.user_id, "roguelite", opts.tier || "finder").modifier));
    const earned = Math.floor(_earnedCurrency(depthReached, reason) * lootMult);
    db.prepare(`
      UPDATE roguelite_runs
      SET ended_at = unixepoch(), end_reason = ?,
          meta_currency_earned = ?, depth_reached = ?
      WHERE id = ?
    `).run(reason, earned, depthReached, runId);

    if (earned > 0) {
      _grantCurrency(db, run.user_id, earned);
    }
    // C2 — a successful extraction records a clear at the run's tier, unlocking
    // the next tier for this mode.
    let tierCleared = null;
    if (reason === "extract" && opts.tier) {
      const r = recordRunClear(db, run.user_id, "roguelite", opts.tier);
      if (r.ok) tierCleared = opts.tier;
    }
    logger.info?.("roguelite", "run_ended", { runId, reason, earned, depthReached, tierCleared });
    return { ok: true, earned, reason, tierCleared };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _grantCurrency(db, userId, amount) {
  db.prepare(`
    INSERT INTO roguelite_meta_currency (user_id, balance, lifetime)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      balance = balance + excluded.balance,
      lifetime = lifetime + excluded.balance,
      updated_at = unixepoch()
  `).run(userId, amount, amount);
}

export function getBalance(db, userId) {
  if (!db || !userId) return { balance: 0, lifetime: 0 };
  try {
    const r = db.prepare(`SELECT balance, lifetime FROM roguelite_meta_currency WHERE user_id = ?`).get(userId);
    return r ? { balance: Number(r.balance), lifetime: Number(r.lifetime) } : { balance: 0, lifetime: 0 };
  } catch { return { balance: 0, lifetime: 0 }; }
}

/**
 * Spend meta-currency on a permanent unlock. Idempotent on
 * (user, unlock_id) — re-purchase rejected.
 */
export function purchaseUnlock(db, userId, unlockId, costCc) {
  if (!db || !userId || !unlockId) return { ok: false, error: "missing_inputs" };
  // C1 — catalog-priced: a known unlock uses its server cost (client can't
  // self-price); unknown ids fall back to the passed cost for back-compat.
  const catalogEntry = META_UNLOCK_CATALOG[unlockId];
  const cost = catalogEntry ? catalogEntry.costCc : Math.max(0, Number(costCc) || 0);
  try {
    const existing = db.prepare(`
      SELECT 1 FROM roguelite_unlocks WHERE user_id = ? AND unlock_id = ?
    `).get(userId, unlockId);
    if (existing) return { ok: false, error: "already_unlocked" };

    const bal = getBalance(db, userId);
    if (bal.balance < cost) return { ok: false, error: "insufficient_funds", balance: bal.balance };

    db.prepare(`
      UPDATE roguelite_meta_currency SET balance = balance - ?, updated_at = unixepoch()
      WHERE user_id = ?
    `).run(cost, userId);
    db.prepare(`
      INSERT INTO roguelite_unlocks (user_id, unlock_id, cost_paid)
      VALUES (?, ?, ?)
    `).run(userId, unlockId, cost);
    return { ok: true, balanceRemaining: bal.balance - cost };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listUnlocks(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT unlock_id, unlocked_at, cost_paid FROM roguelite_unlocks
      WHERE user_id = ?
      ORDER BY unlocked_at DESC
    `).all(userId);
  } catch { return []; }
}

export function hasUnlock(db, userId, unlockId) {
  if (!db || !userId || !unlockId) return false;
  try {
    const r = db.prepare(`
      SELECT 1 FROM roguelite_unlocks WHERE user_id = ? AND unlock_id = ?
    `).get(userId, unlockId);
    return !!r;
  } catch { return false; }
}

export function getActiveRun(db, userId) {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT id, world_id, region_id, started_at, depth_reached
      FROM roguelite_runs WHERE user_id = ? AND ended_at IS NULL
    `).get(userId) || null;
  } catch { return null; }
}

export function listRecentRuns(db, userId, limit = 10) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, region_id, started_at, ended_at, end_reason,
             meta_currency_earned, depth_reached
      FROM roguelite_runs WHERE user_id = ?
      ORDER BY started_at DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(50, limit)));
  } catch { return []; }
}

export { CURRENCY_PER_DEPTH, DEATH_PENALTY_MULT, EXTRACT_BONUS_MULT };
