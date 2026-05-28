// Phase CB3 — farm plots tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  plantSeed, advanceGrowth, harvestCrop, listCropsOnClaim,
  getCropDef, listCrops,
} from "../lib/farming.js";
import { up as upCrops } from "../migrations/247_farm_plots.js";

function freshDb() { const db = new Database(":memory:"); upCrops(db); return db; }

const ownerYes = () => true;
const ownerNo = () => false;

describe("Phase CB3 — farming", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("plantSeed inserts crop; same tile occupied rejected", () => {
    const a = plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "wheat",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    assert.equal(a.ok, true);
    const b = plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "herb",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    assert.equal(b.ok, false);
    assert.equal(b.error, "tile_occupied");
  });

  it("non-owner cannot plant", () => {
    const r = plantSeed(db, "intruder", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "wheat",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerNo,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_claim_owner");
  });

  it("unknown crop rejected", () => {
    const r = plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "mythril",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unknown_crop");
  });

  it("advanceGrowth advances stage during planted season", () => {
    // Wheat affinity: seasons [0, 3]; growth_days 6. Stage 3/3 at day 6.
    plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "wheat",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    // Advance 3 days into season 0.
    advanceGrowth(db, 0, 3);
    const r = db.prepare(`SELECT growth_stage FROM claim_crops WHERE claim_id=?`).get("lc-1");
    // 3/6 of 3 = floor(1.5) = 1
    assert.equal(r.growth_stage, 1);
  });

  it("advanceGrowth halts in wrong season", () => {
    // Mushroom affinity: seasons [4, 5]. Plant in season 0.
    plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "mushroom",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    advanceGrowth(db, 0, 5); // wrong season
    const r = db.prepare(`SELECT growth_stage FROM claim_crops WHERE claim_id=?`).get("lc-1");
    assert.equal(r.growth_stage, 0, "stage 0 — wrong season halts growth");
  });

  it("harvestCrop requires ripe + credits item id with quantity", () => {
    plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "wheat",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    // Try harvest while not ripe.
    const notRipe = harvestCrop(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, isOwner: ownerYes,
    });
    assert.equal(notRipe.ok, false);
    assert.equal(notRipe.error, "not_ripe");

    // Force ripe.
    db.prepare(`UPDATE claim_crops SET growth_stage = 3`).run();
    const ripe = harvestCrop(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, isOwner: ownerYes,
    });
    assert.equal(ripe.ok, true);
    assert.equal(ripe.harvested.itemId, "wheat");
    assert.equal(ripe.harvested.quantity, 5);
    // Row deleted after harvest.
    assert.equal(listCropsOnClaim(db, "lc-1").length, 0);
  });

  it("seasonal multiplier scales yield (deep_winter herb 0.2× from seasons.js)", () => {
    plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "herb",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    db.prepare(`UPDATE claim_crops SET growth_stage = 3`).run();
    const r = harvestCrop(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0,
      seasonalMultiplier: 0.2, isOwner: ownerYes,
    });
    // base 3 × 0.2 = 0.6 → floor → 1 min (Math.max(1))
    assert.equal(r.harvested.quantity, 1);
  });

  it("listCrops returns the 5-crop catalog", () => {
    const all = listCrops();
    assert.equal(all.length, 5);
    const ids = all.map(c => c.id);
    assert.ok(ids.includes("wheat") && ids.includes("mushroom"));
  });
});
