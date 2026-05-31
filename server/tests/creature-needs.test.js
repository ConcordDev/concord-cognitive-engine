// Wave 6 / Layer 3 — the creature motive layer.
//
// Pins diet-driven decay, intent mapping (seek_water/graze/hunt/flee/seek_shade),
// environment amplification (heat→thirst, predator→flee), and totality.
//
// Run: node --test tests/creature-needs.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  freshCreatureNeeds, decayCreatureNeeds, satisfyCreatureNeed, creatureIntent,
  hasUrgentNeed, CREATURE_NEED_KINDS,
} from "../lib/ecosystem/creature-needs.js";

describe("Wave 6 — creature needs", () => {
  it("fresh needs are all zero; decay raises deficits by diet", () => {
    const fresh = freshCreatureNeeds();
    assert.ok(CREATURE_NEED_KINDS.every((k) => fresh[k] === 0));
    const carn = decayCreatureNeeds(fresh, "carnivore", 1);
    const herb = decayCreatureNeeds(fresh, "herbivore", 1);
    assert.ok(carn.hunger > herb.hunger, "carnivore hunger decays faster");
  });

  it("satisfy lowers a need; clamps at 0", () => {
    const n = decayCreatureNeeds(freshCreatureNeeds(), "omnivore", 2);
    const drank = satisfyCreatureNeed(n, "thirst", 1);
    assert.equal(drank.thirst, 0);
  });

  it("intent: a thirsty creature seeks water; heat amplifies it", () => {
    const n = { ...freshCreatureNeeds(), thirst: 0.55 };
    assert.equal(creatureIntent(n, { diet: "herbivore" }, { temp: 35 }), "seek_water");
  });

  it("intent: a hungry carnivore hunts, herbivore grazes", () => {
    const n = { ...freshCreatureNeeds(), hunger: 0.8 };
    assert.equal(creatureIntent(n, { diet: "carnivore" }), "hunt");
    assert.equal(creatureIntent(n, { diet: "herbivore" }), "graze");
  });

  it("intent: a predator nearby forces flee regardless", () => {
    assert.equal(creatureIntent(freshCreatureNeeds(), { diet: "herbivore" }, { predatorNear: true }), "flee");
  });

  it("intent: content creature wanders (or seeks shade in heat)", () => {
    assert.equal(creatureIntent(freshCreatureNeeds(), { diet: "omnivore" }, { temp: 18 }), "wander");
    assert.equal(creatureIntent(freshCreatureNeeds(), { diet: "omnivore" }, { temp: 35 }), "seek_shade");
  });

  it("hasUrgentNeed fires at >= 0.7; total on garbage", () => {
    assert.equal(hasUrgentNeed({ hunger: 0.75 }), true);
    assert.equal(hasUrgentNeed({}), false);
    assert.doesNotThrow(() => creatureIntent(null, null, null));
  });
});
