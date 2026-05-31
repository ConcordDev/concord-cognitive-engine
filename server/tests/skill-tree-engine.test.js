// Contract test for the skill-tree-engine Phase II Wave 16.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  getSkillTreeForActor,
  checkSkillGate,
  SKILL_TREE_CONSTANTS,
} from "../lib/skill-tree-engine.js";
import registerSkillTreeMacros from "../domains/skill-tree.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`skill_tree.${name}`);
  assert.ok(fn, `skill_tree.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerSkillTreeMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE skill_revisions (
      recipe_dtu_id TEXT NOT NULL,
      author_kind TEXT,
      author_id TEXT,
      revision_num INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE npc_skill_acquisitions (
      buyer_npc_id TEXT NOT NULL,
      recipe_dtu_id TEXT NOT NULL,
      acquired_at INTEGER
    );
  `);
});

const ctxAlice = () => ({ actor: { userId: "alice" }, userId: "alice", db });

describe("skill-tree-engine library", () => {
  it("getSkillTreeForActor returns full catalog when no data", () => {
    const t = getSkillTreeForActor(db, "player", "alice");
    assert.equal(t.ok, true);
    assert.ok(t.groups.combat);
    assert.ok(t.groups.athletic);
    assert.ok(t.groups.arts);
    // No skill_revisions rows → all levels are 0
    assert.equal(Object.keys(t.skills).length, 0);
    assert.equal(t.totalLevel, 0);
  });

  it("aggregates skill_revisions for a player", () => {
    db.prepare(`INSERT INTO skill_revisions (recipe_dtu_id, author_kind, author_id, revision_num) VALUES ('swords', 'player', 'alice', 5)`).run();
    db.prepare(`INSERT INTO skill_revisions (recipe_dtu_id, author_kind, author_id, revision_num) VALUES ('swords', 'player', 'alice', 7)`).run();
    db.prepare(`INSERT INTO skill_revisions (recipe_dtu_id, author_kind, author_id, revision_num) VALUES ('cooking', 'player', 'alice', 3)`).run();
    const t = getSkillTreeForActor(db, "player", "alice");
    assert.equal(t.skills.swords.level, 7);
    assert.equal(t.skills.swords.mastery, 0);
    assert.equal(t.skills.cooking.level, 3);
    assert.equal(t.totalLevel, 10);
  });

  it("aggregates npc_skill_acquisitions for an NPC", () => {
    db.prepare(`INSERT INTO npc_skill_acquisitions (buyer_npc_id, recipe_dtu_id) VALUES ('npc_a', 'archery')`).run();
    const t = getSkillTreeForActor(db, "npc", "npc_a");
    assert.equal(t.skills.archery.level, 1);
    assert.equal(t.skills.archery.source, "npc_skill_acquisitions");
  });

  it("classifies skills into the right group", () => {
    db.prepare(`INSERT INTO skill_revisions (recipe_dtu_id, author_kind, author_id, revision_num) VALUES ('photography', 'player', 'alice', 2)`).run();
    const t = getSkillTreeForActor(db, "player", "alice");
    assert.equal(t.skills.photography.group, "arts");
    assert.ok(t.groups.arts.skills.some((s) => s.skill === "photography"));
  });

  it("checkSkillGate AND-combines requirements", () => {
    db.prepare(`INSERT INTO skill_revisions (recipe_dtu_id, author_kind, author_id, revision_num) VALUES ('athletics', 'player', 'alice', 8)`).run();
    db.prepare(`INSERT INTO skill_revisions (recipe_dtu_id, author_kind, author_id, revision_num) VALUES ('reflex', 'player', 'alice', 5)`).run();
    const r = checkSkillGate(db, "player", "alice", [
      { skill: "athletics", minLevel: 6 },
      { skill: "reflex",    minLevel: 5 },
    ]);
    assert.equal(r.eligible, true);
    const r2 = checkSkillGate(db, "player", "alice", [
      { skill: "athletics", minLevel: 10 },
    ]);
    assert.equal(r2.eligible, false);
    assert.equal(r2.missing[0].got, 8);
  });

  it("checkSkillGate when no data → eligible false on any requirement", () => {
    const r = checkSkillGate(db, "player", "alice", [{ skill: "public_speaking", minLevel: 1 }]);
    assert.equal(r.eligible, false);
    assert.equal(r.missing.length, 1);
  });

  it("SKILL_CATALOG covers all 7 groups", () => {
    const groups = Object.keys(SKILL_TREE_CONSTANTS.SKILL_CATALOG);
    assert.deepEqual(groups.sort(), ['arts','athletic','combat','craft','scholar','side','social']);
  });

  it("getSkillTreeForActor surfaces catalog skills with level 0 even when no data", () => {
    const t = getSkillTreeForActor(db, "player", "alice");
    const swordsInCatalog = t.groups.combat.skills.find((s) => s.skill === "swords");
    assert.ok(swordsInCatalog);
    assert.equal(swordsInCatalog.level, 0);
  });
});

describe("skill_tree domain macros", () => {
  it("for_me aggregates the current player's skills", async () => {
    db.prepare(`INSERT INTO skill_revisions (recipe_dtu_id, author_kind, author_id, revision_num) VALUES ('cooking', 'player', 'alice', 3)`).run();
    const r = await call("for_me", ctxAlice());
    assert.equal(r.ok, true);
    assert.equal(r.skills.cooking.level, 3);
  });

  it("check_gate macro", async () => {
    db.prepare(`INSERT INTO skill_revisions (recipe_dtu_id, author_kind, author_id, revision_num) VALUES ('rhetoric', 'player', 'alice', 4)`).run();
    const r = await call("check_gate", ctxAlice(), { requirements: [{ skill: "rhetoric", minLevel: 3 }] });
    assert.equal(r.eligible, true);
  });

  it("catalog macro returns SKILL_CATALOG", async () => {
    const r = await call("catalog", ctxAlice());
    assert.equal(r.ok, true);
    assert.ok(r.catalog.combat.includes("swords"));
  });

  it("rejects no_user / no_db", async () => {
    const r1 = await call("for_me", { actor: { userId: null }, userId: null, db });
    assert.equal(r1.ok, false);
    const r2 = await call("for_me", { actor: { userId: "u" }, userId: "u" });
    assert.equal(r2.ok, false);
  });
});
