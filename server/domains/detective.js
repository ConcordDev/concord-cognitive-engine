// server/domains/detective.js
//
// Macro surface for the `/lenses/detective` deduction board, named to match
// the lens + its `detective.*` manifest entry.
//
// This is a THIN delegation layer over the real engine (server/lib/detective.js)
// and adds NO gameplay logic of its own. The open-crime listing, evidence
// fetch, the Obra-Dinn lock-in scoring (2-of-3 correct WITH a suspect_match
// hard-constraint to resolve a case), the trial_records audit row and the
// investigation-loot spawn all live in the lib; this file only adapts
// (ctx, input) → lib calls and pins the auth/db guards.
//
// The four HTTP routes the board already calls (/api/detective/open/:world,
// /api/detective/crime/:id/evidence, /api/detective/crime/:id/deduce,
// /api/detective/mine) share this same lib — both surfaces are one source of
// truth. These macros give the board a runMacro path (and make the
// ManifestActionBar "Deduce" verb resolve to a registered macro instead of a
// dangling lens.detective.* id).

import {
  listOpenCrimes,
  listEvidenceForCrime,
  getCrimeWithEvidence,
  lockInDeduction,
  getDeductionsByUser,
} from "../lib/detective.js";

function clampLimit(n, def = 50) {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.max(1, Math.min(200, Math.floor(v)));
}

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) before reading —
// a fail-OPEN that clamps a poisoned `limit` through to ok:true is the defect.
// An absent field is fine. Returns null when clean, or the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

export default function registerDetectiveMacros(register) {
  /**
   * detective.list — open cases for a world (read).
   * input: { worldId, limit? }
   */
  register("detective", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    const worldId = input?.worldId ? String(input.worldId) : null;
    if (!worldId) return { ok: false, reason: "missing_world" };
    return { ok: true, crimes: listOpenCrimes(db, worldId, clampLimit(input.limit)) };
  }, { note: "list open crime cases for a world (Obra-Dinn board)" });

  /**
   * detective.get — a single case + its collected evidence (read).
   * Never leaks the culprit (criminal_id is not selected by the lib).
   * input: { crimeId }
   */
  register("detective", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input?.crimeId) return { ok: false, reason: "missing_inputs" };
    const found = getCrimeWithEvidence(db, String(input.crimeId));
    if (!found) return { ok: false, reason: "no_crime" };
    return { ok: true, crime: found.crime, evidence: found.evidence };
  }, { note: "fetch one case + evidence (no culprit leak)" });

  /**
   * detective.evidence — evidence list for one case (read).
   * input: { crimeId }
   */
  register("detective", "evidence", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input?.crimeId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, evidence: listEvidenceForCrime(db, String(input.crimeId)) };
  }, { note: "evidence items for a case" });

  /**
   * detective.deduce — lock in (suspect, weapon, motive). 2-of-3 correct
   * WITH suspect_match required resolves the case. Otherwise records a
   * deduction attempt and the case stays open. (Aliased as `create` so the
   * lens manifest's dtu/create-shaped surface resolves to a real macro.)
   * input: { crimeId, suspectId, weapon?, motive? }
   */
  const deduce = async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.crimeId) return { ok: false, reason: "missing_inputs" };
    if (!input?.suspectId) return { ok: false, error: "missing_suspect" };
    return lockInDeduction(db, userId, String(input.crimeId), {
      suspectId: String(input.suspectId),
      weapon: input.weapon != null ? String(input.weapon) : undefined,
      motive: input.motive != null ? String(input.motive) : undefined,
    });
  };
  register("detective", "deduce", deduce, { note: "lock in a deduction (2-of-3 + suspect_match solves)" });
  register("detective", "create", deduce, { note: "alias of deduce — a deduction is the lens's artifact" });

  /**
   * detective.mine — the caller's deduction history (read).
   * input: { limit? }
   */
  register("detective", "mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, deductions: getDeductionsByUser(db, userId, clampLimit(input.limit, 20)) };
  }, { note: "the caller's deduction / verdict history" });
}
