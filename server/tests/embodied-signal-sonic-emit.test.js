/**
 * Tier-2 contract test for Theme 1 (audio coupling): recordSignal must emit
 * `world:sonic-pulse` over the realtime bus when a non-sensor source writes
 * a loud delta (>5) to `sonic_os.ambient_db`. Sensor/world_seed baseline
 * writes must NOT emit; values ≤5 must NOT emit.
 *
 * Pins the contract the SoundscapeEngine listens for. Frontend integration
 * is verified manually — the bus shape is the load-bearing part.
 *
 * Run: node --test tests/embodied-signal-sonic-emit.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { recordSignal } from "../lib/embodied/signals.js";
import { up as up112 } from "../migrations/112_embodied_signals.js";
import { up as up113 } from "../migrations/113_embodied_signal_log_unification.js";

function setupDb() {
  const db = new Database(":memory:");
  up112(db);
  up113(db);
  return db;
}

function installFakeRealtime() {
  const calls = [];
  globalThis.__CONCORD_REALTIME__ = {
    io: {
      to(channel) {
        return {
          emit(event, payload) {
            calls.push({ channel, event, payload });
          },
        };
      },
    },
  };
  return calls;
}

function clearRealtime() {
  delete globalThis.__CONCORD_REALTIME__;
}

describe("recordSignal → world:sonic-pulse emit", () => {
  let db;
  let calls;

  beforeEach(() => {
    db = setupDb();
    calls = installFakeRealtime();
  });

  afterEach(() => {
    clearRealtime();
  });

  it("emits world:sonic-pulse for skill_cast source on sonic_os.ambient_db > 5", () => {
    const r = recordSignal(db, {
      worldId: "concordia-hub",
      x: 100, z: 200,
      channel: "sonic_os.ambient_db",
      value: 18,
      source: "skill_cast",
      sourceId: "user_alice",
      ttlSeconds: 60,
    });
    assert.ok(r);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].channel, "world:concordia-hub");
    assert.equal(calls[0].event, "world:sonic-pulse");
    assert.equal(calls[0].payload.worldId, "concordia-hub");
    assert.equal(calls[0].payload.value, 18);
    assert.equal(calls[0].payload.source, "skill_cast");
    assert.equal(calls[0].payload.sourceId, "user_alice");
    assert.equal(typeof calls[0].payload.cellX, "number");
    assert.equal(typeof calls[0].payload.cellZ, "number");
  });

  it("emits for combat source on sonic_os.ambient_db > 5", () => {
    recordSignal(db, {
      worldId: "concordia-hub",
      x: 50, z: 50,
      channel: "sonic_os.ambient_db",
      value: 25,
      source: "combat",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event, "world:sonic-pulse");
  });

  it("does NOT emit for sensor source (baseline absolute reading)", () => {
    recordSignal(db, {
      worldId: "concordia-hub",
      x: 0, z: 0,
      channel: "sonic_os.ambient_db",
      value: 50, // sensor absolute reading; not an event
      source: "sensor",
    });
    assert.equal(calls.length, 0);
  });

  it("does NOT emit for world_seed source", () => {
    recordSignal(db, {
      worldId: "concordia-hub",
      x: 1000, z: 1000,
      channel: "sonic_os.ambient_db",
      value: 42,
      source: "world_seed",
    });
    assert.equal(calls.length, 0);
  });

  it("does NOT emit for value ≤ 5 (sub-threshold delta)", () => {
    recordSignal(db, {
      worldId: "concordia-hub",
      x: 0, z: 0,
      channel: "sonic_os.ambient_db",
      value: 4,
      source: "skill_cast",
    });
    assert.equal(calls.length, 0);
    recordSignal(db, {
      worldId: "concordia-hub",
      x: 0, z: 0,
      channel: "sonic_os.ambient_db",
      value: 5,
      source: "combat",
    });
    assert.equal(calls.length, 0);
  });

  it("does NOT emit for non-sonic channels", () => {
    recordSignal(db, {
      worldId: "concordia-hub",
      x: 0, z: 0,
      channel: "thermal_os.ambient_temp",
      value: 35,
      source: "skill_cast",
    });
    recordSignal(db, {
      worldId: "concordia-hub",
      x: 0, z: 0,
      channel: "chemical_os.humidity",
      value: 20,
      source: "skill_cast",
    });
    assert.equal(calls.length, 0);
  });

  it("emits to the correct world room (per-world fan-out)", () => {
    recordSignal(db, {
      worldId: "frontier-glade",
      x: 0, z: 0,
      channel: "sonic_os.ambient_db",
      value: 12,
      source: "skill_cast",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].channel, "world:frontier-glade");
  });

  it("survives missing realtime bus without throwing", () => {
    clearRealtime();
    const r = recordSignal(db, {
      worldId: "concordia-hub",
      x: 0, z: 0,
      channel: "sonic_os.ambient_db",
      value: 20,
      source: "skill_cast",
    });
    // Signal still written; emit is best-effort.
    assert.ok(r);
  });
});
