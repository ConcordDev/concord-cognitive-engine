// server/lib/receipts/calc-receipt.js
//
// GB-1534 — the signing-grade calculation receipt (schema
// "concord-calc-receipt/2"; /3 adds a signed `verification` block). A v1 analysis receipt signed only the solver's
// identity and a hash of the inputs; the numbers it reported (stress,
// safety factor, PASS) rode NEXT TO the signed body, unsigned, so an edited
// result still verified. A v2 calc receipt puts the full inputs, the design
// basis, every reported result (rounded BEFORE signing, so the signed value
// is the shown value), the hand check and the verdict INSIDE the signed
// bytes: editing any of them fails verification with digest_mismatch.
//
// The body is assembled here and attested by attest.js (canon/alg there are
// unchanged). Optional blocks are included only when the caller actually
// has them — a receipt never claims a check, a reference or a job it does
// not have.

import { attestReceipt, loadSigningKey, ALG, CANON } from "./attest.js";

const DEFAULT_PUBLIC_BASE_URL = "https://concord-os.org";

/**
 * Public base URL for links embedded in signed receipts. Comes from config
 * (PUBLIC_BASE_URL), never from a request Host header: the value is signed, so
 * a spoofed Host must not be able to mint a receipt that points elsewhere.
 */
export function receiptBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL;
  const v = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : DEFAULT_PUBLIC_BASE_URL;
}

export const VERIFY_HOW_TO =
  "Offline: remove the top-level `signature` field, canonicalize the rest as sorted-json-v1 "
  + "(object keys sorted, no whitespace, UTF-8), SHA-256 it and compare to signature.digest, then "
  + "Ed25519-verify signature.signature (base64) over those bytes with the public key for keyId "
  + "from publicKeysUrl. Or POST this receipt to verifyUrl. Script: scripts/verify-receipt.mjs.";

/**
 * The self-describing `verification` block signed inside every /3 receipt.
 * `fetchUrl` is only present when the receipt has a stored id.
 */
export function buildVerificationBlock({ keyId = null, receiptId = null } = {}) {
  const base = receiptBaseUrl();
  return {
    verifyUrl: `${base}/api/receipts/verify`,
    ...(receiptId ? { fetchUrl: `${base}/api/receipts/${receiptId}` } : {}),
    publicKeysUrl: `${base}/.well-known/concord-receipt-keys.json`,
    alg: ALG,
    canon: CANON,
    keyId,
    howTo: VERIFY_HOW_TO,
  };
}

export const CALC_RECEIPT_SCHEMA = "concord-calc-receipt/3";
/** Schemas this module has issued. /2 receipts (no `verification` block) remain valid forever. */
export const CALC_RECEIPT_SCHEMAS = ["concord-calc-receipt/2", "concord-calc-receipt/3"];
export const CALC_RECEIPT_SERVICE = "concord-os.org";

/** Round a finite number to `digits` decimals; anything else passes through as null/value unchanged. */
export function roundTo(value, digits) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value ?? null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Solver identity as { id, version }: accepts an object or an "id@version" string. */
function solverBlock(solver) {
  if (solver && typeof solver === "object") {
    return { id: String(solver.id || "unknown"), version: solver.version != null ? String(solver.version) : "" };
  }
  const s = String(solver || "unknown");
  const at = s.lastIndexOf("@");
  return at > 0 ? { id: s.slice(0, at), version: s.slice(at + 1) } : { id: s, version: "" };
}

/** Caller-supplied job references, each capped at 200 chars, signed with the body. */
function cleanJob(job) {
  if (!job || typeof job !== "object") return undefined;
  const out = {};
  for (const k of ["projectRef", "jobRef", "preparedFor"]) {
    const v = job[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Build + attest a v2 calc receipt from its parts.
 * @param {{
 *   solver: string | { id: string, version?: string },
 *   inputs: object, inputHash?: string, units?: string, method?: string,
 *   designBasis?: object, assumptions?: string[], outOfScope?: string[],
 *   results?: object, handCheck?: object, verdict?: object, reference?: object,
 *   job?: { projectRef?: string, jobRef?: string, preparedFor?: string },
 * }} parts
 * @param {{ now?: () => string }} [opts] forwarded to attestReceipt (test hook)
 */
export function buildCalcReceipt(parts = {}, opts = {}) {
  const key = loadSigningKey();
  const body = {
    receiptSchema: CALC_RECEIPT_SCHEMA,
    solver: solverBlock(parts.solver),
    inputs: parts.inputs ?? {},
    ...(parts.inputHash ? { inputHash: parts.inputHash } : {}),
    ...(parts.units ? { units: parts.units } : {}),
    ...(parts.method ? { method: parts.method } : {}),
    ...(parts.designBasis ? { designBasis: parts.designBasis } : {}),
    ...(Array.isArray(parts.assumptions) && parts.assumptions.length ? { assumptions: parts.assumptions } : {}),
    ...(Array.isArray(parts.outOfScope) && parts.outOfScope.length ? { outOfScope: parts.outOfScope } : {}),
    ...(parts.results ? { results: parts.results } : {}),
    ...(parts.handCheck ? { handCheck: parts.handCheck } : {}),
    ...(parts.verdict ? { verdict: parts.verdict } : {}),
    ...(parts.reference ? { reference: parts.reference } : {}),
    issuer: { service: CALC_RECEIPT_SERVICE, keyId: key && key.keyId ? key.keyId : null },
    verification: buildVerificationBlock({ keyId: key && key.keyId ? key.keyId : null }),
  };
  const job = cleanJob(parts.job);
  if (job) body.job = job;
  return attestReceipt(body, opts);
}

const ENVELOPE_STATUSES = ["PASS", "FAIL", "WARN", "NOT_COMPUTED"];

/**
 * A signed v2 calc receipt for one solver envelope (the DesignSession result
 * shape the MCP bridge and the demo routes consume): the envelope's own
 * inputs echo and outputs, signed as reported. Statuses outside the verdict
 * vocabulary are recorded as NOT_COMPUTED, never upgraded.
 * @param {object} env solver envelope { solver, status, inputs, outputs, assumptions }
 * @param {{ job?: object, now?: () => string }} [opts]
 */
export function calcReceiptForEnvelope(env, opts = {}) {
  if (!env || typeof env !== "object") return null;
  const status = ENVELOPE_STATUSES.includes(env.status) ? env.status : "NOT_COMPUTED";
  return buildCalcReceipt({
    solver: env.solver && typeof env.solver === "object"
      ? { id: env.solver.id, version: env.solver.version }
      : env.solver,
    inputs: env.inputs ?? {},
    ...(env.solver && typeof env.solver === "object" && typeof env.solver.method === "string"
      ? { method: env.solver.method }
      : {}),
    assumptions: Array.isArray(env.assumptions) ? env.assumptions : undefined,
    results: env.outputs ?? {},
    verdict: { status },
    job: opts.job,
  }, opts);
}
