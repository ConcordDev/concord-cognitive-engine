/**
 * Kingdom system test suite.
 *
 * Verifies:
 *   - foundKingdom rejects malformed polygon
 *   - foundKingdom rejects overlapping kingdom (same world, centroid in existing region)
 *   - pointInPolygon math
 *   - pointInKingdom locates the right kingdom
 *   - Decree alignment branches (enforced / tension / failed)
 *   - Contest start + resolve (overthrow vs repelled)
 *   - Resident registry
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up105 } from "../migrations/105_kingdoms.js";
import {
  foundKingdom,
  listKingdoms,
  getKingdom,
  pointInPolygon,
  pointInKingdom,
  enactDecree,
  listDecrees,
  contestKingdom,
  contributeContestStrength,
  resolveContest,
  joinKingdom,
  listResidents,
} from "../lib/kingdom.js";

function setupDb() {
  const db = new Database(":memory:");
  // Minimal dtus table — coherence-check.validateDecree probes for storyline tags
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, owner_id TEXT, owner_type TEXT, type TEXT,
      tags_json TEXT, skill_level REAL DEFAULT 0
    )
  `);
  up105(db);
  return db;
}

describe("kingdom geometry", () => {
  it("pointInPolygon detects inside square", () => {
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
    assert.equal(pointInPolygon(sq, 5, 5), true);
    assert.equal(pointInPolygon(sq, 15, 5), false);
    assert.equal(pointInPolygon(sq, -1, 5), false);
  });

  it("pointInPolygon handles concave", () => {
    const concave = [[0, 0], [10, 0], [10, 10], [5, 5], [0, 10]];
    assert.equal(pointInPolygon(concave, 5, 1), true);
    assert.equal(pointInPolygon(concave, 5, 9), false);
  });

  it("pointInPolygon rejects sub-3 vertex", () => {
    assert.equal(pointInPolygon([[0, 0], [1, 1]], 0, 0), false);
  });
});

describe("foundKingdom", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("rejects polygon with < 3 points", () => {
    const r = foundKingdom(db, {
      rulerId: "u1", regionPolygon: [[0, 0], [1, 1]], name: "K1",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "polygon_min_3_points");
  });

  it("requires ruler and name", () => {
    const r1 = foundKingdom(db, { regionPolygon: [[0, 0], [1, 0], [1, 1]], name: "K1" });
    assert.equal(r1.ok, false);
    const r2 = foundKingdom(db, { rulerId: "u1", regionPolygon: [[0, 0], [1, 0], [1, 1]] });
    assert.equal(r2.ok, false);
  });

  it("creates a kingdom + ruler resident", () => {
    const r = foundKingdom(db, {
      rulerId: "u1",
      regionPolygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      name: "Kingdom of Test",
    });
    assert.equal(r.ok, true);
    assert.ok(r.kingdomId);

    const k = getKingdom(db, r.kingdomId);
    assert.equal(k.name, "Kingdom of Test");
    assert.equal(k.ruler_user_id, "u1");

    const residents = listResidents(db, r.kingdomId);
    assert.equal(residents.length, 1);
    assert.equal(residents[0].role, "ruler");
  });

  it("rejects overlapping kingdom in same world", () => {
    const r1 = foundKingdom(db, {
      rulerId: "u1",
      regionPolygon: [[0, 0], [20, 0], [20, 20], [0, 20]],
      name: "K1",
    });
    assert.equal(r1.ok, true);
    // K2 centroid: (8, 8) — clearly inside K1's (0,0)-(20,20) square
    const r2 = foundKingdom(db, {
      rulerId: "u2",
      regionPolygon: [[3, 3], [13, 3], [13, 13], [3, 13]],
      name: "K2",
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "overlaps_existing_kingdom");
  });

  it("allows non-overlapping kingdoms", () => {
    foundKingdom(db, { rulerId: "u1", regionPolygon: [[0, 0], [10, 0], [10, 10], [0, 10]], name: "K1" });
    const r2 = foundKingdom(db, {
      rulerId: "u2",
      regionPolygon: [[100, 100], [110, 100], [110, 110], [100, 110]],
      name: "K2",
    });
    assert.equal(r2.ok, true);
  });
});

describe("pointInKingdom", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("locates the right kingdom", () => {
    foundKingdom(db, { rulerId: "u1", regionPolygon: [[0, 0], [10, 0], [10, 10], [0, 10]], name: "Alpha" });
    foundKingdom(db, { rulerId: "u2", regionPolygon: [[100, 0], [110, 0], [110, 10], [100, 10]], name: "Beta" });
    const inA = pointInKingdom(db, "concordia-hub", 5, 5);
    assert.equal(inA?.name, "Alpha");
    const inB = pointInKingdom(db, "concordia-hub", 105, 5);
    assert.equal(inB?.name, "Beta");
    const noKingdom = pointInKingdom(db, "concordia-hub", 50, 50);
    assert.equal(noKingdom, null);
  });
});

describe("enactDecree alignment", () => {
  let db, kingdomId;
  beforeEach(() => {
    db = setupDb();
    const r = foundKingdom(db, {
      rulerId: "u1",
      regionPolygon: [[0, 0], [100, 0], [100, 100], [0, 100]],
      name: "TestKingdom",
    });
    kingdomId = r.kingdomId;
  });

  it("enacts a kind that matches genre as enforced", async () => {
    // tax_levied is genre-neutral (matches all) → high alignment
    const r = await enactDecree(db, kingdomId, "tax_levied", {});
    assert.equal(r.ok, true);
    assert.ok(r.alignmentScore >= 0.6);
    assert.equal(r.activationState, "enforced");
  });

  it("hostile genre lowers alignment", async () => {
    // firearms_prohibited in 'concordia-hub' is in match list ('concordia') → enforced
    // But we'll create a separate test world that's hostile (cyber)
    const cyber = foundKingdom(db, {
      rulerId: "u2",
      worldId: "neonmoon-cyber",
      regionPolygon: [[200, 0], [300, 0], [300, 100], [200, 100]],
      name: "CyberKingdom",
    });
    const r = await enactDecree(db, cyber.kingdomId, "firearms_prohibited", {});
    assert.equal(r.ok, true);
    // Hostile genre should drag alignment below enforced threshold
    assert.ok(r.alignmentScore < 0.6, `expected hostile alignment, got ${r.alignmentScore}`);
  });

  it("unknown decree kind rejected", async () => {
    const r = await enactDecree(db, kingdomId, "made_up_decree", {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "unknown_decree_kind");
  });

  it("listDecrees activeOnly filters out failed", async () => {
    await enactDecree(db, kingdomId, "tax_levied", {});
    const all = listDecrees(db, kingdomId);
    assert.ok(all.length >= 1);
    const active = listDecrees(db, kingdomId, { activeOnly: true });
    assert.ok(active.length >= 1);
    assert.ok(active.every((d) => d.activation_state === "enforced" || d.activation_state === "tension"));
  });
});

describe("contest", () => {
  let db, kingdomId;
  beforeEach(() => {
    db = setupDb();
    const r = foundKingdom(db, {
      rulerId: "u1",
      regionPolygon: [[0, 0], [100, 0], [100, 100], [0, 100]],
      name: "K",
    });
    kingdomId = r.kingdomId;
  });

  it("contestKingdom creates active claim", () => {
    const r = contestKingdom(db, kingdomId, "u2", "siege");
    assert.equal(r.ok, true);
    assert.ok(r.contestId);
  });

  it("contributeContestStrength + resolveContest with high strength → overthrow", () => {
    const r = contestKingdom(db, kingdomId, "u2", "siege");
    contributeContestStrength(db, r.contestId, 200);
    const res = resolveContest(db, r.contestId);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, "overthrew");
    const k = getKingdom(db, kingdomId);
    assert.equal(k.ruler_user_id, "u2");
  });

  it("contributeContestStrength + resolveContest with low strength → repelled", () => {
    const r = contestKingdom(db, kingdomId, "u2", "siege");
    contributeContestStrength(db, r.contestId, 5);
    const res = resolveContest(db, r.contestId);
    assert.equal(res.ok, true);
    assert.equal(res.outcome, "repelled");
  });
});

describe("residents", () => {
  let db, kingdomId;
  beforeEach(() => {
    db = setupDb();
    const r = foundKingdom(db, {
      rulerId: "u1",
      regionPolygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      name: "K",
    });
    kingdomId = r.kingdomId;
  });

  it("joinKingdom adds resident", () => {
    const r = joinKingdom(db, kingdomId, "u2", "citizen");
    assert.equal(r.ok, true);
    const list = listResidents(db, kingdomId);
    assert.equal(list.length, 2); // ruler + citizen
  });

  it("joinKingdom is idempotent (upsert)", () => {
    joinKingdom(db, kingdomId, "u2", "citizen");
    joinKingdom(db, kingdomId, "u2", "guard");
    const list = listResidents(db, kingdomId);
    const u2 = list.find((r) => r.user_id === "u2");
    assert.equal(u2.role, "guard");
  });
});
