// server/lib/receipts/declarations.js
//
// The ONE signing decision for lens actions. A receipt signature says
// "Concord checked this number against a cited reference, inside a declared
// validity envelope". That claim is made here and nowhere else:
//
//   - REGISTRY: `domain.action` -> declaration { certifiable, solver,
//     reference, envelope, ... }. No declaration, no signature.
//   - assertCanSign(domain, action, inputs) -> { sign, reason, declaration }
//   - applyReceiptDeclaration({ domain, action, inputs, raw }) runs after a
//     lens handler succeeds (POST /api/lens/run, both registry branches). It
//     never fails the solve: the numbers always come back; the signing fields
//     are merged INSIDE `result` (the HTTP shaper peels the outer envelope, so
//     siblings of `result` would be lost).
//
// Declaration shape:
//   {
//     certifiable: true,
//     solver: { id, version },
//     reference: { case, value, tolerance, unit, source? },   // or referenceFor(inputs)
//     envelope: { inputRanges: { name: { min?, max?, oneOf?, default? } },
//                 assumptions: string[], outOfScope: string[] },
//     normalizeInputs(inputs) -> flat inputs the ranges are checked against,
//     computed(result) -> string|null   // reason when the solver did not compute
//     verify(inputs, result) -> string|null  // reason when result disagrees with its own check
//     buildParts(inputs, result, declaration) -> buildCalcReceipt parts
//   }
//
// Refuse-to-sign reasons: missing_declaration, llm_backed_action,
// incomplete_declaration, out_of_envelope:<bound>, not_computed:<why>,
// reference_mismatch:<why>. Every one still returns the numbers.

import { buildCalcReceipt } from "./calc-receipt.js";
import { issueStoredReceipt } from "./store.js";
import { solveBeamStudy } from "../../domains/engineering.js";
import { CHEM_FUELS, CHEM_BOUNDS, chemReceiptParts } from "./chem-equilibrium.js";

const REGISTRY = new Map();

/** Actions that are LLM-backed by name; they are never certifiable, even if someone registers one. */
const LLM_ACTION_RE = /^(analy[sz]e|generate|suggest)$/i;
const MAX_SIGNED_INPUT_CHARS = 8000;

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const key = (domain, action) => `${String(domain)}.${String(action)}`;

export function registerDeclaration(domain, action, declaration) {
  REGISTRY.set(key(domain, action), declaration);
  return declaration;
}
export function getDeclaration(domain, action) {
  return REGISTRY.get(key(domain, action)) || null;
}
export function listDeclarations() {
  return [...REGISTRY.keys()];
}
/** Test seam: remove a declaration (returns the removed one). */
export function unregisterDeclaration(domain, action) {
  const d = REGISTRY.get(key(domain, action)) || null;
  REGISTRY.delete(key(domain, action));
  return d;
}

function resolveReference(decl, inputs) {
  return typeof decl.referenceFor === "function" ? decl.referenceFor(inputs) : decl.reference;
}

const SOURCE_KINDS = ["book", "paper", "standard", "dataset", "url"];

/** ISBN-10 / ISBN-13 with a valid check digit (hyphens/spaces allowed). Fake identifiers fail here. */
export function isValidIsbn(raw) {
  if (typeof raw !== "string") return false;
  const s = raw.replace(/[\s-]/g, "");
  if (/^\d{13}$/.test(s)) {
    const sum = [...s].slice(0, 12).reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]);
  }
  if (/^\d{9}[\dXx]$/.test(s)) {
    const sum = [...s].slice(0, 9).reduce((a, c, i) => a + Number(c) * (10 - i), 0);
    const last = s[9].toUpperCase() === "X" ? 10 : Number(s[9]);
    return (sum + last) % 11 === 0;
  }
  return false;
}

