// Engine N8 × cooking — reaction equilibrium doneness curve. Pins that yield
// rises with heat to a peak then falls when burning sets in, regime labels, and
// the bounded quality multiplier.
//
// Run: node --test tests/viability/cook-chemistry.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cookYield, cookQualityMultiplier } from "../../lib/viability/cook-chemistry.js";

describe("cookYield", () => {
  it("is a doneness curve: cold < hot, but burning (too hot) drops it back", () => {
    const cold = cookYield({ heat: 0.1 }).cookedFraction;
    const peak = cookYield({ heat: 0.8 }).cookedFraction;
    const burnt = cookYield({ heat: 1.0 }).cookedFraction;
    assert.ok(peak > cold, `peak ${peak} > cold ${cold}`);
    assert.ok(peak > burnt, `peak ${peak} > burnt ${burnt}`); // Le Chatelier the wrong way
  });

  it("labels the regime", () => {
    assert.equal(cookYield({ heat: 0.1 }).regime, "undercooked");
    assert.equal(cookYield({ heat: 0.6 }).regime, "cooked");
    assert.equal(cookYield({ heat: 0.95 }).regime, "burnt");
  });

  it("conserves mass (raw + cooked = total) and spoilage lowers yield", () => {
    const r = cookYield({ rawAmount: 4, heat: 0.6, spoilage: 0.1 });
    assert.ok(Math.abs(r.raw + r.cooked - 4) < 1e-9);
    const fresh = cookYield({ heat: 0.6, spoilage: 0.0 }).cookedFraction;
    const spoiled = cookYield({ heat: 0.6, spoilage: 0.8 }).cookedFraction;
    assert.ok(fresh > spoiled);
  });
});

describe("cookQualityMultiplier", () => {
  it("is bounded [0.5,1.5] and best near peak doneness", () => {
    const m = cookQualityMultiplier({ heat: 0.8 });
    assert.ok(m >= 0.5 && m <= 1.5);
    assert.ok(cookQualityMultiplier({ heat: 0.8 }) > cookQualityMultiplier({ heat: 0.05 }));
  });
});
