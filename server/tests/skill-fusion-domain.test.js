/**
 * WS4(d) — player cross-skill fusion macros.
 * preview is pure + write-free; fuse persists a stronger fused skill owned by
 * the caller. Both reject when fewer than two damaging skills are supplied.
 * Run: node --test tests/skill-fusion-domain.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import registerSkillFusionMacros from "../domains/skill-fusion.js";
import { ensureSkillsTable, bootEmergentSkills, getSkill } from "../lib/emergent-skills.js";

function registry() {
  const macros = new Map();
  registerSkillFusionMacros((domain, name, fn) => macros.set(`${domain}.${name}`, fn));
  return macros;
}

const fire = { name: "Flame Jet", element: "fire", maxDamage: 20 };
const wind = { name: "Gust", element: "wind", maxDamage: 16 };

describe("skill-fusion.preview", () => {
  it("returns a stronger fused power without writing", async () => {
    const m = registry();
    const r = await m.get("skill-fusion.preview")({}, { a: fire, b: wind });
    assert.ok(r.ok);
    assert.ok(r.fused.maxDamage > 20);
    assert.equal(r.fused.element, "explosion");
  });
  it("rejects without two damaging skills", async () => {
    const m = registry();
    const r = await m.get("skill-fusion.preview")({}, { a: fire, b: { name: "Haste", element: "none", maxDamage: 0 } });
    assert.equal(r.ok, false);
  });
});

describe("skill-fusion.fuse", () => {
  it("persists a fused skill owned by the caller", async () => {
    const db = new Database(":memory:");
    ensureSkillsTable(db);
    bootEmergentSkills(db);
    const m = registry();
    const r = await m.get("skill-fusion.fuse")({ db, actor: { userId: "u1" } }, { a: fire, b: wind });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(r.skillId);
    assert.ok(getSkill(r.skillId));
    assert.ok(r.fused.maxDamage > 20);
  });
  it("requires auth", async () => {
    const db = new Database(":memory:");
    ensureSkillsTable(db);
    const m = registry();
    const r = await m.get("skill-fusion.fuse")({ db }, { a: fire, b: wind });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });
});
