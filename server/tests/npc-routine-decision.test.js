// Pins the 2026-10-23 fix: NPC action choice no longer asks the LLM for every
// non-urgent NPC on every tick. chooseRoutineAction decides from needs, the
// archetype's work and the time of day, deterministically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseRoutineAction, isPeopleArchetype } from "../lib/npc-simulator.js";

const calm = { hunger: 0.9, rest: 0.9, social: 0.9, purpose: 0.9, safety: 0.9 };

test("people work their archetype's job during the day", () => {
  assert.deepEqual(chooseRoutineAction({ archetype: "farmer", needs: calm, segment: "morning", roll: 0.1 }), { action: "gather_resource" });
  assert.deepEqual(chooseRoutineAction({ archetype: "builder", needs: calm, segment: "midday", roll: 0.1 }), { action: "build_structure" });
  assert.deepEqual(chooseRoutineAction({ archetype: "trader", needs: calm, segment: "afternoon", roll: 0.1 }), { action: "trade" });
  assert.deepEqual(chooseRoutineAction({ archetype: "scholar", needs: calm, segment: "morning", roll: 0.1 }), { action: "practice_skill" });
  assert.deepEqual(chooseRoutineAction({ archetype: "guard", needs: calm, segment: "morning", roll: 0.1 }), { action: "travel" });
});

test("the day has a shape: rest at night, people at dusk", () => {
  assert.deepEqual(chooseRoutineAction({ archetype: "farmer", needs: calm, segment: "night", roll: 0.1 }), { action: "rest" });
  assert.deepEqual(chooseRoutineAction({ archetype: "farmer", needs: calm, segment: "dusk", roll: 0.1 }), { action: "socialize" });
});

test("a low social need is met by socializing, so it recovers instead of spawning quests", () => {
  const lonely = { ...calm, social: 0.35 };
  for (const segment of ["dawn", "morning", "midday", "afternoon", "dusk", "night"]) {
    assert.deepEqual(chooseRoutineAction({ archetype: "trader", needs: lonely, segment, roll: 0.99 }), { action: "socialize" }, segment);
  }
});

test("the lowest open need comes first", () => {
  const needs = { ...calm, social: 0.45, rest: 0.32 };
  assert.deepEqual(chooseRoutineAction({ archetype: "cook", needs, segment: "morning" }), { action: "rest" });
});

test("creatures and monsters never trade or socialize", () => {
  for (const archetype of ["creature:deer", "creature:fish", "undead", "wraith", "orc_warrior"]) {
    assert.equal(isPeopleArchetype(archetype), false, archetype);
    for (const segment of ["morning", "dusk", "night"]) {
      for (const roll of [0.1, 0.6, 0.95]) {
        const { action } = chooseRoutineAction({ archetype, needs: { ...calm, social: 0.1 }, segment, roll });
        assert.ok(["rest", "travel", "gather_resource"].includes(action), `${archetype} ${segment} ${roll} -> ${action}`);
      }
    }
  }
  assert.equal(isPeopleArchetype("trader"), true);
});

test("same inputs, same action (no hidden randomness)", () => {
  const a = chooseRoutineAction({ archetype: "healer", needs: calm, segment: "afternoon", roll: 0.8 });
  const b = chooseRoutineAction({ archetype: "healer", needs: calm, segment: "afternoon", roll: 0.8 });
  assert.deepEqual(a, b);
});
