// Phase CC8 — extraction shooter tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  startRun, pickupLoot, declareExtractionZone, extract, dieDuringRun,
  getActiveRun, listActiveZones,
} from "../lib/extraction.js";
import { up as upExtr } from "../migrations/258_extraction_runs.js";

function freshDb() { const db = new Database(":memory:"); upExtr(db); return db; }

describe("Phase CC8 — extraction shooter", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("startRun + dedupe via alreadyActive", () => {
    const a = startRun(db, "u1", { worldId: "tunya" });
    assert.equal(a.ok, true);
    const b = startRun(db, "u1", { worldId: "tunya" });
    assert.equal(b.alreadyActive, true);
  });

  it("pickupLoot stacks on itemId", () => {
    const r = startRun(db, "u1", { worldId: "tunya" });
    pickupLoot(db, r.runId, { itemId: "rare_herb", quantity: 3 });
    pickupLoot(db, r.runId, { itemId: "rare_herb", quantity: 2 });
    const run = getActiveRun(db, "u1");
    const stash = JSON.parse(run.run_stash_json);
    assert.equal(stash.length, 1);
    assert.equal(stash[0].quantity, 5);
  });

  it("extract banks stash when inside zone radius", () => {
    const r = startRun(db, "u1", { worldId: "tunya" });
    pickupLoot(db, r.runId, { itemId: "loot1", quantity: 1 });
    declareExtractionZone(db, { worldId: "tunya", x: 100, z: 100, radiusM: 10 });
    const ex = extract(db, r.runId, { x: 105, z: 105 });
    assert.equal(ex.extracted, true);
    assert.equal(ex.banked[0].itemId, "loot1");
  });

  it("extract outside zone rejected", () => {
    const r = startRun(db, "u1", { worldId: "tunya" });
    declareExtractionZone(db, { worldId: "tunya", x: 100, z: 100, radiusM: 5 });
    const ex = extract(db, r.runId, { x: 500, z: 500 });
    assert.equal(ex.ok, false);
    assert.equal(ex.error, "not_in_zone");
  });

  it("dieDuringRun moves stash to lost_loot_json", () => {
    const r = startRun(db, "u1", { worldId: "tunya" });
    pickupLoot(db, r.runId, { itemId: "rare_herb", quantity: 5 });
    const d = dieDuringRun(db, r.runId, { position: { x: 10, y: 0, z: 10 } });
    assert.equal(d.ok, true);
    assert.equal(d.lostLoot[0].quantity, 5);
  });

  it("expired zone not visible in listActiveZones", () => {
    declareExtractionZone(db, { worldId: "tunya", x: 0, z: 0, durationS: 60 });
    db.prepare(`UPDATE extraction_zones SET active_until = 1`).run();
    const zones = listActiveZones(db, "tunya");
    assert.equal(zones.length, 0);
  });

  it("pickup on ended run rejected", () => {
    const r = startRun(db, "u1", { worldId: "tunya" });
    dieDuringRun(db, r.runId);
    const p = pickupLoot(db, r.runId, { itemId: "x", quantity: 1 });
    assert.equal(p.ok, false);
    assert.equal(p.error, "run_ended");
  });
});
