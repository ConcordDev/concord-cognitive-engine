// server/lib/culture-friction.js
//
// Concordia Phase 13 — cultural friction + marriage.
//
// Lookups:
//   - getCulture(db, actorKind, actorId)
//   - setCulture(db, actorKind, actorId, culture_id, faith_id?)
//   - getFriction(db, cultureA, cultureB) — sorted-pair-safe
//   - opinionFrictionDelta(db, attackerKind, attackerId, targetKind, targetId)
//     → integer delta to add to a positive opinion event (negative if
//       the cultures are hostile).
//
// Marriage:
//   - marry(db, partnerA, partnerB) — single active marriage per
//     partner; returns marriage id. Sorted-pair invariant: the
//     ordered (a, b) form is the canonical form.
//   - listMarriagesFor(db, actorKind, actorId)
//   - dissolveMarriage(db, marriageId, reason)

import crypto from "node:crypto";

function sortPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function setCulture(db, actorKind, actorId, culture_id, faith_id = null) {
  if (!db || !actorKind || !actorId || !culture_id) return { ok: false, reason: "missing_inputs" };
  if (!["player", "npc"].includes(actorKind)) return { ok: false, reason: "bad_actor_kind" };
  try {
    db.prepare(`
      INSERT INTO actor_culture (actor_kind, actor_id, culture_id, faith_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(actor_kind, actor_id) DO UPDATE
        SET culture_id = excluded.culture_id, faith_id = excluded.faith_id
    `).run(actorKind, actorId, culture_id, faith_id || null);
    return { ok: true, action: "set" };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getCulture(db, actorKind, actorId) {
  if (!db || !actorKind || !actorId) return null;
  try {
    return db.prepare(`
      SELECT actor_kind, actor_id, culture_id, faith_id, established_at
      FROM actor_culture WHERE actor_kind = ? AND actor_id = ?
    `).get(actorKind, actorId) || null;
  } catch { return null; }
}

export function getFriction(db, cultureA, cultureB) {
  if (!db || !cultureA || !cultureB) return 0;
  if (cultureA === cultureB) return 0;
  const [a, b] = sortPair(cultureA, cultureB);
  try {
    const r = db.prepare(`SELECT friction FROM culture_relations WHERE culture_a = ? AND culture_b = ?`).get(a, b);
    return r?.friction ?? 0;
  } catch { return 0; }
}

export function setFriction(db, cultureA, cultureB, friction) {
  if (!db || !cultureA || !cultureB) return { ok: false, reason: "missing_inputs" };
  if (cultureA === cultureB) return { ok: false, reason: "self_pair" };
  const [a, b] = sortPair(cultureA, cultureB);
  const f = Math.max(-1, Math.min(1, Number(friction) || 0));
  try {
    db.prepare(`
      INSERT INTO culture_relations (culture_a, culture_b, friction)
      VALUES (?, ?, ?)
      ON CONFLICT(culture_a, culture_b) DO UPDATE
        SET friction = excluded.friction, updated_at = unixepoch()
    `).run(a, b, f);
    return { ok: true, action: "set", friction: f };
  } catch { return { ok: false, reason: "insert_failed" }; }
}

/**
 * For opinion event modulation. Given attacker + target identities,
 * returns an integer delta that should be ADDED to the baseline
 * opinion event. Negative friction → hostile cultures → -5; positive
 * friction → friendly cultures → +5; zero friction → 0.
 *
 * The integer delta is rounded so callers can directly add it to a
 * baseline score change.
 */
export function opinionFrictionDelta(db, attackerKind, attackerId, targetKind, targetId) {
  const a = getCulture(db, attackerKind, attackerId);
  const b = getCulture(db, targetKind, targetId);
  if (!a || !b) return 0;
  const f = getFriction(db, a.culture_id, b.culture_id);
  return Math.round(f * 10);
}

function makeMarriageId() {
  return `mar_${crypto.randomUUID().slice(0, 16)}`;
}

export function marry(db, partnerA, partnerB) {
  if (!db || !partnerA?.kind || !partnerA?.id || !partnerB?.kind || !partnerB?.id) return { ok: false, reason: "missing_inputs" };
  if (partnerA.kind === partnerB.kind && partnerA.id === partnerB.id) return { ok: false, reason: "self_marriage" };

  // Canonical sort: by composite (kind|id) string ascending.
  const ka = `${partnerA.kind}|${partnerA.id}`;
  const kb = `${partnerB.kind}|${partnerB.id}`;
  const [first, second] = ka < kb ? [partnerA, partnerB] : [partnerB, partnerA];

  // No active marriage allowed for either partner.
  const existing = db.prepare(`
    SELECT id FROM marriages
    WHERE status = 'active' AND (
      (partner_a_kind = ? AND partner_a_id = ?) OR (partner_b_kind = ? AND partner_b_id = ?) OR
      (partner_a_kind = ? AND partner_a_id = ?) OR (partner_b_kind = ? AND partner_b_id = ?)
    )
    LIMIT 1
  `).get(first.kind, first.id, first.kind, first.id, second.kind, second.id, second.kind, second.id);
  if (existing) return { ok: false, reason: "already_married", marriage_id: existing.id };

  const id = makeMarriageId();
  try {
    db.prepare(`
      INSERT INTO marriages (id, partner_a_kind, partner_a_id, partner_b_kind, partner_b_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, first.kind, first.id, second.kind, second.id);
    return { ok: true, action: "married", marriage_id: id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listMarriagesFor(db, actorKind, actorId, { activeOnly = true } = {}) {
  if (!db || !actorKind || !actorId) return [];
  try {
    const stmt = activeOnly
      ? db.prepare(`
          SELECT * FROM marriages
          WHERE status = 'active'
            AND ((partner_a_kind = ? AND partner_a_id = ?) OR (partner_b_kind = ? AND partner_b_id = ?))
        `)
      : db.prepare(`
          SELECT * FROM marriages
          WHERE (partner_a_kind = ? AND partner_a_id = ?) OR (partner_b_kind = ? AND partner_b_id = ?)
        `);
    return stmt.all(actorKind, actorId, actorKind, actorId);
  } catch { return []; }
}

export function dissolveMarriage(db, marriageId, reason = "divorced") {
  if (!db || !marriageId) return { ok: false, reason: "missing_inputs" };
  const status = reason === "widowed" ? "widowed" : "divorced";
  const r = db.prepare(`
    UPDATE marriages
    SET status = ?, ended_at = unixepoch(), end_reason = ?
    WHERE id = ? AND status = 'active'
  `).run(status, reason, marriageId);
  if (r.changes === 0) return { ok: false, reason: "not_active" };
  return { ok: true, action: "dissolved", status };
}

export const CULTURE_CONSTANTS = Object.freeze({
  // exposed for tests
});
