/**
 * WS7 — gradient-health telemetry.
 * Run: node --test tests/world-gradient-health.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { worldGradientHealth, allWorldsGradientHealth } from "../lib/world-gradient-health.js";

const GRAD = { worldRadiusM: 800, hubRadiusM: 80, bandCount: 6, frontierLevel: 100 };

function db() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, x REAL, z REAL, level INTEGER, is_dead INTEGER DEFAULT 0);
    CREATE TABLE worlds (id TEXT PRIMARY KEY, rule_modulators TEXT);
  `);
  d.prepare("INSERT INTO worlds VALUES('w1', ?)").run(JSON.stringify({ gradient: GRAD }));
  // weak near hub, strong at the frontier
  d.prepare("INSERT INTO world_npcs VALUES('a','w1',40,0,3,0)").run();
  d.prepare("INSERT INTO world_npcs VALUES('b','w1',60,0,4,0)").run();
  d.prepare("INSERT INTO world_npcs VALUES('c','w1',700,0,95,0)").run();
  return d;
}

describe("worldGradientHealth", () => {
  it("buckets by band, fetches its own config, reports healthy", () => {
    const h = worldGradientHealth(db(), "w1");
    assert.equal(h.total, 3);
    assert.equal(h.config.worldRadiusM, 800); // self-fetched, not the default 1000
    assert.equal(h.bands[0].count, 2);        // two weak in the hub band
    assert.equal(h.bands[0].maxLevel, 4);
    assert.equal(h.health.hubLowLevel, true);
    assert.equal(h.health.veteransOutward, true);
  });
  it("aggregates across worlds and degrades safely", () => {
    assert.deepEqual(allWorldsGradientHealth(new Database(":memory:")), { ok: true, worlds: [] });
    const all = allWorldsGradientHealth(db());
    assert.equal(all.ok, true);
    assert.equal(all.worlds.length, 1);
  });
});
