// server/lib/receipts/sign-gate.js
//
// Refuse-to-sign gate. A receipt signature says "Concord checked this number".
// So a number is only signed when its action supplies BOTH:
//   - a verified reference { case, value, tolerance, source } the computed
//     result agrees with, and
//   - a validity envelope (declared input ranges + assumptions) the inputs
//     fall inside.
// Anything else is returned unsigned with a machine-readable reason; the
// numbers themselves are never withheld.
//
// spec = {
//   envelope: { ranges: object, assumptions: string[], check(inputs, results) -> string|null },
//   reference(inputs, results) -> { case, value, tolerance, source, reported },
// }

export const GATE_REASONS = Object.freeze([
  "missing_reference", "missing_envelope", "malformed_reference",
  "outside_envelope", "reference_mismatch",
]);

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;

/**
 * @returns {{ ok:true, designBasis:object, assumptions:string[], reference:object }
 *          | { ok:false, reason:string }}
 */
export function evaluateSigningGate(spec, inputs, results) {
  if (!spec || typeof spec.reference !== "function") return { ok: false, reason: "missing_reference" };
  const env = spec.envelope;
  if (
    !env || typeof env.check !== "function" || !env.ranges || typeof env.ranges !== "object"
    || Object.keys(env.ranges).length === 0 || !Array.isArray(env.assumptions)
    || env.assumptions.length === 0 || !env.assumptions.every(nonEmpty)
  ) return { ok: false, reason: "missing_envelope" };

  let violation;
  try { violation = env.check(inputs, results); } catch (e) { violation = `check_threw:${e instanceof Error ? e.message : String(e)}`; }
  if (violation) return { ok: false, reason: `outside_envelope:${violation}` };

  let ref;
  try { ref = spec.reference(inputs, results); } catch { return { ok: false, reason: "malformed_reference" }; }
  if (
    !ref || !nonEmpty(ref.case) || !nonEmpty(ref.source) || !Number.isFinite(ref.value)
    || !Number.isFinite(ref.tolerance) || !(ref.tolerance > 0) || !Number.isFinite(ref.reported)
  ) return { ok: false, reason: "malformed_reference" };
  if (Math.abs(ref.reported - ref.value) > ref.tolerance) {
    return { ok: false, reason: `reference_mismatch:reported ${ref.reported} vs reference ${ref.value} ±${ref.tolerance}` };
  }
  const { reported: _r, ...reference } = ref;
  return {
    ok: true,
    reference,
    assumptions: [...env.assumptions],
    designBasis: { validityEnvelope: { ranges: env.ranges } },
  };
}

/** The unsigned stand-in: never carries a signature, never stored. */
export function unsignedReceipt({ solver, inputs, results, reason }) {
  return {
    receiptSchema: "concord-calc-receipt/2",
    signed: false,
    reason,
    solver,
    inputs,
    results,
    signature: { signature: null },
  };
}
