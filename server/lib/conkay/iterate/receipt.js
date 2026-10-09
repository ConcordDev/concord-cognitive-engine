// server/lib/conkay/iterate/receipt.js
//
// Loop receipts: the hash of the input design IR, the id@version of every
// solver that ran, and each run's status + input hash. A receipt is valid
// only for the same IR and the same solver versions (spec 8 rule 9):
// change either and verifyReceipt() says why it no longer holds.

import crypto from "node:crypto";
import { listSolvers } from "../physics/registry.js";

export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const sha256 = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : canonical(v)).digest("hex");

export function solverVersions(ids) {
  const all = new Map(listSolvers().map((s) => [s.id, s.version]));
  return Object.fromEntries([...ids].sort().map((id) => [id, all.get(id) ?? null]));
}

export function makeReceipt({ ir, solverIds, envelopes, finalDesign, loopVersion }) {
  const body = {
    loopVersion,
    irSha256: sha256(ir),
    solvers: solverVersions(solverIds),
    finalDesignSha256: sha256(finalDesign),
    runs: envelopes.filter(Boolean).map((e) => ({ runId: e.runId, status: e.status, inputHash: e.provenance?.inputHash ?? null })).sort((a, b) => a.runId.localeCompare(b.runId)),
  };
  return { ...body, sha256: sha256(body) };
}

/** Does a receipt still describe this IR under the current solver registry? */
export function verifyReceipt(receipt, ir) {
  const reasons = [];
  if (sha256(ir) !== receipt.irSha256) reasons.push("input design IR changed since the receipt was issued");
  const now = solverVersions(Object.keys(receipt.solvers));
  for (const [id, v] of Object.entries(receipt.solvers)) {
    if (now[id] !== v) reasons.push(`solver ${id} is now ${now[id] ?? "missing"} (receipt used ${v})`);
  }
  const { sha256: s, ...body } = receipt;
  if (sha256(body) !== s) reasons.push("receipt body does not match its hash");
  return { valid: reasons.length === 0, reasons };
}
