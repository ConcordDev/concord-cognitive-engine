// server/lib/romance-engine.js
//
// Phase II Wave 25 — player romance / family / dynasty engine.
//
// Courtship lifecycle:
//   acquainted → courting → engaged → married
//   married → widowed (partner death) | estranged (separation)
//
// Affinity is a -1..+1 scalar updated by interaction. Courtship
// gating requires sustained positive interactions; engagement
// requires affinity > 0.7; marriage requires affinity > 0.85.
//
// Bloodline buffs: children inherit weighted-average of best parent's
// skills (deterministic 80% of best-parent skill at coming-of-age).
// On player death, heir succession cascades the skill snapshot.

import crypto from "node:crypto";
import { checkHeartEvent } from "./heart-events.js";

const COURT_AFFINITY_DELTA = 0.05;
const ENGAGE_THRESHOLD     = 0.70;
const MARRY_THRESHOLD      = 0.85;
const PREGNANCY_DAYS       = 30;   // in-game days from conceive to birth
const ADOLESCENT_DAYS      = 90;
const ADULT_DAYS           = 180;
const SKILL_INHERITANCE_FRAC = 0.80;

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/* ───────── Courtship ───────────────────────────────────────────────── */

export function getCourtship(db, playerUserId, partnerKind, partnerId) {
  return db.prepare(`
    SELECT * FROM player_courtship WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
  `).get(playerUserId, partnerKind, partnerId) || null;
}

export function courtInteraction(db, playerUserId, partnerKind, partnerId, sentiment = 1) {
  if (!playerUserId || !partnerId) return { ok: false, reason: "missing_inputs" };
  const sentimentNum = Math.max(-1, Math.min(1, Number(sentiment) || 1));
  const existing = getCourtship(db, playerUserId, partnerKind, partnerId);
  const delta = COURT_AFFINITY_DELTA * sentimentNum;
  if (!existing) {
    db.prepare(`
      INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status)
      VALUES (?, ?, ?, ?, 'acquainted')
    `).run(playerUserId, partnerKind, partnerId, Math.max(-1, Math.min(1, delta)));
    return { ok: true, affinity: delta, status: "acquainted", new: true };
  }
  let next = Math.max(-1, Math.min(1, existing.affinity + delta));
  let status = existing.status;
  // H3 — fire an authored heart-event scene when this interaction crosses a
  // milestone threshold (once per milestone per partner). The scene's small
  // affinity bonus is folded in so the milestone beat feels earned.
  const heartEvent = checkHeartEvent(db, playerUserId, partnerKind, partnerId, existing.affinity, next);
  if (heartEvent?.affinityBonus) {
    next = Math.max(-1, Math.min(1, next + Number(heartEvent.affinityBonus)));
  }
  // Auto-promote toward courting at moderate affinity
  if (status === "acquainted" && next > 0.30) status = "courting";
  if (status === "courting" && next < 0)       status = "acquainted";
  db.prepare(`
    UPDATE player_courtship SET affinity = ?, status = ?, last_interaction = unixepoch()
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
  `).run(next, status, playerUserId, partnerKind, partnerId);
  return { ok: true, affinity: next, status, new: false, delta, heartEvent: heartEvent || null };
}

export function listMyCourtships(db, playerUserId, status = null) {
  return status
    ? db.prepare(`
        SELECT * FROM player_courtship WHERE player_user_id = ? AND status = ?
        ORDER BY last_interaction DESC LIMIT 200
      `).all(playerUserId, status)
    : db.prepare(`
        SELECT * FROM player_courtship WHERE player_user_id = ?
        ORDER BY last_interaction DESC LIMIT 200
      `).all(playerUserId);
}

/* ───────── Engagement + marriage ───────────────────────────────────── */

export function propose(db, playerUserId, partnerKind, partnerId) {
  const c = getCourtship(db, playerUserId, partnerKind, partnerId);
  if (!c) return { ok: false, reason: "no_courtship" };
  if (c.affinity < ENGAGE_THRESHOLD) return { ok: false, reason: "affinity_too_low", required: ENGAGE_THRESHOLD, got: c.affinity };
  if (c.status === "married") return { ok: false, reason: "already_married" };
  db.prepare(`
    UPDATE player_courtship SET status = 'engaged', last_interaction = unixepoch()
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
  `).run(playerUserId, partnerKind, partnerId);
  return { ok: true, status: "engaged" };
}

