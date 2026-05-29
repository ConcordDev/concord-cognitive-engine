// Contract test for the crime-engine Phase II Wave 23 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  recordCrime, resolveCrime, listWanted,
  issueBounty, claimBounty, cancelBounty, listBountiesOnTarget,
  stakeGangTerritory, advanceTerritoryControl, listTerritoriesInWorld,
  planHeist, executeHeist, listMyHeists,
  CRIME_CONSTANTS,
} from "../lib/crime-engine.js";
import registerCrimeMacros from "../domains/crime.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`crime.${name}`);
  assert.ok(fn, `crime.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerCrimeMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_crimes (
      id TEXT PRIMARY KEY,
      perpetrator_user_id TEXT NOT NULL,
      victim_kind TEXT NOT NULL,
      victim_id TEXT NOT NULL,
      crime_kind TEXT NOT NULL,
      world_id TEXT,
      severity REAL NOT NULL DEFAULT 0.5,
      witnessed INTEGER NOT NULL DEFAULT 0,
      bounty_cents INTEGER NOT NULL DEFAULT 0,
      committed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER,
      resolution TEXT
    );
    CREATE TABLE gang_territories (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      faction_id TEXT NOT NULL,
      center_x REAL NOT NULL,
      center_z REAL NOT NULL,
      radius_m REAL NOT NULL,
      control_pct REAL NOT NULL DEFAULT 50,
      racket_income_cents INTEGER NOT NULL DEFAULT 0,
      established_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE crime_bounties (
      id TEXT PRIMARY KEY,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      issued_by_kind TEXT NOT NULL,
      issued_by_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT 'wanted',
      issued_at INTEGER NOT NULL DEFAULT (unixepoch()),
      claimed_at INTEGER,
      claimed_by_user_id TEXT,
      cancelled_at INTEGER
    );
    CREATE TABLE heist_plans (
      id TEXT PRIMARY KEY,
      planner_user_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      difficulty REAL NOT NULL DEFAULT 0.5,
      reward_cents INTEGER NOT NULL DEFAULT 0,
      crew_json TEXT NOT NULL DEFAULT '[]',
      planned_for INTEGER,
      executed_at INTEGER,
      success INTEGER,
      witnesses_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
});

const ctxAlice = () => ({ actor: { userId: "alice" }, userId: "alice", db });

describe("crime-engine library", () => {
  it("recordCrime + listWanted + resolveCrime", () => {
    const c = recordCrime(db, {
      perpetratorUserId: "alice", victimKind: "npc", victimId: "shopkeeper",
      crimeKind: "theft", severity: 0.4, witnessed: true,
    });
    assert.equal(c.ok, true);
    assert.equal(c.witnessed, true);
    const wanted = listWanted(db);
    assert.equal(wanted.length, 1);
    const res = resolveCrime(db, c.crimeId, "jailed");
    assert.equal(res.ok, true);
    assert.equal(listWanted(db).length, 0);
  });

  it("recordCrime auto-sets bountyCents when witnessed", () => {
    const c = recordCrime(db, {
      perpetratorUserId: "u", victimKind: "npc", victimId: "x", crimeKind: "assault",
      severity: 0.8, witnessed: true,
    });
    assert.ok(c.bountyCents > 0);
  });

  it("issueBounty + claimBounty + cancelBounty", () => {
    const b = issueBounty(db, {
      targetKind: "player", targetId: "perp", issuedByKind: "realm", issuedById: "r1",
      amountCents: 10000, reason: "wanted_for_theft",
    });
    assert.equal(b.ok, true);
    const claim = claimBounty(db, b.bountyId, "bounty_hunter");
    assert.equal(claim.ok, true);
    assert.equal(claim.amountCents, 10000);
    const cancel = cancelBounty(db, b.bountyId, "r1");
    assert.equal(cancel.ok, false);
    assert.equal(cancel.reason, "already_closed");
  });

  it("claimBounty rejects self-claim", () => {
    const b = issueBounty(db, {
      targetKind: "player", targetId: "perp", issuedByKind: "realm", issuedById: "r1",
      amountCents: 100,
    });
    const r = claimBounty(db, b.bountyId, "perp");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "cannot_claim_self");
  });

  it("stakeGangTerritory + advanceControl + listTerritoriesInWorld", () => {
    const t = stakeGangTerritory(db, {
      worldId: "w1", factionId: "gang_a",
      centerX: 0, centerZ: 0, radiusM: 200, controlPct: 30,
    });
    assert.equal(t.ok, true);
    const adv = advanceTerritoryControl(db, t.territoryId, 25);
    assert.equal(adv.controlPct, 55);
    const list = listTerritoriesInWorld(db, "w1");
    assert.equal(list.length, 1);
  });

  it("planHeist + executeHeist success path", () => {
    const h = planHeist(db, {
      plannerUserId: "alice", targetKind: "building", targetId: "vault_1",
      difficulty: 0.4, rewardCents: 5000,
    });
    // High crew skill + low roll → success
    const ex = executeHeist(db, { heistId: h.heistId, crewSkill: 90, rollOverride: 0.01, witnessRollOverride: 0.9 });
    assert.equal(ex.success, true);
    assert.equal(ex.rewardCents, 5000);
    assert.equal(ex.witnesses, 0);
  });

  it("executeHeist failure + witnesses → crime + bounty", () => {
    const h = planHeist(db, {
      plannerUserId: "alice", targetKind: "building", targetId: "vault_1",
      difficulty: 0.7, rewardCents: 5000,
    });
    const ex = executeHeist(db, { heistId: h.heistId, crewSkill: 10, rollOverride: 0.95, witnessRollOverride: 0.05 });
    assert.equal(ex.success, false);
    assert.ok(ex.witnesses > 0);
    assert.ok(ex.crimeId);
    assert.ok(ex.bountyId);
    const bounties = listBountiesOnTarget(db, "player", "alice");
    assert.equal(bounties.length, 1);
  });

  it("executeHeist rejects double-execute", () => {
    const h = planHeist(db, {
      plannerUserId: "alice", targetKind: "building", targetId: "vault_1",
      difficulty: 0.4, rewardCents: 1000,
    });
    executeHeist(db, { heistId: h.heistId, crewSkill: 80, rollOverride: 0.1, witnessRollOverride: 0.9 });
    const second = executeHeist(db, { heistId: h.heistId, crewSkill: 80 });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_executed");
  });

  it("constants exposed", () => {
    assert.ok(CRIME_CONSTANTS.HEIST_SUCCESS_BASE > 0);
  });
});

describe("crime domain macros", () => {
  it("end-to-end record → wanted → resolve", async () => {
    const r = await call("record", ctxAlice(), {
      victimKind: "npc", victimId: "x", crimeKind: "theft", severity: 0.3, witnessed: true,
    });
    assert.equal(r.ok, true);
    const w = await call("wanted", ctxAlice(), {});
    assert.equal(w.wanted.length, 1);
    const resolved = await call("resolve", ctxAlice(), { crimeId: r.crimeId, resolution: "paid" });
    assert.equal(resolved.ok, true);
  });

  it("plan + execute heist via macros", async () => {
    const h = await call("plan_heist", ctxAlice(), {
      targetKind: "building", targetId: "v1", difficulty: 0.3, rewardCents: 1000,
    });
    assert.equal(h.ok, true);
    const ex = await call("execute_heist", ctxAlice(), {
      heistId: h.heistId, crewSkill: 80, rollOverride: 0.05, witnessRollOverride: 0.9,
    });
    assert.equal(ex.ok, true);
    assert.equal(ex.success, true);
  });

  it("rejects no_user / no_db", async () => {
    const r = await call("record", { actor: { userId: null }, userId: null, db }, {
      victimKind: "npc", victimId: "x", crimeKind: "theft",
    });
    assert.equal(r.ok, false);
  });
});
