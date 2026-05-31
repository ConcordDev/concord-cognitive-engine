import { test } from "node:test";
import assert from "node:assert/strict";
import {
  elementVsElement, elementVsMaterial, ignites, douses, reactionsFor, ELEMENTS,
} from "../lib/element-matrix.js";

// WS-CHEMISTRY — BOTW Elements-vs-Materials. A few consistent rules → multiplicative
// situations. These pin the rules so combat/gather/prompter all read the same truth.

test("Rule 2: water douses fire → steam (order-independent)", () => {
  const r = elementVsElement("fire", "water");
  assert.equal(r.result, "steam");
  assert.equal(r.douses, true);
  assert.deepEqual(elementVsElement("water", "fire"), r); // symmetric
  assert.equal(douses("water", "fire"), true);
});

test("Rule 2: water + lightning electrifies (conducts)", () => {
  assert.equal(elementVsElement("water", "lightning").conducts, true);
});

test("Rule 1: fire ignites wood/thatch/grass; not stone", () => {
  assert.equal(ignites("fire", "wood"), true);
  assert.equal(ignites("fire", "thatch"), true);
  assert.equal(ignites("fire", "stone"), false);
});

test("Rule 1: lightning conducts through metal + standing water", () => {
  assert.equal(elementVsMaterial("lightning", "metal").conducts, true);
  assert.equal(elementVsMaterial("lightning", "water_surface").conducts, true);
});

test("Rule 1: ice freezes a water surface into a walkable sheet", () => {
  assert.equal(elementVsMaterial("ice", "water_surface").freezes, true);
});

test("Rule 3: no element pair or material pair is invented out of nothing", () => {
  assert.equal(elementVsElement("light", "shadow"), null); // undefined pair → no reaction
  assert.equal(elementVsMaterial("water", "stone"), null);
});

test("reactionsFor(fire) lists its element + material reactions (prompter source)", () => {
  const rs = reactionsFor("fire");
  assert.ok(rs.length >= 5);
  assert.ok(rs.some((r) => r.with === "water" && r.kind === "element"));
  assert.ok(rs.some((r) => r.with === "wood" && r.kind === "material"));
});

test("ELEMENTS covers the canonical set", () => {
  for (const e of ["fire", "water", "ice", "lightning", "nature"]) assert.ok(ELEMENTS.includes(e));
});
