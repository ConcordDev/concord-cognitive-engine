// world.stress-test: deterministic district stress test over real buildings
// using the materials engine's yield/ultimate model.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerWorldActions, { runDistrictStressTest } from "../domains/world.js";

const ACTIONS = new Map();
registerWorldActions((d, n, fn) => ACTIONS.set(`${d}.${n}`, fn));
const run = (ctx, params) => ACTIONS.get("world.stress-test")(ctx, {}, params);

function db() {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, name TEXT, building_type TEXT, material TEXT, floors INTEGER, health_pct REAL, state TEXT)`);
  const ins = d.prepare("INSERT INTO world_buildings VALUES (?,?,?,?,?,?,?,?)");
  ins.run("b1", "w1", "Hut", "house", "thatch", 1, 1, "standing");
  ins.run("b2", "w1", "Hall", "inn", "stone", 2, 1, "standing");
  ins.run("b3", "w1", "Tower", "tower", "steel", 6, 1, "standing");
  ins.run("b4", "w1", "Ruin", "house", "wood", 1, 1, "collapsed");
  ins.run("b5", "w2", "Elsewhere", "house", "wood", 1, 1, "standing");
  return d;
}

describe("world.stress-test", () => {
  it("is deterministic and uses each building's material", () => {
    const ctx = { db: db() };
    const a = run(ctx, { worldId: "w1", scenario: "earthquake", magnitude: 7 });
    const b = run(ctx, { worldId: "w1", scenario: "earthquake", magnitude: 7 });
    assert.equal(a.ok, true);
    assert.deepEqual(a.result, b.result);
    assert.equal(a.result.buildingsTested, 3, "collapsed and other-world buildings are excluded");
    const byId = Object.fromEntries(a.result.details.map((d) => [d.buildingId, d]));
    // M7: base load 6*1.6^4 = 39.32 → thatch (ultimate 12) fails; steel holds.
    assert.equal(byId.b1.status, "failed");
    assert.equal(byId.b3.status, "passed");
    assert.equal(byId.b1.stress, 39.3);
  });

  it("weakened buildings carry more relative stress", () => {
    const strong = runDistrictStressTest([{ id: "x", material: "wood", floors: 1, health_pct: 1 }], "hurricane", 3);
    const weak = runDistrictStressTest([{ id: "x", material: "wood", floors: 1, health_pct: 0.5 }], "hurricane", 3);
    assert.ok(weak.result.details[0].stress > strong.result.details[0].stress);
  });

  it("rejects bad scenarios and out-of-range magnitudes", () => {
    const ctx = { db: db() };
    assert.equal(run(ctx, { worldId: "w1", scenario: "meteor", magnitude: 5 }).ok, false);
    assert.equal(run(ctx, { worldId: "w1", scenario: "earthquake", magnitude: 12 }).ok, false);
    assert.equal(run(ctx, { worldId: "nope", scenario: "earthquake", magnitude: 5 }).ok, false);
  });
});
