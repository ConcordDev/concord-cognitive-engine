// Phase C — heartbeat worker pool sanity contract.
//
// This test does NOT spawn real worker threads (worker_threads on the
// happy path is integration-tested by booting the server). Instead it
// pins the pool's *contract* — the dispatcher calls `pool.exec` for
// `worker: true` modules, and a mock pool's resolution flows back through
// the registry as if the module had run.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerHeartbeat,
  tickAllRegistered,
  _resetHeartbeatRegistry,
  setHeartbeatPool,
} from "../emergent/heartbeat-registry.js";

describe("Phase C — heartbeat worker pool routing", () => {
  beforeEach(() => {
    _resetHeartbeatRegistry();
    setHeartbeatPool(null);
  });

  it("worker:true modules are routed to the pool's exec()", async () => {
    let calls = 0;
    let lastModuleId = null;
    const mockPool = {
      exec: async (moduleId, ctxSnapshot) => {
        calls++;
        lastModuleId = moduleId;
        return { ok: true, sideEffects: [] };
      },
    };
    setHeartbeatPool(mockPool);

    let inlineRan = false;
    registerHeartbeat("via-pool", {
      frequency: 1,
      worker: true,
      handler: () => { inlineRan = true; },  // must NOT fire when worker:true is honoured
    });

    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.equal(calls, 1, "pool.exec called once");
    assert.equal(lastModuleId, "via-pool");
    assert.equal(inlineRan, false, "inline handler must not run when worker pool is wired");
  });

  it("a pool rejection is caught and the tick continues", async () => {
    const mockPool = {
      exec: async () => { throw new Error("worker_crashed"); },
    };
    setHeartbeatPool(mockPool);

    let inlineRan = false;
    registerHeartbeat("bad-worker", {
      frequency: 1,
      worker: true,
      handler: () => { /* not reached */ },
    });
    registerHeartbeat("inline-after", {
      frequency: 1,
      handler: () => { inlineRan = true; },
    });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.equal(inlineRan, true, "sibling module still ran after worker error");
  });

  it("worker:true without a wired pool falls back to inline execution", async () => {
    let ran = false;
    setHeartbeatPool(null);
    registerHeartbeat("fallback", {
      frequency: 1,
      worker: true,
      handler: () => { ran = true; },
    });
    await tickAllRegistered({ state: {}, db: null, tickCount: 1 });
    assert.equal(ran, true);
  });
});
