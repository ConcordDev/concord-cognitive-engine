// tests/depth/hvac-load-history.test.js
//
// HVAC load estimates are saved to the user's history when the Loads view
// asks (`save: true`), so the latest estimate is back after a reload and a
// server restart. Plain calls (other callers, depth tests) stay stateless.
// The result names its method honestly: a square-foot rule of thumb, not an
// ACCA Manual J calculation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";
import { serializeLensState, hydrateLensState } from "../../lib/lens-state-persistence.js";

const INPUT = { squareFootage: 1800, stories: 2, insulation: "good", climate: "hot-humid" };

describe("hvac — saved load estimates", () => {
  let ctx, other;
  before(async () => {
    ctx = await depthCtx("hvac-loads-a");
    other = await depthCtx("hvac-loads-b");
  });

  it("a plain loadCalculation is not recorded and says it is not Manual J", async () => {
    const r = await lensRun("hvac", "loadCalculation", { data: INPUT }, other);
    assert.equal(r.ok, true);
    assert.equal(r.result.loadId, undefined);
    assert.match(r.result.method, /Not an ACCA Manual J/);
    const list = await lensRun("hvac", "load-list", { params: {} }, other);
    assert.deepEqual(list.result.loads, []);
  });

  it("save: true records the estimate and load-list returns it newest first", async () => {
    const first = await lensRun("hvac", "loadCalculation", { data: { ...INPUT, save: true } }, ctx);
    assert.equal(first.ok, true);
    assert.match(first.result.loadId, /^load_/);
    // 1800 × 25 × 0.9 (good) × 1.25 (humid) × 1.1 (2 stories)
    assert.equal(first.result.coolingBTU, 55688);
    const second = await lensRun("hvac", "loadCalculation", { data: { ...INPUT, squareFootage: 1200, save: true } }, ctx);
    const list = await lensRun("hvac", "load-list", { params: {} }, ctx);
    assert.equal(list.result.loads[0].id, second.result.loadId);
    assert.equal(list.result.loads[1].id, first.result.loadId);
    assert.deepEqual(list.result.loads[1].inputs, INPUT);
    assert.equal(list.result.loads[1].result.coolingBTU, 55688);
  });

  it("another user does not see these estimates", async () => {
    const list = await lensRun("hvac", "load-list", { params: {} }, other);
    assert.deepEqual(list.result.loads, []);
  });

  it("survives a snapshot round-trip (serialize → JSON → hydrate), i.e. a restart", async () => {
    const STATE = globalThis._concordSTATE;
    const blob = JSON.parse(JSON.stringify(serializeLensState(STATE)));
    const fresh = {};
    hydrateLensState(fresh, blob);
    assert.ok(fresh.hvacLens.loads instanceof Map);
    const userId = ctx?.actor?.userId || ctx?.userId;
    const loads = fresh.hvacLens.loads.get(userId);
    assert.equal(loads.length, 2);
    assert.deepEqual(loads[1].inputs, INPUT);
  });
});
