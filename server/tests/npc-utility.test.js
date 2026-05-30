/**
 * Living Society WS4 — needs/utility-driven NPC behavior (the new brain).
 *
 * Proves movement is MOTIVATED, not scripted:
 *   - needs decay (deficit climbs) + satisfy lowers them;
 *   - a HUNGRY npc scores the tavern highest; a BROKE npc scores the forge;
 *   - distance + personality + schedule bias shape the choice;
 *   - a DESIRE bends the choice toward its POI (wants drive movement);
 *   - the same inputs → the same deterministic choice (seeded).
 *
 * Run: node --test tests/npc-utility.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshNeeds, decayNeeds, satisfy, satisfyFromAdvertisement, deficit, topNeed } from "../lib/npc-needs.js";
import { scoreGoal, chooseNextGoal } from "../lib/npc-utility.js";

// POIs advertising need-satisfaction (what npc-pois.js will resolve from real buildings).
const TAVERN = { id: "tavern1", type: "inn", dist: 20, advertises: { hunger: 0.6, social: 0.5 } };
const FORGE  = { id: "forge1",  type: "forge", dist: 25, advertises: { wealth: 0.6, purpose: 0.5 } };
const TEMPLE = { id: "temple1", type: "temple", dist: 30, advertises: { purpose: 0.7 } };
const HOME   = { id: "home1",   type: "house", dist: 15, advertises: { energy: 0.8 } };
const POIS = [TAVERN, FORGE, TEMPLE, HOME];

describe("WS4 — needs decay + satisfy", () => {
  it("deficits climb over time and satisfy lowers them", () => {
    const n0 = freshNeeds();
    const n1 = decayNeeds(n0, 5); // 5 hours
    assert.ok(deficit(n1, "hunger") > deficit(n0, "hunger"), "hunger should climb");
    const n2 = satisfy(n1, "hunger", 0.5);
    assert.ok(deficit(n2, "hunger") < deficit(n1, "hunger"), "eating lowers hunger");
  });

  it("satisfyFromAdvertisement applies a POI's whole advert; deficits clamp to [0,1]", () => {
    const n = satisfyFromAdvertisement({ hunger: 0.9, social: 0.9 }, TAVERN.advertises);
    assert.ok(deficit(n, "hunger") < 0.9 && deficit(n, "social") < 0.9);
    assert.ok(deficit(decayNeeds({ hunger: 0.99 }, 100), "hunger") <= 1.0);
  });

  it("topNeed reports the most pressing deficit", () => {
    assert.equal(topNeed({ hunger: 0.9, energy: 0.1, wealth: 0.2 }).kind, "hunger");
  });
});

describe("WS4 — the utility scorer picks by need (motivated, not scripted)", () => {
  it("a HUNGRY npc scores the tavern above the forge", () => {
    const npc = { id: "n1", archetype: "farmer" };
    const hungry = { hunger: 0.9, energy: 0.2, wealth: 0.2, social: 0.2, safety: 0.1, purpose: 0.2 };
    assert.ok(scoreGoal(npc, hungry, TAVERN) > scoreGoal(npc, hungry, FORGE));
    const choice = chooseNextGoal(npc, hungry, POIS, { topN: 1 });
    assert.equal(choice.poi.id, "tavern1");
  });

  it("a BROKE npc scores the forge above the tavern", () => {
    const npc = { id: "n2", archetype: "farmer" };
    const broke = { hunger: 0.1, energy: 0.2, wealth: 0.95, social: 0.1, safety: 0.1, purpose: 0.3 };
    assert.ok(scoreGoal(npc, broke, FORGE) > scoreGoal(npc, broke, TAVERN));
    assert.equal(chooseNextGoal(npc, broke, POIS, { topN: 1 }).poi.id, "forge1");
  });

  it("a TIRED npc goes home; a PURPOSE-starved mystic goes to the temple", () => {
    assert.equal(chooseNextGoal({ id: "n3", archetype: "default" },
      { hunger: 0.1, energy: 0.95, wealth: 0.1, social: 0.1, safety: 0.1, purpose: 0.1 }, POIS, { topN: 1 }).poi.id, "home1");
    assert.equal(chooseNextGoal({ id: "n4", archetype: "mystic" },
      { hunger: 0.1, energy: 0.2, wealth: 0.1, social: 0.1, safety: 0.1, purpose: 0.9 }, POIS, { topN: 1 }).poi.id, "temple1");
  });

  it("personality tilts the choice (a trader over-weights wealth)", () => {
    const needs = { hunger: 0.5, energy: 0.2, wealth: 0.5, social: 0.2, safety: 0.1, purpose: 0.2 };
    const traderForge = scoreGoal({ id: "t", archetype: "trader" }, needs, FORGE);
    const farmerForge = scoreGoal({ id: "f", archetype: "default" }, needs, FORGE);
    assert.ok(traderForge > farmerForge, "trader values the wealth POI more");
  });

  it("a DESIRE bends the choice toward its POI (wants drive movement)", () => {
    const npc = { id: "n5", archetype: "default" };
    // Mildly hungry — would normally pick the tavern; a strong desire for the temple wins.
    const needs = { hunger: 0.5, energy: 0.2, wealth: 0.2, social: 0.3, safety: 0.1, purpose: 0.3 };
    const choice = chooseNextGoal(npc, needs, POIS, { topN: 1, desirePoiId: "temple1", desireWeight: 3 });
    assert.equal(choice.poi.id, "temple1", "the NPC moved toward what it WANTS, not just what it needs");
  });

  it("is deterministic for the same inputs", () => {
    const npc = { id: "n6", archetype: "default" };
    const needs = { hunger: 0.6, energy: 0.5, wealth: 0.5, social: 0.5, safety: 0.2, purpose: 0.4 };
    const a = chooseNextGoal(npc, needs, POIS, { seedKey: "k" });
    const b = chooseNextGoal(npc, needs, POIS, { seedKey: "k" });
    assert.deepEqual(a, b);
  });

  it("returns null with no candidates", () => {
    assert.equal(chooseNextGoal({ id: "x" }, freshNeeds(), []), null);
  });
});
