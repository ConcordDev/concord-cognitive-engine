// World-Observatory full-build pins (S2): harness-named worlds are
// stamped test data on both macros; canon worlds are not.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerWorldOverviewMacros, { isTestWorldName } from "../domains/world-overview.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, input);
}
before(() => { registerWorldOverviewMacros(register); });

describe("world-observatory S2 — test-world stamping", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("the name marker matches harness/test names only", () => {
    assert.equal(isTestWorldName("tz1026220427mi name harness value"), true);
    assert.equal(isTestWorldName("QA test world"), true);
    assert.equal(isTestWorldName("Concordia Hub"), false);
    assert.equal(isTestWorldName("Testament Reach"), false);
    assert.equal(isTestWorldName(null), false);
  });

  it("overview stamps the harness world and not the canon world", async () => {
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, 'fantasy')`).run("w_hub", "Concordia Hub");
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, 'fantasy')`).run("subw_mvq4a955_4o9lva", "tz1026220427mi name harness value");
    const ov = await call("worldstate.overview", { db }, {});
    assert.equal(ov.ok, true);
    const hub = ov.worlds.find((w) => w.worldId === "w_hub");
    const harness = ov.worlds.find((w) => w.worldId === "subw_mvq4a955_4o9lva");
    assert.ok(hub && harness, "both worlds listed — nothing excluded");
    assert.equal(hub.isTestWorld, false);
    assert.equal(harness.isTestWorld, true);
  });

  it("world_detail stamps the same flag + the world's name", async () => {
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, 'fantasy')`).run("subw_mvq4a955_4o9lva", "tz1026220427mi name harness value");
    const d = await call("worldstate.world_detail", { db }, { worldId: "subw_mvq4a955_4o9lva" });
    assert.equal(d.ok, true);
    assert.equal(d.isTestWorld, true);
    assert.equal(d.worldName, "tz1026220427mi name harness value");
  });
});
