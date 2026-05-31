// Wave 2 — corpus #5 (ETCC unified resource-viability). Pins the one math for
// every depletable pool: stock viability, the R≥D net-flow balance, and the
// willDeplete collapse forecast — identical for metabolism/mana/treasury/etc.
//
// Run: node --test tests/viability/resource-etcc.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resourceViability, resourceFlow, isSustainable, willDeplete, RESOURCE_KINDS } from "../../lib/viability/adapters/resource.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe("ETCC resource viability (#5)", () => {
  it("V = stock/capacity (0 empty, 1 full, 0.5 half)", () => {
    assert.equal(resourceViability({ stock: 0, capacity: 100 }), 0);
    assert.ok(close(resourceViability({ stock: 100, capacity: 100 }), 1));
    assert.ok(close(resourceViability({ stock: 50, capacity: 100 }), 0.5));
  });

  it("net flow is the R≥D balance: repair − (throughput + decay)", () => {
    assert.equal(resourceFlow({ repairRate: 5, throughput: 3, decayRate: 1 }), 1);  // sustainable
    assert.equal(resourceFlow({ repairRate: 1, throughput: 3, decayRate: 1 }), -3); // bleeding
    assert.equal(isSustainable({ repairRate: 5, throughput: 3, decayRate: 1 }), true);
    assert.equal(isSustainable({ repairRate: 1, throughput: 3, decayRate: 1 }), false);
  });

  it("a bleeding pool depletes on a forecastable step; a sustainable one never does", () => {
    const bleeding = willDeplete({ stock: 10, capacity: 100, throughput: 2, repairRate: 0, decayRate: 0 }, { horizon: 30 });
    assert.equal(bleeding.exits, true);
    assert.ok(bleeding.stepOfExit >= 5 && bleeding.stepOfExit <= 7); // 10 / 2 ≈ 5 ticks to empty

    const sustainable = willDeplete({ stock: 10, capacity: 100, throughput: 2, repairRate: 3, decayRate: 0 }, { horizon: 50 });
    assert.equal(sustainable.exits, false); // R(3) ≥ load(2) → never empties (R≥D viable)
  });

  it("the same math serves all six subsystems (ecosystem, treasury, …)", () => {
    // a realm treasury (sparks) and an NPC's hunger run the identical call
    assert.ok(close(resourceViability({ stock: 800, capacity: 1000 }), 0.8)); // treasury
    assert.ok(close(resourceViability({ stock: 20, capacity: 100 }), 0.2));   // hunger near starving
    assert.ok(RESOURCE_KINDS.includes("treasury") && RESOURCE_KINDS.includes("metabolism"));
  });
});