/** Problems with a reference.source a stranger must be able to open. [] when it is checkable. */
export function sourceProblems(source) {
  const bad = [];
  if (!source || typeof source !== "object" || Array.isArray(source)) return ["source"];
  if (!SOURCE_KINDS.includes(source.kind)) bad.push("source.kind");
  if (!nonEmpty(source.citation) || source.citation.trim().length < 15) bad.push("source.citation");
  if (!nonEmpty(source.locator)) bad.push("source.locator");
  const ids = [];
  if (source.isbn !== undefined) { if (isValidIsbn(source.isbn)) ids.push("isbn"); else bad.push("source.isbn"); }
  if (source.doi !== undefined) { if (typeof source.doi === "string" && /^10\.\d{4,9}\/\S+$/.test(source.doi.trim())) ids.push("doi"); else bad.push("source.doi"); }
  if (source.url !== undefined) { if (typeof source.url === "string" && /^https?:\/\/[^\s/]+\.[^\s/]+/.test(source.url.trim())) ids.push("url"); else bad.push("source.url"); }
  if (source.standardId !== undefined) { if (nonEmpty(source.standardId) && source.standardId.trim().length >= 3) ids.push("standardId"); else bad.push("source.standardId"); }
  if (ids.length === 0) bad.push("source.identifier");
  return bad;
}

function referenceProblems(ref) {
  if (!ref || !nonEmpty(ref.case) || !Number.isFinite(ref.value) || !Number.isFinite(ref.tolerance) || !(ref.tolerance > 0)) return ["reference"];
  if (!nonEmpty(ref.unit)) return ["reference.unit"];
  if (!ref.inputs || typeof ref.inputs !== "object" || Array.isArray(ref.inputs) || Object.keys(ref.inputs).length === 0) return ["reference.inputs"];
  return sourceProblems(ref.source);
}

function reviewProblems(decl) {
  const bad = [];
  if (!nonEmpty(decl.reviewedBy)) bad.push("reviewedBy");
  if (!nonEmpty(decl.reviewedAt) || !/^\d{4}-\d{2}-\d{2}/.test(decl.reviewedAt) || Number.isNaN(Date.parse(decl.reviewedAt))) bad.push("reviewedAt");
  return bad;
}

/** Every reference a declaration carries (the golden test replays each). */
export function declarationReferences(decl) {
  if (Array.isArray(decl.referenceList) && decl.referenceList.length) return decl.referenceList;
  return decl.reference ? [decl.reference] : [];
}

/** All schema problems for a declaration, across ALL its references. [] when complete. */
export function declarationProblems(decl) {
  if (!decl || typeof decl !== "object") return ["declaration"];
  const bad = [];
  const refs = declarationReferences(decl);
  if (refs.length === 0) bad.push("reference");
  for (const r of refs) bad.push(...referenceProblems(r));
  bad.push(...reviewProblems(decl));
  return [...new Set(bad)];
}

/**
 * Golden check: run the declaration's own solver on each reference case and compare with the
 * cited value. A declaration whose reference case does not reproduce must fail CI.
 * @returns {Promise<Array<{ case:string, expected:number, measured:number|null, tolerance:number, ok:boolean, why?:string }>>}
 */
export async function checkReferences(decl) {
  const out = [];
  for (const ref of declarationReferences(decl)) {
    const row = { case: ref.case, expected: ref.value, measured: null, tolerance: ref.tolerance, ok: false };
    try {
      if (typeof decl.runReference !== "function") row.why = "no_runReference";
      else {
        const m = await decl.runReference(ref);
        row.measured = Number.isFinite(m) ? m : null;
        if (row.measured === null) row.why = "solver_did_not_compute";
        else row.ok = Math.abs(row.measured - ref.value) <= ref.tolerance;
        if (!row.ok && !row.why) row.why = "outside_tolerance";
      }
    } catch (e) { row.why = `threw:${e instanceof Error ? e.message : String(e)}`; }
    out.push(row);
  }
  return out;
}

/** Registered declarations whose reviewedBy is still a placeholder. Visible debt, never silent. */
export function pendingReviews() {
  return [...REGISTRY.entries()].filter(([, d]) => /^pending\b/i.test(String(d.reviewedBy || "").trim())).map(([k]) => k);
}

/** null when complete, else a reason fragment. */
function incompleteness(decl, inputs) {
  const ref = resolveReference(decl, inputs);
  const refBad = referenceProblems(ref);
  if (refBad.length) return refBad[0];
  const revBad = reviewProblems(decl);
  if (revBad.length) return revBad[0];
  const env = decl.envelope;
  if (!env || !env.inputRanges || typeof env.inputRanges !== "object" || Object.keys(env.inputRanges).length === 0) return "envelope.inputRanges";
  if (!Array.isArray(env.assumptions) || env.assumptions.length === 0 || !env.assumptions.every(nonEmpty)) return "envelope.assumptions";
  if (!decl.solver || !nonEmpty(decl.solver.id)) return "solver";
  if (typeof decl.buildParts !== "function") return "buildParts";
  return null;
}

