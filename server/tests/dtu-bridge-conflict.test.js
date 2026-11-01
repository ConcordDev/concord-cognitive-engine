// server/tests/dtu-bridge-conflict.test.js
//
// Slice 3 (DTU bridge): the provenance conflict rule. The headline
// cases are the founder's, verbatim from the bridge plan:
//   - an invalid provenance chain must NEVER overwrite a valid copy;
//   - incomparable chains refuse a merge.
// Plus the ordinary traffic: new DTU, fast-forward, duplicate, stale,
// and a corrupt held copy (refused, surfaced — never silently fixed).

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeProvenance } from "../lib/dtu-bridge/provenance.js";
import { decideOverwrite } from "../lib/dtu-bridge/conflict-rule.js";

function rec(id, content, parentHash = null) {
  const payload = { id, tier: "canonical", scope: "public", content, createdAt: "2026-10-28T00:00:00.000Z" };
  return { table: "dtus", id, payload, provenance: makeProvenance(payload, parentHash) };
}
function chain(...contents) {
  const out = [];
  for (const c of contents) out.push(rec("dtu-1", c, out.length ? out[out.length - 1].provenance.contentHash : null));
  return out;
}

test("an invalid chain never overwrites a valid copy", () => {
  const existing = chain("alpha", "beta");
  const forged = chain("alpha", "beta");
  forged[1] = { ...forged[1], payload: { ...forged[1].payload, content: "FORGED HISTORY" } };
  const res = decideOverwrite({ existing, incoming: forged });
  assert.equal(res.decision, "reject");
  assert.equal(res.reason, "invalid_chain");
});

test("a chain with a spliced middle link is invalid and rejected", () => {
  const existing = chain("alpha", "beta");
  const spliced = chain("alpha", "beta", "gamma");
  spliced[1] = rec("dtu-1", "INSERTED", spliced[0].provenance.contentHash); // head no longer links
  const res = decideOverwrite({ existing, incoming: spliced });
  assert.equal(res.decision, "reject");
  assert.equal(res.reason, "invalid_chain");
});

test("incomparable chains refuse a merge (a fork is not merged, ever)", () => {
  const existing = chain("alpha", "beta");
  const fork = chain("alpha", "DIFFERENT SECOND VERSION");
  const res = decideOverwrite({ existing, incoming: fork });
  assert.equal(res.decision, "refuse");
  assert.equal(res.reason, "incomparable_chains");
});

test("disjoint roots refuse as incomparable", () => {
  const res = decideOverwrite({ existing: chain("one root"), incoming: chain("another root") });
  assert.equal(res.decision, "refuse");
  assert.equal(res.reason, "incomparable_chains");
});

test("a valid extension fast-forwards", () => {
  const existing = chain("alpha", "beta");
  const incoming = chain("alpha", "beta", "gamma");
  const res = decideOverwrite({ existing, incoming });
  assert.equal(res.decision, "accept");
  assert.equal(res.reason, "fast_forward");
});

test("a single next version anchors onto the held head and fast-forwards", () => {
  const existing = chain("alpha", "beta");
  const next = rec("dtu-1", "gamma", existing[1].provenance.contentHash);
  const res = decideOverwrite({ existing, incoming: [next] });
  assert.equal(res.decision, "accept");
  assert.equal(res.reason, "fast_forward");
});

test("a brand-new DTU is accepted", () => {
  const res = decideOverwrite({ existing: [], incoming: chain("alpha") });
  assert.equal(res.decision, "accept");
  assert.equal(res.reason, "new");
});

test("the same head is a duplicate, not a write", () => {
  const existing = chain("alpha", "beta");
  const res = decideOverwrite({ existing, incoming: chain("alpha", "beta") });
  assert.equal(res.decision, "duplicate");
});

test("a stale (behind) chain is rejected without touching the held copy", () => {
  const res = decideOverwrite({ existing: chain("alpha", "beta"), incoming: chain("alpha") });
  assert.equal(res.decision, "reject");
  assert.equal(res.reason, "stale");
});

test("a corrupt held copy refuses and surfaces, even for a valid incoming chain", () => {
  const existing = chain("alpha", "beta");
  existing[0] = { ...existing[0], payload: { ...existing[0].payload, content: "LOCALLY CORRUPTED" } };
  const res = decideOverwrite({ existing, incoming: chain("alpha", "beta", "gamma") });
  assert.equal(res.decision, "refuse");
  assert.equal(res.reason, "existing_chain_invalid");
});

test("chains for different DTUs are refused; empty incoming is rejected", () => {
  const other = [rec("dtu-2", "alpha")];
  assert.equal(decideOverwrite({ existing: chain("alpha"), incoming: other }).reason, "different_dtu");
  assert.equal(decideOverwrite({ existing: chain("alpha"), incoming: [] }).decision, "reject");
});
