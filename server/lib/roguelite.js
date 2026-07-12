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
//
// Wave 4 gap-closure: runMetaModifiers() below was computing a correct
// modifier bundle from owned meta-unlocks with ZERO callers wiring it into
// actual gameplay — startRun() returned it, and nothing ever read the
// response field. This file now APPLIES each stat for real:
//   startingHpBonus  — added to player_resource_bars at startRun(), removed
//                       symmetrically at endRun() (see hp_bonus_applied,
//                       migration 359).
//   damageMult       — folded into server/lib/run-modifiers.js's merged
//                       bundle, applied to combat damage by the callers in
//                       routes/worlds.js + server.js's combat:attack socket
//                       handler.
//   extraDraftPicks  — banked into draft_picks_available at advanceRun();
//                       spent by pickDraftBoon().
//   metaCurrencyMult — multiplies the banked currency at endRun().
//   revives          — seeded into revives_remaining at startRun(); consumed
//                       by maybeReviveRoguelitePlayer() on a would-be death.

import crypto from "node:crypto";
import logger from "../logger.js";
import { resolveRunDifficulty, recordRunClear, lootMultFor } from "./run-difficulty.js";
import { getOrInitPlayerBars } from "./combat/damage-calculator.js";
import { rollDraft, recordPick, getRunModifiers, nearSynergyHints } from "./run-draft.js";

// D6-flavor precedent (horde's "second_wind" cosmetic upgrade described the
// same number) — a consumed revive restores the player to half their max HP,
// not a full heal, so death still costs momentum even when survived.
const REVIVE_HP_FRACTION = 0.5;

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

/**
 * Add `bonus` HP to a player's world-scoped resource bars (creating the row
 * with getOrInitPlayerBars if it doesn't exist yet). Returns the bonus
 * actually applied (0 if the bars substrate is unavailable) so the caller can
 * store EXACTLY that amount for symmetric removal later.
 */
function _applyStartingHpBonus(db, userId, worldId, bonus) {
  const amt = Math.floor(Number(bonus) || 0);
  if (!db || !userId || !worldId || amt <= 0) return 0;
  try {
    const bars = getOrInitPlayerBars(db, userId, worldId);
    const newMax = (bars.max_hp || 100) + amt;
    const newHp = Math.min(newMax, (bars.hp || 0) + amt);
    db.prepare(`
      UPDATE player_resource_bars SET max_hp = ?, hp = ?, updated_at = unixepoch()
      WHERE user_id = ? AND world_id = ?
    `).run(newMax, newHp, userId, worldId);
    return amt;
  } catch {
    return 0; // player_resource_bars substrate optional — run still starts
  }
}

