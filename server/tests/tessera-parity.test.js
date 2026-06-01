// Sere managed parity — the Tessera funds both sides so the war never resolves.
// Pins the clamp (a sagging belligerent is topped back up off the truce
// threshold), the relight (a faction already at truce is yanked back to war), the
// main-arc payoff (endFunding lets the war finally resolve), Sere-scoping, and
// the OFF kill-switch no-op.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upFunding } from "../migrations/321_faction_funding.js";
import { up as upFactionStrategy } from "../migrations/117_faction_strategy.js";
import {
  recordFunding, endFunding, activeFunding, clampParity, seedManagedParity, _testing,
} from "../lib/tessera-parity.js";
import { runTesseraParity } from "../emergent/tessera-parity-cycle.js";

function freshDb() {
  const db = new Database(":memory:");
  upFactionStrategy(db);
  upFunding(db);
  // two belligerents + a non-funded control faction in another world
  for (const [fid, mom] of [["dovrane", -0.5], ["keshar", -0.7], ["other_world_faction", -0.8]]) {
    db.prepare("INSERT INTO faction_strategy_state (faction_id, stance, momentum, next_move_at, updated_at) VALUES (?, 'war', ?, 0, unixepoch())").run(fid, mom);
  }
  return db;
}
const mom = (db, fid) => db.prepare("SELECT momentum FROM faction_strategy_state WHERE faction_id=?").get(fid).momentum;

describe("tessera managed parity (ON)", () => {
  beforeEach(() => { process.env.CONCORD_TESSERA_PARITY = "1"; });
  afterEach(() => { delete process.env.CONCORD_TESSERA_PARITY; });

  it("seedManagedParity records the canonical Sere Border-Mirror funding", () => {
    const db = freshDb();
    seedManagedParity(db);
    const f = activeFunding(db, "sere");
    assert.equal(f.length, 1);
    assert.equal(f[0].funder_id, "the_tessera");
    assert.deepEqual([f[0].war_faction_a, f[0].war_faction_b].sort(), ["dovrane", "keshar"]);
  });

  it("clamps a sagging belligerent off the truce threshold (war stays lit)", () => {
    const db = freshDb();
    recordFunding(db, { worldId: "sere", funderId: "the_tessera", warFactionA: "dovrane", warFactionB: "keshar" });
    const r = clampParity(db, "sere");
    // dovrane (-0.5) was sagging → topped up to PARITY_FLOOR; keshar (-0.7, past truce) relit
    assert.equal(mom(db, "dovrane"), _testing.PARITY_FLOOR);
    assert.equal(mom(db, "keshar"), _testing.PARITY_FLOOR);
    assert.ok(mom(db, "dovrane") > _testing.TRUCE_THRESHOLD, "never reaches the truce floor");
    assert.ok(r.clamped.length >= 2);
  });

  it("does NOT touch factions in other worlds", () => {
    const db = freshDb();
    recordFunding(db, { worldId: "sere", funderId: "the_tessera", warFactionA: "dovrane", warFactionB: "keshar" });
    clampParity(db, "sere");
    assert.equal(mom(db, "other_world_faction"), -0.8, "non-funded faction untouched");
  });

  it("main-arc payoff: endFunding lets the war finally resolve", () => {
    const db = freshDb();
    recordFunding(db, { worldId: "sere", funderId: "the_tessera", warFactionA: "dovrane", warFactionB: "keshar" });
    const e = endFunding(db, { worldId: "sere", warFactionA: "keshar", warFactionB: "dovrane" }); // order-insensitive
    assert.ok(e.ended >= 1);
    assert.equal(activeFunding(db, "sere").length, 0);
    // with funding gone, a sagging belligerent is no longer topped up
    db.prepare("UPDATE faction_strategy_state SET momentum=-0.7 WHERE faction_id='dovrane'").run();
    clampParity(db, "sere");
    assert.equal(mom(db, "dovrane"), -0.7, "no longer clamped — free to seek truce");
  });

  it("the heartbeat seeds + clamps in one pass", async () => {
    const db = freshDb();
    const r = await runTesseraParity({ db });
    assert.equal(r.ok, true);
    assert.ok(r.clamped >= 2);
    assert.equal(activeFunding(db, "sere").length, 1, "funding auto-seeded by the cycle");
  });
});

describe("tessera managed parity (OFF kill-switch)", () => {
  beforeEach(() => { process.env.CONCORD_TESSERA_PARITY = "0"; });
  afterEach(() => { delete process.env.CONCORD_TESSERA_PARITY; });
  it("clampParity + cycle are inert", async () => {
    const db = freshDb();
    recordFunding(db, { worldId: "sere", funderId: "the_tessera", warFactionA: "dovrane", warFactionB: "keshar" });
    assert.equal(clampParity(db, "sere").reason, "disabled");
    assert.equal(mom(db, "keshar"), -0.7, "unchanged when disabled");
    assert.equal((await runTesseraParity({ db })).reason, "disabled");
  });
});
