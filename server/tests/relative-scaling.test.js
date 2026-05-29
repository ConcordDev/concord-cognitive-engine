/**
 * E1 (Phase E §0 — "the one law") — relative NPC scaling band math.
 *
 * Pins: gated OFF by default (no behaviour change); when on, common NPCs are
 * capped below the player (curb-stomp trash) and named/boss NPCs are floored to
 * ~player tier (always a credible threat), never inflating trash or nerfing an
 * already-overlevelled boss.
 *
 * Run: node --test tests/relative-scaling.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  relativeScaledLevel,
  relativeScalingEnabled,
  getPlayerCombatLevel,
} from "../lib/entity-power.js";

const ORIG = process.env.CONCORD_RELATIVE_SCALING;
afterEach(() => { process.env.CONCORD_RELATIVE_SCALING = ORIG; });

describe("E1 — gated off by default", () => {
  beforeEach(() => { delete process.env.CONCORD_RELATIVE_SCALING; });
  it("is a no-op when the flag is unset", () => {
    assert.equal(relativeScalingEnabled(), false);
    assert.equal(relativeScaledLevel(200, 100, { named: false }), 200);
    assert.equal(relativeScaledLevel(50, 100, { named: true }), 50);
  });
});

describe("E1 — relative scaling ON", () => {
  beforeEach(() => { process.env.CONCORD_RELATIVE_SCALING = "1"; });

  it("caps a high-level common NPC below the player (player outgrows trash)", () => {
    // player 100, commonHi 0.85 → ceiling 85; a level-200 common NPC reads 85.
    assert.equal(relativeScaledLevel(200, 100, { named: false }), 85);
  });

  it("does NOT inflate a weak common NPC up to the ceiling", () => {
    // a level-50 common NPC vs a level-100 player stays 50 (we only cap).
    assert.equal(relativeScaledLevel(50, 100, { named: false }), 50);
  });

  it("floors a weak named/boss NPC up to ~player tier (stakes preserved)", () => {
    // player 100, named mid (1.0+1.1)/2 = 1.05 → 105.
    assert.equal(relativeScaledLevel(50, 100, { named: true }), 105);
  });

  it("keeps an already-overlevelled boss at its own level", () => {
    assert.equal(relativeScaledLevel(300, 100, { named: true }), 300);
  });

  it("is safe with garbage inputs", () => {
    // own coerces to 1; common caps at min(1, ceiling) = 1.
    assert.equal(relativeScaledLevel("x", 100, { named: false }), 1);
    // player 0 coerces to 1 → named target round(1*1.05)=1 → keeps own 50.
    assert.equal(relativeScaledLevel(50, 0, { named: true }), 50);
  });
});

describe("E1 — getPlayerCombatLevel", () => {
  it("degrades to 1 on null db", () => {
    assert.equal(getPlayerCombatLevel(null, "u1"), 1);
    assert.equal(getPlayerCombatLevel({}, null), 1);
  });
});
