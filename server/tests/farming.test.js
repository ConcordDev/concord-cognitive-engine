// Phase CB3 — farm plots tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  plantSeed, advanceGrowth, harvestCrop, listCropsOnClaim,
  getCropDef, listCrops, waterCrop,
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

  it("waterCrop rejects non-owner, missing crop, and already-ripe crops", () => {
    plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "wheat",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    const intruder = waterCrop(db, "intruder", {
      claimId: "lc-1", tileX: 0, tileY: 0, isOwner: ownerNo,
    });
    assert.equal(intruder.ok, false);
    assert.equal(intruder.error, "not_claim_owner");

    const noCrop = waterCrop(db, "u1", {
      claimId: "lc-1", tileX: 9, tileY: 9, isOwner: ownerYes,
    });
    assert.equal(noCrop.ok, false);
    assert.equal(noCrop.error, "no_crop");

    db.prepare(`UPDATE claim_crops SET growth_stage = 3`).run();
    const ripe = waterCrop(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, isOwner: ownerYes,
    });
    assert.equal(ripe.ok, false);
    assert.equal(ripe.error, "already_ripe");
  });

  it("watering is a genuine growth-rate bonus: watered crop ripens sooner than an unwatered one", () => {
    // Wheat: seasons [0,3], growth_days 6. Two identical plots, same planted
    // day. Water only lc-2's crop, then advance both by the same 3 days.
    plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "wheat",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    plantSeed(db, "u1", {
      claimId: "lc-2", tileX: 0, tileY: 0, cropKind: "wheat",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });

    // Confirm plantSeed no longer stamps a fake watered_at (the dead-write bug).
    const freshRow = db.prepare(`SELECT watered_at FROM claim_crops WHERE claim_id='lc-1'`).get();
    assert.equal(freshRow.watered_at, null, "watered_at must stay null until a real water action");

    const w = waterCrop(db, "u1", { claimId: "lc-2", tileX: 0, tileY: 0, isOwner: ownerYes });
    assert.equal(w.ok, true);

    const nowUnix = Math.floor(Date.now() / 1000);
    // One tick advances every unripe crop; lc-1 (unwatered) gets the base
    // rate, lc-2 (watered) gets +WATER_BONUS_DAYS.
    const r1 = advanceGrowth(db, 0, 3, nowUnix);
    assert.equal(r1.ok, true);
    assert.ok(r1.waterBonusApplied >= 1, "expected the watered crop's advance to be tagged with a bonus");

    const unwatered = db.prepare(`SELECT growth_stage FROM claim_crops WHERE claim_id='lc-1'`).get();
    const watered = db.prepare(`SELECT growth_stage FROM claim_crops WHERE claim_id='lc-2'`).get();
    // 3/6 of 3 = floor(1.5) = 1 (unwatered, base rate — matches the
    // pre-existing "advances stage during planted season" assertion above).
    assert.equal(unwatered.growth_stage, 1);
    // (3+1)/6 of 3 = floor(2.0) = 2 — the watered crop is measurably ahead.
    assert.equal(watered.growth_stage, 2);
    assert.ok(watered.growth_stage > unwatered.growth_stage, "watered crop must ripen faster than unwatered");
  });

  it("watering bonus expires outside the recency window", () => {
    plantSeed(db, "u1", {
      claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "wheat",
      currentSeasonIdx: 0, currentDay: 0, isOwner: ownerYes,
    });
    waterCrop(db, "u1", { claimId: "lc-1", tileX: 0, tileY: 0, isOwner: ownerYes });
    // Simulate a growth tick far beyond the 48h freshness window.
    const staleNow = Math.floor(Date.now() / 1000) + 10 * 24 * 3600;
    advanceGrowth(db, 0, 3, staleNow);
    const r = db.prepare(`SELECT growth_stage FROM claim_crops WHERE claim_id='lc-1'`).get();
    // No bonus applied once the watering has gone stale — same as unwatered.
    assert.equal(r.growth_stage, 1);
  });

  it("listCrops returns the crop catalog (census target ≥18, base crops present)", () => {
    const all = listCrops();
    // Catalog expanded from the original 5 to the census target via the authoring
    // pipeline (scripts/author/author-libs.mjs --type crop). The 5 base crops remain.
    assert.ok(all.length >= 18, `expected ≥18 crops, got ${all.length}`);
    const ids = all.map(c => c.id);
    for (const base of ["wheat", "herb", "vine", "root", "mushroom"]) {
      assert.ok(ids.includes(base), `base crop ${base} missing`);
    }
  });
});
