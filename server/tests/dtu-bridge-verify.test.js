// server/tests/dtu-bridge-verify.test.js
//
// Slice 5 (DTU bridge): the end-to-end dry run — the observable proof
// that slices 0–4 compose into a working bridge with no database, no
// network and no credential. Scenario: four DTUs cross (or try to):
// a new one syncs, an extension fast-forwards, a fork is refused with
// the target's own copy preserved, and a spliced (invalid) chain does
// not land its forged head. The report must show all four outcomes
// explicitly and every chain the target holds must still verify.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeProvenance } from "../lib/dtu-bridge/provenance.js";
import { runBridgeDryRun } from "../lib/dtu-bridge/verify.js";

function rec(id, content, parentHash = null) {
  const payload = { id, tier: "canonical", scope: "public", content, createdAt: "2026-10-28T00:00:00.000Z" };
  return { table: "dtus", id, payload, provenance: makeProvenance(payload, parentHash) };
}
function chain(id, ...contents) {
  const out = [];
  for (const c of contents) out.push(rec(id, c, out.length ? out[out.length - 1].provenance.contentHash : null));
  return out;
}

test("dry run: new + extended DTUs sync; fork and spliced chain are refused with reasons", () => {
  // Target already holds: dtu-2 at v1, dtu-3 at its own v2, dtu-4 at v2.
  const targetChains = [chain("dtu-2", "one"), chain("dtu-3", "alpha", "beta"), chain("dtu-4", "alpha", "beta")];

  // Source sends: dtu-1 brand new; dtu-2 extended; dtu-3 forked; dtu-4 spliced.
  const spliced = chain("dtu-4", "alpha", "beta", "gamma");
  spliced[1] = rec("dtu-4", "SPLICED", spliced[0].provenance.contentHash);
  const sourceChains = [
    chain("dtu-1", "fresh"),
    chain("dtu-2", "one", "two", "three"),
    chain("dtu-3", "alpha", "FORK"),
    spliced,
  ];

  const report = runBridgeDryRun({ sourceChains, targetChains });

  assert.equal(report.ok, true);
  const byId = Object.fromEntries(report.perDtu.map((d) => [d.id, d]));
  assert.equal(byId["dtu-1"].inSync, true);
  assert.equal(byId["dtu-2"].inSync, true);
  assert.equal(byId["dtu-3"].inSync, false); // fork refused — target keeps its own copy
  assert.equal(byId["dtu-4"].inSync, false); // spliced chain is NOT the target's chain
  assert.equal(byId["dtu-4"].headConverged, true); // …though the honest head record converged onto the genuine parent — reported, not hidden

  const refusalIds = new Set(report.refusals.map((r) => r.id));
  assert.ok(refusalIds.has("dtu-3"));
  assert.ok(refusalIds.has("dtu-4"));
  assert.ok(report.targetIntegrity.every((r) => r.valid), "every held chain must still verify");
  assert.equal(report.counts.failed, 0);
});

test("dry run: an empty bridge is a clean, honest no-op", () => {
  const report = runBridgeDryRun({ sourceChains: [], targetChains: [] });
  assert.equal(report.ok, true);
  assert.equal(report.counts.enqueued, 0);
  assert.deepEqual(report.perDtu, []);
});

test("dry run: re-sending the same source is all duplicates, nothing double-applies", () => {
  const sourceChains = [chain("dtu-1", "a", "b")];
  const first = runBridgeDryRun({ sourceChains, targetChains: [] });
  assert.equal(first.perDtu[0].inSync, true);
  // Second run: target already holds the full chain (seeded with it).
  const second = runBridgeDryRun({ sourceChains, targetChains: sourceChains });
  assert.equal(second.perDtu[0].inSync, true);
  assert.equal(second.counts.applied, 0);
  assert.equal(second.counts.duplicates, 2);
});
