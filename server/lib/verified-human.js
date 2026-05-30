// server/lib/verified-human.js
//
// Universal Move System — the opt-in verified-human badge. The world is
// indistinguishable by default (everyone's a citizen; "human" only adds a
// spectator); this lets the side carrying asymmetric out-of-world stakes opt in
// and filter for others who have. Pure DB helpers over the mig-293 columns.
// Kill-switch CONCORD_VERIFIED_HUMAN_BADGE=0 disables the whole surface.
//
// Synthetic playtest agents NEVER call verifyHuman → badge-ineligible by
// construction, so Instrument 2 can't pollute the verified-human signal.

function enabled() { return process.env.CONCORD_VERIFIED_HUMAN_BADGE !== "0"; }
function hasCol(db) {
  try { return db.pragma("table_info(users)").some((c) => c.name === "verified_human"); }
  catch { return false; }
}

/** Complete the one-time human verification (idempotent). */
export function verifyHuman(db, userId) {
  if (!enabled() || !hasCol(db) || !userId) return { ok: false, reason: "unavailable" };
  db.prepare("UPDATE users SET verified_human = 1, verified_human_at = COALESCE(verified_human_at, ?) WHERE id = ?")
    .run(new Date().toISOString(), userId);
  return { ok: true, verifiedHuman: true };
}

/** Toggle whether the (already-verified) badge is shown. Default visible. */
export function setBadgeVisible(db, userId, visible) {
  if (!enabled() || !hasCol(db) || !userId) return { ok: false, reason: "unavailable" };
  db.prepare("UPDATE users SET badge_visible = ? WHERE id = ?").run(visible ? 1 : 0, userId);
  return { ok: true, badgeVisible: !!visible };
}

/** Is this user a verified human (regardless of display preference)? */
export function isVerifiedHuman(db, userId) {
  if (!enabled() || !hasCol(db) || !userId) return false;
  const r = db.prepare("SELECT verified_human FROM users WHERE id = ?").get(userId);
  return !!(r && r.verified_human);
}

/** Display badge = verified AND opted to show it. This is what UIs render. */
export function badgeVisibleFor(db, userId) {
  if (!enabled() || !hasCol(db) || !userId) return false;
  const r = db.prepare("SELECT verified_human, badge_visible FROM users WHERE id = ?").get(userId);
  return !!(r && r.verified_human && r.badge_visible);
}

/** The opt-in "verified-human only" filter: keep only verified ids. */
export function filterVerifiedHuman(db, userIds) {
  if (!enabled() || !hasCol(db) || !Array.isArray(userIds) || !userIds.length) return [];
  const ph = userIds.map(() => "?").join(",");
  try {
    return db.prepare(`SELECT id FROM users WHERE id IN (${ph}) AND verified_human = 1`).all(...userIds).map((r) => r.id);
  } catch { return []; }
}

export function statusFor(db, userId) {
  if (!hasCol(db)) return { ok: true, available: false, verifiedHuman: false, badgeVisible: false };
  return { ok: true, available: enabled(), verifiedHuman: isVerifiedHuman(db, userId), badgeVisible: badgeVisibleFor(db, userId) };
}
