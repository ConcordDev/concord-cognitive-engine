// server/emergent/user-profile-compiler-cycle.js
//
// Wave A / A3 — heartbeat that compiles user_player_profiles for users
// whose activity has changed since their last compile. Bounded
// MAX_PER_PASS=10 so a busy server with many recently-active users
// still stays within budget.
//
// Heartbeat invariant: never throws.
// Kill switch: CONCORD_USER_PROFILE_COMPILER=0.

import logger from "../logger.js";
import { compileProfile, activitySignature } from "../lib/user-player-profile.js";

const MAX_PER_PASS = 10;
const STALENESS_S = 24 * 3600;   // skip users compiled within last 24h
const RECENT_ACTIVITY_S = 7 * 24 * 3600;

export async function runUserProfileCompilerCycle({ db } = {}) {
  if (process.env.CONCORD_USER_PROFILE_COMPILER === "0") {
    return { ok: false, reason: "disabled" };
  }
  if (!db) return { ok: false, reason: "no_db" };

  // Candidate users: ones who have *any* skill row + were active in the
  // last week + either have no profile or a stale one whose activity
  // signature changed.
  let candidates = [];
  try {
    const nowS = Math.floor(Date.now() / 1000);
    candidates = db.prepare(`
      SELECT DISTINCT s.user_id
      FROM player_skill_levels s
      LEFT JOIN user_player_profiles p ON p.user_id = s.user_id
      WHERE s.last_used_at IS NULL OR s.last_used_at > ?
      ORDER BY COALESCE(p.last_compiled_at, 0) ASC
      LIMIT ?
    `).all(nowS - RECENT_ACTIVITY_S, MAX_PER_PASS * 3);
  } catch {
    return { ok: true, reason: "no_table", compiled: 0 };
  }

  const stats = { ok: true, evaluated: candidates.length, compiled: 0, skipped: 0, errored: 0 };
  const nowS = Math.floor(Date.now() / 1000);

  for (const { user_id: uid } of candidates) {
    if (stats.compiled >= MAX_PER_PASS) break;
    try {
      const existing = db.prepare(`
        SELECT last_compiled_at, activity_signature FROM user_player_profiles WHERE user_id = ?
      `).get(uid);
      const sig = activitySignature(db, uid);
      const fresh = existing
        && existing.last_compiled_at
        && (nowS - existing.last_compiled_at) < STALENESS_S
        && existing.activity_signature === sig;
      if (fresh) { stats.skipped++; continue; }
      const r = compileProfile(db, uid);
      if (r.ok) stats.compiled++;
      else      stats.errored++;
    } catch (err) {
      stats.errored++;
      logger?.warn?.("user-profile-compiler", "user_failed", { uid, error: err?.message });
    }
  }

  return stats;
}
