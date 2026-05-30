/**
 * Living Society — Phase 0.6: destructible world + load-bearing hydrology.
 *
 *   - applyDeformation persists a delta; deformationsForWorld replays it;
 *     getElevationAt = base + delta (the single elevation truth);
 *   - digging is depth-clamped + yields the cell's terrain material;
 *   - the water flow solver moves water to the lowest cell, CONSERVES volume,
 *     and pools deterministically;
 *   - build-bill debits a real materials bill (conserved matter).
 *
 * Run: node --test tests/terrain-deformation.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up281 } from "../migrations/281_terrain_deformation.js";
import {
  baseElevation, getElevationAt, applyDeformation, deformationsForWorld,
  craterAt, cellOf, TERRAIN_CONSTANTS,
} from "../lib/terrain-deformation.js";
import { solveFlowStep, totalWater, setWater, tickWaterFlow, waterDepthAt } from "../lib/terrain-water.js";
import { debitBuildBill, canAfford, billFor } from "../lib/build-bill.js";

const W = "w1";
function db281() {
  const db = new Database(":memory:");
  up281(db);
  db.exec(`CREATE TABLE player_inventory (
    id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT DEFAULT 'concordia-hub',
    item_type TEXT, item_id TEXT, item_name TEXT, quantity INTEGER DEFAULT 1,
    quality TEXT, acquired_at INTEGER DEFAULT (unixepoch()), properties_json TEXT
  );`);
  return db;
}

describe("Phase 0.6 — terrain deformation", () => {
  it("persists a dig delta + replays it; elevation = base + delta", () => {
    const db = db281();
    const wx = 500, wz = 500;
    const base = baseElevation(wx, wz);
    const r = applyDeformation(db, W, wx, wz, 3, "excavate");
    assert.equal(r.ok, true);
    assert.ok(r.newDelta < 0, "excavate lowers the cell");
    assert.ok(r.material, "yields a terrain material");
    const elev = getElevationAt(db, W, wx, wz);
    assert.ok(Math.abs(elev - (base + r.newDelta)) < 0.01, `${elev} vs ${base + r.newDelta}`);
    const replay = deformationsForWorld(db, W);
    assert.equal(replay.length, 1);
    const { cx, cz } = cellOf(wx, wz);
    assert.equal(replay[0].cell_x, cx);
    assert.equal(replay[0].cell_z, cz);
  });

  it("dig depth is clamped (no infinite hole)", () => {
    const db = db281();
    for (let i = 0; i < 50; i++) applyDeformation(db, W, 600, 600, 5, "excavate");
    const d = deformationsForWorld(db, W)[0];
    assert.ok(Math.abs(d.height_delta) <= TERRAIN_CONSTANTS.MAX_DIG_DEPTH + 0.001);
  });

  it("a building collapse writes a crater", () => {
    const db = db281();
    const r = craterAt(db, W, 700, 700, 4);
    assert.equal(r.ok, true);
    assert.equal(deformationsForWorld(db, W)[0].kind, "crater");
  });
});

describe("Phase 0.6 — hydrology flow solver", () => {
  it("moves water downhill, conserves volume, and pools", () => {
    // A 3-cell line: high(10) - mid(5) - low(0). Drop 6 water on the high cell.
    const cells = new Map([
      ["0,0", { cx: 0, cz: 0, terrain: 10, water: 6 }],
      ["1,0", { cx: 1, cz: 0, terrain: 5, water: 0 }],
      ["2,0", { cx: 2, cz: 0, terrain: 0, water: 0 }],
    ]);
    const v0 = totalWater(cells);
    let cur = cells;
    for (let i = 0; i < 30; i++) cur = solveFlowStep(cur);
    const v1 = totalWater(cur);
    assert.ok(Math.abs(v0 - v1) < 1e-3, `volume not conserved: ${v0} -> ${v1}`);
    // Water should have accumulated in the lowest cell.
    assert.ok(cur.get("2,0").water > cur.get("0,0").water, "water pooled in the low cell");
  });

  it("is deterministic", () => {
    const mk = () => new Map([
      ["0,0", { cx: 0, cz: 0, terrain: 8, water: 4 }],
      ["1,0", { cx: 1, cz: 0, terrain: 2, water: 0 }],
    ]);
    const a = solveFlowStep(mk());
    const b = solveFlowStep(mk());
    assert.deepEqual([...a.entries()], [...b.entries()]);
  });

  it("DB water grid: set, read per-cell depth, tick conserves volume", () => {
    const db = db281();
    setWater(db, W, 55, 55, 5);     // cell A high water
    setWater(db, W, 65, 55, 0);     // adjacent cell
    assert.equal(waterDepthAt(db, W, 55, 55), 5);
    const before = db.prepare(`SELECT SUM(water_height) s FROM world_water_cells WHERE world_id=?`).get(W).s;
    const r = tickWaterFlow(db, W);
    assert.equal(r.ok, true);
    const after = db.prepare(`SELECT SUM(water_height) s FROM world_water_cells WHERE world_id=?`).get(W).s;
    assert.ok(Math.abs(before - after) < 0.05, `volume drift ${before} -> ${after}`);
  });
});

describe("Phase 0.6 — resource-gated building (conserved matter)", () => {
  it("debits a real materials bill; rejects when short", () => {
    const db = db281();
    const give = (id, q) => db.prepare(`INSERT INTO player_inventory (id,user_id,world_id,item_type,item_id,item_name,quantity) VALUES (?,?,?,?,?,?,?)`)
      .run(`i_${id}_${Math.random()}`, "u1", W, "material", id, id, q);
    const bill = billFor("house"); // wood 20 + stone 10
    assert.equal(canAfford(db, "u1", W, bill).ok, false);
    give("wood", 25); give("stone", 12);
    assert.equal(canAfford(db, "u1", W, bill).ok, true);
    const r = debitBuildBill(db, "u1", W, bill);
    assert.equal(r.ok, true);
    assert.equal(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id='u1' AND item_id='wood'`).get().n, 5);
  });
});
