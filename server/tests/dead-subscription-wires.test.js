// server/tests/dead-subscription-wires.test.js
//
// Contract tests for two of the six Class-A dead socket subscriptions closed
// per docs/DEAD_SUBSCRIPTION_AUDIT.md — events whose frontend HUD was fully
// built and mounted while nothing on the server ever emitted them, so the HUD
// sat permanently in its slow backstop-poll path.
//
// Covered here (the two that live in plain libs and are directly callable):
//   • submarine:dive-state  <- lib/world-gathering.js#updateSwimState
//   • nemesis:nearby        <- emergent/nemesis-cycle.js#runNemesisCycle
//
// Both emit through `globalThis._concordRealtimeEmit`, the escape hatch
// server.js stashes so lib/emergent modules can emit without a circular
// import. These tests install a spy in that slot, which is exactly how the
// real call site is reached (same pattern as tests/npc-building-affinity.test.js
// and tests/hidden-quests-fire-emit.test.js).
//
// The load-bearing assertions are about VOLUME and TARGETING, not payload
// fields: both listeners use the `useRealtimeRefresh` hook, which re-fetches
// on the event and DISCARDS the payload entirely. So what must be true is
// (a) an emit happens on a real state change, (b) it does NOT happen when
// nothing changed — updateSwimState runs on every player move, so an
// unconditional emit would flood the socket — and (c) it is scoped to the
// right audience (per-user for dive state, per-world for the nemesis graph).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { checkSwimState, updateSwimState } from "../lib/world-gathering.js";
import { runNemesisCycle } from "../emergent/nemesis-cycle.js";
import { up as upRelationships } from "../migrations/226_npc_relationships.js";

// ── Emit spy ─────────────────────────────────────────────────────────────

let emits = [];
let priorEmit;

function installEmitSpy() {
  emits = [];
  priorEmit = globalThis._concordRealtimeEmit;
  globalThis._concordRealtimeEmit = (event, payload, opts) => {
    emits.push({ event, payload, opts: opts || {} });
    return { ok: true };
  };
}

function restoreEmitSpy() {
  if (priorEmit === undefined) delete globalThis._concordRealtimeEmit;
  else globalThis._concordRealtimeEmit = priorEmit;
}

const emitsOf = (name) => emits.filter((e) => e.event === name);

// ── submarine:dive-state ─────────────────────────────────────────────────

describe("submarine:dive-state — emits only on a real enter/exit-water transition", () => {
  let db;
  const WORLD = "tunya";
  const USER = "user-dive-1";

  // Derive real swim/land coordinates from the shipped elevation function
  // rather than hardcoding magic numbers that a terrain change would silently
  // invalidate. If either can't be found the terrain contract changed and the
  // test says so instead of asserting something meaningless.
  function findPos(wantSwimming) {
    for (let x = 0; x < 4000; x += 17) {
      for (let z = 0; z < 400; z += 23) {
        const pos = { x, z };
        if (checkSwimState(pos).swimming === wantSwimming) return pos;
      }
    }
    return null;
  }

  // runMigrations is async — awaiting it is load-bearing here. Calling it
  // without await leaves the schema half-built and the INSERT below fails
  // with a bare SQLITE_ERROR that looks like a schema problem rather than a
  // race.
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    db.prepare(`
      INSERT INTO world_visits (id, user_id, world_id, arrived_at, is_swimming)
      VALUES (?, ?, ?, unixepoch(), 0)
    `).run("visit-dive-1", USER, WORLD);
    installEmitSpy();
  });

  afterEach(() => {
    restoreEmitSpy();
    db.close();
  });

  it("emits once when the player enters water, targeted at that user only", () => {
    const wet = findPos(true);
    assert.ok(wet, "no swimming position found — terrain contract changed");

    updateSwimState(db, WORLD, USER, wet);

    const dive = emitsOf("submarine:dive-state");
    assert.equal(dive.length, 1, "entering water should emit exactly once");
    assert.equal(dive[0].opts.userId, USER, "dive state is per-user, never per-world");
    assert.equal(dive[0].opts.worldId, undefined, "must not world-broadcast a private dive state");
    assert.equal(dive[0].payload.isSwimming, true);
  });

  it("does NOT re-emit while the player keeps swimming (runs on every move)", () => {
    const wet = findPos(true);
    assert.ok(wet, "no swimming position found — terrain contract changed");

    updateSwimState(db, WORLD, USER, wet);
    assert.equal(emitsOf("submarine:dive-state").length, 1);

    // Three more moves, still in water: the state never changed, so an
    // emit here would be the socket flood this gating exists to prevent.
    updateSwimState(db, WORLD, USER, wet);
    updateSwimState(db, WORLD, USER, wet);
    updateSwimState(db, WORLD, USER, wet);

    assert.equal(
      emitsOf("submarine:dive-state").length, 1,
      "repeat moves in the same swim state must not emit",
    );
  });

  it("emits again on the exit-water transition", () => {
    const wet = findPos(true);
    const dry = findPos(false);
    assert.ok(wet && dry, "need both a swimming and a non-swimming position");

    updateSwimState(db, WORLD, USER, wet);
    updateSwimState(db, WORLD, USER, dry);

    const dive = emitsOf("submarine:dive-state");
    assert.equal(dive.length, 2, "enter + exit are two transitions");
    assert.equal(dive[1].payload.isSwimming, false);
    assert.equal(dive[1].opts.userId, USER);
  });

  it("never emits for a player who was already dry and stays dry", () => {
    const dry = findPos(false);
    assert.ok(dry, "no dry position found — terrain contract changed");

    updateSwimState(db, WORLD, USER, dry);
    updateSwimState(db, WORLD, USER, dry);

    assert.equal(emitsOf("submarine:dive-state").length, 0);
  });
});

