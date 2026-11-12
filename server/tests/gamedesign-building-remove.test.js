// FIX-foundry-008 — a placed building can be removed by its owner.
// Hermetic pins for game-design.building-remove against a real
// in-memory SQLite (the macro reads ctx.db first):
//  1. The owner removes their building; the world_buildings row is gone
//     and the blueprint DTU row is untouched.
//  2. Another user is refused (not_your_building) and the row stands.
//  3. An unknown building id is refused (building_not_found); anonymous
//     callers are refused (auth_required).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
// node:sqlite (built-in) keeps this test hermetic — it supplies its own
// db handle via ctx.db, which the macro reads first.
import { DatabaseSync } from "node:sqlite";
import registerGameDesignActions from "../domains/gamedesign.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`game-design.${name}`);
  assert.ok(fn, `game-design.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => {
  registerGameDesignActions(register);
  db = new DatabaseSync(":memory:");
  db.prepare(`CREATE TABLE world_buildings (
    id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, archetype TEXT, feature TEXT,
    name TEXT, x REAL, y REAL, z REAL, rotation REAL, rotation_y REAL,
    width REAL, height REAL, depth REAL, blueprint_dtu_id TEXT, spawned_by_user_id TEXT,
    owner_type TEXT, owner_id TEXT, state TEXT, is_seed INTEGER, created_at TEXT
  )`).run();
  db.prepare(`CREATE TABLE dtus (
    id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT, body_json TEXT, tags_json TEXT,
    visibility TEXT, tier TEXT, created_at TEXT, updated_at TEXT
  )`).run();
  db.prepare(`INSERT INTO dtus (id, owner_user_id, title) VALUES ('dtu_bp1', 'user_a', 'Inn')`).run();
  db.prepare(`INSERT INTO world_buildings (id, world_id, name, blueprint_dtu_id, spawned_by_user_id, state)
    VALUES ('wb_1', 'world_1', 'Inn', 'dtu_bp1', 'user_a', 'standing')`).run();
});

const ctxA = { db: null, actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { db: null, actor: { userId: "user_b" }, userId: "user_b" };
const ctxAnon = { db: null, actor: { userId: "anon" }, userId: "anon" };

describe("game-design.building-remove", () => {
  it("refuses anonymous callers and unknown ids", () => {
    ctxAnon.db = db;
    assert.equal(call("building-remove", ctxAnon, { buildingId: "wb_1" }).error, "auth_required");
    ctxA.db = db;
    assert.equal(call("building-remove", ctxA, { buildingId: "wb_nope" }).error, "building_not_found");
  });

  it("refuses a non-owner and the row stands", () => {
    ctxB.db = db;
    const r = call("building-remove", ctxB, { buildingId: "wb_1" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_your_building");
    assert.ok(db.prepare("SELECT id FROM world_buildings WHERE id = 'wb_1'").get());
  });

  it("the owner removes the placement; the blueprint DTU survives", () => {
    ctxA.db = db;
    const r = call("building-remove", ctxA, { buildingId: "wb_1" });
    assert.equal(r.ok, true);
    assert.equal(db.prepare("SELECT id FROM world_buildings WHERE id = 'wb_1'").get(), undefined);
    assert.ok(db.prepare("SELECT id FROM dtus WHERE id = 'dtu_bp1'").get(), "blueprint DTU stays");
  });
});