export function wed(db, playerUserId, partnerKind, partnerId) {
  const c = getCourtship(db, playerUserId, partnerKind, partnerId);
  if (!c) return { ok: false, reason: "no_courtship" };
  if (c.status !== "engaged") return { ok: false, reason: "not_engaged" };
  if (c.affinity < MARRY_THRESHOLD) return { ok: false, reason: "affinity_too_low", required: MARRY_THRESHOLD, got: c.affinity };
  const marriageId = uid("marriage");
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO player_marriages (id, player_user_id, partner_kind, partner_id)
      VALUES (?, ?, ?, ?)
    `).run(marriageId, playerUserId, partnerKind, partnerId);
    db.prepare(`
      UPDATE player_courtship SET status = 'married', last_interaction = unixepoch()
      WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
    `).run(playerUserId, partnerKind, partnerId);
  });
  tx();
  return { ok: true, marriageId, status: "married" };
}

export function dissolveMarriage(db, marriageId, reason = "estranged") {
  const m = db.prepare("SELECT * FROM player_marriages WHERE id = ?").get(marriageId);
  if (!m) return { ok: false, reason: "marriage_not_found" };
  if (m.dissolved_at) return { ok: false, reason: "already_dissolved" };
  db.prepare(`
    UPDATE player_marriages SET dissolved_at = unixepoch(), dissolved_reason = ?
    WHERE id = ?
  `).run(String(reason), marriageId);
  // Knock the courtship status to widowed (death) or estranged
  const courtStatus = reason === "widowed" ? "widowed" : "estranged";
  db.prepare(`
    UPDATE player_courtship SET status = ?, last_interaction = unixepoch()
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
  `).run(courtStatus, m.player_user_id, m.partner_kind, m.partner_id);
  return { ok: true, dissolvedReason: reason, courtStatus };
}

export function listMyMarriages(db, playerUserId, activeOnly = true) {
  return activeOnly
    ? db.prepare("SELECT * FROM player_marriages WHERE player_user_id = ? AND dissolved_at IS NULL ORDER BY married_at DESC").all(playerUserId)
    : db.prepare("SELECT * FROM player_marriages WHERE player_user_id = ? ORDER BY married_at DESC LIMIT 50").all(playerUserId);
}

/* ───────── Pregnancy + birth ───────────────────────────────────────── */

export function conceive(db, carrierUserId, partnerKind, partnerId) {
  const married = db.prepare(`
    SELECT 1 FROM player_marriages
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ? AND dissolved_at IS NULL
  `).get(carrierUserId, partnerKind, partnerId);
  if (!married) return { ok: false, reason: "must_be_married_to_conceive" };
  const active = db.prepare(`
    SELECT 1 FROM player_pregnancies WHERE carrier_user_id = ? AND born_at IS NULL
  `).get(carrierUserId);
  if (active) return { ok: false, reason: "already_pregnant" };
  const id = uid("preg");
  const now = Math.floor(Date.now() / 1000);
  const dueAt = now + PREGNANCY_DAYS * 86400;
  db.prepare(`
    INSERT INTO player_pregnancies (id, carrier_user_id, partner_kind, partner_id, due_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, carrierUserId, partnerKind, partnerId, dueAt);
  return { ok: true, pregnancyId: id, dueAt };
}

export function birthChild(db, pregnancyId, options = {}) {
  const p = db.prepare("SELECT * FROM player_pregnancies WHERE id = ?").get(pregnancyId);
  if (!p) return { ok: false, reason: "pregnancy_not_found" };
  if (p.born_at) return { ok: false, reason: "already_born" };
  const childId = uid("child");
  const name = String(options.name || `Heir-${childId.slice(-4)}`).slice(0, 80);
  const inheritedSkills = options.parentSkills ? inheritSkills(options.parentSkills) : {};
  const personality = options.personality || {};
  db.prepare(`
    INSERT INTO player_children
      (id, parent_user_id, other_parent_kind, other_parent_id, name,
       inherited_skills_json, personality_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    childId, p.carrier_user_id, p.partner_kind, p.partner_id, name,
    JSON.stringify(inheritedSkills), JSON.stringify(personality),
  );
  db.prepare("UPDATE player_pregnancies SET born_at = unixepoch() WHERE id = ?").run(pregnancyId);
  return { ok: true, childId, name, inheritedSkills };
}

function inheritSkills(parentSkillsByPerson) {
  // parentSkillsByPerson: { parentA: { skillKey: level }, parentB: { ... } }
  const merged = {};
  const all = Object.values(parentSkillsByPerson || {}).filter(Boolean);
  for (const parent of all) {
    for (const [skill, level] of Object.entries(parent || {})) {
      const candidate = Number(level) * SKILL_INHERITANCE_FRAC;
      if (!merged[skill] || candidate > merged[skill]) merged[skill] = candidate;
    }
  }
  return merged;
}

export function listChildren(db, parentUserId) {
  return db.prepare(`
    SELECT * FROM player_children WHERE parent_user_id = ? ORDER BY born_at DESC LIMIT 50
  `).all(parentUserId);
}

export function advanceChildMaturity(db, childId) {
  const c = db.prepare("SELECT * FROM player_children WHERE id = ?").get(childId);
  if (!c) return { ok: false, reason: "child_not_found" };
  const ageDays = Math.floor((Math.floor(Date.now() / 1000) - c.born_at) / 86400);
  let maturity = "infant";
  if (ageDays >= ADULT_DAYS) maturity = "adult";
  else if (ageDays >= ADOLESCENT_DAYS) maturity = "adolescent";
  else if (ageDays >= 30) maturity = "child";
  db.prepare(`
    UPDATE player_children SET age_days = ?, maturity = ? WHERE id = ?
  `).run(ageDays, maturity, childId);
  return { ok: true, childId, maturity, ageDays };
}

/* ───────── Heir succession (called from npc-legacy player path) ───── */

export function selectHeir(db, deceasedUserId) {
  // Among children, prefer 'adult' > 'adolescent' > 'child'; tiebreak by birth order
  const children = listChildren(db, deceasedUserId);
  const maturityRank = { adult: 3, adolescent: 2, child: 1, infant: 0 };
  const sorted = children
    .map((c) => ({ ...c, rank: maturityRank[c.maturity] || 0 }))
    .sort((a, b) => b.rank - a.rank || a.born_at - b.born_at);
  return sorted[0] || null;
}

export const ROMANCE_CONSTANTS = Object.freeze({
  COURT_AFFINITY_DELTA,
  ENGAGE_THRESHOLD,
  MARRY_THRESHOLD,
  PREGNANCY_DAYS,
  ADOLESCENT_DAYS,
  ADULT_DAYS,
  SKILL_INHERITANCE_FRAC,
});
