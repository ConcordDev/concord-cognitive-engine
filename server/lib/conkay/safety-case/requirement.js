// server/lib/conkay/safety-case/requirement.js
//
// A safety requirement record with the traceability fields of roadmap
// area 4: source, owner, design implementation, analysis, sourced
// acceptance criterion, verification record, reviewer and change history.
// A record missing any field is INCOMPLETE and says which; nothing is
// silently treated as satisfied.

import { humanNameError, screeningStatus } from "./vocabulary.js";

export const REQUIREMENT_FIELDS = Object.freeze(["source", "owner", "implementation", "analysis", "acceptanceCriterion", "verification", "reviewer", "history"]);
const HEX64 = /^[0-9a-f]{64}$/;

export function makeRequirement(r) {
  return {
    id: r.id, text: r.text, textNote: r.textNote ?? null,
    source: r.source ?? null,                 // [{ regulation, locator, url, role, quote? }]
    owner: r.owner ?? null,                   // { name, role }
    implementation: r.implementation ?? null, // { nodes: [design-graph node ids] }
    analysis: r.analysis ?? null,             // [{ runId, receiptSha256 }]
    acceptanceCriterion: r.acceptanceCriterion ?? null, // { statement, metric: { runId, output, comparator, value }, source: [...] }
    verification: r.verification ?? null,     // { method, status: pending|performed, performedBy?, date?, evidence? }
    reviewer: r.reviewer ?? null,             // { name, role, signedOff?: date }
    history: r.history ?? null,               // { log: ChangeLog head hash, entries: n }
  };
}

/**
 * Field-level completeness. ctx (optional): { runIds:Set, receipts:Set, nodeIds:Set } to check
 * that the links resolve. Returns { complete, missing: [{field, reason}] }.
 */
export function checkRequirement(r, ctx = {}) {
  const missing = [];
  const miss = (field, reason) => missing.push({ field, reason });
  if (!Array.isArray(r.source) || !r.source.length) miss("source", "no regulation/standard locator");
  else for (const s of r.source) if (!s.regulation || !s.locator || !s.url) miss("source", `source entry lacks regulation, locator or url (${s.locator || "?"})`);
  const oe = humanNameError(r.owner?.name, "owner");
  if (oe) miss("owner", oe);
  if (!r.implementation?.nodes?.length) miss("implementation", "no design-graph node implements it");
  else if (ctx.nodeIds) for (const n of r.implementation.nodes) if (!ctx.nodeIds.has(n)) miss("implementation", `node ${n} is not in the design`);
  if (!Array.isArray(r.analysis) || !r.analysis.length) miss("analysis", "no solver run + receipt linked");
  else {for (const a of r.analysis) {
    if (!a.runId || !HEX64.test(a.receiptSha256 || "")) miss("analysis", `analysis link needs runId and a 64-hex receipt hash (${a.runId || "?"})`);
    else {
      if (ctx.runIds && !ctx.runIds.has(a.runId)) miss("analysis", `run ${a.runId} not found`);
      if (ctx.receipts && !ctx.receipts.has(a.receiptSha256)) miss("analysis", `receipt ${a.receiptSha256.slice(0, 12)}… does not match the current analysis (stale)`);
    }
  }}
  const ac = r.acceptanceCriterion;
  if (!ac?.statement || !ac?.metric) miss("acceptanceCriterion", "no acceptance criterion with a checkable metric");
  else if (!Array.isArray(ac.source) || !ac.source.length) miss("acceptanceCriterion", "acceptance criterion is not sourced");
  if (!r.verification?.method) miss("verification", "no verification record");
  else if (r.verification.status === "performed") {
    const ve = humanNameError(r.verification.performedBy, "verification.performedBy");
    if (ve) miss("verification", ve);
  } else miss("verification", "verification not yet performed by a qualified engineer");
  const re = humanNameError(r.reviewer?.name, "reviewer");
  if (re) miss("reviewer", re);
  else if (r.owner?.name && r.reviewer.name.trim().toLowerCase() === r.owner.name.trim().toLowerCase()) miss("reviewer", "reviewer must be a different person from the owner");
  if (!r.history?.head) miss("history", "no change history");
  return { complete: missing.length === 0, missing };
}

/** Evaluate the acceptance metric against analysis envelopes: true | false | null (not computable). */
export function metricMet(ac, envelopes) {
  const env = envelopes.find((e) => e.runId === ac?.metric?.runId);
  const v = env?.outputs?.[ac.metric.output]?.value;
  if (v === undefined || v === null) return null;
  const x = Array.isArray(v) ? v.length : v;
  const t = ac.metric.value;
  switch (ac.metric.comparator) {
    case "==": return x === t;
    case "<=": return x <= t;
    case ">=": return x >= t;
    default: return null;
  }
}

/**
 * Screening status: incomplete (fields missing) / screening_fail (the
 * linked analysis fails the criterion) / needs_review (no screening issue,
 * human verification or sign-off outstanding) / screening_pass (complete,
 * criterion met, verification performed and reviewer signed off; still
 * only a screening result).
 */
export function requirementStatus(r, envelopes, ctx = {}) {
  const { complete, missing } = checkRequirement(r, ctx);
  const met = metricMet(r.acceptanceCriterion, envelopes);
  let status;
  if (met === false) status = "screening_fail";
  else if (!complete) status = "incomplete";
  else if (met === null || !r.reviewer?.signedOff) status = "needs_review";
  else status = "screening_pass";
  return { id: r.id, status: screeningStatus(status), criterionMet: met, missing };
}
