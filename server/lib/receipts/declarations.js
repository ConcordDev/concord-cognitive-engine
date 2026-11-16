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
import { CHEM_FUELS, CHEM_BOUNDS, CHEM_OXIDIZER, chemReceiptParts } from "./chem-equilibrium.js";

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

/** null when complete, else a reason fragment. */
function incompleteness(decl, inputs) {
  const ref = resolveReference(decl, inputs);
  if (!ref || !nonEmpty(ref.case) || !Number.isFinite(ref.value) || !Number.isFinite(ref.tolerance) || !(ref.tolerance > 0)) return "reference";
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
export function applyReceiptDeclaration(args = {}) {
  const out = applyReceiptDeclarationCore(args);
  // Demo routes render a calc sheet even when we refuse to sign: give them the
  // receipt body with its signature block nulled, never a signed one.
  if (args.withUnsignedBody && out && out.result && out.result.signed === false && !out.result.calcReceipt) {
    try {
      const decl = getDeclaration(args.domain, args.action);
      if (decl && typeof decl.buildParts === "function") {
        const flat = typeof decl.normalizeInputs === "function" ? decl.normalizeInputs(args.inputs || {}) : { ...(args.inputs || {}) };
        const parts = decl.buildParts(flat, args.raw.result, decl);
        const built = parts && parts.prebuilt ? parts.prebuilt : buildCalcReceipt(parts);
        const body = { ...built, signed: false, reason: out.result.signingReason, signature: { signature: null } };
        return { ...out, result: { ...out.result, calcReceipt: body, receipt: body } };
      }
    } catch { /* no body to show; the numbers still come back */ }
  }
  return out;
}

/**
 * Envelope gate for the ConKay solver path (MCP conkay_solve, conkay_design
 * views). `env` is a solver envelope { solver, status, inputs, outputs, ... }.
 * The declaration is found by solver id and must supply `fromEnvelope(env)` ->
 * { inputs, result } in its own lens shape. No declaration (or no adapter) ->
 * unsigned `missing_declaration`; the caller still returns the envelope's numbers.
 * @returns {{ signed:boolean, saved:boolean, signingReason?:string, calcReceipt:object|null, receipt:object|null, receiptId?:string, receiptUrl?:string }}
 */
export function applyEnvelopeDeclaration(env, { db, store, now } = {}) {
  const refuse = (reason) => ({ signed: false, saved: false, signingReason: reason, calcReceipt: null, receipt: null });
  try {
    const solverId = env && env.solver && typeof env.solver === "object" ? env.solver.id : null;
    let found = null;
    for (const [k, d] of REGISTRY) {
      if (d && d.certifiable === true && typeof d.fromEnvelope === "function" && d.solver && d.solver.id === solverId) { found = { k, d }; break; }
    }
    if (!found) return refuse("missing_declaration");
    const [domain, ...rest] = found.k.split(".");
    const action = rest.join(".");
    const adapted = found.d.fromEnvelope(env);
    if (!adapted || typeof adapted !== "object" || !adapted.inputs || !adapted.result) return refuse("out_of_envelope:envelope_not_adaptable");
    const out = applyReceiptDeclarationCore({ domain, action, inputs: adapted.inputs, raw: { ok: true, result: adapted.result }, db, store, now });
    const r = out && out.result ? out.result : {};
    if (r.signed !== true) return refuse(r.signingReason || "not_signed");
    return {
      signed: true, saved: r.saved === true, calcReceipt: r.calcReceipt, receipt: r.receipt,
      ...(r.receiptId ? { receiptId: r.receiptId, receiptUrl: r.receiptUrl } : {}),
      ...(r.saveError ? { saveError: r.saveError } : {}),
    };
  } catch (e) {
    return refuse(`receipt_failed:${e instanceof Error ? e.message : String(e)}`);
  }
}

function applyReceiptDeclarationCore({ domain, action, inputs, raw, db, store, now } = {}) {
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

const numOr = (v, d) => (v === undefined || v === null || v === "" ? d : Number(v));

registerDeclaration("chem", "equilibrium", {
  certifiable: true,
  solver: { id: "chem.equilibrium", version: "1.0.0" },
  // Default (CH4) reference; H2 swaps via referenceFor.
  reference: CHEM_FUELS.CH4.reference,
  referenceFor: (inputs) => (CHEM_FUELS[String(inputs.fuel).toUpperCase()] || CHEM_FUELS.CH4).reference,
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
  // ConKay solver envelope (Pa, nested echo values) -> the lens shape (atm). Anything the
  // certified envelope does not cover (other oxidizer, mechanism not matching the fuel) is not adapted.
  fromEnvelope: (env) => {
    const v = (k) => (env.inputs && env.inputs[k] && typeof env.inputs[k] === "object" ? env.inputs[k].value : undefined);
    const fuel = typeof v("fuel") === "string" ? v("fuel").toUpperCase() : null;
    if (!fuel || !CHEM_FUELS[fuel] || v("mechanism") !== CHEM_FUELS[fuel].mechanism || v("oxidizer") !== CHEM_OXIDIZER) return null;
    const P0 = Number(v("initialPressure")) / 101325;
    const out = env.outputs || {};
    const T = out.adiabaticFlameTemperature && out.adiabaticFlameTemperature.value;
    const ok = env.status !== "NOT_COMPUTED" && Number.isFinite(T);
    return {
      inputs: { fuel, phi: Number(v("equivalenceRatio")), T0: Number(v("initialTemperature")), P0 },
      result: {
        status: ok ? "COMPUTED" : "NOT_COMPUTED",
        ...(ok ? { adiabaticFlameTemperatureK: T, majorProducts: out.majorProducts ? out.majorProducts.value : [] } : { reason: env.reason || "not computed" }),
        solver: env.solver, assumptions: env.assumptions,
      },
    };
  },
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
  reference: {
    case: "Closed-form Euler–Bernoulli hand calculation (peak stress and deflection) for the same support and load, compared with the beam-frame FEA result",
    value: 0, unit: "% disagreement", tolerance: 2,
  },
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
