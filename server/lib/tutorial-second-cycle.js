/**
 * Second-Cycle tutorial — Wave 7 / T3.2.
 *
 * After the four-quest First Cycle, the player still doesn't know the
 * new UI surfaces shipped in the recent arc. This second cycle teaches
 * them via 6 lightweight steps. Unlike the first cycle (which goes
 * through the quest engine), this one checks lightweight signals
 * directly so we don't have to invent new objective types:
 *
 *   open_character_sheet  → user_ui_opens row for ui_key='character_sheet'
 *   open_favorites_wheel  → user_ui_opens row for ui_key='favorites_wheel'
 *   open_perk_constellation → user_ui_opens row for ui_key='perk_constellation'
 *   discover_hybrid       → any row in player_creature_discoveries with kind='hybrid'
 *   tame_creature         → any row in player_creature_discoveries with kind='tamed'
 *   claim_land            → any row in land_claims with owner_user_id = caller
 */

export const SECOND_CYCLE_STEPS = Object.freeze([
  { key: "open_character_sheet",   label: "Press C to open your character sheet" },
  { key: "open_favorites_wheel",   label: "Press Q to open the favorites wheel" },
  { key: "open_perk_constellation", label: "Press K to view your perk constellation" },
  { key: "discover_hybrid",        label: "Find a hybrid creature in the wild" },
  { key: "tame_creature",          label: "Tame your first companion" },
  { key: "claim_land",             label: "Press T and claim a patch of land" },
]);

export function recordUiOpen(db, userId, uiKey) {
  if (!db || !userId || !uiKey) return { ok: false, reason: "invalid_args" };
  try {
    db.prepare(`
      INSERT OR IGNORE INTO user_ui_opens (user_id, ui_key)
      VALUES (?, ?)
    `).run(userId, uiKey);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "persist_failed", message: err?.message };
  }
}

function _hasUiOpen(db, userId, uiKey) {
  try {
    const row = db.prepare(`
      SELECT 1 AS x FROM user_ui_opens WHERE user_id = ? AND ui_key = ?
    `).get(userId, uiKey);
    return !!row;
  } catch { return false; }
}

function _hasDiscovery(db, userId, kind) {
  try {
    const row = db.prepare(`
      SELECT 1 AS x FROM player_creature_discoveries
      WHERE user_id = ? AND kind = ?
      LIMIT 1
    `).get(userId, kind);
    return !!row;
  } catch { return false; }
}

function _hasLandClaim(db, userId) {
  try {
    const row = db.prepare(`
      SELECT 1 AS x FROM land_claims WHERE owner_user_id = ? AND status = 'active' LIMIT 1
    `).get(userId);
    return !!row;
  } catch { return false; }
}

/**
 * Compute the second-cycle progress for a user. Returns the same shape
 * as the first-cycle helper for consistency.
 */
export function deriveSecondCycleProgress(db, userId) {
  const steps = SECOND_CYCLE_STEPS.map((s) => {
    let done = false;
    switch (s.key) {
      case "open_character_sheet":    done = _hasUiOpen(db, userId, "character_sheet"); break;
      case "open_favorites_wheel":    done = _hasUiOpen(db, userId, "favorites_wheel"); break;
      case "open_perk_constellation": done = _hasUiOpen(db, userId, "perk_constellation"); break;
      case "discover_hybrid":         done = _hasDiscovery(db, userId, "hybrid"); break;
      case "tame_creature":           done = _hasDiscovery(db, userId, "tamed"); break;
      case "claim_land":              done = _hasLandClaim(db, userId); break;
    }
    return { ...s, complete: done };
  });
  const completeCount = steps.filter((s) => s.complete).length;
  const currentStep = steps.find((s) => !s.complete)?.key ?? null;
  return {
    ok: true,
    tutorial: "second_cycle",
    steps,
    completeCount,
    totalCount: steps.length,
    complete: completeCount === steps.length,
    currentStep,
  };
}
