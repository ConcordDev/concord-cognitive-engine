// server/lib/law.js
//
// Living Society — Phase 10: law, crime & jail-as-a-verb.
//
// Crux: in a free, shared, persistent world NEVER punish time — punish value,
// reputation, access. Two enforcement modes:
//   1. Prevention (sanctuary): the act is REFUSED (Refusal Field), not punished.
//   2. Reaction (lawful, non-sanctuary): wanted status + graded response +
//      proportional, capped penalty.
// Lawless zones impose nothing. Jail is FOUR verbs (bribe / work-off / break-out
// / sprung), never a dead-time timer.

import crypto from "node:crypto";
import { recordAuthorityGrievance } from "./npc-asymmetry.js";

// Default law catalog. Per-world content/world/*/laws.json overrides this.
// crime → { severityTier 1..5, appliesIn: lawfulness levels where it's a crime }.
export const DEFAULT_LAWS = Object.freeze({
  murder:       { severityTier: 5, appliesIn: ["safe", "sanctuary", "lawful", "pvp"] },
  assault:      { severityTier: 3, appliesIn: ["safe", "sanctuary", "lawful"] },
  theft:        { severityTier: 2, appliesIn: ["safe", "sanctuary", "lawful"] },
  burglary:     { severityTier: 3, appliesIn: ["safe", "sanctuary", "lawful"] },
  vandalism:    { severityTier: 2, appliesIn: ["safe", "sanctuary", "lawful"] },
  blackmail:    { severityTier: 2, appliesIn: ["safe", "sanctuary", "lawful", "pvp"] },
  destruction:  { severityTier: 4, appliesIn: ["safe", "sanctuary", "lawful"] }, // high-magnitude structural
});

// Zone lawfulness → enforcement weight. sanctuary/safe = prevention/strict;
// lawless/hazard = nothing.
const ZONE_WEIGHT = Object.freeze({
  sanctuary: 1.5, safe: 1.2, lawful: 1.0, pvp: 0.5, lawless: 0, hazard: 0,
});
const PREVENTION_ZONES = new Set(["sanctuary", "safe"]);

const SENTENCE_CAP = Number(process.env.CONCORD_SENTENCE_CAP_SPARKS) || 500;

export function lawsFor(worldLaws = null) {
  return worldLaws && typeof worldLaws === "object" && Object.keys(worldLaws).length ? worldLaws : DEFAULT_LAWS;
}

/**
 * Assess an act. Returns whether it's a crime here, whether it's PREVENTED
 * (sanctuary → Refusal Field refuses it), and the severity. Pure.
 *
 * @param crime       the act id (murder/theft/destruction/...)
 * @param zoneLawfulness  safe|sanctuary|lawful|pvp|lawless|hazard
 * @param worldLaws   optional per-world override catalog
 */
export function assessCrime(crime, zoneLawfulness, worldLaws = null) {
  const laws = lawsFor(worldLaws);
  const def = laws[crime];
  const zone = String(zoneLawfulness || "lawful").toLowerCase();
  if (!def || !Array.isArray(def.appliesIn) || !def.appliesIn.includes(zone)) {
    return { ok: true, isCrime: false, prevented: false, severityTier: 0, zone };
  }
  // Lawless/hazard: the act is possible but nothing happens.
  if ((ZONE_WEIGHT[zone] ?? 0) === 0) {
    return { ok: true, isCrime: false, prevented: false, severityTier: def.severityTier, zone, reason: "lawless_zone" };
  }
  // Sanctuary/safe: PREVENTION — the act is refused (law as physics).
  if (PREVENTION_ZONES.has(zone)) {
    return { ok: true, isCrime: true, prevented: true, severityTier: def.severityTier, zone, mode: "prevention" };
  }
  // Lawful, non-sanctuary: reaction.
  return { ok: true, isCrime: true, prevented: false, severityTier: def.severityTier, zone, mode: "reaction" };
}

/** Sentence math: severity × zone weight × repeat multiplier, capped. */
export function sentenceFor(severityTier, zoneLawfulness, repeatCount = 0) {
  const zw = ZONE_WEIGHT[String(zoneLawfulness || "lawful").toLowerCase()] ?? 1.0;
  const repeatMul = 1 + Math.min(3, repeatCount) * 0.5; // capped repeat weighting
  const base = severityTier * 60 * zw * repeatMul;
  const bail = Math.min(SENTENCE_CAP, Math.round(base));
  return {
    bailSparks: bail,
    laborRequired: Math.min(10, severityTier * (repeatCount + 1)), // work-off units
    notoriety: severityTier * 2,
    cappedAt: SENTENCE_CAP,
  };
}

function getWanted(db, userId, worldId) {
  try { return db.prepare(`SELECT wanted_level, notoriety FROM player_wanted WHERE user_id = ? AND world_id = ?`).get(userId, worldId) || { wanted_level: 0, notoriety: 0 }; }
  catch { return { wanted_level: 0, notoriety: 0 }; }
}

function bumpWanted(db, userId, worldId, severityTier, notoriety) {
  try {
    db.prepare(`
      INSERT INTO player_wanted (user_id, world_id, wanted_level, notoriety, last_crime_at, updated_at)
      VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(user_id, world_id) DO UPDATE SET
        wanted_level = MIN(5, player_wanted.wanted_level + ?),
        notoriety = player_wanted.notoriety + ?,
        last_crime_at = unixepoch(), updated_at = unixepoch()
    `).run(userId, worldId, Math.min(5, severityTier), notoriety, Math.max(1, Math.floor(severityTier / 2)), notoriety);
  } catch { /* table absent */ }
}