/** Symmetric removal of an amount previously granted by _applyStartingHpBonus. */
function _removeStartingHpBonus(db, userId, worldId, bonus) {
  const amt = Math.floor(Number(bonus) || 0);
  if (!db || !userId || !worldId || amt <= 0) return;
  try {
    const bars = db.prepare(`
      SELECT hp, max_hp FROM player_resource_bars WHERE user_id = ? AND world_id = ?
    `).get(userId, worldId);
    if (!bars) return;
    const newMax = Math.max(1, (bars.max_hp || 100) - amt);
    const newHp = Math.min(newMax, bars.hp || 0);
    db.prepare(`
      UPDATE player_resource_bars SET max_hp = ?, hp = ?, updated_at = unixepoch()
      WHERE user_id = ? AND world_id = ?
    `).run(newMax, newHp, userId, worldId);
  } catch { /* best-effort — a missing bars row means there's nothing to remove */ }
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
      // Wave 4: this internal close bypasses endRun()'s payout/removal logic
      // (no currency is earned on a silent world-switch timeout, matching the
      // pre-existing behavior), but the prior run's starting-HP bonus MUST
      // still be removed symmetrically or it would silently accumulate across
      // every region-switch a player makes with veteran_vigor owned.
      const priorBonus = db.prepare(`SELECT hp_bonus_applied FROM roguelite_runs WHERE id = ?`).get(active.id);
      db.prepare(`
        UPDATE roguelite_runs
        SET ended_at = unixepoch(), end_reason = 'timeout'
        WHERE id = ?
      `).run(active.id);
      _removeStartingHpBonus(db, userId, worldId, priorBonus?.hp_bonus_applied || 0);
    }

    const id = `rgl_${crypto.randomBytes(6).toString("hex")}`;
    // C1 + C2 — the meta-unlock modifiers this run starts with.
    const modifiers = runMetaModifiers(db, userId);
    const hpBonusApplied = _applyStartingHpBonus(db, userId, worldId, modifiers.startingHpBonus);
    const revivesRemaining = Math.max(0, Math.floor(modifiers.revives || 0));
    db.prepare(`
      INSERT INTO roguelite_runs
        (id, user_id, world_id, region_id, hp_bonus_applied, revives_remaining)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, worldId, regionId, hpBonusApplied, revivesRemaining);
    logger.info?.("roguelite", "run_started", { runId: id, userId, regionId, tier, hpBonusApplied, revivesRemaining });
    return {
      ok: true, runId: id, alreadyActive: false,
      modifiers, hpBonusApplied, revivesRemaining,
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
    // Wave 4 (Gap C) — a purchased `fortune_finder` meta-unlock multiplies the
    // cash-out on top of the difficulty loot multiplier. Read fresh at end
    // time (not the start-time snapshot) since it's a permanent passive, not
    // a run-scoped resource — a purchase mid-run legitimately benefits the
    // payout it's about to receive.
    const metaCurrencyMult = Number(runMetaModifiers(db, run.user_id).metaCurrencyMult) || 0;
    const earned = Math.floor(_earnedCurrency(depthReached, reason) * lootMult * (1 + metaCurrencyMult));
    db.prepare(`
      UPDATE roguelite_runs
      SET ended_at = unixepoch(), end_reason = ?,
          meta_currency_earned = ?, depth_reached = ?
      WHERE id = ?
    `).run(reason, earned, depthReached, runId);

    // Wave 4 — remove exactly the starting-HP bonus this run was granted at
    // startRun() (stored, not recomputed — see migration 359's doc comment).
    _removeStartingHpBonus(db, run.user_id, run.world_id, run.hp_bonus_applied || 0);

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
 *
 * Security fix (Wave 4 catalog-reconciliation pass): price is ALWAYS looked
 * up server-side from META_UNLOCK_CATALOG — there is no client-suppliable
 * cost anymore. The prior code fell back to `costCc` (a request-body value)
 * for any unlockId not present in the catalog; since the shop-visible
 * catalog (`content/roguelite-unlocks.json`) used a disjoint set of ids from
 * `META_UNLOCK_CATALOG`, EVERY real purchase went through that fallback and
 * was fully self-priced by the client (including cost 0). A 4th positional
 * arg is still accepted so existing call sites don't need updating, but it
 * is intentionally ignored — do not resurrect any use of it for pricing.
 */
export function purchaseUnlock(db, userId, unlockId, _clientSuppliedCostIgnored) {
  if (!db || !userId || !unlockId) return { ok: false, error: "missing_inputs" };
  const catalogEntry = META_UNLOCK_CATALOG[unlockId];
  if (!catalogEntry) return { ok: false, error: "unknown_unlock" };
  const cost = catalogEntry.costCc;
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
      SELECT id, world_id, region_id, started_at, depth_reached,
             hp_bonus_applied, revives_remaining, draft_picks_available
      FROM roguelite_runs WHERE user_id = ? AND ended_at IS NULL
    `).get(userId) || null;
  } catch { return null; }
}

/**
 * F4.1 / Gap B — roguelite's in-run draft moment. Mirrors horde's
 * "next wave" (tickWave): advances the run's depth and offers a fresh
 * structured boon draft. extraDraftPicks (from an owned meta-unlock) raises
 * how many picks are BANKED per advance, not just how many are offered — see
 * migration 359's doc comment for why banking (rather than a strict
 * one-round-only bonus) is the honest reading of a PERMANENT meta-unlock.
 */
