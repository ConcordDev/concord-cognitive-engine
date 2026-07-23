/**
 * Coverage contract for NPC aggression profiles.
 *
 * Pins that every archetype defined in npc-archetypes.js#UNIVERSE_ARCHETYPES
 * (all 8 universes × enemies/civilians/bosses) plus the GENERIC fallbacks
 * (wanderer / citizen / elder) resolves to a dedicated AGGRO_PROFILE entry —
 * never the `default` catch-all — so a spawned NPC of any archetype has a
 * hand-tuned behavior rather than the generic 0.3-aggro fallback.
 *
 * Also pins: each profile is either combat-capable or intentionally passive,
 * every value sits inside the documented ranges, and every damage-bonus key
 * has a matching profile.
 *
 * Run: node --test server/tests/npc-aggro-coverage.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { UNIVERSE_ARCHETYPES, getArchetypes } from "../lib/npc-archetypes.js";
import { AGGRO_PROFILE, ARCHETYPE_DAMAGE_BONUS } from "../lib/npc-simulator.js";

// Collect every archetype string across every universe + role, plus the three
// GENERIC fallbacks (resolved via getArchetypes on an unknown universe type,
// since GENERIC_ARCHETYPES itself is module-private).
function allArchetypes() {
  const set = new Set();
  for (const universe of Object.values(UNIVERSE_ARCHETYPES)) {
    for (const role of ["enemies", "civilians", "bosses"]) {
      for (const a of universe[role] || []) set.add(a.archetype);
    }
  }
  for (const role of ["enemies", "civilians", "bosses"]) {
    for (const a of getArchetypes("__unknown_universe__", role)) set.add(a.archetype);
  }
  return [...set];
}

describe("AGGRO_PROFILE archetype coverage", () => {
  const archetypes = allArchetypes();

  it("resolves a discovered archetype set of a sane size", () => {
    // Sanity that the enumeration actually found the archetypes (not empty).
    assert.ok(archetypes.length >= 50, `expected ≥50 archetypes, got ${archetypes.length}`);
  });

  it("every archetype has its own AGGRO_PROFILE key (never falls back to default)", () => {
    const missing = archetypes.filter((a) => !Object.prototype.hasOwnProperty.call(AGGRO_PROFILE, a));
    assert.deepEqual(missing, [], `archetypes with no dedicated profile: ${missing.join(", ")}`);
  });

  it("each profile is either combat-capable or intentionally passive", () => {
    for (const a of archetypes) {
      const p = AGGRO_PROFILE[a];
      const combat = p.aggro > 0 && p.pursuitRadius > 0 && p.melee >= 1;
      const passive = p.aggro === 0 && p.pursuitRadius === 0 && p.melee === 0;
      assert.ok(
        combat || passive,
        `${a} is neither cleanly combat-capable nor passive: ${JSON.stringify(p)}`,
      );
    }
  });

  it("every profile value sits inside the documented ranges", () => {
    for (const [name, p] of Object.entries(AGGRO_PROFILE)) {
      assert.ok(p.alertRadius >= 6 && p.alertRadius <= 18, `${name} alertRadius out of [6,18]: ${p.alertRadius}`);
      assert.ok(p.pursuitRadius >= 0 && p.pursuitRadius <= 30, `${name} pursuitRadius out of [0,30]: ${p.pursuitRadius}`);
      assert.ok(p.melee >= 0 && p.melee <= 3, `${name} melee out of [0,3]: ${p.melee}`);
      assert.ok(p.aggro >= 0.0 && p.aggro <= 0.95, `${name} aggro out of [0.0,0.95]: ${p.aggro}`);
      assert.equal(typeof p.canCallHelp, "boolean", `${name} canCallHelp not boolean`);
    }
  });

  it("neutral-faction civilians are passive (aggro 0.0)", () => {
    // Neutral-faction civilians are the true non-combatants (bakers, medics,
    // traders). Hero/law-faction civilians (guard, sheriff, knight, detective,
    // hunter, vigilante) sit in the civilians list but are intentionally
    // combatants — they are covered by the combat-or-passive dichotomy test,
    // not asserted passive here.
    const neutralCivilians = new Set();
    for (const universe of Object.values(UNIVERSE_ARCHETYPES)) {
      for (const c of universe.civilians || []) {
        if (c.faction === "neutral") neutralCivilians.add(c.archetype);
      }
    }
    for (const c of neutralCivilians) {
      assert.equal(AGGRO_PROFILE[c].aggro, 0.0, `neutral civilian ${c} should be passive`);
    }
  });

  it("every ARCHETYPE_DAMAGE_BONUS key has a matching AGGRO_PROFILE entry", () => {
    for (const key of Object.keys(ARCHETYPE_DAMAGE_BONUS)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(AGGRO_PROFILE, key),
        `damage-bonus key ${key} has no profile`,
      );
      assert.ok(ARCHETYPE_DAMAGE_BONUS[key] > 0, `damage-bonus ${key} should be > 0`);
    }
  });
});