function rangeViolation(name, spec, value) {
  if (spec.oneOf) {
    const v = typeof value === "string" ? value.toUpperCase() : value;
    return spec.oneOf.some((o) => (typeof o === "string" ? o.toUpperCase() : o) === v) ? null : `${name} must be one of ${spec.oneOf.join("|")}`;
  }
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return `${name} is not a finite number`;
  if (spec.exclusiveMin != null && !(n > spec.exclusiveMin)) return `${name} must be > ${spec.exclusiveMin}`;
  if (spec.min != null && n < spec.min) return `${name} ${n} below ${spec.min}${spec.unit ? ` ${spec.unit}` : ""}`;
  if (spec.max != null && n > spec.max) return `${name} ${n} above ${spec.max}${spec.unit ? ` ${spec.unit}` : ""}`;
  return null;
}

/**
 * Pure decision. Never throws.
 * @returns {{ sign:boolean, reason?:string, declaration:object|null }}
 */
export function assertCanSign(domain, action, inputs) {
  if (LLM_ACTION_RE.test(String(action))) return { sign: false, reason: "llm_backed_action", declaration: null };
  const declaration = getDeclaration(domain, action);
  if (!declaration || declaration.certifiable !== true) return { sign: false, reason: "missing_declaration", declaration: declaration || null };
  let flat;
  try { flat = typeof declaration.normalizeInputs === "function" ? declaration.normalizeInputs(inputs || {}) : { ...(inputs || {}) }; } catch { flat = null; }
  if (!flat) return { sign: false, reason: "out_of_envelope:inputs_not_normalizable", declaration };
  const missing = incompleteness(declaration, flat);
  if (missing) return { sign: false, reason: `incomplete_declaration:${missing}`, declaration };
  for (const [name, spec] of Object.entries(declaration.envelope.inputRanges)) {
    const v = rangeViolation(name, spec, flat[name]);
    if (v) return { sign: false, reason: `out_of_envelope:${v}`, declaration };
  }
  return { sign: true, declaration, inputs: flat };
}

const unsigned = (raw, reason, extra = {}) => {
  const r = raw.result;
  const patch = { signed: false, saved: false, signingReason: reason, ...(r.reason === undefined ? { reason } : {}), ...extra };
  // A pre-built receipt that we refuse to vouch for must not keep a live signature.
  if (r.calcReceipt && typeof r.calcReceipt === "object" && r.calcReceipt.signature && r.calcReceipt.signature.signature) {
    patch.calcReceipt = { ...r.calcReceipt, signed: false, reason, signature: { signature: null } };
  }
  return { ...raw, result: { ...r, ...patch } };
};

/**
 * Post-handler hook. `raw` is the handler's return value. Only a successful
 * `{ ok:true, result:<object> }` is touched; everything else passes through.
 * Signed / unsigned fields are merged into `result` (`signed`, `saved`,
 * `signingReason`, `receiptId`, `receiptUrl`, `calcReceipt`, `receipt`).
 * An action with no declaration is never signed; only chem results are
 * annotated (`signed:false`) because the chem lens renders the banner from it,
 * every other domain's result passes through byte-for-byte.
 */
export function applyReceiptDeclaration({ domain, action, inputs, raw, db, store, now } = {}) {
  try {
    if (!raw || raw.ok === false || !raw.result || typeof raw.result !== "object" || Array.isArray(raw.result)) return raw;
    if (raw.result.receiptId) return raw; // already carries a stored receipt: one signing decision only
    const decision = assertCanSign(domain, action, inputs);
    if (!decision.sign) {
      if (!decision.declaration) return domain === "chem" ? unsigned(raw, decision.reason) : raw;
      return unsigned(raw, decision.reason);
    }
    const decl = decision.declaration;
    const flat = decision.inputs;
    const notComputed = typeof decl.computed === "function" ? decl.computed(raw.result) : null;
    if (notComputed) return unsigned(raw, `not_computed:${notComputed}`);
    const mismatch = typeof decl.verify === "function" ? decl.verify(flat, raw.result) : null;
    if (mismatch) return unsigned(raw, `reference_mismatch:${mismatch}`);
    if (JSON.stringify(flat).length > MAX_SIGNED_INPUT_CHARS) return unsigned(raw, "out_of_envelope:inputs_too_large_to_sign");

    const parts = decl.buildParts(flat, raw.result, decl);
    const built = parts && parts.prebuilt ? parts.prebuilt : buildCalcReceipt(parts, now ? { now } : {});
    const issued = issueStoredReceipt(built, { db, store, now });
    if (!issued.receipt || !issued.receipt.signature || !issued.receipt.signature.signature) return unsigned(raw, "no_signing_key");
    const common = { signed: true, calcReceipt: issued.receipt, receipt: issued.receipt };
    return issued.saved
      ? { ...raw, result: { ...raw.result, ...common, saved: true, receiptId: issued.receiptId, receiptUrl: issued.receiptUrl } }
      : { ...raw, result: { ...raw.result, ...common, saved: false, saveError: issued.saveError } };
  } catch (e) {
    // The solve must never fail because of signing.
    return raw && raw.result ? unsigned(raw, `receipt_failed:${e instanceof Error ? e.message : String(e)}`) : raw;
  }
}

