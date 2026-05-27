// server/lib/religion-engine.js
//
// Phase II Wave 24 — faith mechanics.
//
//   foundFaith(actor, name, doctrine)
//   join / leave / convert
//   pray  → small faith_strength bump + skill XP for the faithful
//   sermon → recruitment minigame outcome funnels into worshippers
//   accuseHeresy → triggers a faith_event chain (crusade/excommunication)
//   tickFaiths → per-faith cycle that decays inactive worshippers and
//                promotes/demotes by activity
//
// Faith_strength is the substrate quality the marketplace + LLaVA
// would later judge. For now: a deterministic counter advanced by
// prayer/sermon/witnessed-conversion.

import crypto from "node:crypto";

const FERVOR_STEP = 0.04;
const DECAY_STEP_PER_DAY = 0.02;
const RECRUITMENT_AFFINITY_CAP = 0.6;
const ROLE_THRESHOLDS = {
  lay:     0.0,
  novice:  0.20,
  priest:  0.55,
  prophet: 0.85,
};

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/* ───────── Faith CRUD ──────────────────────────────────────────────── */

export function foundFaith(db, { actorKind, actorId, name, doctrine }) {
  if (!actorKind || !actorId || !name) throw new Error("actorKind, actorId, name required");
  const id = uid("faith");
  const tenetCount = doctrine?.tenets?.length || 0;
  db.prepare(`
    INSERT INTO faiths (id, name, doctrine_json, founder_kind, founder_id, tenet_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, String(name).slice(0, 120), JSON.stringify(doctrine || {}), actorKind, actorId, Math.min(32, tenetCount));
  // Founder is automatically a prophet
  db.prepare(`
    INSERT INTO worshippers (faith_id, actor_kind, actor_id, faith_strength, role)
    VALUES (?, ?, ?, 0.9, 'prophet')
  `).run(id, actorKind, actorId);
  db.prepare(`
    INSERT INTO faith_events (id, faith_id, actor_kind, actor_id, event_kind)
    VALUES (?, ?, ?, ?, 'founding')
  `).run(uid("fe"), id, actorKind, actorId);
  db.prepare(`UPDATE faiths SET total_worshippers = 1 WHERE id = ?`).run(id);
  return { ok: true, faithId: id };
}

export function getFaith(db, faithId) {
  return db.prepare("SELECT * FROM faiths WHERE id = ?").get(faithId) || null;
}

export function listFaiths(db) {
  return db.prepare("SELECT * FROM faiths ORDER BY total_worshippers DESC LIMIT 200").all();
}

export function getWorshipper(db, faithId, actorKind, actorId) {
  return db.prepare(`
    SELECT * FROM worshippers WHERE faith_id = ? AND actor_kind = ? AND actor_id = ? AND left_at IS NULL
  `).get(faithId, actorKind, actorId) || null;
}

export function listWorshippersForActor(db, actorKind, actorId) {
  return db.prepare(`
    SELECT * FROM worshippers WHERE actor_kind = ? AND actor_id = ? AND left_at IS NULL
  `).all(actorKind, actorId);
}

export function join(db, faithId, actorKind, actorId) {
  if (!getFaith(db, faithId)) return { ok: false, reason: "faith_not_found" };
  const existing = getWorshipper(db, faithId, actorKind, actorId);
  if (existing) return { ok: true, alreadyJoined: true };
  db.prepare(`
    INSERT INTO worshippers (faith_id, actor_kind, actor_id, faith_strength, role)
    VALUES (?, ?, ?, 0.1, 'lay')
  `).run(faithId, actorKind, actorId);
  db.prepare(`UPDATE faiths SET total_worshippers = total_worshippers + 1 WHERE id = ?`).run(faithId);
  return { ok: true };
}

export function leave(db, faithId, actorKind, actorId) {
  const r = db.prepare(`
    UPDATE worshippers SET left_at = unixepoch() WHERE faith_id = ? AND actor_kind = ? AND actor_id = ? AND left_at IS NULL
  `).run(faithId, actorKind, actorId);
  if (r.changes > 0) {
    db.prepare(`UPDATE faiths SET total_worshippers = MAX(0, total_worshippers - 1) WHERE id = ?`).run(faithId);
  }
  return { ok: r.changes > 0 };
}

/* ───────── Ritual actions ──────────────────────────────────────────── */

function logEvent(db, faithId, actorKind, actorId, kind, targetActorId = null, payload = {}) {
  db.prepare(`
    INSERT INTO faith_events (id, faith_id, actor_kind, actor_id, event_kind, target_actor_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uid("fe"), faithId, actorKind, actorId, kind, targetActorId, JSON.stringify(payload));
}

function bumpFervor(db, faithId, actorKind, actorId, delta) {
  const w = getWorshipper(db, faithId, actorKind, actorId);
  if (!w) return null;
  const next = Math.max(0, Math.min(1, w.faith_strength + delta));
  // Role advancement is monotonic — won't drop role on prayer skip
  let role = w.role;
  for (const [r, threshold] of Object.entries(ROLE_THRESHOLDS).sort((a, b) => b[1] - a[1])) {
    if (next >= threshold) { role = r; break; }
  }
  db.prepare(`
    UPDATE worshippers SET faith_strength = ?, role = ? WHERE faith_id = ? AND actor_kind = ? AND actor_id = ?
  `).run(next, role, faithId, actorKind, actorId);
  return { faithStrength: next, role };
}

export function pray(db, faithId, actorKind, actorId) {
  if (!getWorshipper(db, faithId, actorKind, actorId)) return { ok: false, reason: "not_a_worshipper" };
  const r = bumpFervor(db, faithId, actorKind, actorId, FERVOR_STEP);
  if (!r) return { ok: false, reason: "no_worshipper_row" };
  logEvent(db, faithId, actorKind, actorId, "prayer");
  return { ok: true, ...r };
}

export function sermon(db, faithId, preacherKind, preacherId, options = {}) {
  const preacher = getWorshipper(db, faithId, preacherKind, preacherId);
  if (!preacher) return { ok: false, reason: "preacher_not_worshipper" };
  if (preacher.faith_strength < 0.5) return { ok: false, reason: "preacher_not_strong_enough" };
  const audienceSize = Math.max(1, Math.floor(Number(options.audienceSize) || 5));
  // Deterministic conversion outcome: charisma (caller-provided) scales
  // the recruitment count linearly. Tests can also override `recruited`
  // to pin behavior.
  const recruited = Number.isFinite(options.recruitedOverride)
    ? Number(options.recruitedOverride)
    : Math.max(0, Math.min(audienceSize, Math.floor(audienceSize * RECRUITMENT_AFFINITY_CAP * (preacher.faith_strength))));
  logEvent(db, faithId, preacherKind, preacherId, "sermon", null, { audienceSize, recruited });
  bumpFervor(db, faithId, preacherKind, preacherId, FERVOR_STEP * 1.5);
  return { ok: true, audienceSize, recruited };
}

export function convert(db, faithId, convertedActorKind, convertedActorId, preacherKind, preacherId) {
  const preacher = getWorshipper(db, faithId, preacherKind, preacherId);
  if (!preacher) return { ok: false, reason: "preacher_not_worshipper" };
  if (preacher.faith_strength < 0.4) return { ok: false, reason: "preacher_not_strong_enough" };
  const existing = getWorshipper(db, faithId, convertedActorKind, convertedActorId);
  if (existing) return { ok: true, alreadyWorshipper: true };
  // Leave other faiths first
  const others = listWorshippersForActor(db, convertedActorKind, convertedActorId);
  for (const o of others) {
    leave(db, o.faith_id, convertedActorKind, convertedActorId);
  }
  const j = join(db, faithId, convertedActorKind, convertedActorId);
  if (!j.ok) return j;
  logEvent(db, faithId, preacherKind, preacherId, "conversion", convertedActorId, {});
  return { ok: true, converted: true, fromFaithCount: others.length };
}

export function accuseHeresy(db, faithId, accuserKind, accuserId, targetActorKind, targetActorId) {
  const accuser = getWorshipper(db, faithId, accuserKind, accuserId);
  if (!accuser) return { ok: false, reason: "accuser_not_worshipper" };
  if (accuser.faith_strength < 0.6) return { ok: false, reason: "accuser_not_strong_enough" };
  const target = getWorshipper(db, faithId, targetActorKind, targetActorId);
  if (!target) return { ok: false, reason: "target_not_worshipper" };
  // Mark target as heretic role
  db.prepare(`
    UPDATE worshippers SET role = 'heretic' WHERE faith_id = ? AND actor_kind = ? AND actor_id = ?
  `).run(faithId, targetActorKind, targetActorId);
  logEvent(db, faithId, accuserKind, accuserId, "heresy_accusation", targetActorId, {});
  return { ok: true, targetActorId, accusationRecorded: true };
}

export function excommunicate(db, faithId, councilActorKind, councilActorId, targetActorKind, targetActorId) {
  const council = getWorshipper(db, faithId, councilActorKind, councilActorId);
  if (!council) return { ok: false, reason: "council_not_worshipper" };
  if (council.role !== "priest" && council.role !== "prophet") {
    return { ok: false, reason: "council_not_authorised" };
  }
  const r = leave(db, faithId, targetActorKind, targetActorId);
  logEvent(db, faithId, councilActorKind, councilActorId, "excommunication", targetActorId, {});
  return { ok: r.ok };
}

/* ───────── Cycle ───────────────────────────────────────────────────── */

/**
 * Per-cycle drain: faith_strength decays for worshippers who haven't
 * prayed/sermon'd in the last 24 hours. Stub-simple: scan recent
 * faith_events keyed by actor; any worshipper without a recent event
 * loses DECAY_STEP_PER_DAY.
 */
export function tickFaiths(db) {
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 86400;
  const lapsed = db.prepare(`
    SELECT w.faith_id, w.actor_kind, w.actor_id, w.faith_strength
    FROM worshippers w
    LEFT JOIN faith_events fe
      ON fe.faith_id = w.faith_id AND fe.actor_kind = w.actor_kind AND fe.actor_id = w.actor_id
       AND fe.event_kind IN ('prayer','sermon') AND fe.ts >= ?
    WHERE w.left_at IS NULL AND fe.id IS NULL
  `).all(oneDayAgo);
  let demoted = 0;
  for (const w of lapsed) {
    const next = Math.max(0, w.faith_strength - DECAY_STEP_PER_DAY);
    db.prepare(`
      UPDATE worshippers SET faith_strength = ? WHERE faith_id = ? AND actor_kind = ? AND actor_id = ?
    `).run(next, w.faith_id, w.actor_kind, w.actor_id);
    if (next < ROLE_THRESHOLDS.lay + 0.01) demoted++;
  }
  return { ok: true, lapsed: lapsed.length, demoted };
}

export function listRecentEvents(db, faithId, limit = 50) {
  return db.prepare(`
    SELECT id, faith_id, actor_kind, actor_id, event_kind, target_actor_id, payload_json, ts
    FROM faith_events
    WHERE faith_id = ?
    ORDER BY ts DESC LIMIT ?
  `).all(faithId, Math.max(1, Math.min(500, Number(limit) || 50)));
}

export const RELIGION_CONSTANTS = Object.freeze({
  FERVOR_STEP,
  DECAY_STEP_PER_DAY,
  ROLE_THRESHOLDS,
});
