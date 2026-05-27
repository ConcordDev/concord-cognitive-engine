// Contract test for the city-engine Phase II Wave 18 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ensureBudget, getBudget, setTaxRate, setAllocations,
  enactPolicy, repealPolicy, listActivePolicies,
  snapshotHappiness, latestSnapshot,
  CITY_CONSTANTS,
} from "../lib/city-engine.js";
import registerCityMacros from "../domains/city.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`city.${name}`);
  assert.ok(fn, `city.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerCityMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE city_budgets (
      world_id TEXT PRIMARY KEY,
      tax_rate_pct REAL NOT NULL DEFAULT 12,
      treasury_cents INTEGER NOT NULL DEFAULT 100000,
      housing_alloc_pct REAL NOT NULL DEFAULT 20,
      health_alloc_pct REAL NOT NULL DEFAULT 15,
      safety_alloc_pct REAL NOT NULL DEFAULT 25,
      infra_alloc_pct REAL NOT NULL DEFAULT 20,
      culture_alloc_pct REAL NOT NULL DEFAULT 10,
      welfare_alloc_pct REAL NOT NULL DEFAULT 10,
      last_tick_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE city_policies (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      enacted_by_user TEXT,
      enacted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      repealed_at INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX idx_city_policies_active
      ON city_policies (world_id, kind) WHERE repealed_at IS NULL;
    CREATE TABLE city_happiness_snapshot (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      tick_at INTEGER NOT NULL DEFAULT (unixepoch()),
      overall_pct REAL NOT NULL,
      housing_pct REAL NOT NULL DEFAULT 50,
      health_pct REAL NOT NULL DEFAULT 50,
      safety_pct REAL NOT NULL DEFAULT 50,
      infra_pct REAL NOT NULL DEFAULT 50,
      culture_pct REAL NOT NULL DEFAULT 50,
      welfare_pct REAL NOT NULL DEFAULT 50,
      faction_alignments_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
});

const ctxAlice = () => ({ actor: { userId: "alice" }, userId: "alice", db });

describe("city-engine library", () => {
  it("ensureBudget creates default row", () => {
    const b = ensureBudget(db, "w1");
    assert.equal(b.tax_rate_pct, 12);
    assert.equal(b.housing_alloc_pct, 20);
  });

  it("setTaxRate clamps 0..90", () => {
    setTaxRate(db, "w1", 150);
    assert.equal(getBudget(db, "w1").tax_rate_pct, 90);
    setTaxRate(db, "w1", -5);
    assert.equal(getBudget(db, "w1").tax_rate_pct, 0);
  });

  it("setAllocations normalizes when total > 100", () => {
    setAllocations(db, "w1", { housing: 80, health: 80 });
    const b = getBudget(db, "w1");
    // Sum should be ~100 after normalization
    assert.ok(Math.abs(b.housing_alloc_pct + b.health_alloc_pct - 100) < 0.01);
  });

  it("enactPolicy + repealPolicy + idempotency", () => {
    const r = enactPolicy(db, "w1", "curfew");
    assert.equal(r.ok, true);
    const r2 = enactPolicy(db, "w1", "curfew");
    assert.equal(r2.alreadyEnacted, true);
    const rep = repealPolicy(db, "w1", "curfew");
    assert.equal(rep.ok, true);
    // After repeal we can re-enact
    const r3 = enactPolicy(db, "w1", "curfew");
    assert.equal(r3.alreadyEnacted, undefined);
  });

  it("enactPolicy rejects invalid kind", () => {
    const r = enactPolicy(db, "w1", "free_lunch");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_kind");
  });

  it("listActivePolicies returns only un-repealed", () => {
    enactPolicy(db, "w1", "curfew");
    enactPolicy(db, "w1", "free_healthcare");
    repealPolicy(db, "w1", "curfew");
    const list = listActivePolicies(db, "w1");
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, "free_healthcare");
  });

  it("snapshotHappiness writes a row + computes overall", () => {
    const r = snapshotHappiness(db, "w1");
    assert.equal(r.ok, true);
    assert.ok(r.overall >= 0 && r.overall <= 100);
    const latest = latestSnapshot(db, "w1");
    assert.ok(latest);
    assert.equal(latest.overall_pct, r.overall);
  });

  it("snapshotHappiness drift between consecutive ticks", () => {
    // Set all allocations to favor housing → housing dept score should drift up
    setAllocations(db, "w1", { housing: 50, health: 10, safety: 10, infra: 10, culture: 10, welfare: 10 });
    const first = snapshotHappiness(db, "w1");
    const second = snapshotHappiness(db, "w1");
    assert.ok(second.departments.housing > first.departments.housing);
    assert.equal(second.delta !== null, true);
  });

  it("active policies bump happiness departments", () => {
    enactPolicy(db, "w1", "arts_subsidy"); // culture +10
    enactPolicy(db, "w1", "rent_control"); // housing +12, welfare +3
    const r = snapshotHappiness(db, "w1");
    assert.ok(r.departments.housing >= 50);
    assert.ok(r.departments.culture >= 50);
  });

  it("constants exposed", () => {
    assert.ok(CITY_CONSTANTS.HAPPINESS_DRIFT_PER_TICK > 0);
    assert.ok(CITY_CONSTANTS.POLICY_EFFECTS.curfew.safety > 0);
  });
});

describe("city domain macros", () => {
  it("end-to-end: budget → tax → allocations → enact → snapshot → summary", async () => {
    const b = await call("get_budget", ctxAlice(), { worldId: "w1" });
    assert.equal(b.ok, true);
    await call("set_tax_rate", ctxAlice(), { worldId: "w1", taxRatePct: 18 });
    await call("set_allocations", ctxAlice(), { worldId: "w1", allocations: { housing: 30 } });
    const e = await call("enact", ctxAlice(), { worldId: "w1", kind: "free_healthcare" });
    assert.equal(e.ok, true);
    const snap = await call("snapshot_happiness", ctxAlice(), { worldId: "w1" });
    assert.equal(snap.ok, true);
    const sum = await call("summary", ctxAlice(), { worldId: "w1" });
    assert.equal(sum.ok, true);
    assert.equal(sum.policies.length, 1);
    assert.equal(sum.happiness.overall_pct, snap.overall);
  });

  it("rejects no_db", async () => {
    const r = await call("get_budget", { actor: { userId: "x" }, userId: "x" }, { worldId: "w1" });
    assert.equal(r.ok, false);
  });
});
