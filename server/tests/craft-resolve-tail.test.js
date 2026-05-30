/**
 * Living Society — Phase 0 tail: the final two craft-resolve wraps (no deferral).
 *
 *   - skill-evolution.applyEvolution — optional resource FUEL amplifies the
 *     evolution's damage/range growth (player-only, world-scoped, consumed).
 *   - craft-chains — a chain may carry a resource BILL (inputs_json, mig 279);
 *     startChain consumes it; advanceStep resolves the finished item's quality
 *     from those propertied inputs via the single craft-resolve layer.
 *
 * Run: node --test tests/craft-resolve-tail.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { seedResourceProperties } from "../lib/resources.js";
import { composeDeterministicEvolution, applyEvolution } from "../lib/skill-evolution.js";
import { up as up180 } from "../migrations/180_multi_step_crafts.js";
import { up as up279 } from "../migrations/279_craft_chain_inputs.js";
import { registerChain, getChain, startChain, advanceStep } from "../lib/craft-chains.js";

const WORLD = "concordia-hub";
const USER = "user_t";

function invSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT DEFAULT 'concordia-hub',
      item_type TEXT, item_id TEXT, item_name TEXT, quantity INTEGER DEFAULT 1,
      quality TEXT, acquired_at INTEGER DEFAULT (unixepoch()), properties_json TEXT
    );
    CREATE TABLE IF NOT EXISTS resource_properties (
      item_id TEXT PRIMARY KEY, potency INTEGER, affinity TEXT, stability INTEGER,
      volume REAL, weight REAL, rarity_tier INTEGER, source_type TEXT, magical_sub TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);
  seedResourceProperties(db);
}
function give(db, itemId, qty) {
  db.prepare(`INSERT INTO player_inventory (id, user_id, world_id, item_type, item_id, item_name, quantity)
              VALUES (?, ?, ?, 'material', ?, ?, ?)`)
    .run(`inv_${itemId}_${Math.random()}`, USER, WORLD, itemId, itemId, qty);
}

// ── skill-evolution fuel ────────────────────────────────────────────────────

function makeEvoDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT, skill_level INTEGER, total_experience INTEGER);
    CREATE TABLE skill_revisions (
      id TEXT PRIMARY KEY, recipe_dtu_id TEXT, revision_num INTEGER, level_at_revision INTEGER,
      author_kind TEXT, author_id TEXT, description TEXT, composer TEXT,
      max_damage_before REAL, max_damage_after REAL, range_m_before REAL, range_m_after REAL,
      costs_json TEXT, effect_delta_json TEXT, name_before TEXT, name_after TEXT,
      status TEXT, created_at INTEGER
    );
    CREATE TABLE skill_evolution_unlocks (
      id TEXT PRIMARY KEY, entity_kind TEXT, entity_id TEXT, recipe_dtu_id TEXT,
      unlocked_at INTEGER, completed_at INTEGER, revision_id TEXT
    );
  `);
  invSchema(db);
  return db;
}
function seedRecipe(db) {
  const meta = {
    skill_kind: "fighting_style", element: "physical",
    name: "Iron Fist", current_name: "Iron Fist", max_damage: 20, range_m: 3,
    revision_num: 0, revision_history: [], costs: { stamina: 5 },
  };
  db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, skill_level, total_experience)
              VALUES ('rec1', 'fighting_style_recipe', 'Iron Fist', ?, ?, 10, 0)`).run(USER, JSON.stringify(meta));
  return db.prepare(`SELECT * FROM dtus WHERE id='rec1'`).get();
}

describe("Phase 0 tail — skill-evolution.applyEvolution fuel", () => {
  it("fuel amplifies max_damage_after vs the same evolution without fuel", () => {
    const dbNo = makeEvoDb();
    const recNo = seedRecipe(dbNo);
    const evoNo = composeDeterministicEvolution(recNo, 10, "harder strikes", [], "player");
    const rNo = applyEvolution(dbNo, "player", USER, evoNo);
    assert.equal(rNo.ok, true);
    const dmgNo = dbNo.prepare(`SELECT max_damage_after FROM skill_revisions WHERE id=?`).get(rNo.revisionId).max_damage_after;

    const dbF = makeEvoDb();
    const recF = seedRecipe(dbF);
    give(dbF, "grand_soul_gem", 1);
    const evoF = composeDeterministicEvolution(recF, 10, "harder strikes", [], "player");
    const rF = applyEvolution(dbF, "player", USER, evoF, { userId: USER, worldId: WORLD, fuelItemIds: ["grand_soul_gem"] });
    assert.equal(rF.ok, true);
    assert.ok(rF.fuel, "fuel applied");
    const dmgF = dbF.prepare(`SELECT max_damage_after FROM skill_revisions WHERE id=?`).get(rF.revisionId).max_damage_after;

    assert.ok(dmgF > dmgNo, `${dmgF} !> ${dmgNo}`);
    // fuel consumed
    const left = dbF.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id=?`).get(USER).n;
    assert.equal(left, 0);
  });

  it("NPC evolution carries no fuel (player-only path)", () => {
    const db = makeEvoDb();
    const rec = seedRecipe(db);
    give(db, "grand_soul_gem", 1);
    const evo = composeDeterministicEvolution(rec, 10, "harder", [], "npc");
    const r = applyEvolution(db, "npc", "npc_1", evo, { userId: USER, worldId: WORLD, fuelItemIds: ["grand_soul_gem"] });
    assert.equal(r.ok, true);
    assert.ok(!r.fuel, "no fuel for NPC path");
    // not consumed
    assert.equal(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id=?`).get(USER).n, 1);
  });
});

// ── craft-chains resource bill ────────────────────────────────────────────────

function makeChainDb() {
  const db = new Database(":memory:");
  up180(db);
  up279(db);
  invSchema(db);
  return db;
}
const BILL_CHAIN = {
  id: "ingot_chain", name: "Steel Ingot Run", output_item: "fine_ingot",
  inputs: [{ id: "iron_ore", quantity: 2 }],
  steps: [
    { kind: "gather", name: "mine", duration_s: 0 },
    { kind: "finish", name: "smelt", duration_s: 0 },
  ],
};

describe("Phase 0 tail — craft-chains resource bill", () => {
  it("startChain consumes the resource bill; advanceStep resolves output quality", () => {
    const db = makeChainDb();
    registerChain(db, BILL_CHAIN);
    const chain = getChain(db, "ingot_chain");
    assert.equal(chain.inputs.length, 1);

    give(db, "iron_ore", 2);
    const s = startChain(db, USER, WORLD, "ingot_chain");
    assert.equal(s.ok, true);
    assert.equal(s.consumedInputs, 1);
    // bill consumed
    assert.equal(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id=?`).get(USER).n, 0);

    // both steps have duration 0 → advance through to completion
    const a1 = advanceStep(db, USER, s.jobId, {});
    assert.equal(a1.ok, true);
    const a2 = advanceStep(db, USER, s.jobId, {});
    assert.equal(a2.finished, true);
    assert.ok(a2.resolved, "resolved provenance on completion");
    assert.equal(a2.resolved.outputAffinity, "physical");
    assert.ok(a2.outputQuality >= 0.5 && a2.outputQuality <= 2.0);
    const stored = db.prepare(`SELECT output_quality FROM player_craft_jobs WHERE id=?`).get(s.jobId).output_quality;
    assert.equal(stored, a2.outputQuality);
  });

  it("startChain rejects when the player lacks the bill", () => {
    const db = makeChainDb();
    registerChain(db, BILL_CHAIN);
    const s = startChain(db, USER, WORLD, "ingot_chain");
    assert.equal(s.ok, false);
    assert.equal(s.reason, "missing_material");
  });

  it("a chain with no bill behaves exactly as before (no consume, no quality)", () => {
    const db = makeChainDb();
    registerChain(db, { id: "free", name: "Free", output_item: "thing", steps: [{ kind: "finish", name: "x", duration_s: 0 }] });
    const s = startChain(db, USER, WORLD, "free");
    assert.equal(s.ok, true);
    const a = advanceStep(db, USER, s.jobId, {});
    assert.equal(a.finished, true);
    assert.equal(a.outputQuality, undefined);
  });
});
