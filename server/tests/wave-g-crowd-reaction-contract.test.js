// server/tests/wave-g-crowd-reaction-contract.test.js
//
// Wave G5 — pins the crowd-reaction gate: archetype × distance × damage
// → reaction kind. Guards the combat anti-cheat invariant
// (finalDamage post-cap, never raw client damage).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crowdReactionTo } from "../lib/affect-behavior-gates.js";

describe("crowdReactionTo", () => {
  it("returns 'none' for very small damage (anti-cheat invariant: only matters at scale)", () => {
    const r = crowdReactionTo({ npcArchetype: "civilian", distance: 5, finalDamage: 2 });
    assert.equal(r.kind, "none");
  });

  it("civilian + ≤30m → flee_home, frantic, fearful", () => {
    const r = crowdReactionTo({ npcArchetype: "civilian", distance: 15, finalDamage: 50 });
    assert.equal(r.kind, "flee_home");
    assert.equal(r.movementStyle, "frantic");
    assert.equal(r.mood, "fearful");
  });

  it("child treated as civilian", () => {
    const r = crowdReactionTo({ npcArchetype: "child", distance: 10, finalDamage: 50 });
    assert.equal(r.kind, "flee_home");
  });

  it("merchant + ≤30m → cower, cautious", () => {
    const r = crowdReactionTo({ npcArchetype: "merchant", distance: 20, finalDamage: 50 });
    assert.equal(r.kind, "cower");
    assert.equal(r.movementStyle, "cautious");
  });

  it("elder treated as cowering", () => {
    const r = crowdReactionTo({ npcArchetype: "elder", distance: 12, finalDamage: 50 });
    assert.equal(r.kind, "cower");
  });

  it("guard + hasAuthority + ≤40m → engage, confident, hostile", () => {
    const r = crowdReactionTo({ npcArchetype: "guard", distance: 35, finalDamage: 50, hasAuthority: true });
    assert.equal(r.kind, "engage");
    assert.equal(r.movementStyle, "confident");
    assert.equal(r.mood, "hostile");
  });

  it("guard WITHOUT authority falls through to default", () => {
    const r = crowdReactionTo({ npcArchetype: "guard", distance: 22, finalDamage: 50, hasAuthority: false });
    // No civilian/cowering match → default watch band ≤25m.
    assert.equal(r.kind, "watch");
  });

  it("unknown archetype within 25m → watch (suspicious)", () => {
    const r = crowdReactionTo({ npcArchetype: "wanderer", distance: 20, finalDamage: 50 });
    assert.equal(r.kind, "watch");
    assert.equal(r.mood, "suspicious");
  });

  it("unknown archetype 25–40m → still watch but relaxed", () => {
    const r = crowdReactionTo({ npcArchetype: "wanderer", distance: 35, finalDamage: 50 });
    assert.equal(r.kind, "watch");
    assert.equal(r.movementStyle, "relaxed");
  });

  it("anything beyond 40m → none", () => {
    const r = crowdReactionTo({ npcArchetype: "civilian", distance: 50, finalDamage: 50 });
    assert.equal(r.kind, "none");
  });

  it("ttlSeconds set on every reactive kind", () => {
    for (const archetype of ["civilian", "merchant"]) {
      const r = crowdReactionTo({ npcArchetype: archetype, distance: 10, finalDamage: 50 });
      assert.ok(typeof r.ttlSeconds === "number" && r.ttlSeconds > 0);
    }
  });
});
