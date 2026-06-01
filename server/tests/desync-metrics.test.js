/**
 * E1 — desync-rate telemetry helper.
 *
 * recordCombatReject increments the right Prometheus counter (by kind, with a world
 * label) and is a safe no-op before metrics init. Pinned with a mock of the globalThis
 * METRICS handle server.js publishes.
 *
 * Run: node --test tests/desync-metrics.test.js
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordCombatReject } from "../lib/desync-metrics.js";

afterEach(() => { delete globalThis._concordMETRICS; });

function mockMetrics() {
  const calls = { reach: [], damage: [] };
  globalThis._concordMETRICS = {
    counters: {
      combatReachRejected: { inc: (labels) => calls.reach.push(labels) },
      combatDamageRejected: { inc: (labels) => calls.damage.push(labels) },
    },
  };
  return calls;
}

test("reach reject increments the reach counter with the world label", () => {
  const calls = mockMetrics();
  assert.equal(recordCombatReject("reach", "tunya"), true);
  assert.deepEqual(calls.reach, [{ world: "tunya" }]);
  assert.equal(calls.damage.length, 0);
});

test("damage reject increments the damage counter", () => {
  const calls = mockMetrics();
  assert.equal(recordCombatReject("damage", "concordia-hub"), true);
  assert.deepEqual(calls.damage, [{ world: "concordia-hub" }]);
});

test("missing world falls back to 'unknown'", () => {
  const calls = mockMetrics();
  recordCombatReject("reach");
  assert.deepEqual(calls.reach, [{ world: "unknown" }]);
});

test("unknown kind is a no-op (returns false)", () => {
  mockMetrics();
  assert.equal(recordCombatReject("bogus", "w"), false);
});

test("before metrics init it is a safe no-op (never throws)", () => {
  delete globalThis._concordMETRICS;
  assert.equal(recordCombatReject("reach", "w"), false);
});
