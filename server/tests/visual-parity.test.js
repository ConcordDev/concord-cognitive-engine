// Instrument 2 — the visual render-parity (data×vision) analyzer. Pins the
// three-layer comparison (presence / appearance / animation) + the aggregate
// %drawn/%equipped/%animating the health report surfaces.
//
// Run: node --test tests/visual-parity.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parityForEntity, aggregateParity } from "../../scripts/playtest/visual-playtest.mjs";

describe("visual render-parity analyzer", () => {
  it("full parity when vision sees what the data knows", () => {
    const r = parityForEntity(
      { present: true, equipped: ["sword"], activity: "forge" },
      { present: true, sees: ["an npc holding a sword"], motion: "forge work at an anvil" },
    );
    assert.equal(r.parity, true);
    assert.ok(r.layers.presence && r.layers.appearance && r.layers.animation);
  });

  it("catches a present-but-naked NPC (gear in data, not on screen)", () => {
    const r = parityForEntity(
      { present: true, equipped: ["sword", "armor"] },
      { present: true, sees: ["an npc"] },
    );
    assert.equal(r.parity, false);
    assert.ok(r.mismatches.some((m) => m.layer === "appearance"));
  });

  it("catches a T-posing NPC (activity in data, no motion seen)", () => {
    const r = parityForEntity({ present: true, activity: "forge" }, { present: true, motion: "standing still" });
    assert.equal(r.layers.animation, false);
  });

  it("catches an invisible NPC (data says present, vision sees nothing)", () => {
    const r = parityForEntity({ present: true }, { present: false });
    assert.equal(r.layers.presence, false);
  });

  it("aggregates to %drawn / %equipped / %animating", () => {
    const agg = aggregateParity([
      parityForEntity({ present: true, equipped: ["sword"], activity: "walk" }, { present: true, sees: ["sword"], motion: "walking" }),
      parityForEntity({ present: true, equipped: ["bow"] }, { present: true, sees: ["nothing"] }), // naked
      parityForEntity({ present: true }, { present: false }), // invisible
    ]);
    assert.equal(agg.total, 3);
    assert.equal(agg.pctDrawn, 67);     // 2 of 3 present
    assert.equal(agg.pctEquipped, 67);  // 2 of 3 (the invisible one has no equipped req)
    assert.equal(agg.parity, false);
  });
});
