// Content pillar 2 — authored skill/weapon blueprints → combat-readable skill
// DTUs. The combat route loads `data`/`skill_level` from `dtus WHERE id=?` and
// reads max_damage/range_m off the parsed data JSON, so a seeded blueprint is a
// REAL definition (bounded by combat-limits), not decorative. Pins the
// round-trip, idempotency, and that authored damage stays within the cap.
//
// Run: node --test tests/skill-blueprints-seed.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedSkillBlueprints, validateSkillBlueprint } from "../lib/skill-seeder.js";
import { resolvedDamageCap, COMBAT_DAMAGE_HARD_CAP } from "../lib/combat-limits.js";

const SKILLS = [
  { id: "dtu_swordsmanship_v1", name: "Founder's Edge", element: "physical", max_damage: 45, range_m: 3, bar_cost: 12 },
  { id: "dtu_lattice_arc_v1", name: "Lattice Arc", element: "energy", max_damage: 60, range_m: 14, resource_bar: "mana", bar_cost: 18 },
];

test("blueprints seed as combat-readable type='skill' DTUs", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  assert.equal(seedSkillBlueprints(db, SKILLS), 2);

  // Mirror exactly what routes/worlds.js:2299 reads.
  const row = db.prepare("SELECT type, data, skill_level FROM dtus WHERE id = ?").get("dtu_swordsmanship_v1");
  assert.equal(row.type, "skill");
  const data = JSON.parse(row.data);
  assert.equal(data.max_damage, 45);
  assert.equal(data.element, "physical");
  assert.equal(data.range_m, 3);
  assert.equal(data.resource_bar, "stamina");
  assert.equal(data.authored, true);

  // Every authored skill's resolved cap stays within the hard ceiling.
  for (const s of SKILLS) {
    assert.ok(resolvedDamageCap(s.max_damage) <= COMBAT_DAMAGE_HARD_CAP,
      `${s.name} resolved cap ${resolvedDamageCap(s.max_damage)} ≤ ${COMBAT_DAMAGE_HARD_CAP}`);
  }
  db.close();
});

test("re-seed is idempotent (insert-once on the versioned id)", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedSkillBlueprints(db, SKILLS);
  assert.equal(seedSkillBlueprints(db, SKILLS), 0, "re-seed adds nothing");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM dtus WHERE type='skill'").get().c, 2);
  db.close();
});

test("validateSkillBlueprint rejects malformed entries", () => {
  assert.equal(validateSkillBlueprint({ id: "a", name: "A" }).ok, true);
  assert.equal(validateSkillBlueprint({ name: "A" }).ok, false);            // no id
  assert.equal(validateSkillBlueprint({ id: "a", name: "A", max_damage: "x" }).ok, false);
  assert.equal(validateSkillBlueprint(null).ok, false);
});

test("authored content/skills.json is valid + bounded", async () => {
  const { readFileSync } = await import("node:fs");
  const url = new URL("../../content/skills.json", import.meta.url);
  const arr = JSON.parse(readFileSync(url, "utf8"));
  assert.ok(Array.isArray(arr) && arr.length >= 1);
  for (const s of arr) {
    assert.equal(validateSkillBlueprint(s).ok, true, `${s.name} valid`);
    if (s.max_damage !== undefined) {
      assert.ok(resolvedDamageCap(s.max_damage) <= COMBAT_DAMAGE_HARD_CAP, `${s.name} bounded`);
    }
  }
});
