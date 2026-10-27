// INC-150 follow-up: a read replica must not run the 15-min emergent auto-persist
// (it stalled the replica's event loop and overwrote the primary's state file).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startAutoPersist, stopAutoPersist, getPersistenceMetrics } from "../emergent/persistence.js";

const prev = process.env.CONCORD_READ_REPLICA;
after(() => { if (prev === undefined) delete process.env.CONCORD_READ_REPLICA; else process.env.CONCORD_READ_REPLICA = prev; });

test("replica skips the auto-persist timer and the shutdown persist", () => {
  process.env.CONCORD_READ_REPLICA = "1";
  const r = startAutoPersist({}, { dataDir: "/nonexistent-concord-test-dir" });
  assert.equal(r.skipped, "read_replica");
  assert.equal(getPersistenceMetrics().timerActive, false);
  assert.equal(stopAutoPersist({}).skipped, "read_replica");
});

test("primary still arms the timer", () => {
  delete process.env.CONCORD_READ_REPLICA;
  const r = startAutoPersist({}, { intervalMs: 60_000, dataDir: "/nonexistent-concord-test-dir" });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, undefined);
  assert.equal(getPersistenceMetrics().timerActive, true);
  process.env.CONCORD_READ_REPLICA = "1"; // stop without writing anywhere
  stopAutoPersist({});
  assert.equal(getPersistenceMetrics().timerActive, false);
});
