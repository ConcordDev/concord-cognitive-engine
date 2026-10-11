// server/lib/conkay/knowledge/claims.js
//
// Property-as-Claim. The schema (schema.js) fixes a claim's shape; this file
// enforces what a shape can't:
//
//   - "unknown" stands alone, and an unknown claim carries no value or range.
//   - A claim with a value says how it was obtained (some status other than
//     unknown), and a quantitative value carries a unit.
//   - A claim with no evidence is unknown. Nothing is Sourced, Measured,
//     Computed, Estimated, Simulated or Validated on someone's say-so; the
//     author's own statement (evidence kind "user_statement") is recorded as
//     who asserted it, never as support.
//   - sourced   → a document, URL, dataset or standard, with a locator.
//   - measured  → a test record.
//   - computed / estimated / simulated → a calculation receipt; an estimate
//     also states its assumptions and an uncertainty range.
//   - validated → a test record and a non-unknown value.
//   - support "supported" / "partially_supported" / "contradicted" needs
//     evidence other than the author's statement.
//   - hypothesis   (1.1.0) stands alone; may carry the asserted value with
//     only the author's statement behind it. It is never support.
//   - contradicted (1.1.0) stands alone and needs BOTH a basis (a cited
//     conservation law / geometric identity, kind "law", or a sourced value:
//     document/url/dataset/standard with a locator) AND a calculation
//     receipt showing the conflict.
//   - bin (1.1.0): buildable / research-stage / unsupported-as-stated.
//     promotionGate() keeps unsupported-as-stated claims out of fabrication
//     and acceptance however self-consistent their own arithmetic is.

import { validateClaimShape, STATUS_FLAGS, EXCLUSIVE_STATUSES, CLAIM_BINS } from "./schema.js";
import { missingConditionsFor, PROPERTIES } from "./properties.js";

const SOURCE_KINDS = new Set(["document", "url", "dataset", "standard"]);
const has = (list, pred) => (list || []).some(pred);
const real = (e) => e && e.kind !== "user_statement";

/** Validate one claim: shape, then the status rules. Returns a list of errors. */
export function validateClaim(c, path = "$") {
  const shape = validateClaimShape(c, path);
  if (shape.length) return shape;
  const errors = [];
  const at = (m) => errors.push(`${path} (${c.id}): ${m}`);
  const s = new Set(c.status);
  const ev = c.evidence || [];
  const hasValue = c.value != null || c.range != null;

  for (const x of EXCLUSIVE_STATUSES) {
    if (s.has(x) && s.size > 1) at(`"${x}" cannot be combined with ${[...s].filter((y) => y !== x).join(", ")}`);
  }
  if (s.has("unknown") && hasValue) at("an unknown claim cannot carry a value or range");
  if (!s.has("unknown") && !hasValue) at("a claim with no value or range must be status [\"unknown\"]");
  if (hasValue && c.kind === "quantitative" && !c.unit) at("a quantitative value needs a unit");
  if (c.range && !(c.range.min <= c.range.max)) at("range.min must be ≤ range.max");

  if (!has(ev, real) && !s.has("unknown") && !s.has("hypothesis")) at(`no evidence: status must be ["unknown"], not ${JSON.stringify(c.status)}`);
  if (s.has("sourced") && !has(ev, (e) => SOURCE_KINDS.has(e.kind) && e.locator)) at("sourced needs a document/url/dataset/standard evidence ref with a locator");
  if (s.has("measured") && !has(ev, (e) => e.kind === "test_record")) at("measured needs a test_record evidence ref");
  for (const f of ["computed", "estimated", "simulated"]) {
    if (s.has(f) && !has(ev, (e) => e.kind === "calculation" && e.receiptRef)) at(`${f} needs a calculation evidence ref with a receiptRef`);
  }
  if (s.has("estimated")) {
    if (!(c.method?.assumptions || []).length) at("estimated needs method.assumptions");
    if (!c.uncertainty || c.uncertainty.type === "unknown") at("estimated needs an uncertainty (e.g. a range)");
  }
  if (s.has("validated") && !has(ev, (e) => e.kind === "test_record")) at("validated needs a test_record evidence ref");
  if (s.has("contradicted")) {
    const basis = has(ev, (e) => (e.kind === "law" && e.sourceId) || (SOURCE_KINDS.has(e.kind) && e.locator));
    if (!basis) at("contradicted needs a cited conservation law / geometry (kind \"law\" with a sourceId) or a sourced value with a locator");
    if (!has(ev, (e) => e.kind === "calculation" && e.receiptRef)) at("contradicted needs the calculation showing the conflict (calculation evidence with a receiptRef)");
  }
  if (s.has("hypothesis") && c.support !== "unsupported" && c.support !== "not_applicable") at(`a hypothesis is not support: support must be "unsupported", not "${c.support}"`);
  if (c.bin != null && !CLAIM_BINS.includes(c.bin)) at(`bin must be one of ${CLAIM_BINS.join(", ")}`);
  if (["supported", "partially_supported", "contradicted"].includes(c.support) && !has(ev, real)) {
    at(`support "${c.support}" needs evidence other than the author's statement`);
  }
  if (c.support === "supported" && s.has("unknown") && c.kind === "quantitative") at("a quantitative claim cannot be supported while its value is unknown");
  return errors;
}

