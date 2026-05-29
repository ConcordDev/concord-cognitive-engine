// server/lib/horror-dread.js
//
// E1 — dread substrate for asymmetric horror. The atmosphere layer on top of
// the bare win-conditions in horror.js:
//   - proximity-driven dread (closer ghost = more dread; decays when safe)
//   - a chase state (ghost within CHASE_RADIUS_M → flee music + camera)
//   - a health-tier ladder (healthy → wounded → downed) with a bleed-out
//     timer and a rally (comeback) path
//   - a `horror:tension` event payload the audio + UI consume
//
// Pure-compute helpers + a per-session tick. Positions are passed in by the
// caller (the heartbeat reads them from city-presence) so this stays testable.

// ── Dials (env-overridable; documented in BALANCE_DIALS.md) ────────────────────
export const TERROR_RADIUS_M = Number(process.env.CONCORD_HORROR_TERROR_RADIUS_M) || 28;
export const CHASE_RADIUS_M = Number(process.env.CONCORD_HORROR_CHASE_RADIUS_M) || 10;
export const DREAD_RISE_PER_TICK = Number(process.env.CONCORD_HORROR_DREAD_RISE) || 0.18;
export const DREAD_DECAY_PER_TICK = Number(process.env.CONCORD_HORROR_DREAD_DECAY) || 0.06;
export const BLEED_OUT_S = Number(process.env.CONCORD_HORROR_BLEED_OUT_S) || 45;

function dist3(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Dread contribution from a single proximity reading, 0..1. Zero beyond the
 * terror radius, ramps smoothly to 1 at point-blank. Quadratic so the last
 * few metres spike — the "it's right behind me" feel.
 */
export function dreadFromDistance(distance, terrorRadius = TERROR_RADIUS_M) {
  if (!Number.isFinite(distance) || distance >= terrorRadius) return 0;
  const t = 1 - distance / terrorRadius; // 0 at edge, 1 at contact
  return Math.max(0, Math.min(1, t * t));
}

/** The tension band the audio engine keys off. */
export function tensionBand(dread, inChase) {
  if (inChase || dread >= 0.75) return "terror";
  if (dread >= 0.35) return "tension";
  return "calm";
}

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name); }
  catch { return false; }
}

function ensureRow(db, sessionId, userId) {
  db.prepare(`
    INSERT INTO horror_dread_state (session_id, user_id) VALUES (?, ?)
    ON CONFLICT(session_id, user_id) DO NOTHING
  `).run(sessionId, userId);
}

/**
 * Advance dread for one investigator given the ghost distance. Returns the new
 * dread state + a `tension` payload. Downed/rallied tiers don't accrue dread.
 */
export function advanceDread(db, sessionId, userId, ghostDistance, nowMs = Date.now()) {
  if (!db || !sessionId || !userId || !tableExists(db, "horror_dread_state")) {
    return { ok: false };
  }
  ensureRow(db, sessionId, userId);
  const row = db.prepare(`SELECT * FROM horror_dread_state WHERE session_id=? AND user_id=?`).get(sessionId, userId);
  if (row.health_tier === "downed") {
    return { ok: true, dread: row.dread, inChase: false, band: "terror", healthTier: "downed", pursuerDistance: ghostDistance };
  }
  const proximityDread = dreadFromDistance(ghostDistance);
  const inChase = Number.isFinite(ghostDistance) && ghostDistance <= CHASE_RADIUS_M;
  // Rise toward proximity dread, or decay toward 0 when safe.
  let dread = row.dread;
  if (proximityDread > dread) dread = Math.min(1, dread + DREAD_RISE_PER_TICK);
  else dread = Math.max(proximityDread, dread - DREAD_DECAY_PER_TICK);
  dread = Math.max(0, Math.min(1, dread));
  const now = Math.floor(nowMs / 1000);
  const chaseStartedAt = inChase ? (row.in_chase ? row.chase_started_at : now) : null;
  db.prepare(`
    UPDATE horror_dread_state
    SET dread=?, pursuer_distance=?, in_chase=?, chase_started_at=?, updated_at=?
    WHERE session_id=? AND user_id=?
  `).run(dread, Number.isFinite(ghostDistance) ? ghostDistance : null, inChase ? 1 : 0, chaseStartedAt, now, sessionId, userId);
  return {
    ok: true,
    dread,
    inChase,
    band: tensionBand(dread, inChase),
    healthTier: row.health_tier,
    pursuerDistance: Number.isFinite(ghostDistance) ? ghostDistance : null,
  };
}

/**
 * Tick every investigator in a session against the ghost position.
 * `positions` = { ghost: {x,y,z}, investigators: { userId: {x,y,z} } }.
 * Returns an array of per-investigator tension payloads (for `horror:tension`).
 */
