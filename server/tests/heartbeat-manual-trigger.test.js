// server/tests/heartbeat-manual-trigger.test.js
//
// Pins `runHeartbeatModuleNow` (server/emergent/heartbeat-registry.js) —
// added so the Heartbeat Monitor lens's "trigger" control
// (tick.heartbeatControl, op:'trigger') can actually run a module
// out-of-band instead of only incrementing a counter nobody reads.
// It must reuse the same try/catch + timeout machinery as a normal
// tick dispatch so a manual trigger can never throw at the caller.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerHeartbeat,
  runHeartbeatModuleNow,
  _resetHeartbeatRegistry,
} from "../emergent/heartbeat-registry.js";

describe("runHeartbeatModuleNow", () => {
  beforeEach(() => {
    _resetHeartbeatRegistry();
  });

  it("returns ok:false for an unregistered module id", async () => {
    const r = await runHeartbeatModuleNow("does-not-exist", { state: {}, db: null });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown_heartbeat_module/);
  });

  it("invokes the registered handler immediately, passing state/db/reason through", async () => {
    let seen = null;
    registerHeartbeat("manual-trigger-test", {
      frequency: 999999, // would never be due on a real tickCount
      handler: (ctx) => { seen = ctx; },
    });
    const state = { marker: "s1" };
    const db = { marker: "d1" };
    const r = await runHeartbeatModuleNow("manual-trigger-test", { state, db, reason: "manual-trigger" });
    assert.equal(r.ok, true);
    assert.ok(seen, "handler should have been invoked");
    assert.equal(seen.state, state);
    assert.equal(seen.db, db);
    assert.equal(seen.reason, "manual-trigger");
    // tickCount is a sentinel — it's not a real tick, so it must not
    // collide with any handler's `tickCount % frequency === 0` logic.
    assert.equal(seen.tickCount, -1);
  });

  it("never throws even when the handler throws — same as a normal tick dispatch", async () => {
    registerHeartbeat("manual-trigger-throws", {
      frequency: 1,
      handler: () => { throw new Error("boom"); },
    });
    const r = await runHeartbeatModuleNow("manual-trigger-throws", { state: {}, db: null });
    // _runOne swallows the throw (logs + increments a metric); the caller
    // still gets an honest ok:true because the invocation itself succeeded.
    assert.equal(r.ok, true);
  });

  it("defaults reason to 'manual-trigger' when not supplied", async () => {
    let seen = null;
    registerHeartbeat("manual-trigger-default-reason", {
      frequency: 1,
      handler: (ctx) => { seen = ctx; },
    });
    await runHeartbeatModuleNow("manual-trigger-default-reason", { state: {}, db: null });
    assert.equal(seen.reason, "manual-trigger");
  });
});
