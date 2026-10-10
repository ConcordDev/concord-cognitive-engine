// Low-memory host profile. The decision is pure when a snapshot and env are
// passed in, so it does not depend on the runner's RAM.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isLowMemoryHost,
  shouldPauseHeavyBackground,
  shouldAutoLoadLlmModels,
  getHostIdentity,
  _resetHostProfileCacheForTest,
} from "../lib/host-profile.js";

const GB = 1024 * 1024 * 1024;
const PROD = { NODE_ENV: "production" };

function snap(partial) {
  return {
    totalBytes: 32 * GB,
    availableBytes: 16 * GB,
    swapTotalKb: 0,
    swapUsedKb: 0,
    swapPressure: 0,
    availableRatio: 0.5,
    ...partial,
  };
}

describe("host-profile — isLowMemoryHost", () => {
  afterEach(() => {
    delete process.env.CONCORD_LOW_MEMORY_HOST;
    _resetHostProfileCacheForTest();
  });

  it("a 32GB host with headroom is not low-memory", () => {
    assert.equal(isLowMemoryHost(snap({}), PROD), false);
  });

  it("16GB or less is a low-memory host", () => {
    assert.equal(isLowMemoryHost(snap({ totalBytes: 16 * GB, availableBytes: 8 * GB, availableRatio: 0.5 }), PROD), true);
    assert.equal(isLowMemoryHost(snap({ totalBytes: 8 * GB, availableBytes: 4 * GB, availableRatio: 0.5 }), PROD), true);
  });

  it("high swap pressure is a low-memory host even with lots of RAM", () => {
    const host = snap({
      totalBytes: 64 * GB,
      availableBytes: 32 * GB,
      availableRatio: 0.5,
      swapTotalKb: 8 * 1024 * 1024,
      swapUsedKb: 5 * 1024 * 1024,
      swapPressure: 5 / 8,
    });
    assert.equal(isLowMemoryHost(host, PROD), true);
  });

  it("low available-memory ratio is a low-memory host", () => {
    const host = snap({
      totalBytes: 64 * GB,
      availableBytes: 4 * GB,
      availableRatio: 4 / 64,
    });
    assert.equal(isLowMemoryHost(host, PROD), true);
  });

  it("CONCORD_LOW_MEMORY_HOST forces the profile on or off", () => {
    assert.equal(isLowMemoryHost(snap({ totalBytes: 64 * GB, availableRatio: 0.9 }), { CONCORD_LOW_MEMORY_HOST: "1" }), true);
    assert.equal(isLowMemoryHost(snap({ totalBytes: 4 * GB, availableRatio: 0.01, swapPressure: 1, swapTotalKb: 1 }), { CONCORD_LOW_MEMORY_HOST: "0", NODE_ENV: "production" }), false);
  });

  it("NODE_ENV=test does not auto-detect from a small snapshot", () => {
    assert.equal(isLowMemoryHost(snap({ totalBytes: 4 * GB, availableRatio: 0.01 }), { NODE_ENV: "test" }), false);
  });
});

describe("host-profile — gates", () => {
  afterEach(() => {
    delete process.env.CONCORD_LOW_MEMORY_HOST;
    _resetHostProfileCacheForTest();
  });

  it("pause and model autoload follow the forced profile", () => {
    process.env.CONCORD_LOW_MEMORY_HOST = "1";
    assert.equal(shouldPauseHeavyBackground(), true);
    assert.equal(shouldAutoLoadLlmModels(), false);
    process.env.CONCORD_LOW_MEMORY_HOST = "0";
    assert.equal(shouldPauseHeavyBackground(), false);
    assert.equal(shouldAutoLoadLlmModels(), true);
  });

  it("getHostIdentity names the host and the role env", () => {
    process.env.HOST_ROLE = "fallback";
    process.env.CONCORD_LOW_MEMORY_HOST = "0";
    const id = getHostIdentity();
    assert.equal(typeof id.hostname, "string");
    assert.ok(id.hostname.length > 0);
    assert.equal(id.role, "fallback");
    assert.equal(id.lowMemory, false);
    delete process.env.HOST_ROLE;
  });

  it("heavy maintenance stays paused after activity when the profile is on", async () => {
    process.env.CONCORD_LOW_MEMORY_HOST = "1";
    const presence = await import("../lib/presence-idle.js");
    presence.markActivity({ authed: true });
    assert.equal(presence.isIdle(), false);
    assert.equal(presence.shouldRunHeavyMaintenance(), false);
  });

  it("lattice drift scan and quest cycle pause when the profile is on", async () => {
    process.env.CONCORD_LOW_MEMORY_HOST = "1";
    const { runPeriodicDriftScan } = await import("../emergent/lattice-orchestrator.js");
    const { runLatticeQuestCycle } = await import("../emergent/lattice-quest-cycle.js");
    const drift = await runPeriodicDriftScan({});
    assert.equal(drift.skipped, "low_memory_host");
    const quests = await runLatticeQuestCycle({});
    assert.equal(quests.skipped, "low_memory_host");
  });
});
