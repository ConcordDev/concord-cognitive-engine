// server/lib/conkay/chain/receipt.js
//
// SX-CHAIN-RECEIPT — the chain-level receipt (founder design rule,
// CB-0835): a chain run signs ONE artifact. Not one receipt per
// link stapled together — a single artifact carrying:
//
//   - per-link receipts: for every step that ran, the sha256 over
//     the canonical form of its {inputs, outputs} plus the solver
//     id@version that produced them;
//   - seam contracts: for every interface between links, the
//     quantities that cross it with their units, the assumptions
//     each side carries, and the envelope intersection — computed
//     by the runner from the links' actual outputs, with a status
//     per seam (HOLDS / VIOLATED / INCOMPLETE / NOT_APPLICABLE);
//   - the chain hash: sha256 over the ordered link hashes and the
//     seam statuses — change any link or flip any seam and the
//     artifact's hash changes.
//
// The signing rule is implemented here, not merely stated: the
// artifact's status is SIGNED only when every link computed AND
// every seam HOLDS or is NOT_APPLICABLE. A seam mismatch fails
// the chain receipt EVEN WHEN EVERY LINK PASSES (status
// SEAM_VIOLATION) — per-link success is not chain success. A
// stopped link leaves the receipt INCOMPLETE, naming the step
// and its NOT_COMPUTED reason. Skipped steps (optional links not
// declared, or a step blocked on an open question) are recorded
// in the artifact with their reasons — a receipt that hides its
// holes is not a receipt.
//
// Hashing reuses the loop receipt's canonical form and sha256
// (iterate/receipt.js), so chain and loop receipts speak the same
// language.

import { canonical, sha256 } from "../iterate/receipt.js";
import { getSolver } from "../physics/registry.js";

export const CHAIN_RECEIPT_VERSION = "1.0.0";

const SEAM_OK = new Set(["HOLDS", "NOT_APPLICABLE"]);

/** One link's receipt: the hash of exactly what it consumed and produced. */
export function linkReceipt({ step, solver, inputs, outputs }) {
  const version = getSolver(solver)?.version ?? null;
  return {
    step,
    solver,
    solverVersion: version,
    hash: sha256({ inputs, outputs }),
  };
}

/**
 * Assemble the chain artifact.
 * links:   [linkReceipt(...)] in execution order (only links that ran)
 * seams:   [{id, from, to, quantity, unit, status, detail, fromValue?, toValue?}]
 * skipped: [{step, solver?, reason}]
 * stopped: null | {step, solver, reason} — the link that NOT_COMPUTED
 */
export function buildChainReceipt({ chainId, links = [], seams = [], skipped = [], stopped = null }) {
  let status;
  if (stopped) status = "INCOMPLETE";
  else if (seams.some((s) => s.status === "VIOLATED")) status = "SEAM_VIOLATION";
  else if (seams.some((s) => s.status === "INCOMPLETE")) status = "INCOMPLETE";
  else status = "SIGNED";
  const body = {
    version: CHAIN_RECEIPT_VERSION,
    chainId,
    status,
    links,
    seams,
    skipped,
    stopped,
  };
  return { ...body, hash: sha256(body) };
}

/**
 * Re-verify an artifact against freshly recomputed links: the
 * artifact holds only if its hash recomputes AND every link hash
 * matches the recomputation AND its status is SIGNED. Returns
 * {valid, reasons} — reasons name the first mismatch found per
 * link, never a bare false.
 */
export function verifyChainReceipt(receipt, recomputedLinks) {
  const reasons = [];
  if (!receipt || typeof receipt.hash !== "string") return { valid: false, reasons: ["receipt carries no hash"] };
  const { hash, ...body } = receipt;
  if (sha256(body) !== hash) reasons.push("the artifact's own hash does not recompute — it was altered after assembly");
  if (receipt.status !== "SIGNED") reasons.push(`receipt status is ${receipt.status}, not SIGNED`);
  const byStep = new Map((recomputedLinks || []).map((l) => [l.step, l]));
  for (const link of receipt.links || []) {
    const re = byStep.get(link.step);
    if (!re) { reasons.push(`link ${link.step} (${link.solver}) was not recomputed`); continue; }
    if (re.hash !== link.hash) reasons.push(`link ${link.step} (${link.solver}) recomputes to a different hash — its inputs or outputs changed`);
    if (re.solverVersion !== link.solverVersion) reasons.push(`link ${link.step} solver version changed (${link.solverVersion} -> ${re.solverVersion})`);
  }
  return { valid: reasons.length === 0, reasons };
}

export { canonical, sha256 };
export default { CHAIN_RECEIPT_VERSION, linkReceipt, buildChainReceipt, verifyChainReceipt };
