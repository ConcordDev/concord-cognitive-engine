// server/lib/conkay/knowledge/connectors/review.js
//
// Contradiction checks across the claims the connectors produce, and the
// review queue. Nothing here resolves a conflict: conflicting, uncertain or
// incomplete records are queued for a person, with every candidate and where
// it came from. The only selection rule is stated and narrow (selectReference):
// at the exact state asked for, a NIST reference-equation value with a stated
// uncertainty is the value used for computation, and the other sources become
// cross-checks; anything they disagree on stays in the queue.
//
// Each value's interval is value ± max(stated uncertainty, printed precision).
// Two values conflict when their intervals do not overlap.

import { makeClaim } from "../claims.js";
import { sha256 } from "./fetcher.js";

export const REVIEW_VERSION = "1.0.0";
export const REVIEW_DECISION = "pending_human_review";

export function interval(c) {
  if (c.range) return { lo: c.range.min, hi: c.range.max };
  const v = c.value;
  if (typeof v !== "number") return null;
  let h = 0;
  const u = c.uncertainty;
  if (u?.type === "range") h = Math.max(v - u.low, u.high - v);
  else if (u?.type === "pct") h = Math.abs(v) * u.value / 100;
  else if (u?.type === "stddev" || u?.type === "expanded") h = u.value * (u.coverageFactor || 1);
  return { lo: v - h, hi: v + h };
}

const sameState = (a, b, { tolK = 0.01, tolPa = 2000 } = {}) => {
  const ta = a.conditions?.temperature, tb = b.conditions?.temperature;
  const pa = a.conditions?.pressure, pb = b.conditions?.pressure;
  if (ta != null && tb != null && Math.abs(ta - tb) > tolK) return false;
  if (pa != null && pb != null && Math.abs(pa - pb) > tolPa) return false;
  return true;
};

/** Group numeric claims of one subject/property whose states match (temperature within 10 mK and pressure where both state them). */
export function groupComparable(claims) {
  const groups = [];
  for (const c of claims) {
    // a value whose required conditions are missing is queued as such, and is not compared (it has no state to match)
    if (!c.property || !interval(c) || c.missingConditions?.length) continue;
    const g = groups.find((x) => x.subject === c.subject && x.property === c.property && x.method === (c.conditions?.method || null) && x.claims.every((y) => sameState(y, c)));
    if (g) g.claims.push(c);
    else groups.push({ subject: c.subject, property: c.property, method: c.conditions?.method || null, claims: [c] });
  }
  return groups;
}

const loc = (c) => c.evidence?.[0]?.locator || c.id;

/** Conflicts and missing conditions -> review items (never a chosen winner). */
export function checkClaims(claims) {
  const reviews = [];
  for (const g of groupComparable(claims)) {
    if (g.claims.length < 2) continue;
    const iv = g.claims.map((c) => ({ c, ...interval(c) }));
    const pairs = [];
    for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length; j++) if (iv[i].hi < iv[j].lo || iv[j].hi < iv[i].lo) pairs.push([iv[i].c.id, iv[j].c.id]);
    if (pairs.length) {
      const lo = Math.min(...iv.map((x) => x.lo)), hi = Math.max(...iv.map((x) => x.hi));
      reviews.push({
        kind: "conflict", subject: g.subject, property: g.property, method: g.method,
        reason: `${g.claims.length} values for ${g.property}${g.method ? ` (${g.method})` : ""} at the same state do not all agree within their stated uncertainty / printed precision (span ${lo.toPrecision(5)} to ${hi.toPrecision(5)} ${g.claims[0].unit}; ${pairs.length} disagreeing pair(s))`,
        candidates: g.claims.map((c) => ({ claim: c.id, value: c.value ?? c.range, unit: c.unit, conditions: c.conditions, source: c.attributedTo || c.evidence?.[0]?.sourceId, locator: loc(c) })),
        disagreeing: pairs, decision: REVIEW_DECISION,
      });
    }
  }
  for (const c of claims) {
    if (c.missingConditions?.length) reviews.push({ kind: "missing_conditions", subject: c.subject, property: c.property, claim: c.id, reason: `the source does not state: ${c.missingConditions.join(", ")}`, locator: loc(c), decision: REVIEW_DECISION });
  }
  return reviews;
}