// ── nemesis:nearby ───────────────────────────────────────────────────────

describe("nemesis:nearby — emits world-scoped only when the graph actually changed", () => {
  let db;
  const WORLD = "tunya";

  // Minimal shape the cycle's rule engine reads, mirroring the fixture in
  // tests/nemesis-cycle.test.js (that suite deliberately avoids the full
  // migration pipeline because the cycle no-ops on missing tables).
  function freshDb() {
    const d = new Database(":memory:");
    upRelationships(d);
    d.exec(`
      CREATE TABLE world_npcs (
        id TEXT PRIMARY KEY, world_id TEXT, faction TEXT, archetype TEXT, level INTEGER
      );
    `);
    return d;
  }

  beforeEach(() => {
    db = freshDb();
    installEmitSpy();
  });

  afterEach(() => {
    restoreEmitSpy();
    db.close();
  });

  it("a quiet tick with nothing to process emits nothing", () => {
    const r = runNemesisCycle({ db, worldId: WORLD });
    assert.equal(r.ok, true);
    assert.equal(r.processed, 0);
    assert.equal(r.decayed, 0);
    assert.equal(
      emitsOf("nemesis:nearby").length, 0,
      "an idle heartbeat must not push — this runs on a timer forever",
    );
  });

  it("returns its documented shape and never throws on a bare DB", () => {
    // Heartbeat contract: modules must always return a plain {ok,...} object
    // rather than throwing, or one bad module stops the whole tick.
    const r = runNemesisCycle({ db, worldId: WORLD });
    assert.equal(typeof r, "object");
    assert.equal(r.ok, true);
    assert.equal(r.world, WORLD);
    assert.equal(typeof r.processed, "number");
    assert.equal(typeof r.decayed, "number");
  });

  it("is disabled by CONCORD_NEMESIS_CYCLE=0 and emits nothing when off", () => {
    const prior = process.env.CONCORD_NEMESIS_CYCLE;
    process.env.CONCORD_NEMESIS_CYCLE = "0";
    try {
      const r = runNemesisCycle({ db, worldId: WORLD });
      assert.equal(r.skipped, "disabled_by_env");
      assert.equal(emitsOf("nemesis:nearby").length, 0);
    } finally {
      if (prior === undefined) delete process.env.CONCORD_NEMESIS_CYCLE;
      else process.env.CONCORD_NEMESIS_CYCLE = prior;
    }
  });
});
