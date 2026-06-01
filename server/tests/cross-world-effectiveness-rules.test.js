// B2 #14 fix — cross-world effectiveness must honour BOTH world-meta shapes:
// skill_affinity (authored) AND skill_effectiveness_rules (Foundry/world-seed).

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWorldMeta, effectivenessMultiplier, resolveAffinity } from "../lib/cross-world-effectiveness.js";

test("resolveAffinity reads skill_affinity when present", () => {
  assert.equal(resolveAffinity({ skill_affinity: { magic: 0.95, default: 0.4 } }, "magic"), 0.95);
  assert.equal(resolveAffinity({ skill_affinity: { magic: 0.95, default: 0.4 } }, "hacking"), 0.4);
});

test("resolveAffinity reads skill_effectiveness_rules {multiplier} shape (the #14 gap)", () => {
  const meta = { skill_effectiveness_rules: { magic: { multiplier: 0.2 }, default: { multiplier: 1.0 } } };
  assert.equal(resolveAffinity(meta, "magic"), 0.2);
  assert.equal(resolveAffinity(meta, "hacking"), 1.0); // default
});

test("skill_affinity wins when both shapes are present (authored intent canonical)", () => {
  const meta = { skill_affinity: { magic: 0.9 }, skill_effectiveness_rules: { magic: { multiplier: 0.1 } } };
  assert.equal(resolveAffinity(meta, "magic"), 0.9);
});

test("resolveAffinity returns null when neither shape carries the domain/default", () => {
  assert.equal(resolveAffinity({}, "magic"), null);
  assert.equal(resolveAffinity(null, "magic"), null);
});

test("effectivenessMultiplier now applies a skill_effectiveness_rules world (was neutral before the fix)", () => {
  registerWorldMeta({ world_id: "foundry_world_x", name: "FX", skill_effectiveness_rules: { hacking: { multiplier: 0.05 }, default: { multiplier: 0.6 } } });
  // A low-level hacker in a hacking-hostile foundry world: affinity 0.05, floor at
  // level 1 = 0.10, so the level floor wins → 0.10 (NOT the 0.7 neutral fallback).
  const m = effectivenessMultiplier({ domain: "hacking", worldId: "foundry_world_x", level: 1 });
  assert.ok(m <= 0.11, `expected ~floor 0.10, got ${m}`);
  // A non-specified domain falls to the rules' default 0.6.
  const d = effectivenessMultiplier({ domain: "cooking", worldId: "foundry_world_x", level: 100 });
  assert.ok(Math.abs(d - 0.6) < 0.01 || d >= 0.5, `expected ~0.6/floor, got ${d}`);
});
