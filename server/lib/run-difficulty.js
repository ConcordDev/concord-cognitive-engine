// server/lib/run-difficulty.js
//
// C2 / F4.2 — difficulty tiers for run-modes. difficulty.js#applyDifficulty was
// wired only to world-bosses; this wraps it so roguelite / horde / extraction
// can run at a player-selected tier (finder → normal → heroic → mythic), gated
// by a prior clear, scaling enemy count/health/loot. Thin reuse of the existing
// difficulty substrate — no new tier system.

import { getModifier, tierUnlockedFor, recordClear, applyDifficulty, TIER_ORDER } from "./difficulty.js";

/** The encounter id a run-mode uses for tier-gating (one chain per mode). */
export function runEncounterId(runKind) {
  return `run:${runKind}`;
}

/**
 * Resolve a run's difficulty: validate the tier is unlocked for this mode, and
 * return its modifier. Defaults to 'finder' (always unlocked). Returns
 * { ok, tier, modifier } or { ok:false, reason }.
 */
export function resolveRunDifficulty(db, userId, runKind, tier = "finder") {
  if (!TIER_ORDER.includes(tier)) return { ok: false, reason: "invalid_tier", validTiers: TIER_ORDER };
  const encounterId = runEncounterId(runKind);
  if (!tierUnlockedFor(db, userId, encounterId, tier)) {
    return { ok: false, reason: "tier_locked", tier, needsClearOf: encounterId };
  }
  const modifier = getModifier(db, tier);
  // finder is the baseline (identity scaling) — it works even on a minimal
  // build without the difficulty_modifiers table. Higher tiers need the row.
  if (!modifier) {
    if (tier === "finder") return { ok: true, tier, modifier: null };
    return { ok: false, reason: "no_modifier_row", tier };
  }
  return { ok: true, tier, modifier };
}

/** Scale a run encounter (enemy stats) by the resolved tier modifier. */
export function scaleRunEncounter(encounter, modifier) {
  return applyDifficulty(encounter, modifier);
}

/** Record a clear of a run mode at a tier (unlocks the next tier). */
export function recordRunClear(db, userId, runKind, tier) {
  return recordClear(db, userId, runEncounterId(runKind), tier);
}

/**
 * D6 — the loot/reward multiplier of a resolved difficulty modifier (1.0 at
 * finder / on a minimal build). Audacity at a higher tier yields outsized
 * payouts because this scales the meta-currency grant.
 */
export function lootMultFor(modifier) {
  if (!modifier) return 1.0;
  const m = Number(modifier.loot_mult ?? modifier.lootMult ?? 1.0);
  return Number.isFinite(m) && m > 0 ? m : 1.0;
}

/**
 * D6 — shared run-meta-currency bank. `roguelite_meta_currency` is the single
 * Hades-pattern gem bank (per the CLAUDE.md invariant); all run modes
 * (roguelite/horde/extraction) bank persistent meta-progress here so that a
 * LOSS still advances the player. Guarded: a build without the table no-ops.
 * Never touches the CC wallet (run currency is separate by design).
 */
export function grantRunMeta(db, userId, amount) {
  const amt = Math.floor(Number(amount) || 0);
  if (!db || !userId || amt <= 0) return { ok: false, reason: "noop", granted: 0 };
  try {
    db.prepare(`
      INSERT INTO roguelite_meta_currency (user_id, balance, lifetime)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        balance = balance + excluded.balance,
        lifetime = lifetime + excluded.balance,
        updated_at = unixepoch()
    `).run(userId, amt, amt);
    return { ok: true, granted: amt };
  } catch (e) {
    return { ok: false, reason: "schema_unavailable", granted: 0 };
  }
}

export { TIER_ORDER };
