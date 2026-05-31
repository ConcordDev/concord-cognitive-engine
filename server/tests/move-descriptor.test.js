import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMotion, stampMoveMeta, SKILL_KIND_MOTION } from "../lib/move-descriptor.js";

// Universal Move System P1 — the server twin of the client move-resolver. These
// pin the derive + stamp contract (and the kill-switch) so a created move always
// carries an explicit, element-correct motion block in meta_json.

test("deriveMotion: spell+fire → magic/cast_channel/projectile draining mana", () => {
  const m = deriveMotion("spell", "fire");
  assert.equal(m.motionFamily, "magic");
  assert.equal(m.motionArchetype, "cast_channel");
  assert.equal(m.effectArchetype, "projectile"); // fire bias
  assert.equal(m.resourceGauge, "mana");
  assert.equal(m.element, "fire");
  assert.deepEqual(m.phases, [200, 160, 220]);
});

test("deriveMotion: each skill_kind drains its lore gauge (mirrors client)", () => {
  assert.equal(deriveMotion("biopower").resourceGauge, "bio");
  assert.equal(deriveMotion("cyber_ability").resourceGauge, "charge");
  assert.equal(deriveMotion("fighting_style").resourceGauge, "stamina");
  assert.equal(deriveMotion("psionic").resourceGauge, "mana");
});

test("deriveMotion: element drives a distinct effect (ice ≠ fire)", () => {
  assert.equal(deriveMotion("spell", "ice").effectArchetype, "ground_zone");
  assert.notEqual(deriveMotion("spell", "ice").effectArchetype, deriveMotion("spell", "fire").effectArchetype);
});

test("deriveMotion: unknown kind/element never throws, sane defaults", () => {
  const m = deriveMotion("zorp", "glorbo");
  assert.equal(m.motionFamily, "magic"); // falls back to spell
  assert.ok(m.motionArchetype && m.effectArchetype);
});

test("deriveMotion covers exactly the 7 authored skill kinds", () => {
  assert.deepEqual(Object.keys(SKILL_KIND_MOTION).sort(),
    ["biopower", "cyber_ability", "fighting_style", "mundane", "psionic", "spell", "tech_gadget"]);
});

test("stampMoveMeta: stamps motion + nativeWorld, idempotent on motion", () => {
  const meta = { skill_kind: "spell", element: "lightning" };
  stampMoveMeta(meta, { skillKind: "spell", element: "lightning", worldId: "tunya" });
  assert.equal(meta.motion.effectArchetype, "chain"); // lightning bias
  assert.equal(meta.nativeWorld, "tunya");
  const firstMotion = meta.motion;
  stampMoveMeta(meta, { skillKind: "spell", element: "fire", worldId: "crime" }); // must not clobber
  assert.equal(meta.motion, firstMotion);
  assert.equal(meta.nativeWorld, "tunya");
});

test("stampMoveMeta: kill-switch CONCORD_MOVE_RESOLVER=0 is a no-op", () => {
  const prev = process.env.CONCORD_MOVE_RESOLVER;
  process.env.CONCORD_MOVE_RESOLVER = "0";
  try {
    const meta = { skill_kind: "spell", element: "fire" };
    stampMoveMeta(meta, { skillKind: "spell", element: "fire", worldId: "hub" });
    assert.equal(meta.motion, undefined);
    assert.equal(meta.nativeWorld, undefined);
  } finally {
    if (prev === undefined) delete process.env.CONCORD_MOVE_RESOLVER;
    else process.env.CONCORD_MOVE_RESOLVER = prev;
  }
});
