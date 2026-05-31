import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crossWorldPotency, masteryFactor, worldAffinity, isAvailableIn, SKILL_KIND_DOMAIN,
} from "../lib/cross-world-potency.js";

// Universal Move System — Pillar 2 (availability) + Pillar 3 (cross-world potency).
// One contract test per system stands in for the systems × worlds grid (test the
// edges, not the cells).

const TUNYA = { id: "tunya", rule_modulators: JSON.stringify({ magic_level: 2, skill_affinity: { magic: 0.9, tech: 0.2 } }) };
const CRIME = { id: "crime", rule_modulators: JSON.stringify({ magic_level: 0, tech_level: 2, skill_affinity: { magic: 0.1, tech: 0.8 } }) };

test("native world → full potency (1.0)", () => {
  assert.equal(crossWorldPotency({ skillLevel: 1, skillKind: "spell", nativeWorldId: "tunya", targetWorldId: "tunya", targetWorld: TUNYA }), 1.0);
});

test("foreign world: novice sags toward the world's affinity, master claws it back", () => {
  const novice = crossWorldPotency({ skillLevel: 2, skillKind: "spell", nativeWorldId: "hub", targetWorldId: "tunya", targetWorld: { rule_modulators: JSON.stringify({ skill_affinity: { magic: 0.2 } }) } });
  const master = crossWorldPotency({ skillLevel: 200, skillKind: "spell", nativeWorldId: "hub", targetWorldId: "tunya", targetWorld: { rule_modulators: JSON.stringify({ skill_affinity: { magic: 0.2 } }) } });
  assert.ok(novice < 0.35, `novice should sag near 0.2 affinity, got ${novice}`);
  assert.ok(master >= 0.99, `master should travel at full, got ${master}`);
  assert.ok(master > novice);
});

test("masteryFactor: 0 at novice, saturates to 1 at master level", () => {
  assert.equal(masteryFactor(0), 0);
  assert.ok(masteryFactor(200) >= 1);
  assert.ok(masteryFactor(9999) <= 1);
});

test("worldAffinity falls back to the 0.7 neutral floor when undeclared", () => {
  assert.equal(worldAffinity({ rule_modulators: "{}" }, "magic"), 0.7);
  assert.equal(worldAffinity(TUNYA, "magic"), 0.9);
});

test("Pillar 2: a no-magic world forbids spells but allows tech", () => {
  assert.equal(isAvailableIn(CRIME, { skillKind: "spell" }).available, false);
  assert.equal(isAvailableIn(CRIME, { skillKind: "biopower" }).available, false);
  assert.equal(isAvailableIn(CRIME, { skillKind: "cyber_ability" }).available, true);
});

test("kill-switch CONCORD_CROSS_WORLD_POTENCY=0 → always full", () => {
  const prev = process.env.CONCORD_CROSS_WORLD_POTENCY;
  process.env.CONCORD_CROSS_WORLD_POTENCY = "0";
  try {
    assert.equal(crossWorldPotency({ skillLevel: 1, skillKind: "spell", nativeWorldId: "hub", targetWorldId: "tunya", targetWorld: TUNYA }), 1.0);
  } finally {
    if (prev === undefined) delete process.env.CONCORD_CROSS_WORLD_POTENCY;
    else process.env.CONCORD_CROSS_WORLD_POTENCY = prev;
  }
});

test("SKILL_KIND_DOMAIN maps every authored kind", () => {
  for (const k of ["fighting_style", "spell", "biopower", "cyber_ability", "psionic", "tech_gadget", "mundane"]) {
    assert.ok(SKILL_KIND_DOMAIN[k], `missing domain for ${k}`);
  }
});
