// server/lib/dtu-bridge/conflict-rule.js
//
// DTU bridge — Slice 3: the provenance conflict rule.
//
// When two copies of a DTU disagree, the provenance chain decides —
// this is the founder's rule, stated in the bridge plan and enforced
// here as a pure function (it mutates nothing; Slice 4 acts on its
// decisions):
//
//   - An invalid chain NEVER overwrites a valid copy. If the incoming
//     chain fails verification — a hash that does not recompute, a
//     broken link, a bad signature — it is rejected outright.
//   - Incomparable chains refuse a merge. If neither chain contains
//     the other's head (a fork, or two unrelated roots), the rule
//     refuses: no last-writer-wins, no silent merge. A human or a
//     higher layer must reconcile; the bridge never guesses.
//   - A valid chain that strictly extends the held chain fast-forwards
//     it. A chain that is merely behind is stale and changes nothing.
//   - If the HELD chain itself fails verification, the rule refuses
//     too: a corrupt local copy is a repair problem to surface, not
//     something an incoming copy silently papers over.
//
// Decisions: "accept" (new | fast_forward), "duplicate" (same head),
// "reject" (invalid_chain | stale | empty_incoming),
// "refuse" (incomparable_chains | existing_chain_invalid |
// different_dtu). Only "accept" may lead to a write.

import { verifyChain } from "./provenance.js";

function chainIdentity(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const { table, id } = records[0];
  for (const r of records) {
    if (r.table !== table || r.id !== id) return "mixed";
  }
  return { table, id };
}

function headHash(records) {
  return records[records.length - 1].provenance.contentHash;
}

export function decideOverwrite({ existing = [], incoming = [], key = null } = {}) {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return { decision: "reject", reason: "empty_incoming" };
  }
  const inId = chainIdentity(incoming);
  const exId = chainIdentity(existing);
  if (inId === "mixed" || exId === "mixed" || (exId && inId && (exId.table !== inId.table || exId.id !== inId.id))) {
    return { decision: "refuse", reason: "different_dtu" };
  }

  const inCheck = verifyChain(incoming, { key });
  if (!inCheck.valid) {
    return { decision: "reject", reason: "invalid_chain", failures: inCheck.failures };
  }

  if (!existing || existing.length === 0) {
    return { decision: "accept", reason: "new", signatureChecked: inCheck.signatureChecked };
  }

  const exCheck = verifyChain(existing, { key });
  if (!exCheck.valid) {
    return { decision: "refuse", reason: "existing_chain_invalid", failures: exCheck.failures };
  }

  const exHead = headHash(existing);
  const inHead = headHash(incoming);
  if (exHead === inHead) {
    return { decision: "duplicate", reason: "already_present" };
  }

  const inHashes = new Set(incoming.map((r) => r.provenance.contentHash));
  // Fast-forward when the held head is inside the incoming chain, or
  // when the incoming chain's root anchors directly onto the held
  // head (a single next version, or a segment whose earlier versions
  // are exactly the held chain).
  if (inHashes.has(exHead) || incoming.some((r) => r.provenance.parentHash === exHead)) {
    return { decision: "accept", reason: "fast_forward", signatureChecked: inCheck.signatureChecked };
  }

  const exHashes = new Set(existing.map((r) => r.provenance.contentHash));
  if (exHashes.has(inHead)) {
    return { decision: "reject", reason: "stale" };
  }

  return { decision: "refuse", reason: "incomparable_chains" };
}
