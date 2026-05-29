/**
 * E0 — server-rendered client cadence dials. Pins the default values + that
 * each is env-overridable, so a poll can be re-tuned without a frontend rebuild.
 *
 * Run: node --test tests/client-config.test.js
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

async function freshGetConfig() {
  // re-import with a cache-busting query so env changes are re-read
  const mod = await import(`../lib/client-config.js?ts=${Date.now()}_${Math.random()}`);
  return mod.getClientConfig();
}

describe("E0 — client config dials", () => {
  const saved = {};
  afterEach(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; saved[k] = undefined; } });

  it("ships sensible defaults", async () => {
    const c = await freshGetConfig();
    assert.equal(c.poll.restaurantMs, 3000);
    assert.equal(c.poll.driftAlertMs, 15000);
    assert.equal(c.poll.hordeWaveMs, 1000);
    assert.equal(c.throttle.footprintFrameMs, 200);
  });

  it("each poll dial is env-overridable", async () => {
    saved.CONCORD_POLL_RESTAURANT_MS = process.env.CONCORD_POLL_RESTAURANT_MS;
    saved.CONCORD_POLL_DRIFT_MS = process.env.CONCORD_POLL_DRIFT_MS;
    process.env.CONCORD_POLL_RESTAURANT_MS = "1500";
    process.env.CONCORD_POLL_DRIFT_MS = "8000";
    const c = await freshGetConfig();
    assert.equal(c.poll.restaurantMs, 1500);
    assert.equal(c.poll.driftAlertMs, 8000);
  });

  it("ignores a non-positive / garbage env value (keeps the default)", async () => {
    saved.CONCORD_POLL_RESTAURANT_MS = process.env.CONCORD_POLL_RESTAURANT_MS;
    process.env.CONCORD_POLL_RESTAURANT_MS = "not-a-number";
    let c = await freshGetConfig();
    assert.equal(c.poll.restaurantMs, 3000);
    process.env.CONCORD_POLL_RESTAURANT_MS = "-5";
    c = await freshGetConfig();
    assert.equal(c.poll.restaurantMs, 3000);
  });

  it("the shape has poll + throttle groups", async () => {
    const c = await freshGetConfig();
    assert.ok(c.poll && typeof c.poll === "object");
    assert.ok(c.throttle && typeof c.throttle === "object");
  });
});
