import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  shouldPauseBackgroundOrchestration,
  shouldPauseLocalHeavyCompute,
  isHeavyWorkRemote,
} from "../lib/host-profile.js";
import {
  _resetHeartbeatRegistry,
  registerHeartbeat,
  tickAllRegistered,
  getRegistrySkipStats,
  getRegistryScheduleSummary,
} from "../emergent/heartbeat-registry.js";
import {
  _resetGovernorForTest,
  registerStatusProvider,
  getGovernorStatus,
} from "../lib/background-governor.js";

describe("PR-5 remote orchestration", () => {
  describe("host-profile", () => {
    it("local heavy compute stays paused; background orchestration pauses only when heavy work is not remote", () => {
      const original = {
        CONCORD_LOW_MEMORY_HOST: process.env.CONCORD_LOW_MEMORY_HOST,
        CONCORD_HEAVY_WORK_REMOTE: process.env.CONCORD_HEAVY_WORK_REMOTE,
      };
      try {
        process.env.CONCORD_LOW_MEMORY_HOST = "1";
        delete process.env.CONCORD_HEAVY_WORK_REMOTE;

        const env = { NODE_ENV: "test", CONCORD_LOW_MEMORY_HOST: "1" };
        assert.equal(isHeavyWorkRemote(env), false);
        assert.equal(shouldPauseLocalHeavyCompute(), true);
        assert.equal(shouldPauseBackgroundOrchestration(env), true);

        process.env.CONCORD_HEAVY_WORK_REMOTE = "1";
        const envRemote = { NODE_ENV: "test", CONCORD_LOW_MEMORY_HOST: "1", CONCORD_HEAVY_WORK_REMOTE: "1" };
        assert.equal(isHeavyWorkRemote(envRemote), true);
        assert.equal(shouldPauseLocalHeavyCompute(), true);
        assert.equal(shouldPauseBackgroundOrchestration(envRemote), false);
      } finally {
        if (original.CONCORD_LOW_MEMORY_HOST === undefined) delete process.env.CONCORD_LOW_MEMORY_HOST;
        else process.env.CONCORD_LOW_MEMORY_HOST = original.CONCORD_LOW_MEMORY_HOST;
        if (original.CONCORD_HEAVY_WORK_REMOTE === undefined) delete process.env.CONCORD_HEAVY_WORK_REMOTE;
        else process.env.CONCORD_HEAVY_WORK_REMOTE = original.CONCORD_HEAVY_WORK_REMOTE;
      }
    });
  });

  describe("heartbeat-registry skip costs/ids", () => {
    beforeEach(() => {
      _resetHeartbeatRegistry();
    });

    it("only the db module runs when cpu cost and a specific id are skipped", async () => {
      const ran = [];
      registerHeartbeat("m-db", {
        frequency: 1,
        scope: "global",
        cost: "db",
        handler: () => ran.push("m-db"),
      });
      registerHeartbeat("m-cpu", {
        frequency: 1,
        scope: "global",
        cost: "cpu",
        handler: () => ran.push("m-cpu"),
      });
      registerHeartbeat("m-llm", {
        frequency: 1,
        scope: "global",
        cost: "llm",
        handler: () => ran.push("m-llm"),
      });

      await tickAllRegistered({
        state: { settings: {} },
        db: null,
        tickCount: 1,
        skipCosts: ["cpu"],
        skipIds: ["m-llm"],
      });

      assert.deepEqual(ran, ["m-db"]);
      const skips = getRegistrySkipStats();
      assert.equal(skips.byReason["cost:cpu"], 1);
      assert.equal(skips.byReason["id"], 1);
      assert.deepEqual(skips.lastSkipped, ["m-cpu", "m-llm"]);
    });

    it("invalid cost throws", () => {
      assert.throws(() =>
        registerHeartbeat("bad", { frequency: 1, handler: () => {}, cost: "network" })
      );
    });
  });

  describe("heartbeat-registry schedule summary", () => {
    beforeEach(() => {
      _resetHeartbeatRegistry();
    });

    it("reports ran/neverRan/onSchedule/late correctly", async () => {
      const tickMs = 15000;
      registerHeartbeat("m-db", { frequency: 1, scope: "global", cost: "db", handler: () => {} });
      registerHeartbeat("m-cpu", { frequency: 1, scope: "global", cost: "cpu", handler: () => {} });
      registerHeartbeat("m-llm", { frequency: 1, scope: "global", cost: "llm", handler: () => {} });

      await tickAllRegistered({
        state: { settings: {} },
        db: null,
        tickCount: 1,
        skipCosts: ["cpu"],
        skipIds: ["m-llm"],
      });

      const now = Date.now();
      const s1 = getRegistryScheduleSummary({ tickMs, now });
      assert.equal(s1.modules, 3);
      assert.equal(s1.ran, 1);
      assert.equal(s1.neverRan, 2);
      assert.equal(s1.onSchedule, 1);
      assert.equal(s1.late, 0);

      const farFuture = now + 10 * 60 * 1000;
      const s2 = getRegistryScheduleSummary({ tickMs, now: farFuture });
      assert.equal(s2.late, 1);
      assert.deepEqual(s2.lateIds, ["m-db"]);
    });
  });

  describe("background-governor status providers", () => {
    beforeEach(() => {
      _resetGovernorForTest();
    });

    it("registered provider shows its value", () => {
      registerStatusProvider("x", () => ({ a: 1 }));
      const st = getGovernorStatus();
      assert.deepEqual(st.providers.x, { a: 1 });
    });

    it("throwing provider surfaces an error object", () => {
      registerStatusProvider("y", () => {
        throw new Error("boom");
      });
      const st = getGovernorStatus();
      assert.deepEqual(st.providers.y, { error: "boom" });
    });
  });
});
