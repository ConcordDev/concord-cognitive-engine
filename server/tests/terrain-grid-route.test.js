/**
 * WS-A1 — the bulk terrain read the 3D client consumes: deformation deltas +
 * the wet-cell water grid. Pins waterGridForWorld + the shape the route returns.
 *
 * Run: node --test tests/terrain-grid-route.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { deformationsForWorld, applyDeformation, CELL_SIZE } from "../lib/terrain-deformation.js";
import { waterGridForWorld, setWater } from "../lib/terrain-water.js";

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

describe("WS-A1 — terrain grid readers", () => {
  it("deformationsForWorld returns persisted dig deltas", () => {
    const db = mkDb();
    const r = applyDeformation(db, W, 100, 100, 3, "excavate");
    assert.equal(r.ok, true);
    const defs = deformationsForWorld(db, W);
    assert.equal(defs.length, 1);
    assert.ok(defs[0].height_delta < 0, "excavate lowers the cell");
    assert.equal(typeof defs[0].cell_x, "number");
  });

  it("waterGridForWorld returns only wet cells (water_height > MIN)", () => {
    const db = mkDb();
    setWater(db, W, 50, 50, 1.5);  // wet
    setWater(db, W, 70, 70, 0.0);  // dry — excluded
    const water = waterGridForWorld(db, W);
    assert.equal(water.length, 1);
    assert.ok(water[0].water_height > 1, `expected wet cell, got ${water[0].water_height}`);
  });

  it("the route payload shape composes both readers + a cell size", () => {
    const db = mkDb();
    applyDeformation(db, W, 100, 100, 2, "excavate");
    setWater(db, W, 50, 50, 0.8);
    // Mirror exactly what GET /api/worlds/:worldId/terrain returns.
    const payload = {
      ok: true,
      cellSize: CELL_SIZE,
      deformations: deformationsForWorld(db, W),
      water: waterGridForWorld(db, W),
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.cellSize, CELL_SIZE);
    assert.equal(payload.deformations.length, 1);
    assert.equal(payload.water.length, 1);
  });

  it("absent tables → empty arrays, never throws", () => {
    const db = new Database(":memory:");
    assert.deepEqual(deformationsForWorld(db, W), []);
    assert.deepEqual(waterGridForWorld(db, W), []);
    assert.deepEqual(waterGridForWorld(null, W), []);
  });
});
