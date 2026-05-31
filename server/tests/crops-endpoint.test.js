// Wave 5c — the per-world crops read (the one endpoint that was missing).
//
// Pins the join + tile translation the GET /api/worlds/:worldId/crops handler
// runs: claim_crops -> land_claims (this world, active), per-claim tile -> absolute
// world tile via the claim anchor (renderer maps tile*2m -> world x/z).
//
// Run: node --test tests/crops-endpoint.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig135 from "../migrations/135_land_claims.js";
import * as mig247 from "../migrations/247_farm_plots.js";

// The exact query + translation the route uses (kept in sync with routes/worlds.js).
function cropsForWorld(db, worldId) {
  const rows = db.prepare(`
    SELECT cc.claim_id, cc.tile_x, cc.tile_y, cc.crop_kind, cc.growth_stage,
           lc.anchor_x, lc.anchor_z
    FROM claim_crops cc
    JOIN land_claims lc ON lc.id = cc.claim_id
    WHERE lc.world_id = ? AND lc.status = 'active'
    LIMIT 2000
  `).all(worldId);
  return rows.map((r) => ({
    claim_id: r.claim_id,
    tile_x: Math.round((Number(r.anchor_x) || 0) / 2) + (Number(r.tile_x) || 0),
    tile_y: Math.round((Number(r.anchor_z) || 0) / 2) + (Number(r.tile_y) || 0),
    crop_kind: r.crop_kind,
    growth_stage: r.growth_stage,
  }));
}

let db;
beforeEach(() => {
  db = new Database(":memory:");
  mig135.up(db);
  mig247.up(db);
  db.prepare(`INSERT INTO land_claims (id, owner_user_id, world_id, anchor_x, anchor_z, radius_m)
              VALUES ('claim_A','usr_1','tunya',10,20,50)`).run();
  db.prepare(`INSERT INTO land_claims (id, owner_user_id, world_id, anchor_x, anchor_z, radius_m, status)
              VALUES ('claim_B','usr_1','tunya',0,0,50,'abandoned')`).run();
  db.prepare(`INSERT INTO claim_crops (claim_id, tile_x, tile_y, crop_kind, growth_stage, planted_season_idx, planted_day, planted_by)
              VALUES ('claim_A',1,2,'wheat',2,0,0,'usr_1')`).run();
  db.prepare(`INSERT INTO claim_crops (claim_id, tile_x, tile_y, crop_kind, growth_stage, planted_season_idx, planted_day, planted_by)
              VALUES ('claim_B',0,0,'herb',3,0,0,'usr_1')`).run();
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("Wave 5c — per-world crops read", () => {
  it("returns active-claim crops translated to absolute world tiles", () => {
    const crops = cropsForWorld(db, "tunya");
    assert.equal(crops.length, 1, "only the active claim's crop is returned");
    const c = crops[0];
    assert.equal(c.crop_kind, "wheat");
    assert.equal(c.growth_stage, 2);
    // anchor (10,20) -> tile (5,10); + local (1,2) -> (6,12)
    assert.equal(c.tile_x, 6);
    assert.equal(c.tile_y, 12);
  });

  it("excludes non-active claims and other worlds", () => {
    assert.equal(cropsForWorld(db, "tunya").every((c) => c.claim_id === "claim_A"), true);
    assert.equal(cropsForWorld(db, "cyber").length, 0);
  });
});