/** The NIST value at exactly this state (temperature within 1 mK), or null. */
export function selectReference(claims, subject, property, tK) {
  const hits = claims.filter((c) => c.subject === subject && c.property === property && c.evidence?.[0]?.sourceId === "nist_webbook" && Math.abs((c.conditions?.temperature ?? NaN) - tK) < 1e-3);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Cross-check source values against the reference values: relative densities are converted with the reference
 * water density at their own reference temperature (when NIST gives it), then compared with the reference
 * liquid density at their sample temperature. Returns { checks, reviews } (computed claims with receipts).
 */
export function crossCheckDensities(sourceClaims, referenceClaims, { water = "water" } = {}) {
  const checks = [], reviews = [];
  for (const c of sourceClaims.filter((x) => x.property === "relative_density" || x.property === "liquid_density" || x.flags?.includes("unit_not_stated"))) {
    const tK = c.conditions?.temperature;
    if (tK == null) { reviews.push({ kind: "not_checkable", subject: c.subject, claim: c.id, reason: "no temperature stated: cannot be compared with a reference value", locator: loc(c), decision: REVIEW_DECISION }); continue; }
    const ref = selectReference(referenceClaims, c.subject, "liquid_density", tK);
    if (!ref) { reviews.push({ kind: "not_checkable", subject: c.subject, claim: c.id, reason: `no reference density at ${tK} K`, locator: loc(c), decision: REVIEW_DECISION }); continue; }
    const readings = [];
    if (c.property === "relative_density") {
      const tr = c.conditions.reference_temperature;
      const w = tr != null ? selectReference(referenceClaims, water, "liquid_density", tr) : null;
      if (!w) { reviews.push({ kind: "not_checkable", subject: c.subject, claim: c.id, reason: tr == null ? "relative density without a stated water reference temperature" : `no reference water density at ${tr} K`, locator: loc(c), decision: REVIEW_DECISION }); continue; }
      readings.push({ as: `relative density x water density at ${tr} K (${w.value} kg/m3)`, value: c.value * w.value, half: (interval(c).hi - c.value) * w.value + c.value * (interval(w).hi - w.value) });
    } else if (c.property === "liquid_density") {
      readings.push({ as: "density as printed", value: c.value, half: interval(c).hi - c.value });
    } else {
      // unit not stated: show what each reading would mean; neither is adopted
      const n = Number(String(c.value).match(/^[-+]?\d+(?:\.\d+)?/)?.[0]);
      const res = 0.5 * 10 ** -((String(n).split(".")[1] || "").length);
      readings.push({ as: "if read as g/cm3", value: n * 1000, half: res * 1000 });
      const w4 = selectReference(referenceClaims, water, "liquid_density", 277.15);
      if (w4) readings.push({ as: `if read as relative density to water at 4 °C (${w4.value} kg/m3)`, value: n * w4.value, half: res * w4.value });
    }
    const r = interval(ref);
    for (const rd of readings) {
      const agree = rd.value - rd.half <= r.hi && rd.value + rd.half >= r.lo;
      const relDiff = (rd.value - ref.value) / ref.value;
      const receipt = { solver: "density-cross-check", version: REVIEW_VERSION, inputs: { claim: c.id, reference: ref.id, reading: rd.as }, outputs: { value: rd.value, reference: ref.value, relDiff } };
      const receiptRef = `receipt:${sha256(JSON.stringify(receipt)).slice(0, 16)}`;
      checks.push({
        claim: c.id, reference: ref.id, reading: rd.as, valueKgM3: rd.value, referenceKgM3: ref.value, relativeDifference: relDiff, agreesWithinUncertainty: agree,
        computed: makeClaim({
          id: `claim:${c.subject}:density-check:${c.id.split(":").pop()}:${readings.indexOf(rd) + 1}`, subject: c.subject, property: "liquid_density", kind: "quantitative",
          value: rd.value, unit: "kg/m3", conditions: { temperature: tK, pressure: ref.conditions.pressure },
          uncertainty: { type: "range", low: rd.value - rd.half, high: rd.value + rd.half, note: "propagated printed precision and reference uncertainty" },
          method: { kind: "calculation", description: `${rd.as}; compared with ${ref.id}`, standard: null, receiptRef, assumptions: c.flags?.includes("unit_not_stated") ? ["the unit is not stated by the source: this is one possible reading, not adopted"] : [] },
          status: ["computed"], support: "partially_supported",
          evidence: [...c.evidence, ...ref.evidence, { kind: "calculation", sourceId: null, title: "density cross-check", url: null, document: null, author: null, date: null, retrieved: null, locator: null, excerpt: null, sha256: null, license: null, receiptRef }],
          flags: agree ? [] : ["disagrees_with_reference"],
        }),
        receipt,
      });
      if (!agree && !c.flags?.includes("unit_not_stated")) reviews.push({ kind: "disagrees_with_reference", subject: c.subject, claim: c.id, reason: `${rd.as}: ${rd.value.toFixed(2)} kg/m3 vs NIST ${ref.value} kg/m3 at ${tK} K (${(relDiff * 100).toFixed(3)} %), outside their combined uncertainty`, locator: loc(c), decision: REVIEW_DECISION });
    }
  }
  return { checks, reviews };
}