// ─── seeded declarations ────────────────────────────────────────────────────

// reviewedBy is a HUMAN (Dutch) or Zuko 2 sign-off. The seeds below were drafted by an LLM and
// have not been signed off, so they say so; pendingReviews() lists them. Replace on review.
const REVIEW_PENDING = "PENDING: Dutch or Zuko 2 review";
const SEED_DATE = "2026-11-16";

// Closed-form Euler–Bernoulli beam results (peak moment, deflection) for the three supports:
// simply supported centre load (M=PL/4, d=PL^3/48EI), cantilever tip load (M=PL, d=PL^3/3EI),
// fixed-fixed centre load (M=PL/8, d=PL^3/192EI). ISBN-13 9780071742474 verified against Open Library.
// The case number inside Table 8.1 has NOT been checked against the book (locatorVerified:false).
const BEAM_REFERENCE = {
  case: "Closed-form Euler–Bernoulli hand calculation (peak stress and deflection) for the same support and load, compared with the beam-frame FEA result",
  value: 0, unit: "% disagreement", tolerance: 2,
  inputs: { dims: { length: 3000, height: 300, flangeWidth: 150, flangeThickness: 12, webThickness: 8 }, loadN: 20000, support: "simply-supported", material: "steel-a992" },
  source: {
    kind: "book",
    citation: "Young, W. C., Budynas, R. G., Sadegh, A. M., Roark's Formulas for Stress and Strain, 8th ed., McGraw-Hill, 2012",
    locator: "Table 8.1, Shear, moment, slope, and deflection formulas for finite-length beams of constant cross section (end-loaded cantilever, centre-loaded simply supported and fixed-fixed cases)",
    isbn: "9780071742474",
    locatorVerified: false,
    locatorNote: "table title only; the case numbers inside Table 8.1 were not checked against the book",
  },
};

const numOr = (v, d) => (v === undefined || v === null || v === "" ? d : Number(v));

