// Wave 2 — corpus #8 (health-bar-for-everything), the faction + npc scalars on
// the spine. Pins: faction viability fades toward the collapse-momentum boundary,
// npc viability fades toward the mental-break threshold, and the boolean gates
// match the live faction-strategy / npc-stress thresholds.
//
// Run: node --test tests/viability/scalar-viability.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  factionViability, isFactionCollapsing, npcViability, isNpcBreaking,
  FACTION_COLLAPSE_MOMENTUM, NPC_BREAK_STRESS,
} from "../../lib/viability/adapters/scalar-viability.js";

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe("faction viability (#8)", () => {
  it("ascendant momentum → 1, at the collapse boundary → 0", () => {
    assert.ok(close(factionViability(1), 1));
    assert.ok(close(factionViability(FACTION_COLLAPSE_MOMENTUM), 0));
    // mid: momentum 0.2 → (0.2+0.6)/1.6 = 0.5
    assert.ok(close(factionViability(0.2), 0.5));
  });
  it("collapse gate matches the war→truce threshold", () => {
    assert.equal(isFactionCollapsing(-0.7), true);
    assert.equal(isFactionCollapsing(-0.5), false);
    assert.equal(factionViability(-0.9), 0); // past the boundary → clamped 0
  });
});

describe("npc viability (#8)", () => {
  it("serene → 1, at the break threshold → 0, midway → 0.5", () => {
    assert.ok(close(npcViability(0), 1));
    assert.ok(close(npcViability(NPC_BREAK_STRESS), 0));
    assert.ok(close(npcViability(40), 0.5));
  });
  it("break gate matches npc-stress's threshold", () => {
    assert.equal(isNpcBreaking(85), true);
    assert.equal(isNpcBreaking(70), false);
    assert.equal(npcViability(95), 0); // past break → clamped 0
  });
});
