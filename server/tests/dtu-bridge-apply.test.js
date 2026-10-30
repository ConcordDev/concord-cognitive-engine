// server/tests/dtu-bridge-apply.test.js
//
// Slice 4 (DTU bridge): the apply engine + the outbox pump.
// The centrepiece is the contract's required case, end to end: a
// target holding a valid copy receives a pack carrying an invalid
// provenance chain — the pack is rejected and the valid copy is
// byte-for-byte untouched afterwards. Plus fast-forward application,
// fork refusal, idempotent re-application, and the pump's outcome
// mapping (delivered / duplicate / abandoned / failed).

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeProvenance } from "../lib/dtu-bridge/provenance.js";
import { buildPack } from "../lib/dtu-bridge/pack-envelope.js";
import { createMemoryStore, createOutbox } from "../lib/dtu-bridge/outbox.js";
import { applyPack, createMemoryTarget, drainOutboxToTarget } from "../lib/dtu-bridge/apply.js";

function rec(id, content, parentHash = null) {
  const payload = { id, tier: "canonical", scope: "public", content, createdAt: "2026-10-28T00:00:00.000Z" };
  return { table: "dtus", id, payload, provenance: makeProvenance(payload, parentHash) };
}
function chain(...contents) {
  const out = [];
  for (const c of contents) out.push(rec("dtu-1", c, out.length ? out[out.length - 1].provenance.contentHash : null));
  return out;
}

test("applyPack lands a new DTU and then fast-forwards it", () => {
  const target = createMemoryTarget();
  const v1 = chain("alpha");
  let res = applyPack(target, buildPack({ records: v1 }));
  assert.deepEqual(res.receipts, [{ table: "dtus", id: "dtu-1", decision: "accept", reason: "new", applied: 1 }]);

  const v3 = chain("alpha", "beta", "gamma");
  res = applyPack(target, buildPack({ records: v3 }));
  assert.equal(res.receipts[0].decision, "accept");
  assert.equal(res.receipts[0].reason, "fast_forward");
  assert.equal(res.receipts[0].applied, 2); // only the two versions the target lacked
  assert.equal(target.getChain("dtus", "dtu-1").length, 3);
});

test("an invalid provenance chain fails to overwrite a valid copy — the copy is untouched", () => {
  const target = createMemoryTarget();
  const valid = chain("alpha", "beta");
  applyPack(target, buildPack({ records: valid }));
  const before = JSON.stringify(target.getChain("dtus", "dtu-1"));

  // A pack whose records were built honestly, then forged in transit:
  // parse-level tampering is refused whole…
  const forgedWire = JSON.parse(JSON.stringify(buildPack({ records: chain("alpha", "beta") })));
  forgedWire.records[1].payload.content = "FORGED HISTORY";
  let res = applyPack(target, forgedWire);
  assert.equal(res.ok, false);

  // …and a pack carrying an internally inconsistent chain (records
  // re-signed around a splice by rebuilding the pack around them)
  // is rejected by the rule, per-DTU, with the target untouched.
  const spliced = chain("alpha", "beta", "gamma");
  spliced[1] = rec("dtu-1", "SPLICED", spliced[0].provenance.contentHash);
  // Rebuild provenance so each record is self-consistent but the CHAIN is broken:
  spliced[2] = rec("dtu-1", "gamma", spliced[2].provenance.parentHash);
  res = applyPack(target, buildPack({ records: spliced }));
  assert.equal(res.ok, true);
  assert.equal(res.receipts[0].decision, "reject");
  assert.equal(res.receipts[0].reason, "invalid_chain");
  assert.equal(JSON.stringify(target.getChain("dtus", "dtu-1")), before);
});

test("a fork is refused and the held chain is unchanged; re-applying the same pack is a duplicate", () => {
  const target = createMemoryTarget();
  applyPack(target, buildPack({ records: chain("alpha", "beta") }));
  const forkRes = applyPack(target, buildPack({ records: chain("alpha", "OTHER") }));
  assert.equal(forkRes.receipts[0].decision, "refuse");
  assert.equal(forkRes.receipts[0].applied, 0);
  assert.equal(target.getChain("dtus", "dtu-1").length, 2);

  const dupRes = applyPack(target, buildPack({ records: chain("alpha", "beta") }));
  assert.equal(dupRes.receipts[0].decision, "duplicate");
  assert.equal(target.getChain("dtus", "dtu-1").length, 2);
});

test("the pump drains the outbox into the target, once", () => {
  const outbox = createOutbox(createMemoryStore(), { now: () => 5_000_000 });
  const target = createMemoryTarget();
  const ch = chain("alpha", "beta");
  outbox.enqueuePack(buildPack({ records: ch }));

  const s1 = drainOutboxToTarget(outbox, target);
  assert.deepEqual(s1, { claimed: 2, applied: 2, duplicates: 0, abandoned: 0, failed: 0 });
  assert.equal(target.getChain("dtus", "dtu-1").length, 2);
  assert.equal(outbox.stats().delivered, 2);

  const s2 = drainOutboxToTarget(outbox, target);
  assert.equal(s2.claimed, 0); // nothing left to deliver — no double delivery
});

test("the pump abandons a poison record and still applies the rest", () => {
  const store = createMemoryStore();
  const outbox = createOutbox(store, { now: () => 5_000_000 });
  const target = createMemoryTarget();
  applyPack(target, buildPack({ records: chain("alpha", "beta") }));

  // A forked next version can never apply to the held chain.
  const forkNext = rec("dtu-1", "FORKED", chain("alpha")[0].provenance.contentHash);
  const good = rec("dtu-2", "fresh");
  outbox.enqueuePack(buildPack({ records: [forkNext] }));
  outbox.enqueuePack(buildPack({ records: [good] }));

  const s = drainOutboxToTarget(outbox, target);
  assert.equal(s.abandoned, 1);
  assert.equal(s.applied, 1);
  assert.equal(target.getChain("dtus", "dtu-2").length, 1);
  assert.equal(target.getChain("dtus", "dtu-1").length, 2); // fork did not land
  const poisoned = store.all().find((r) => r.dtuId === "dtu-1");
  assert.equal(poisoned.status, "abandoned");
  assert.match(poisoned.lastError, /refuse:incomparable_chains/);
});
