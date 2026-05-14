/**
 * Tier-2 contract tests for Concordia Phase 13 — culture friction + marriage.
 *
 * Pins (culture):
 *   - setCulture upserts on (actor_kind, actor_id)
 *   - getFriction is sorted-pair-safe (returns same value for [a,b] and [b,a])
 *   - friction defaults to 0 for unknown pairs
 *   - same-culture pair returns 0
 *   - opinionFrictionDelta integer-rounds friction × 10
 *   - seeded relations (dinye/fluxom hostile, asbir/dinye friendly, etc.)
 *
 * Pins (marriage):
 *   - marry creates active marriage
 *   - second active marriage refused
 *   - self-marriage refused
 *   - listMarriagesFor returns active for either partner
 *   - dissolveMarriage transitions active → divorced/widowed
 *
 * Run: node --test tests/culture-marriage.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  setCulture,
  getCulture,
  getFriction,
  setFriction,
  opinionFrictionDelta,
  marry,
  listMarriagesFor,
  dissolveMarriage,
} from "../lib/culture-friction.js";
import { up as up182 } from "../migrations/182_culture_marriage.js";

function setupDb() {
  const db = new Database(":memory:");
  up182(db);
  return db;
}

describe("Phase 13 / culture — setCulture + getCulture", () => {
  it("upserts on (kind, id)", () => {
    const db = setupDb();
    setCulture(db, "player", "u_1", "sanguire", "fire_lineage");
    setCulture(db, "player", "u_1", "medici", "crash_remembrance");
    const c = getCulture(db, "player", "u_1");
    assert.equal(c.culture_id, "medici");
    assert.equal(c.faith_id, "crash_remembrance");
  });

  it("rejects bad actor_kind", () => {
    const db = setupDb();
    const r = setCulture(db, "ghost", "x", "sanguire");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_actor_kind");
  });
});

describe("Phase 13 / culture — getFriction symmetry", () => {
  it("sorted-pair-safe — same value for [a,b] and [b,a]", () => {
    const db = setupDb();
    const f1 = getFriction(db, "dinye", "fluxom");
    const f2 = getFriction(db, "fluxom", "dinye");
    assert.equal(f1, f2);
  });

  it("defaults to 0 for unknown pair", () => {
    const db = setupDb();
    assert.equal(getFriction(db, "unknown_a", "unknown_b"), 0);
  });

  it("same culture returns 0", () => {
    const db = setupDb();
    assert.equal(getFriction(db, "dinye", "dinye"), 0);
  });
});

describe("Phase 13 / culture — seeded friction", () => {
  it("Bloc vs Fluxom is hostile (-0.6)", () => {
    const db = setupDb();
    assert.equal(getFriction(db, "dinye", "fluxom"), -0.6);
    assert.equal(getFriction(db, "aekon", "fluxom"), -0.6);
  });

  it("Bloc inner solidarity (+0.4)", () => {
    const db = setupDb();
    assert.equal(getFriction(db, "asbir", "dinye"), 0.4);
  });

  it("Medici/Sangree awkward (-0.2)", () => {
    const db = setupDb();
    assert.equal(getFriction(db, "medici", "sangree"), -0.2);
  });
});

describe("Phase 13 / culture — setFriction", () => {
  it("clamps to [-1, 1]", () => {
    const db = setupDb();
    setFriction(db, "akeia", "sahm", 5);
    assert.equal(getFriction(db, "akeia", "sahm"), 1);
    setFriction(db, "akeia", "sahm", -5);
    assert.equal(getFriction(db, "akeia", "sahm"), -1);
  });

  it("rejects self-pair", () => {
    const db = setupDb();
    const r = setFriction(db, "dinye", "dinye", 0.5);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self_pair");
  });
});

describe("Phase 13 / culture — opinionFrictionDelta", () => {
  it("computes integer delta from friction × 10", () => {
    const db = setupDb();
    setCulture(db, "player", "u_atk", "dinye");
    setCulture(db, "npc",    "n_tgt", "fluxom");
    const delta = opinionFrictionDelta(db, "player", "u_atk", "npc", "n_tgt");
    // dinye-fluxom friction = -0.6 → -6
    assert.equal(delta, -6);
  });

  it("returns 0 when no culture set", () => {
    const db = setupDb();
    const delta = opinionFrictionDelta(db, "player", "u_a", "npc", "n_b");
    assert.equal(delta, 0);
  });
});

describe("Phase 13 / marriage — marry / refuse / dissolve", () => {
  it("creates active marriage", () => {
    const db = setupDb();
    const r = marry(db, { kind: "player", id: "u_1" }, { kind: "npc", id: "npc_a" });
    assert.equal(r.action, "married");
    assert.ok(r.marriage_id);
  });

  it("refuses second active marriage for same partner", () => {
    const db = setupDb();
    marry(db, { kind: "player", id: "u_1" }, { kind: "npc", id: "npc_a" });
    const r = marry(db, { kind: "player", id: "u_1" }, { kind: "npc", id: "npc_b" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "already_married");
  });

  it("refuses self-marriage", () => {
    const db = setupDb();
    const r = marry(db, { kind: "player", id: "u_1" }, { kind: "player", id: "u_1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self_marriage");
  });

  it("listMarriagesFor returns active for either partner", () => {
    const db = setupDb();
    marry(db, { kind: "player", id: "u_1" }, { kind: "npc", id: "npc_a" });
    assert.equal(listMarriagesFor(db, "player", "u_1").length, 1);
    assert.equal(listMarriagesFor(db, "npc",    "npc_a").length, 1);
  });

  it("dissolveMarriage transitions active → divorced", () => {
    const db = setupDb();
    const r = marry(db, { kind: "player", id: "u_1" }, { kind: "npc", id: "npc_a" });
    dissolveMarriage(db, r.marriage_id, "divorced");
    assert.equal(listMarriagesFor(db, "player", "u_1").length, 0);
    // After dissolution, can re-marry.
    const r2 = marry(db, { kind: "player", id: "u_1" }, { kind: "npc", id: "npc_b" });
    assert.equal(r2.action, "married");
  });

  it("widowed status set when reason=widowed", () => {
    const db = setupDb();
    const r = marry(db, { kind: "player", id: "u_1" }, { kind: "npc", id: "npc_a" });
    const x = dissolveMarriage(db, r.marriage_id, "widowed");
    assert.equal(x.status, "widowed");
  });
});