registerDeclaration("chem", "equilibrium", {
  certifiable: true,
  solver: { id: "chem.equilibrium", version: "1.0.0" },
  // Default (CH4) reference; H2 swaps via referenceFor.
  reference: CHEM_FUELS.CH4.reference,
  referenceFor: (inputs) => (CHEM_FUELS[String(inputs.fuel).toUpperCase()] || CHEM_FUELS.CH4).reference,
  referenceList: Object.values(CHEM_FUELS).map((f) => f.reference),
  // Golden-test hook: run the real solver on a reference case's inputs, return the value in the reference's unit.
  runReference: async (ref) => {
    const { solveChemEquilibrium } = await import("./chem-equilibrium.js");
    const out = await solveChemEquilibrium({ fuel: ref.inputs.fuel, phi: ref.inputs.phi, T0: ref.inputs.T0, P0atm: ref.inputs.P0 });
    return out.status === "NOT_COMPUTED" ? null : out.tAd;
  },
  reviewedBy: REVIEW_PENDING,
  reviewedAt: SEED_DATE,
  envelope: {
    inputRanges: {
      fuel: { oneOf: Object.keys(CHEM_FUELS) },
      phi: { min: CHEM_BOUNDS.phi.min, max: CHEM_BOUNDS.phi.max, unit: "equivalence ratio" },
      T0: { min: CHEM_BOUNDS.T0.min, max: CHEM_BOUNDS.T0.max, unit: "K" },
      P0: { min: CHEM_BOUNDS.P0atm.min, max: CHEM_BOUNDS.P0atm.max, unit: "atm" },
    },
    assumptions: [
      "Fuel/air only (O2:1, N2:3.76); Cantera chemical equilibrium at fixed enthalpy and pressure (HP)",
      "Adiabatic, complete mixing, ideal gas; the mechanism is gri30.yaml (CH4) or h2o2.yaml (H2)",
    ],
    outOfScope: [
      "Finite-rate kinetics, ignition delay, flame speed",
      "Heat loss, radiation, dissociation beyond the mechanism's species set",
      "Pass/fail against the cited reference applies only at phi 1, 300 K, 1 atm; off that state the number is signed with a WARN verdict, not a PASS",
    ],
  },
  normalizeInputs: (i) => ({
    fuel: typeof i.fuel === "string" ? i.fuel.toUpperCase() : (i.fuel === undefined ? "CH4" : i.fuel),
    phi: numOr(i.phi, 1),
    T0: numOr(i.T0, 300),
    P0: numOr(i.P0, 1),
  }),
  computed: (r) => (r.status === "COMPUTED" && Number.isFinite(r.adiabaticFlameTemperatureK) ? null : (r.reason || "the chemistry kernel did not compute a result")),
  buildParts: (inputs, r) => {
    const spec = { fuel: inputs.fuel, phi: inputs.phi, T0: inputs.T0, P0atm: inputs.P0 };
    const outcome = {
      status: r.status, tAd: r.adiabaticFlameTemperatureK, products: r.majorProducts || [],
      solver: r.solver, assumptions: r.assumptions, reason: r.reason,
    };
    return chemReceiptParts(spec, outcome);
  },
});

registerDeclaration("engineering", "beamStudy", {
  certifiable: true,
  solver: { id: "beam-frame-fea", version: "1" },
  // Honest declaration: this is NOT a published-textbook numeric case. The
  // check is the FEA result against the closed-form Euler–Bernoulli hand
  // calculation for the same support/load case (summarizeBeamStudy's own
  // 2% tolerance); the receipt's verdict is a yield check at the stated SF.
  reference: BEAM_REFERENCE,
  referenceList: [BEAM_REFERENCE],
  // Golden-test hook: FEA vs the closed-form hand calculation on the reference case, as % disagreement (worst of stress, deflection).
  runReference: async (ref) => {
    const solved = solveBeamStudy(ref.inputs);
    if (!solved.ok) return null;
    const h = solved.result.handCheck;
    return Math.max(h.stressError, h.deflectionError) * 100;
  },
  reviewedBy: REVIEW_PENDING,
  reviewedAt: SEED_DATE,
  envelope: {
    inputRanges: {
      length: { exclusiveMin: 0, max: 50000, unit: "mm" },
      height: { exclusiveMin: 0 },
      flangeWidth: { exclusiveMin: 0 },
      flangeThickness: { exclusiveMin: 0 },
      webThickness: { exclusiveMin: 0 },
      loadN: { exclusiveMin: 0, max: 1e9, unit: "N" },
      support: { oneOf: ["simply-supported", "cantilever", "fixed"] },
    },
    assumptions: [
      "Linear-elastic Euler–Bernoulli beam elements, doubly-symmetric I-section, a single point load",
      "Material properties from the built-in library; unfactored load, yield check at the stated safety factor",
    ],
    outOfScope: ["Buckling, fatigue, connections, shear deformation, stress concentrations", "Any design code compliance"],
  },
  normalizeInputs: (i) => {
    const d = i.dims && typeof i.dims === "object" ? i.dims : i;
    const out = { support: typeof i.support === "string" ? i.support : "simply-supported", loadN: Math.abs(Number(i.loadN)) };
    for (const k of ["length", "height", "flangeWidth", "flangeThickness", "webThickness"]) out[k] = Number(d[k]);
    return out;
  },
  verify: (_i, r) => (r.calcReceipt && r.calcReceipt.handCheck && r.calcReceipt.handCheck.agrees === false ? "FEA disagrees with the closed-form hand check beyond 2%" : null),
  computed: (r) => (r.calcReceipt ? null : "no calc receipt produced"),
  buildParts: (_i, r) => ({ prebuilt: r.calcReceipt }),
});
