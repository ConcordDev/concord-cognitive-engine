/**
 * Tier-2 contract tests for Concordia Phase 3 — actor-physique.
 *
 * Pins:
 *   - getPhysique returns defaults stub when no row
 *   - setPhysique upserts; validates ranges
 *   - massMultiplier: identity → 1.0, heavy/light → clamped [0.7, 1.4]
 *   - combatMassMultiplier reads both rows + composes
 *
 * Run: node --test tests/actor-physique.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  getPhysique,
  setPhysique,
  massMultiplier,
  combatMassMultiplier,
  PHYSIQUE_CONSTANTS,
} from "../lib/actor-physique.js";
import { up as up174 } from "../migrations/174_actor_physique.js";

function setupDb() {
  const db = new Database(":memory:");
  up174(db);
  return db;
}

describe("Phase 3 / actor-physique — defaults", () => {
  it("getPhysique returns defaults when no row", () => {
    const db = setupDb();
    const r = getPhysique(db, "player", "user_1");
    assert.equal(r.mass_kg, PHYSIQUE_CONSTANTS.DEFAULT_MASS_KG);
    assert.equal(r.height_m, PHYSIQUE_CONSTANTS.DEFAULT_HEIGHT_M);
    assert.equal(r.body_type, "average");
    assert.equal(r.is_default, true);
  });

  it("returns stub without db too", () => {
    const r = getPhysique(null, "player", "user_1");
    assert.equal(r.mass_kg, 75);
  });
});

describe("Phase 3 / actor-physique — setPhysique", () => {
  it("upserts on (actor_kind, actor_id)", () => {
    const db = setupDb();
    setPhysique(db, "player", "user_1", { mass_kg: 90, height_m: 1.85, body_type: "tall" });
    setPhysique(db, "player", "user_1", { mass_kg: 60, height_m: 1.65, body_type: "slim" });
    const r = getPhysique(db, "player", "user_1");
    assert.equal(r.mass_kg, 60);
    assert.equal(r.body_type, "slim");
  });

  it("rejects out-of-range mass", () => {
    const db = setupDb();
    const r = setPhysique(db, "player", "u", { mass_kg: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "mass_out_of_range");
  });

  it("rejects out-of-range height", () => {
    const db = setupDb();
    const r = setPhysique(db, "player", "u", { height_m: 3.5 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "height_out_of_range");
  });

  it("rejects bad actor_kind", () => {
    const db = setupDb();
    const r = setPhysique(db, "alien", "u", {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_actor_kind");
  });

  it("falls back to default body_type when invalid", () => {
    const db = setupDb();
    setPhysique(db, "player", "u", { body_type: "ghost" });
    assert.equal(getPhysique(db, "player", "u").body_type, "average");
  });
});

describe("Phase 3 / actor-physique — massMultiplier", () => {
  it("identity → 1.0", () => {
    const r = massMultiplier(75, 75);
    assert.equal(r.multiplier, 1.0);
    assert.equal(r.identity, true);
  });

  it("heavy vs light → clamps at 1.4", () => {
    const r = massMultiplier(150, 50);
    assert.equal(r.multiplier, 1.4);
    assert.ok(r.raw > 1.4);
  });

  it("light vs heavy → clamps at 0.7", () => {
    const r = massMultiplier(50, 150);
    assert.equal(r.multiplier, 0.7);
    assert.ok(r.raw < 0.7);
  });

  it("mild advantage (90 vs 75) → ~1.2 raw, ~1.2 clamped", () => {
    const r = massMultiplier(90, 75);
    assert.ok(Math.abs(r.multiplier - 1.2) < 0.001);
  });

  it("falls back to defaults on garbage input", () => {
    const r = massMultiplier(NaN, NaN);
    assert.equal(r.multiplier, 1.0);
  });
});

describe("Phase 3 / actor-physique — combatMassMultiplier (combat-path entry)", () => {
  it("returns 1.0 when neither actor has a row (both default to 75)", () => {
    const db = setupDb();
    const r = combatMassMultiplier(db,
      { kind: "player", id: "user_1" },
      { kind: "npc",    id: "npc_1" });
    assert.equal(r.multiplier, 1.0);
    assert.equal(r.attackerMassKg, 75);
    assert.equal(r.targetMassKg, 75);
  });

  it("composes with set rows", () => {
    const db = setupDb();
    setPhysique(db, "player", "user_1", { mass_kg: 100 });
    setPhysique(db, "npc",    "npc_1",  { mass_kg: 55 });
    const r = combatMassMultiplier(db,
      { kind: "player", id: "user_1" },
      { kind: "npc",    id: "npc_1" });
    // ratio = 100/55 = 1.818 → clamped 1.4
    assert.equal(r.multiplier, 1.4);
    assert.equal(r.attackerMassKg, 100);
    assert.equal(r.targetMassKg, 55);
  });

  it("identity returns identity flag", () => {
    const db = setupDb();
    setPhysique(db, "player", "user_1", { mass_kg: 80 });
    setPhysique(db, "npc",    "npc_1",  { mass_kg: 80 });
    const r = combatMassMultiplier(db,
      { kind: "player", id: "user_1" },
      { kind: "npc",    id: "npc_1" });
    assert.equal(r.identity, true);
  });

  it("returns no_input when missing actor", () => {
    const db = setupDb();
    const r = combatMassMultiplier(db, null, { kind: "npc", id: "x" });
    assert.equal(r.kind, "no_input");
  });
});