export function tickSessionDread(db, sessionId, positions, nowMs = Date.now()) {
  if (!db || !sessionId || !positions?.ghost || !positions.investigators) return [];
  const out = [];
  for (const [userId, pos] of Object.entries(positions.investigators)) {
    const d = dist3(positions.ghost, pos);
    const r = advanceDread(db, sessionId, userId, d, nowMs);
    if (r.ok) out.push({ sessionId, userId, dread: r.dread, inChase: r.inChase, band: r.band, healthTier: r.healthTier, pursuerDistance: r.pursuerDistance });
  }
  return out;
}

// ── Health tiers / bleed-out / rally ──────────────────────────────────────────
/**
 * Wound an investigator (healthy → wounded, or wounded → downed with a
 * bleed-out timer). Returns the new tier. The session's `downInvestigator`
 * win-check stays in horror.js — this is the somatic ladder beneath it.
 */
export function woundInvestigator(db, sessionId, userId, nowMs = Date.now()) {
  if (!db || !sessionId || !userId || !tableExists(db, "horror_dread_state")) return { ok: false };
  ensureRow(db, sessionId, userId);
  const row = db.prepare(`SELECT health_tier FROM horror_dread_state WHERE session_id=? AND user_id=?`).get(sessionId, userId);
  const now = Math.floor(nowMs / 1000);
  let tier = row.health_tier;
  if (tier === "healthy" || tier === "rallied") {
    tier = "wounded";
    db.prepare(`UPDATE horror_dread_state SET health_tier='wounded', updated_at=? WHERE session_id=? AND user_id=?`).run(now, sessionId, userId);
    return { ok: true, healthTier: "wounded", downed: false };
  }
  if (tier === "wounded") {
    const bleedOut = now + BLEED_OUT_S;
    db.prepare(`UPDATE horror_dread_state SET health_tier='downed', bleed_out_at=?, dread=1, updated_at=? WHERE session_id=? AND user_id=?`).run(bleedOut, now, sessionId, userId);
    return { ok: true, healthTier: "downed", downed: true, bleedOutAt: bleedOut };
  }
  return { ok: true, healthTier: tier, downed: tier === "downed" };
}

/**
 * Rally (revive) a downed or wounded investigator — the comeback beat. A
 * teammate reaching them before bleed-out brings them back to 'rallied'
 * (healthy-equivalent but counted for pacing). Idempotent for non-downed.
 */
export function rallyInvestigator(db, sessionId, userId, nowMs = Date.now()) {
  if (!db || !sessionId || !userId || !tableExists(db, "horror_dread_state")) return { ok: false };
  ensureRow(db, sessionId, userId);
  const row = db.prepare(`SELECT health_tier, bleed_out_at, rallied_count FROM horror_dread_state WHERE session_id=? AND user_id=?`).get(sessionId, userId);
  const now = Math.floor(nowMs / 1000);
  if (row.health_tier === "downed" && row.bleed_out_at != null && now > row.bleed_out_at) {
    return { ok: false, reason: "bled_out" };
  }
  if (row.health_tier === "healthy") return { ok: true, healthTier: "healthy", rallied: false };
  db.prepare(`
    UPDATE horror_dread_state
    SET health_tier='rallied', bleed_out_at=NULL, dread=0.5, rallied_count=rallied_count+1, updated_at=?
    WHERE session_id=? AND user_id=?
  `).run(now, sessionId, userId);
  return { ok: true, healthTier: "rallied", rallied: true, ralliedCount: row.rallied_count + 1 };
}

/**
 * Sweep downed investigators whose bleed-out timer has elapsed. Returns the
 * user ids that bled out (the caller hands them to horror.downInvestigator to
 * apply the win-check). Keeps the substrate the single source of timing truth.
 */
export function sweepBleedOuts(db, sessionId, nowMs = Date.now()) {
  if (!db || !sessionId || !tableExists(db, "horror_dread_state")) return [];
  const now = Math.floor(nowMs / 1000);
  return db.prepare(`
    SELECT user_id FROM horror_dread_state
    WHERE session_id=? AND health_tier='downed' AND bleed_out_at IS NOT NULL AND bleed_out_at < ?
  `).all(sessionId, now).map((r) => r.user_id);
}

/** Read the dread state for a session (HUD helper). */
export function getDreadState(db, sessionId) {
  if (!db || !sessionId || !tableExists(db, "horror_dread_state")) return [];
  return db.prepare(`
    SELECT user_id AS userId, dread, pursuer_distance AS pursuerDistance,
           in_chase AS inChase, health_tier AS healthTier, bleed_out_at AS bleedOutAt,
           rallied_count AS ralliedCount
    FROM horror_dread_state WHERE session_id=? ORDER BY dread DESC
  `).all(sessionId).map((r) => ({ ...r, inChase: !!r.inChase, band: tensionBand(r.dread, !!r.inChase) }));
}
