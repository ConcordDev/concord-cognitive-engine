// server/lib/legitimacy.js
//
// Temperament P6 — the legitimacy rubric (Graham v. Connor 3-factor) + the ledger.
//
// Graham v. Connor (the US objective-reasonableness standard for use of force)
// scores force on three factors, judged from the moment of the encounter:
//   1. severity of the crime/threat at issue,
//   2. whether the subject poses an immediate threat,
//   3. whether the subject is actively resisting or evading.
//
// scoreEncounter folds those into a justified-force ceiling and a proportionality
// score; recordLegitimacyEvent persists the verdict to the P6 ledger (mig 319).
// This is the authoritative rubric the 2 CI gates pin; combat-restraint.js's
// assessForce is the fast in-tick approximation. Pure + guarded. Behind
// CONCORD_TEMPERAMENT for writes; scoreEncounter is pure and always callable.

import crypto from "crypto";

const FORCE_RANK = Object.freeze({ none: 0, nonlethal: 1, lethal: 2 });
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const b01 = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : clamp01(num(v, 0)));

/**
 * Score a use-of-force encounter on the Graham 3-factor test.
 * @param {object} e
 * @param {number|boolean} e.crimeSeverity     0..1 (or bool)
 * @param {number|boolean} e.immediateThreat   0..1 (or bool)
 * @param {number|boolean} e.activeResistance  0..1 (or bool)
 * @param {'none'|'nonlethal'|'lethal'} e.forceUsed
 * @param {boolean} [e.warned]
 * @returns {{verdict:'legitimate'|'excessive'|'unlawful', score:number, justifiedCeiling:string, factors:object, reasons:string[]}}
 */
export function scoreEncounter({ crimeSeverity = 0, immediateThreat = 0, activeResistance = 0, forceUsed = "none", warned = false } = {}) {
  const f = { crimeSeverity: b01(crimeSeverity), immediateThreat: b01(immediateThreat), activeResistance: b01(activeResistance) };
  const used = FORCE_RANK[forceUsed] != null ? forceUsed : "nonlethal";
  const reasons = [];

  // The Graham aggregate (immediate threat weighted highest — it's the crux of
  // objective reasonableness).
  const graham = clamp01(f.immediateThreat * 0.5 + f.activeResistance * 0.3 + f.crimeSeverity * 0.2);

  // Justified ceiling: lethal only when there's a real immediate threat; nonlethal
  // when there's meaningful resistance/severity; otherwise none.
  let justifiedCeiling = "none";
  if (f.immediateThreat >= 0.5) justifiedCeiling = "lethal";
  else if (graham >= 0.25) justifiedCeiling = "nonlethal";

  let verdict = "legitimate";
  if (FORCE_RANK[used] > FORCE_RANK[justifiedCeiling]) {
    // Force exceeded what the encounter justified.
    verdict = (used === "lethal" && justifiedCeiling === "none") ? "unlawful" : "excessive";
    reasons.push(`force_exceeds_justified:${used}>${justifiedCeiling}`);
  } else if (used === "lethal" && !warned && f.immediateThreat < 0.8) {
    // Lethal force generally requires a warning where feasible (immediate, severe
    // threat excepted).
    verdict = "excessive";
    reasons.push("lethal_without_warning");
  }

  // Score: 1 when force ≤ justified; degrades by how many ranks it overshoots.
  const overshoot = Math.max(0, FORCE_RANK[used] - FORCE_RANK[justifiedCeiling]);
  const score = clamp01(1 - overshoot * 0.5 - (reasons.includes("lethal_without_warning") ? 0.25 : 0));

  return { verdict, score: Math.round(score * 1e4) / 1e4, justifiedCeiling, factors: f, graham: Math.round(graham * 1e4) / 1e4, reasons };
}

/**
 * Persist a legitimacy event. Accepts either an explicit verdict/score, or the
 * Graham factors (then it scores them). Guarded + kill-switched (writes only when
 * CONCORD_TEMPERAMENT is on; the table is optional).
 */
export function recordLegitimacyEvent(db, { worldId, actorId, npcId, kind, verdict, score, factors, combatState } = {}) {
  if (process.env.CONCORD_TEMPERAMENT !== "1") return { ok: false, reason: "disabled" };
  if (!db || !kind) return { ok: false, reason: "missing_inputs" };
  try {
    let v = verdict, s = score, f = factors;
    if (!v && f) { const sc = scoreEncounter(f); v = sc.verdict; s = sc.score; }
    // A kill on someone hors de combat is unlawful by definition.
    if (!v && (kind === "execute_hors_de_combat")) { v = "unlawful"; s = 0; }
    v = v || "excessive"; s = s == null ? 0 : clamp01(num(s, 0));
    const id = `leg_${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`INSERT INTO legitimacy_events (id, world_id, actor_id, npc_id, kind, verdict, score, factors_json) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, worldId || null, actorId || null, npcId || null, String(kind), v, s, JSON.stringify(f || { combatState }));
    return { ok: true, id, verdict: v, score: s };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/** An actor's legitimacy standing — excessive/unlawful ratio over recent events. */
export function legitimacyStanding(db, actorId, { limit = 100 } = {}) {
  if (!db || !actorId) return { ok: false, reason: "missing_inputs" };
  try {
    const rows = db.prepare(`SELECT verdict, score FROM legitimacy_events WHERE actor_id=? ORDER BY at DESC LIMIT ?`).all(String(actorId), limit);
    const n = rows.length;
    if (!n) return { ok: true, events: 0, excessiveRate: 0, unlawfulRate: 0, meanScore: 1 };
    const excessive = rows.filter((r) => r.verdict === "excessive").length;
    const unlawful = rows.filter((r) => r.verdict === "unlawful").length;
    const meanScore = rows.reduce((a, r) => a + num(r.score, 0), 0) / n;
    return { ok: true, events: n, excessiveRate: r4(excessive / n), unlawfulRate: r4(unlawful / n), meanScore: r4(meanScore) };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

function r4(n) { return Math.round(n * 1e4) / 1e4; }

export default scoreEncounter;
