// server/lib/run-modifiers.js
//
// Wave 4 gap-closure — the read-side glue that makes horde's draft picks
// (run-draft.js) and roguelite's purchased meta-unlocks (roguelite.js)
// ACTUALLY affect live combat. Both prior systems computed a real, correct
// modifier bundle and then had zero callers on the combat path — this module
// is that caller.
//
// getActiveRunModifiers(db, userId) finds the user's active horde OR
// roguelite run (if any) and returns a single merged modifier bundle:
//   - horde:     just the in-run draft picks (horde has no meta-unlock shop).
//   - roguelite: in-run draft picks PLUS owned meta-unlocks (runMetaModifiers),
//                merged additively per-stat.
//
// STACKING RULE (explicit judgment call — see CLAUDE.md Wave 4 discipline):
// same-named stats (most commonly `damageMult`) from DIFFERENT sources (a
// drafted boon vs. a purchased meta-unlock) are SUMMED, then applied as ONE
// multiplicative factor to damage (finalDamage *= 1 + damageMult). This
// mirrors the existing, already-shipped convention in run-draft.js's own
// getRunModifiers(), which already sums multiple picked boons of the SAME
// stat together (see its `modifiers[boon.effect.stat] += boon.effect.value`).
// Treating "draft pick" and "meta-unlock" as just two more contributors to
// the same additive pool is the consistent reading of that precedent, and it
// avoids the double-compounding a multiplicative stack would produce for a
// player who has both a rich draft AND a maxed meta shop (e.g. two separate
// 1.25x multiplications of the same conceptual "+25% damage" claim would
// silently read as 56% total instead of the intended 50%).
//
// CACHE / INVALIDATION STORY:
// getActiveRunModifiers is called on the hot combat-attack path (every hit),
// so it's backed by a short-TTL in-memory cache keyed by userId. Correctness-
// critical mutations (a new draft pick, a new meta-unlock purchase, a run
// start/end) are all served through server.js's route handlers, which call
// invalidateRunModifierCache(userId) immediately after each such mutation —
// so in the common case the cache is invalidated within the same request
// that changed it, not merely time-expired. The TTL (default 4s) is a SAFETY
// NET for any caller that forgets to invalidate, not the primary mechanism.
// This module deliberately does NOT import roguelite.js's mutating functions
// (startRun/endRun/purchaseUnlock) or horde-mode.js's (pickUpgrade/startHorde/
// endHorde) to call invalidate itself — roguelite.js already imports this
// module's sibling (run-draft.js) and would create a require cycle if it also
// imported run-modifiers.js just to invalidate its own cache; keeping the
// invalidation calls in server.js's route layer (which already dynamically
// imports every lib file per-request with no cycle risk) avoids that
// entirely. A modifier is monotonic within a run (picks/unlocks only ADD,
// never remove, until the run ends) so a few seconds of staleness can only
// ever under-count, never mis-apply a stat the player doesn't have.

import { getRunModifiers } from "./run-draft.js";
import { runMetaModifiers } from "./roguelite.js";

const CACHE_TTL_MS = Number(process.env.CONCORD_RUN_MODIFIER_CACHE_MS) || 4000;
const _cache = new Map(); // userId -> { expiresAt, bundle }

const EMPTY_BUNDLE = Object.freeze({ runKind: null, runId: null, modifiers: {}, synergies: [] });

function _mergeModifiers(...bundles) {
  const out = {};
  for (const b of bundles) {
    for (const [k, v] of Object.entries(b || {})) {
      const num = Number(v) || 0;
      if (num === 0) continue;
      out[k] = Math.round(((out[k] || 0) + num) * 1000) / 1000;
    }
  }
  return out;
}

function _computeActiveRunModifiers(db, userId) {
  if (!db || !userId) return EMPTY_BUNDLE;

  try {
    const horde = db.prepare(`SELECT id FROM horde_runs WHERE user_id = ? AND ended_at IS NULL`).get(userId);
    if (horde) {
      const draft = getRunModifiers(db, "horde", horde.id);
      return { runKind: "horde", runId: horde.id, modifiers: draft.modifiers, synergies: draft.synergies };
    }
  } catch { /* horde_runs / run_draft_picks tables optional on a minimal build */ }

  try {
    const rl = db.prepare(`SELECT id FROM roguelite_runs WHERE user_id = ? AND ended_at IS NULL`).get(userId);
    if (rl) {
      const draft = getRunModifiers(db, "roguelite", rl.id);
      const meta = runMetaModifiers(db, userId);
      return {
        runKind: "roguelite",
        runId: rl.id,
        modifiers: _mergeModifiers(draft.modifiers, meta),
        synergies: draft.synergies,
      };
    }
  } catch { /* roguelite_runs / run_draft_picks tables optional on a minimal build */ }

  return EMPTY_BUNDLE;
}

/**
 * The live modifier bundle for a user's active run (horde OR roguelite), or
 * an empty bundle when no run is active. Cached per-user for CACHE_TTL_MS.
 */
export function getActiveRunModifiers(db, userId) {
  if (!db || !userId) return EMPTY_BUNDLE;
  const now = Date.now();
  const cached = _cache.get(userId);
  if (cached && cached.expiresAt > now) return cached.bundle;
  const bundle = _computeActiveRunModifiers(db, userId);
  _cache.set(userId, { expiresAt: now + CACHE_TTL_MS, bundle });
  return bundle;
}

/** Bust the cache for one user (after a mutation) or everyone (no arg — tests). */
export function invalidateRunModifierCache(userId) {
  if (userId) _cache.delete(userId);
  else _cache.clear();
}

export { CACHE_TTL_MS };