/**
 * Build a claim with defaults filled and missingConditions derived from the
 * property catalog. Does not validate; call validateClaim.
 */
export function makeClaim(fields) {
  const c = {
    id: fields.id,
    subject: fields.subject,
    property: fields.property ?? null,
    relatedProperties: fields.relatedProperties || [],
    kind: fields.kind || (fields.unit ? "quantitative" : "qualitative"),
    value: fields.value ?? null,
    range: fields.range ?? null,
    unit: fields.unit ?? null,
    statement: fields.statement ?? null,
    conditions: fields.conditions || {},
    missingConditions: [],
    uncertainty: fields.uncertainty ?? null,
    method: fields.method || { kind: "none", description: null, standard: null, receiptRef: null, assumptions: [] },
    status: fields.status || ["unknown"],
    support: fields.support || "unsupported",
    bin: fields.bin ?? null,
    evidence: fields.evidence || [],
    requiredEvidence: fields.requiredEvidence || [],
    assertedBy: fields.assertedBy ?? null,
    attributedTo: fields.attributedTo ?? null,
    label: fields.label ?? null,
    flags: fields.flags || [],
    notes: fields.notes || [],
  };
  if (c.method.assumptions == null) c.method = { ...c.method, assumptions: [] };
  const props = [c.property, ...c.relatedProperties].filter(Boolean);
  const missing = new Set();
  for (const p of props) for (const m of missingConditionsFor(p, c.conditions) || []) missing.add(m);
  c.missingConditions = [...missing];
  return c;
}

const ACCEPTING = new Set(["sourced", "measured", "computed", "validated"]);

/**
 * May this claim be promoted into a fabrication or acceptance step?
 * Returns { allowed, screeningOnly, reasons }. The rule from the spec: a
 * claim in the unsupported-as-stated bin is refused even when its status is
 * "computed" (internal self-consistency is not evidence); hypothesis,
 * contradicted and unknown claims are refused; research-stage claims need a
 * measured or validated result (a coupon that passed a named test); an
 * estimate passes only as a screening input, and says so.
 */
export function promotionGate(claim, stage = "acceptance") {
  if (!["fabrication", "acceptance"].includes(stage)) throw new Error(`unknown stage "${stage}"`);
  const s = new Set(claim?.status || ["unknown"]);
  const reasons = [];
  if (claim?.bin === "unsupported-as-stated") reasons.push(`bin "unsupported-as-stated": never promoted into ${stage}, however self-consistent its own calculation is`);
  for (const x of EXCLUSIVE_STATUSES) if (s.has(x)) reasons.push(`status "${x}" cannot enter ${stage}`);
  if (claim?.bin === "research-stage" && !s.has("measured") && !s.has("validated")) reasons.push("research-stage claim has no measured/validated result (needs a specimen that passed a named test)");
  const accepting = [...s].some((x) => ACCEPTING.has(x));
  const screeningOnly = !accepting && s.has("estimated");
  if (!accepting && !screeningOnly && !reasons.length) reasons.push(`status ${JSON.stringify([...s])} is not an accepted basis`);
  return { allowed: reasons.length === 0, screeningOnly: reasons.length === 0 && screeningOnly, reasons };
}

/** True when the property is in the catalog. */
export function knownProperty(p) {
  return p != null && Object.prototype.hasOwnProperty.call(PROPERTIES, p);
}

export { STATUS_FLAGS, CLAIM_BINS };
