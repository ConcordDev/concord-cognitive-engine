// Track D — training-room combo strip grounding.
//
// `content/skills.json`'s authored `combo_followups` must actually survive
// the seed → DTU-persist → combat-frame-data round trip that the Training
// Room lens reads (`training-room.frame_data` → `getFrameDataForSkillId` →
// `getSkillFrameData`). Pins:
//   - seeding persists combo_followups into the DTU's `data` JSON blob
//   - getFrameDataForSkillId (the real read path) surfaces them, correctly
//     shaped ({ skillId, name })
//   - every authored combo_followup id resolves to a real skill in the same
//     catalog (no dangling references — the chain is grounded, not invented)
//   - the terminal skill (no sensible follow-up) surfaces an honest empty
//     array, not a fabricated one
//
// Run: node --test tests/skill-combo-followups.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedSkillBlueprints, validateSkillBlueprint } from "../lib/skill-seeder.js";
import { getFrameDataForSkillId } from "../lib/combat-frame-data.js";

const SKILLS_URL = new URL("../../content/skills.json", import.meta.url);
const SKILLS = JSON.parse(readFileSync(SKILLS_URL, "utf8"));

test("authored combo_followups shape-validate", () => {
  for (const s of SKILLS) {
    assert.equal(validateSkillBlueprint(s).ok, true, `${s.name} valid`);
  }
});

test("every authored combo_followup id resolves to a real skill in the catalog (no dangling refs)", () => {
  const knownIds = new Set(SKILLS.map((s) => s.id));
  let checked = 0;
  for (const s of SKILLS) {
    for (const f of s.combo_followups || []) {
      const id = typeof f === "string" ? f : f.id;
      assert.ok(knownIds.has(id), `${s.name}'s follow-up "${id}" must be a real skill id`);
      checked++;
    }
  }
  // Sanity: this test is only meaningful if there's at least one authored chain.
  assert.ok(checked >= 1, "expected at least one authored combo_followup to check");
});

test("seed → DTU persist → combat-frame-data surfaces the real authored chain", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  assert.equal(seedSkillBlueprints(db, SKILLS), SKILLS.length);

  // Founder's Edge → flows into The Sovereign's Refusal (real chain, mirrors
  // the authored prerequisite order — see the grounding note in skill-seeder.js).
  const founders = getFrameDataForSkillId(db, "dtu_swordsmanship_v1");
  assert.equal(founders.combo_followups.length, 1);
  assert.equal(founders.combo_followups[0].skillId, "dtu_refusal_ward_v1");
  assert.equal(founders.combo_followups[0].name, "The Sovereign's Refusal");

  // The Sovereign's Refusal → flows into Sundered Lattice Arc.
  const refusal = getFrameDataForSkillId(db, "dtu_refusal_ward_v1");
  assert.equal(refusal.combo_followups.length, 1);
  assert.equal(refusal.combo_followups[0].skillId, "dtu_lattice_arc_v1");

  // Terminal skill — ranged finisher, no sensible follow-up. Honest empty,
  // not a fabricated one.
  const lattice = getFrameDataForSkillId(db, "dtu_lattice_arc_v1");
  assert.deepEqual(lattice.combo_followups, []);

  db.close();
});

test("skill with no combo_followups field round-trips to an empty array, not undefined", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedSkillBlueprints(db, [{ id: "dtu_test_no_combo", name: "Test Skill" }]);
  const fd = getFrameDataForSkillId(db, "dtu_test_no_combo");
  assert.ok(Array.isArray(fd.combo_followups));
  assert.equal(fd.combo_followups.length, 0);
  db.close();
});

test("validateSkillBlueprint rejects malformed combo_followups", () => {
  assert.equal(validateSkillBlueprint({ id: "a", name: "A", combo_followups: "not-an-array" }).ok, false);
  assert.equal(validateSkillBlueprint({ id: "a", name: "A", combo_followups: [{ noId: true }] }).ok, false);
  assert.equal(validateSkillBlueprint({ id: "a", name: "A", combo_followups: [""] }).ok, false);
  assert.equal(validateSkillBlueprint({ id: "a", name: "A", combo_followups: ["dtu_x"] }).ok, true);
  assert.equal(validateSkillBlueprint({ id: "a", name: "A", combo_followups: [{ id: "dtu_x", name: "X" }] }).ok, true);
  assert.equal(validateSkillBlueprint({ id: "a", name: "A", combo_followups: [] }).ok, true);
});
