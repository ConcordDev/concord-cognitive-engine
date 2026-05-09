// server/emergent/player-signs-cleanup.js
//
// Theme deferred (game-feel pass): heartbeat that hard-deletes expired
// player_signs rows. Frequency 240 (~60 min). Cheap; bounded by index
// on expires_at.
//
// Per heartbeat invariant: NEVER throws. Kill-switch:
// CONCORD_PLAYER_SIGNS_CLEANUP=0.

import { cleanupExpiredSigns } from "../lib/player-signs.js";

export async function runPlayerSignsCleanup({ db } = {}) {
  if (process.env.CONCORD_PLAYER_SIGNS_CLEANUP === "0") {
    return { ok: false, reason: "disabled" };
  }
  if (!db) return { ok: false, reason: "no_db" };
  let removed = 0;
  try {
    removed = cleanupExpiredSigns(db);
  } catch { /* sweep is best-effort */ }
  return { ok: true, removed };
}