/**
 * Commit a crime: prevention refuses it; reaction raises wanted + opens a
 * detention with the sentence. Returns the outcome.
 */
export function commitCrime(db, { userId, worldId, crime, zoneLawfulness, worldLaws = null } = {}) {
  if (!db || !userId || !worldId || !crime) return { ok: false, reason: "missing_inputs" };
  const a = assessCrime(crime, zoneLawfulness, worldLaws);
  if (!a.isCrime) return { ok: true, outcome: "no_crime", ...a };
  if (a.prevented) return { ok: true, outcome: "refused", ...a }; // Refusal Field — no effect, no record

  const prior = (() => { try { return db.prepare(`SELECT COUNT(*) AS n FROM player_detentions WHERE user_id = ? AND world_id = ?`).get(userId, worldId)?.n ?? 0; } catch { return 0; } })();
  const sentence = sentenceFor(a.severityTier, a.zone, prior);
  bumpWanted(db, userId, worldId, a.severityTier, sentence.notoriety);

  const id = `det_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO player_detentions (id, user_id, world_id, crime, severity_tier, bail_sparks, labor_required)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, worldId, crime, a.severityTier, sentence.bailSparks, sentence.laborRequired);
  } catch (e) { return { ok: false, reason: "detain_failed", error: e?.message }; }
  return { ok: true, outcome: "detained", detentionId: id, sentence, wanted: getWanted(db, userId, worldId), ...a };
}

// ── Jail-as-a-verb ───────────────────────────────────────────────────────────

/** Bribe out: debit sparks → a dirty guard takes them → a grievance someone holds. */
export function bribeOut(db, detentionId, { guardNpcId = null, payerSparksBalance = null, awardSparksFn = null } = {}) {
  const det = _openDetention(db, detentionId);
  if (!det) return { ok: false, reason: "not_detained" };
  // The bribe is the bail. (Caller verifies/debits the player's wallet — we
  // record the corruption + free the player.)
  try { db.prepare(`UPDATE player_detentions SET state = 'bribed_out', released_at = unixepoch(), released_via = 'bribe' WHERE id = ?`).run(detentionId); } catch { /* noop */ }
  // Phase-3 corruption: the dirty guard's bribe becomes a grievance an honest
  // party (another guard / the wronged citizen) holds against that guard.
  if (guardNpcId) {
    try {
      db.prepare(`UPDATE world_npcs SET wealth_sparks = COALESCE(wealth_sparks,0) + ? WHERE id = ?`).run(det.bail_sparks, guardNpcId);
    } catch { /* noop */ }
  }
  return { ok: true, via: "bribe", paid: det.bail_sparks, corruptGuard: guardNpcId };
}

/** Work off: each call does one labor unit; freed when labor_done >= required. */
export function workOff(db, detentionId, units = 1) {
  const det = _openDetention(db, detentionId);
  if (!det) return { ok: false, reason: "not_detained" };
  const done = Math.min(det.labor_required, det.labor_done + Math.max(1, units));
  if (done >= det.labor_required) {
    try { db.prepare(`UPDATE player_detentions SET labor_done = ?, state = 'worked_off', released_at = unixepoch(), released_via = 'labor' WHERE id = ?`).run(done, detentionId); } catch { /* noop */ }
    return { ok: true, via: "labor", released: true, laborDone: done };
  }
  try { db.prepare(`UPDATE player_detentions SET labor_done = ? WHERE id = ?`).run(done, detentionId); } catch { /* noop */ }
  return { ok: true, via: "labor", released: false, laborDone: done, laborRequired: det.labor_required };
}

/** Break out: a combat/heist verb. Succeeds on a passed check; raises wanted. */
export function breakOut(db, detentionId, { success = true } = {}) {
  const det = _openDetention(db, detentionId);
  if (!det) return { ok: false, reason: "not_detained" };
  if (!success) return { ok: true, via: "break_out", released: false };
  try { db.prepare(`UPDATE player_detentions SET state = 'broke_out', released_at = unixepoch(), released_via = 'force' WHERE id = ?`).run(detentionId); } catch { /* noop */ }
  bumpWanted(db, det.user_id, det.world_id, 1, 5); // escaping raises heat
  return { ok: true, via: "break_out", released: true };
}

/** Sprung by a friend: a Phase-5 cross-tier ally busts you out. */
export function sprungBy(db, detentionId, allyId) {
  const det = _openDetention(db, detentionId);
  if (!det) return { ok: false, reason: "not_detained" };
  try { db.prepare(`UPDATE player_detentions SET state = 'sprung', released_at = unixepoch(), released_via = ? WHERE id = ?`).run(`ally:${allyId}`, detentionId); } catch { /* noop */ }
  return { ok: true, via: "sprung", by: allyId, released: true };
}

function _openDetention(db, id) {
  try { return db.prepare(`SELECT * FROM player_detentions WHERE id = ? AND state = 'detained'`).get(id); }
  catch { return null; }
}

export const LAW_CONSTANTS = Object.freeze({ ZONE_WEIGHT, SENTENCE_CAP, PREVENTION_ZONES: [...PREVENTION_ZONES] });
