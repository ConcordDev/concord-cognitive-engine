/**
 * WS-A5 — the dug-ditch-fills mechanic: water must flow DOWNHILL into an empty,
 * lower cell. Regression for the playtest find where loadWaterGrid only loaded
 * wet cells, so makeDryNeighbour walled off every dry destination (terrain=∞)
 * and water could never enter a freshly-dug ditch.
 *
 * Run: node --test tests/terrain-water-flow.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { setWater, waterDepthAt, tickWaterFlow, loadWaterGrid, totalWater, solveFlowStep } from "../lib/terrain-water.js";
import { applyDeformation } from "../lib/terrain-deformation.js";

const W = "concordia-hub";
function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_terrain_deformations (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, cell_x INTEGER NOT NULL, cell_z INTEGER NOT NULL,
      height_delta REAL NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'excavate',
      material_id TEXT, created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0,
      UNIQUE (world_id, cell_x, cell_z)
    );
    CREATE TABLE world_water_cells (
      world_id TEXT NOT NULL, cell_x INTEGER NOT NULL, cell_z INTEGER NOT NULL,
      water_height REAL NOT NULL DEFAULT 0, updated_at INTEGER DEFAULT 0,
      PRIMARY KEY (world_id, cell_x, cell_z)
    );
  `);
  return db;
}

describe("WS-A5 — hydrology flows into a dug ditch", () => {
  it("loadWaterGrid seeds dry orthogonal neighbours with real terrain", () => {
    const db = mkDb();
    setWater(db, W, 150, 150, 4); // one wet cell
    const grid = loadWaterGrid(db, W);
    // the wet cell + its 4 neighbours are present (5 total), neighbours dry
    assert.ok(grid.size >= 5, `expected wet + 4 dry neighbours, got ${grid.size}`);
    let dry = 0;
    for (const c of grid.values()) { if (c.water === 0) dry++; assert.ok(Number.isFinite(c.terrain), "neighbour has real terrain"); }
    assert.ok(dry >= 4, "the 4 neighbours are dry");
  });

  it("water drains from a high wet cell into an adjacent DUG (lower) cell", () => {
    const db = mkDb();
    // Dig a deep pit at a cell, then seed water in the neighbour one cell east.
    applyDeformation(db, W, 105, 105, 12, "excavate"); // pit at cell (10,10), -12m
    setWater(db, W, 115, 105, 6);                       // water at cell (11,10)
    const startDepthPit = waterDepthAt(db, W, 105, 105);
    assert.equal(startDepthPit, 0, "pit starts dry");

    for (let i = 0; i < 12; i++) tickWaterFlow(db, W);

    // The dug pit (the lowest cell) is now wet AND holds the most water — it
    // pooled, exactly the dig-a-ditch-and-it-fills mechanic.
    const pitDepth = waterDepthAt(db, W, 105, 105);
    assert.ok(pitDepth > 1, `water should have pooled in the pit; depth=${pitDepth}`);
    const srcDepth = waterDepthAt(db, W, 115, 105);
    assert.ok(pitDepth > srcDepth, `pit (${pitDepth}) should hold more than the drained source (${srcDepth})`);
  });

  it("pure solveFlowStep still conserves volume with a dry lower neighbour in the map", () => {
    const cells = new Map([
      ["0,0", { cx: 0, cz: 0, terrain: 10, water: 5 }], // high + wet
      ["1,0", { cx: 1, cz: 0, terrain: 2, water: 0 }],  // low + dry (the ditch)
    ]);
    const before = totalWater(cells);
    const next = solveFlowStep(cells);
    assert.ok((next.get("1,0").water || 0) > 0, "water flowed into the dry ditch");
    assert.ok(Math.abs(totalWater(next) - before) < 1e-3, "volume conserved");
  });
});