export function advanceRun(db, runId, opts = {}) {
  if (!db || !runId) return { ok: false, error: "missing_inputs" };
  try {
    const run = db.prepare(`SELECT user_id, depth_reached, draft_picks_available, ended_at FROM roguelite_runs WHERE id = ?`).get(runId);
    if (!run) return { ok: false, error: "no_run" };
    if (run.ended_at) return { ok: false, error: "run_ended" };

    const newDepth = (run.depth_reached || 1) + 1;
    const meta = runMetaModifiers(db, run.user_id);
    const picksGranted = 1 + Math.max(0, Math.floor(meta.extraDraftPicks || 0));
    const newPicksAvailable = (run.draft_picks_available || 0) + picksGranted;
    db.prepare(`
      UPDATE roguelite_runs SET depth_reached = ?, draft_picks_available = ?
      WHERE id = ?
    `).run(newDepth, newPicksAvailable, runId);

    return {
      ok: true,
      depthReached: newDepth,
      draftOffering: rollDraft(db, "roguelite", runId, Math.max(3, picksGranted + 2)),
      synergyHints: nearSynergyHints(db, "roguelite", runId),
      picksGrantedThisAdvance: picksGranted,
      picksAvailable: newPicksAvailable,
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * F4.1 / Gap B — spend one banked draft pick on a boon. Rejects if the run
 * has no picks available (a player can't out-pick their advances) or the
 * boon is unknown/already taken (delegated to run-draft.js#recordPick).
 */
export function pickDraftBoon(db, runId, userId, pickId) {
  if (!db || !runId || !userId || !pickId) return { ok: false, error: "missing_inputs" };
  try {
    const run = db.prepare(`SELECT user_id, draft_picks_available, ended_at FROM roguelite_runs WHERE id = ?`).get(runId);
    if (!run) return { ok: false, error: "no_run" };
    if (run.ended_at) return { ok: false, error: "run_ended" };
    if (run.user_id !== userId) return { ok: false, error: "not_your_run" };
    if (!(run.draft_picks_available > 0)) return { ok: false, error: "no_picks_available" };

    const rec = recordPick(db, { runKind: "roguelite", runId, userId, pickId: String(pickId) });
    if (!rec.ok) return { ok: false, error: rec.reason || "pick_failed" };

    db.prepare(`
      UPDATE roguelite_runs SET draft_picks_available = draft_picks_available - 1 WHERE id = ?
    `).run(runId);

    const bundle = getRunModifiers(db, "roguelite", runId);
    return {
      ok: true,
      pickId: rec.pickId,
      boon: rec.boon,
      modifiers: bundle.modifiers,
      synergies: bundle.synergies,
      picksAvailable: run.draft_picks_available - 1,
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Gap C — the roguelite death-handling path. Called by the combat routes
 * (routes/worlds.js's npc-attack, server/lib/npc-simulator.js's autonomous
 * NPC attacks) whenever a hit WOULD kill this user. If they have an active
 * roguelite run with revives_remaining > 0, consumes one charge, restores
 * them to REVIVE_HP_FRACTION of max HP, and returns { revived: true } so the
 * caller can override the kill instead of ending the run. World-scoped so a
 * revive charge only fires for damage taken inside the run's own world.
 */
export function maybeReviveRoguelitePlayer(db, userId, worldId) {
  if (!db || !userId || !worldId) return { revived: false };
  try {
    const run = db.prepare(`
      SELECT id, revives_remaining FROM roguelite_runs
      WHERE user_id = ? AND world_id = ? AND ended_at IS NULL
    `).get(userId, worldId);
    if (!run || !(run.revives_remaining > 0)) return { revived: false };

    db.prepare(`UPDATE roguelite_runs SET revives_remaining = revives_remaining - 1 WHERE id = ?`).run(run.id);

    const bars = db.prepare(`SELECT max_hp FROM player_resource_bars WHERE user_id = ? AND world_id = ?`).get(userId, worldId);
    const maxHp = bars?.max_hp || 100;
    const reviveHp = Math.max(1, Math.round(maxHp * REVIVE_HP_FRACTION));
    db.prepare(`
      UPDATE player_resource_bars SET hp = ?, updated_at = unixepoch() WHERE user_id = ? AND world_id = ?
    `).run(reviveHp, userId, worldId);

    const revivesRemaining = run.revives_remaining - 1;
    logger.info?.("roguelite", "revive_consumed", { runId: run.id, userId, worldId, revivesRemaining, reviveHp });
    return { revived: true, runId: run.id, revivesRemaining, reviveHp };
  } catch (err) {
    return { revived: false, error: err?.message };
  }
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

export { CURRENCY_PER_DEPTH, DEATH_PENALTY_MULT, EXTRACT_BONUS_MULT, REVIVE_HP_FRACTION };
