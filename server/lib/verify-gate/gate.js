// server/lib/verify-gate/gate.js
//
// Decide what a candidate (theory / hypothesis / mega / hyper) is worth, from its claims' check results.
//   REFUTED     any claim was shown false -> not stored as knowledge (rejected log only)
//   PENDING     a checker was unavailable for a checkable claim and nothing is refuted -> stays pending
//   VERIFIED    at least one checkable claim, every checkable claim verified, none unchecked/failed -> may be mega/hyper
//   PARTIAL     some verified, some failed/unchecked -> stays a hypothesis tier, unverified claims listed, not promoted
//   UNTESTABLE  nothing checkable (only speculative/narrative) -> a labeled speculative note, never mega/hyper, never fact
// The receipt records every claim, its checker and result, so a demotion can always be explained.

import { createHash } from "node:crypto";
import { extractClaims } from "./claims.js";
import { checkClaim } from "./checkers.js";

export const OUTCOMES = Object.freeze(["VERIFIED", "PARTIAL", "REFUTED", "UNTESTABLE", "PENDING"]);
export const GATE_VERSION = "1.0.0";

export function decideOutcome(results) {
  const checkable = results.filter((r) => r.result !== "n/a");
  if (results.some((r) => r.result === "refuted")) return "REFUTED";
  if (!checkable.length) return "UNTESTABLE";
  if (checkable.some((r) => r.result === "pending")) return "PENDING";
  const verified = checkable.filter((r) => r.result === "verified").length;
  if (verified === checkable.length) return "VERIFIED";
  if (verified === 0 && checkable.every((r) => r.result === "unchecked")) return "UNTESTABLE";
  return "PARTIAL";
}

/**
 * @param {{ id?: string, title?: string, body: string, tier?: string }} candidate
 * @param {object} deps injected checkers' dependencies (see checkers.js), plus now()
 */
export async function verifyCandidate(candidate, deps = {}) {
  const now = deps.now || Date.now;
  const startedAt = now();
  const claims = extractClaims(`${candidate.title ? `${candidate.title}. ` : ""}${candidate.body || ""}`);
  const results = [];
  for (const claim of claims) {
    results.push(await checkClaim(claim, deps));
    if (typeof deps.yieldNow === "function") await deps.yieldNow(); // never hold the event loop across claims
  }
  const outcome = decideOutcome(results);
  const unverified = results.filter((r) => r.result !== "verified" && r.result !== "n/a").map((r) => ({ claimId: r.claimId, result: r.result, detail: r.detail }));
  const receipt = {
    version: GATE_VERSION,
    candidateId: candidate.id || null,
    outcome,
    claims: results.map((r) => ({ ...r, text: claims.find((c) => c.id === r.claimId)?.text })),
    unverified,
    checkedAt: new Date(startedAt).toISOString(),
    elapsedMs: now() - startedAt,
    bodyHash: createHash("sha256").update(String(candidate.body || "")).digest("hex"),
  };
  return { outcome, receipt };
}
