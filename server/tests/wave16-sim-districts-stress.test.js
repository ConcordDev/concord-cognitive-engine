// Hub district count and the stress-test route read real stored rows.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";
import { runDistrictStressTest } from "../domains/world.js";

describe("sim hub districts + stress-test route", () => {
  let db, server, url;

  before(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL, population INTEGER NOT NULL DEFAULT 0, total_visits INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, name TEXT, building_type TEXT, material TEXT, floors INTEGER, health_pct REAL, state TEXT);
      CREATE TABLE districts (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, name TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO worlds (id, name) VALUES ('w1','One')").run();
    db.prepare("INSERT INTO districts (id, world_id, name) VALUES ('d1','w1','A'),('d2','w1','B'),('d3','w1','C')").run();
    const ins = db.prepare("INSERT INTO world_buildings VALUES (?,?,?,?,?,?,?,?)");
    ins.run("b1", "w1", "Hut", "house", "thatch", 1, 1, "standing");
    ins.run("b2", "w1", "Tower", "tower", "steel", 6, 1, "standing");
    ins.run("b3", "w1", "Ruin", "house", "wood", 1, 1, "collapsed");
    const app = express();
    app.use(express.json());
    app.use("/api/world", createWorldRoutes({ db }));
    await new Promise((r) => { server = app.listen(0, "127.0.0.1", () => { url = `http://127.0.0.1:${server.address().port}`; r(); }); });
  });
  after(async () => { await new Promise((r) => server.close(r)); db.close(); });

  const post = async (body) => {
    const res = await fetch(`${url}/api/world/sim/stress-test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it("reports the real district count when the districts table exists", async () => {
    const res = await fetch(`${url}/api/world/sim/concordia`);
    const body = await res.json();
    assert.equal(body.concordia.districts, 3);
    assert.equal(body.concordia.districtsReason, undefined);
  });

  it("matches the shared algorithm on standing buildings only", async () => {
    const r = await post({ districtId: "w1", scenario: "earthquake", magnitude: 7 });
    assert.equal(r.status, 200);
    const expected = runDistrictStressTest([
      { id: "b1", name: "Hut", building_type: "house", material: "thatch", floors: 1, health_pct: 1 },
      { id: "b2", name: "Tower", building_type: "tower", material: "steel", floors: 6, health_pct: 1 },
    ], "earthquake", 7).result;
    const { ok, districtId, ...rest } = r.body;
    assert.equal(ok, true);
    assert.equal(districtId, "w1");
    assert.deepEqual(rest, expected);
    assert.equal(rest.buildingsTested, 2);
  });

  it("rejects bad input and unknown worlds honestly", async () => {
    assert.equal((await post({ scenario: "earthquake", magnitude: 7 })).status, 400);
    assert.equal((await post({ districtId: "w1", scenario: "meteor", magnitude: 5 })).status, 400);
    assert.equal((await post({ districtId: "w1", scenario: "earthquake", magnitude: 99 })).status, 400);
    const none = await post({ districtId: "nope", scenario: "earthquake", magnitude: 5 });
    assert.equal(none.status, 404);
    assert.equal(none.body.error, "no_standing_buildings");
  });
});
