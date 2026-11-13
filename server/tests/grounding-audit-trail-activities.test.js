// grounding-audit-trail-activities.test.js
//
// FIX-grounding-012: the audit trail recorded fact checks (via
// recordCheck) but never Source tier, Decompose, or the verification
// mint, so the Audit trail tab could not reconstruct three of the
// four workbench actions. grounding.recordActivity now appends those
// entries in the trail's established shape.

import { test } from "node:test";
import assert from "node:assert/strict";

async function loadActions() {
  globalThis._concordSTATE = {};
  const actions = new Map();
  const { default: registerGroundingActions } = await import("../domains/grounding.js");
  registerGroundingActions((domain, action, fn) => actions.set(`${domain}.${action}`, fn));
  return actions;
}
const CTX = { actor: { userId: "walker" }, userId: "walker" };
const ART = { id: null, data: {}, meta: {} };

test("source-tier, decompose, and mint activities land in the audit trail", async () => {
  const actions = await loadActions();
  const record = actions.get("grounding.recordActivity");
  const auditTrail = actions.get("grounding.auditTrail");

  const tier = record(CTX, ART, { kind: "source-tier", claim: "reuters.com", summary: "credible (72/100)" });
  assert.equal(tier.ok, true);
  assert.equal(tier.result.recorded.action, "source tier scored");

  const dec = record(CTX, ART, { kind: "decompose", claim: "Water boils at 100 °C and steam rises", summary: "2 atomic claims (conjunction)" });
  assert.equal(dec.ok, true);
  assert.equal(dec.result.recorded.action, "claim decomposed");

  const mint = record(CTX, ART, { kind: "mint", claim: "Water boils at 100 °C", dtuId: "dtu_cefaed756d8e30222602" });
  assert.equal(mint.ok, true);
  assert.equal(mint.result.recorded.action, "verification DTU minted");
  assert.equal(mint.result.recorded.dtuId, "dtu_cefaed756d8e30222602");
  assert.equal(mint.result.recorded.verdict, "dtu_cefaed756d8e30222602");

  const trail = auditTrail(CTX, ART, {}).result.trail;
  assert.deepEqual(trail.map((e) => e.action), [
    "verification DTU minted",
    "claim decomposed",
    "source tier scored",
  ]);
});

test("recordActivity refuses unknown kinds and a mint without its DTU id", async () => {
  const actions = await loadActions();
  const record = actions.get("grounding.recordActivity");
  assert.equal(record(CTX, ART, { kind: "publish" }).ok, false);
  const noId = record(CTX, ART, { kind: "mint", claim: "x" });
  assert.equal(noId.ok, false);
  assert.match(noId.error, /dtuId/);
  const trail = actions.get("grounding.auditTrail")(CTX, ART, {}).result.trail;
  assert.equal(trail.length, 0);
});
