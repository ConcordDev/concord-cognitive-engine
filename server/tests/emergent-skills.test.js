/**
 * Emergent skills — effect grammar, attach gating, evolve chain.
 * Run: node --test tests/emergent-skills.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  ensureSkillsTable,
  bootEmergentSkills,
  createSkill,
  evolveSkill,
  getSkill,
  listSkills,
  attachSkills,
  EFFECT_KINDS,
} from "../lib/emergent-skills.js";

function setup() {
  const db = new Database(":memory:");
  ensureSkillsTable(db);
  return db;
}

describe("effect grammar", () => {
  it("rejects skills with unknown effect kinds", () => {
    const db = setup();
    const r = createSkill(db, {
      name: "bad", verb: "bad",
      effects: [{ kind: "delete_world", params: {} }],
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /unknown effect kind/i);
  });

  it("accepts skills using only EFFECT_KINDS members", () => {
    const db = setup();
    for (const kind of EFFECT_KINDS) {
      const r = createSkill(db, {
        name: `s_${kind}`, verb: kind,
        effects: [{ kind, params: { amount: 1 } }],
      });
      assert.strictEqual(r.ok, true, `kind ${kind} should be allowed`);
    }
  });

  it("rejects empty-effect skills", () => {
    const db = setup();
    const r = createSkill(db, { name: "empty", verb: "x", effects: [] });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /no effects/i);
  });
});

describe("evolve chain", () => {
  it("creates a derivative skill with parentId set", () => {
    const db = setup();
    const parent = createSkill(db, {
      name: "parent", verb: "parent",
      effects: [{ kind: "damage", params: { amount: 10 } }],
    });
    const child = evolveSkill(db, parent.skill.id, (s) => ({
      ...s,
      name: "child",
      effects: [{ kind: "damage", params: { amount: 14 } }],
    }));
    assert.strictEqual(child.ok, true);
    assert.strictEqual(child.skill.provenance.parentId, parent.skill.id);
    assert.notStrictEqual(child.skill.id, parent.skill.id);
  });

  it("returns parent_not_found for missing parent", () => {
    const db = setup();
    const r = evolveSkill(db, "skl_nonexistent", (s) => s);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "parent_not_found");
  });
});

describe("attachSkills body-part gating", () => {
  it("attaches wingbeat only to creatures with wing parts", () => {
    const db = setup();
    bootEmergentSkills(db);
    const wingedBp = {
      topology: "winged_quadruped", massKg: 100,
      parts: [{ kind: "wing" }, { kind: "leg" }, { kind: "leg" }, { kind: "leg" }, { kind: "leg" }, { kind: "torso" }, { kind: "head" }],
    };
    const wingless = {
      topology: "humanoid", massKg: 80,
      parts: [{ kind: "arm" }, { kind: "arm" }, { kind: "leg" }, { kind: "leg" }, { kind: "torso" }, { kind: "head" }],
    };
    const wingSkills = attachSkills(wingedBp);
    const handSkills = attachSkills(wingless);
    const skills = listSkills();
    const wingbeat = skills.find(s => s.name === "wingbeat");
    if (wingbeat) {
      assert.ok(wingSkills.includes(wingbeat.id));
      assert.ok(!handSkills.includes(wingbeat.id));
    }
  });
});

describe("listSkills filter", () => {
  it("filters by origin", () => {
    const db = setup();
    createSkill(db, { name: "a", verb: "a", origin: "user_alice", effects: [{ kind: "damage", params: { amount: 1 } }] });
    createSkill(db, { name: "b", verb: "b", origin: "user_bob",   effects: [{ kind: "damage", params: { amount: 1 } }] });
    const aliceSkills = listSkills({ origin: "user_alice" });
    assert.ok(aliceSkills.every(s => s.provenance.origin === "user_alice"));
    assert.strictEqual(aliceSkills.length, 1);
  });
});
