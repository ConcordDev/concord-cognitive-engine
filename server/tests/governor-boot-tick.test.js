// governorTick boot behaviour — regression test for the frozen heartbeat
// counter after a restart.
//
// The bug: governorTick("boot") bypassed the low-memory pause, so on a
// low-memory host the first tick ran the LLM-heavy autogen/dream/evolution
// macros, held _governorTickRunning for minutes, starved every interval
// tick (tick_already_running), and left STATE.__bgTickCounter at 0 until
// kernelTick was finally reached deep in the tick — /api/system/health
// reported heartbeat.tick = 0 for ~6 minutes after every restart.
//
// The fix: the boot tick follows the same low-memory rule as every other
// tick, and the idle / low-memory branches bump __bgTickCounter when the
// tick starts, not after their registry/consolidation work.
//
// Boots the real server (same harness as the depth suites); no network —
// the heavy macros are replaced with slow spies via the macro registry.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// Force the low-memory host profile before anything reads it. The env var
// is checked on every shouldPauseHeavyBackground() call, so flipping it
// mid-file (test 3) also works.
process.env.CONCORD_LOW_MEMORY_HOST = "1";

const { __TEST__ } = await import("../server.js");
const { STATE, governorTick, MACROS, register } = __TEST__;
const presenceIdle = await import("../lib/presence-idle.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEAVY = ["autogen", "dream", "evolution"];
const originals = new Map();
let heavyCalls = [];

function stubHeavy(ms) {
  heavyCalls = [];
  for (const name of HEAVY) {
    if (!originals.has(name)) originals.set(name, MACROS.get("system")?.get(name));
    register("system", name, async () => {
      heavyCalls.push(name);
      if (ms > 0) await sleep(ms);
      return { ok: true };
    }, { note: "intentional_shadow_ok" });
  }
}

function restoreHeavy() {
  for (const name of HEAVY) {
    const orig = originals.get(name);
    if (orig) MACROS.get("system").set(name, orig);
  }
}

describe("governorTick — boot tick on a low-memory host", () => {
  before(() => {
    STATE.settings = STATE.settings || {};
    STATE.settings.heartbeatEnabled = true;
    STATE.settings.autogenEnabled = true;
    STATE.settings.dreamEnabled = true;
    STATE.settings.evolutionEnabled = true;
  });

  after(() => {
    restoreHeavy();
    delete process.env.CONCORD_LOW_MEMORY_HOST;
  });

  it("boot tick takes the low-memory path: no heavy macros, counter bumps, returns fast", async () => {
    stubHeavy(3000); // each heavy macro would take 3 s if it ran
    const before = STATE.__bgTickCounter || 0;
    const t0 = Date.now();
    const r = await governorTick("boot");
    const elapsed = Date.now() - t0;
    assert.equal(r.ok, true);
    assert.equal(r.skipped, "low_memory_host");
    assert.deepEqual(heavyCalls, [], "boot tick must not run autogen/dream/evolution on a low-memory host");
    assert.equal(STATE.__bgTickCounter, before + 1, "the tick that ran must count itself");
    assert.ok(elapsed < 2500, `boot tick should return fast, took ${elapsed} ms`);
  });

  it("the next interval tick is not starved and also counts", async () => {
    const before = STATE.__bgTickCounter || 0;
    const r = await governorTick("interval");
    assert.equal(r.ok, true);
    assert.notEqual(r.reason, "tick_already_running");
    // Idle branch or low-memory branch — both are light paths that count.
    assert.ok(r.skipped === "idle_no_users" || r.skipped === "low_memory_host", `unexpected skip: ${r.skipped}`);
    assert.equal(STATE.__bgTickCounter, before + 1);
  });

  it("on a normal-memory host the full path still runs heavy macros, and the overlap guard still holds", async () => {
    process.env.CONCORD_LOW_MEMORY_HOST = "0";
    try {
      presenceIdle.markActivity({ authed: true }); // not idle -> main path
      STATE.settings.dreamEnabled = false;
      STATE.settings.evolutionEnabled = false;
      stubHeavy(2500);
      const p = governorTick("boot");
      const blocked = await governorTick("interval");
      assert.equal(blocked.ok, false);
      assert.equal(blocked.reason, "tick_already_running");
      const r = await p;
      assert.equal(r.ok, true);
      assert.deepEqual(heavyCalls, ["autogen"], "full path must still run the heavy macros when the host can afford them");
    } finally {
      process.env.CONCORD_LOW_MEMORY_HOST = "1";
      STATE.settings.dreamEnabled = true;
      STATE.settings.evolutionEnabled = true;
    }
  });
});
