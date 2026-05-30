/**
 * Living Society — Phase 13: world-creation as the highest-stakes verb.
 *
 *   - two tiers; canon requires an operator (no self-promote to rule-bending);
 *   - founding grace protects a startup window;
 *   - conquer transfers CONTROL but never the historical founder, never the hub,
 *     never during grace;
 *   - the authored-substrate sanctity invariant forbids hard-deleting a world
 *     with authored content / NPCs / visits;
 *   - expandClaim grows the safe radius at escalating cost;
 *   - conditional god-tier forces are conditions over constants.
 *
 * Run: node --test tests/world-sovereignty.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up291 } from "../migrations/291_world_sovereignty.js";
import {
  setWorldTier, grantFoundingGrace, isUnderGrace, conquerWorld,
  canHardDeleteWorld, conditionalGodTierForce, SOVEREIGNTY_CONSTANTS,
} from "../lib/world-sovereignty.js";
import { claimLand, expandClaim } from "../lib/land-claims.js";

function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT, universe_type TEXT DEFAULT 'standard', created_by TEXT, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE world_visits (id TEXT PRIMARY KEY, world_id TEXT, user_id TEXT);
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT);
    CREATE TABLE land_claims (id TEXT PRIMARY KEY, owner_user_id TEXT, world_id TEXT, anchor_x REAL, anchor_z REAL, radius_m REAL, bond_sparks INTEGER, maintenance_per_day INTEGER, claimed_at INTEGER, last_maintained_at INTEGER, status TEXT);
    CREATE TABLE land_claim_events (id TEXT PRIMARY KEY, claim_id TEXT, kind TEXT, actor TEXT, payload_json TEXT, created_at INTEGER DEFAULT (unixepoch()));
  `);
  up291(db);
  db.prepare(`INSERT INTO worlds (id, name, created_by) VALUES ('moon1', 'Moon', 'founder_a')`).run();
  return db;
}

describe("Phase 13 — two tiers", () => {
  it("a world defaults to open; canon requires an operator", () => {
    const db = mkDb();
    assert.equal(db.prepare(`SELECT tier FROM worlds WHERE id='moon1'`).get().tier, "open");
    assert.equal(setWorldTier(db, "moon1", "canon", { isOperator: false }).reason, "canon_requires_operator");
    assert.equal(setWorldTier(db, "moon1", "canon", { isOperator: true, sanctionedBy: "admin" }).tier, "canon");
  });
});

describe("Phase 13 — founding grace", () => {
  it("protects a startup window", () => {
    const db = mkDb();
    grantFoundingGrace(db, "moon1", "founder_a", { windowS: 1000, now: 100 });
    assert.equal(isUnderGrace(db, "moon1", 500), true);
    assert.equal(isUnderGrace(db, "moon1", 2000), false);
  });
});

describe("Phase 13 — conquerable, never deletable", () => {
  it("conquer transfers control but preserves the historical founder", () => {
    const db = mkDb();
    const r = conquerWorld(db, "moon1", { conquerorId: "warlord", now: 999999 });
    assert.equal(r.ok, true);
    assert.equal(r.newRuler, "warlord");
    assert.equal(r.historicalFounder, "founder_a");
    const w = db.prepare(`SELECT created_by, current_ruler_id FROM worlds WHERE id='moon1'`).get();
    assert.equal(w.created_by, "founder_a", "founder NEVER overwritten");
    assert.equal(w.current_ruler_id, "warlord");
  });

  it("refuses to conquer the hub + a world under grace", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO worlds (id, name, created_by) VALUES ('concordia-hub', 'Hub', 'system')`).run();
    assert.equal(conquerWorld(db, "concordia-hub", { conquerorId: "x" }).reason, "concordant_law_refusal");
    grantFoundingGrace(db, "moon1", "founder_a", { windowS: 1000, now: 100 });
    assert.equal(conquerWorld(db, "moon1", { conquerorId: "x", now: 500 }).reason, "founder_grace");
  });

  it("the sanctity invariant forbids deleting an authored / visited world", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('n1', 'moon1')`).run();
    assert.equal(canHardDeleteWorld(db, "moon1").allowed, false);
    // an empty unauthored world CAN be cleaned up
    db.prepare(`INSERT INTO worlds (id, name) VALUES ('empty', 'Empty')`).run();
    assert.equal(canHardDeleteWorld(db, "empty").allowed, true);
    // the hub is eternal
    assert.equal(canHardDeleteWorld(db, "concordia-hub").allowed, false);
  });
});

describe("Phase 13 — expandClaim (risk scales with ambition)", () => {
  it("grows the safe radius outward at escalating cost", () => {
    const db = mkDb();
    const c = claimLand(db, { userId: "founder_a", worldId: "moon1", x: 0, z: 0, radiusM: 20 });
    assert.equal(c.ok, true);
    const e1 = expandClaim(db, { claimId: c.claimId, userId: "founder_a", newRadiusM: 60 });
    assert.equal(e1.ok, true);
    assert.equal(db.prepare(`SELECT radius_m FROM land_claims WHERE id=?`).get(c.claimId).radius_m, 60);
    const e2 = expandClaim(db, { claimId: c.claimId, userId: "founder_a", newRadiusM: 120 });
    assert.ok(e2.deltaBond > e1.deltaBond, "each expansion costs more (quadratic in area)");
    // not the owner → refused
    assert.equal(expandClaim(db, { claimId: c.claimId, userId: "rando", newRadiusM: 150 }).reason, "not_owner");
  });
});

describe("Phase 13 — conditional god-tier forces", () => {
  it("are conditions over constants (daylight / ramp / regen)", () => {
    const noon = conditionalGodTierForce("daylight_avatar", { illumination: 80000 });
    const night = conditionalGodTierForce("daylight_avatar", { illumination: 0 });
    assert.ok(noon.magnitude > night.magnitude, "stronger in sunlight");
    const early = conditionalGodTierForce("war_ramp", { fightDurationS: 0 });
    const late = conditionalGodTierForce("war_ramp", { fightDurationS: 600 });
    assert.ok(late.magnitude > early.magnitude, "ramps with fight duration");
    assert.ok(SOVEREIGNTY_CONSTANTS.GRACE_WINDOW_S > 0);
  });
});
