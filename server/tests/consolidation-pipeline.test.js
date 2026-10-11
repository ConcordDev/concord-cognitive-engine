import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";
import { consolidationIntervalMs, consolidationIsDue } from "../lib/consolidation-schedule.js";

// The behavioral cases boot server.js. Disable the governor before that
// import so a boot tick cannot run consolidation against the fixture.
process.env.CONCORD_DISABLE_HEARTBEAT = "true";
process.env.CONCORD_NO_LISTEN = "true";

let _serverMod = null;
registerServerCleanExit(() => _serverMod?.__TEST__);

const serverPath = path.join(import.meta.dirname, "../server.js");
const serverSrc = fs.readFileSync(serverPath, "utf-8");

describe("Consolidation Pipeline", () => {
  it("should have CONSOLIDATION frozen constants", () => {
    assert.ok(serverSrc.includes("const CONSOLIDATION = Object.freeze({"));
    assert.ok(serverSrc.includes("MEGA_MIN_CLUSTER: 5"));
    assert.ok(serverSrc.includes("MEGA_MAX_PER_CYCLE: 8"));
    assert.ok(serverSrc.includes("HYPER_MIN_MEGAS: 3"));
    assert.ok(serverSrc.includes("COVERAGE_THRESHOLD: 0.8"));
    assert.ok(serverSrc.includes("MAX_HEAP_BYTES: 4_294_967_296"));
  });

  it("should have TICK_FREQUENCIES frozen constants", () => {
    assert.ok(serverSrc.includes("const TICK_FREQUENCIES = Object.freeze({"));
    assert.ok(serverSrc.includes("CONSOLIDATION: 30"));
    assert.ok(serverSrc.includes("FORGETTING: 50"));
    assert.ok(serverSrc.includes("WEALTH_REDISTRIBUTION: 500"));
  });

  it("should have CONTEXT_TIER_BOOST frozen constants", () => {
    assert.ok(serverSrc.includes("const CONTEXT_TIER_BOOST = Object.freeze({"));
    assert.ok(serverSrc.includes("hyper: 2.0"));
    assert.ok(serverSrc.includes("mega: 1.5"));
  });

  it("should have quality validation function", () => {
    assert.ok(serverSrc.includes("function validateConsolidationQuality"));
    assert.ok(serverSrc.includes("COVERAGE_THRESHOLD"));
    assert.ok(serverSrc.includes("AUTHORITY_PRESERVATION"));
  });

  it("should have edge transfer function", () => {
    assert.ok(serverSrc.includes("function transferEdgesToConsolidated"));
  });

  it("should have adaptive threshold computation", () => {
    assert.ok(serverSrc.includes("function computeAdaptiveThreshold"));
    assert.ok(serverSrc.includes("HEAP_TARGET_PERCENT"));
  });

  it("should use TICK_FREQUENCIES in heartbeat", () => {
    assert.ok(serverSrc.includes("TICK_FREQUENCIES.CONSOLIDATION"));
    assert.ok(serverSrc.includes("TICK_FREQUENCIES.FORGETTING"));
  });

  it("should have archive functions", () => {
    assert.ok(serverSrc.includes("function archiveDTUToDisk"));
    assert.ok(serverSrc.includes("function rehydrateDTU"));
    assert.ok(serverSrc.includes("function demoteToArchive"));
  });

  it("should have context query macro", () => {
    assert.ok(serverSrc.includes('register("context", "query"'));
  });

  it("should have marketplace macros", () => {
    assert.ok(serverSrc.includes('register("marketplace", "list"'));
    assert.ok(serverSrc.includes('register("marketplace", "purchase"'));
    assert.ok(serverSrc.includes('register("marketplace", "browse"'));
  });

  it("clusters by fromTier and absorbs gapPromote's real return shape", () => {
    assert.match(serverSrc, /fromTier:\s*"regular"/);
    assert.match(serverSrc, /fromTier:\s*"mega"/);
    assert.ok(serverSrc.includes('op === "gap_promotion"'));
    assert.ok(serverSrc.includes("function absorbConsolidatedPromotion"));
    assert.ok(serverSrc.includes("dtu.consolidation.lastRunAt"));
    assert.ok(serverSrc.includes("consolidationLastRunAt"));
  });
});

describe("consolidation wall-clock schedule", () => {
  it("turns the old every-30-ticks period into a persisted interval", () => {
    assert.equal(consolidationIntervalMs({ heartbeatMs: 15000, everyTicks: 30 }), 450000);
    assert.equal(consolidationIntervalMs({ heartbeatMs: 1000, everyTicks: 30 }), 450000);
    assert.equal(consolidationIntervalMs({ heartbeatMs: 60000, everyTicks: 30, overrideMs: 5000 }), 5000);
  });

  it("is due when it has never run, and not due inside the interval", () => {
    assert.equal(consolidationIsDue({ lastRunAt: 0, now: 1_000_000, intervalMs: 450000 }), true);
    assert.equal(consolidationIsDue({ lastRunAt: 1000, now: 1000 + 449999, intervalMs: 450000 }), false);
    assert.equal(consolidationIsDue({ lastRunAt: 1000, now: 1000 + 450000, intervalMs: 450000 }), true);
  });
});

describe("gap_promotion keeps mega tier, honors ids, and absorbs members", () => {
  let runMacro;
  let makeInternalCtx;
  let makeCtx;
  let STATE;
  let db;
  let absorb;
  let originalDtus;

  before(async () => {
    const mod = await import("../server.js");
    _serverMod = mod;
    ({ runMacro, makeInternalCtx, makeCtx, STATE, db, absorbConsolidatedPromotion: absorb } = mod.__TEST__);
    assert.equal(typeof absorb, "function");
  });

  beforeEach(() => {
    originalDtus = STATE.dtus;
    STATE.dtus = new Map();
  });

  afterEach(() => {
    STATE.dtus = originalDtus;
  });

  function auditCounts() {
    const row = db.prepare(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN pass = 1 THEN 1 ELSE 0 END), 0) AS passes
      FROM compression_audit`).get();
    return { total: row.total, passes: row.passes };
  }

  function seed(id, title) {
    STATE.dtus.set(id, {
      id,
      title,
      tier: "regular",
      scope: "personal",
      visibility: "private",
      status: "active",
      source: "user",
      tags: ["harbor-tide", "ledger-cluster"],
      creator_id: "consolidation-tester",
      core: { claims: [], definitions: [], invariants: [], examples: [] },
      cretiHuman: `Distinct piling note ${id}.`,
      lineage: { parents: [], children: [] },
      meta: { createdBy: "consolidation-tester" },
    });
  }

  it("internal gap_promotion keeps tier mega, honors ids, dedups clusterKey, then absorbs members", async () => {
    const ids = ["gap-m1", "gap-m2", "gap-m3", "gap-m4", "gap-m5"];
    for (const id of ids) seed(id, `Harbor tide ledger ${id}`);
    const distractors = ["gap-x1", "gap-x2", "gap-x3"];
    for (const id of distractors) seed(id, `Harbor tide ledger extra ${id}`);

    const before = auditCounts();
    const ctx = makeInternalCtx("governor");
    const first = await runMacro("dtu", "gapPromote", { ids, minCluster: 5, maxPromotions: 1 }, ctx);

    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.did, "promoted", JSON.stringify(first));
    assert.equal(first.dtus?.length, 1);
    assert.equal(first.dtu?.tier, "mega");
    assert.equal(first.promoted?.[0]?.megaId, first.dtu.id);
    assert.deepEqual([...first.dtu.lineage.parents].sort(), [...ids].sort());
    for (const id of distractors) {
      assert.equal(first.dtu.lineage.parents.includes(id), false);
    }
    assert.equal(STATE.dtus.get(first.dtu.id)?.tier, "mega");
    assert.equal((STATE.dtus.get(first.dtu.id)?.tags || []).includes("tier_downgraded"), false);

    const afterFirst = auditCounts();
    assert.equal(afterFirst.passes, before.passes + 1);
    assert.equal(afterFirst.total, before.total + 1);

    const megas = () => [...STATE.dtus.values()].filter(d => d.tier === "mega").length;
    const megaCount = megas();
    const second = await runMacro("dtu", "gapPromote", { ids, minCluster: 5, maxPromotions: 1 }, ctx);
    assert.equal(second.did, "none", JSON.stringify(second));
    assert.equal(second.dtus?.length || 0, 0);
    assert.equal(megas(), megaCount);
    const afterSecond = auditCounts();
    assert.equal(afterSecond.passes, afterFirst.passes);
    assert.equal(afterSecond.total, afterFirst.total);

    const absorbed = await absorb(first, { ids });
    assert.equal(absorbed.ok, true, JSON.stringify(absorbed));
    assert.equal(absorbed.absorbed, ids.length);
    assert.equal(STATE.dtus.has(first.dtu.id), true);
    assert.equal(STATE.dtus.get(first.dtu.id).tier, "mega");
    for (const id of ids) assert.equal(STATE.dtus.has(id), false, `${id} should be absorbed`);
    for (const id of distractors) assert.equal(STATE.dtus.has(id), true);
  });

  it("a user ctx calling gap_promotion is still downgraded and writes no pass audit", async () => {
    const ids = ["user-m1", "user-m2", "user-m3", "user-m4", "user-m5"];
    for (const id of ids) seed(id, `User harbor ledger ${id}`);
    const before = auditCounts();
    const ctx = makeCtx(null);
    assert.notEqual(ctx.internal, true);
    assert.notEqual(ctx.system, true);
    assert.notEqual(ctx.actor?.internal, true);

    const result = await runMacro("dtu", "gapPromote", { ids, minCluster: 5, maxPromotions: 1 }, ctx);
    assert.equal(result.did, "none", JSON.stringify(result));
    const downgraded = [...STATE.dtus.values()].filter(d =>
      String(d.title || "").startsWith("MEGA —") && (d.tags || []).includes("tier_downgraded"));
    assert.equal(downgraded.length, 1);
    assert.equal(downgraded[0].tier, "regular");
    const after = auditCounts();
    assert.equal(after.passes, before.passes);
    assert.equal(after.total, before.total);
    for (const id of ids) assert.equal(STATE.dtus.has(id), true);
  });
});

describe("Archive Migration", () => {
  it("should have archived_dtus migration", () => {
    const migrationPath = path.join(import.meta.dirname, "../migrations/007_archived_dtus.js");
    assert.equal(fs.existsSync(migrationPath), true);
    const migrationSrc = fs.readFileSync(migrationPath, "utf-8");
    assert.ok(migrationSrc.includes("archived_dtus"));
    assert.ok(migrationSrc.includes("tier TEXT"));
    assert.ok(migrationSrc.includes("rehydrated_count"));
  });
});

describe("Artifact Store", () => {
  it("should have artifact store module", () => {
    const storePath = path.join(import.meta.dirname, "../lib/artifact-store.js");
    assert.equal(fs.existsSync(storePath), true);
    const storeSrc = fs.readFileSync(storePath, "utf-8");
    assert.ok(storeSrc.includes("storeArtifact"));
    assert.ok(storeSrc.includes("retrieveArtifact"));
    assert.ok(storeSrc.includes("deleteArtifact"));
    assert.ok(storeSrc.includes("getArtifactDiskUsage"));
  });
});

describe("Feedback Engine", () => {
  it("should have feedback engine module", () => {
    const enginePath = path.join(import.meta.dirname, "../lib/feedback-engine.js");
    assert.equal(fs.existsSync(enginePath), true);
    const engineSrc = fs.readFileSync(enginePath, "utf-8");
    assert.ok(engineSrc.includes("processFeedbackQueue"));
    assert.ok(engineSrc.includes("aggregateFeedback"));
    assert.ok(engineSrc.includes("FEEDBACK_TYPES"));
  });
});

describe("low-memory host still consolidates and drains jobs", () => {
  let governorTick;
  let STATE;
  let db;
  let MACROS;
  let register;

  before(async () => {
    const mod = _serverMod || await import("../server.js");
    _serverMod = mod;
    ({ governorTick, STATE, db, MACROS, register } = mod.__TEST__);
    assert.equal(typeof governorTick, "function");
  });

  function clearStamp() {
    STATE.settings = STATE.settings || {};
    STATE.settings.consolidationLastRunAt = 0;
    try {
      db.prepare(`DELETE FROM runtime_config_kv WHERE key = ?`).run("dtu.consolidation.lastRunAt");
    } catch { /* kv is optional */ }
  }

  async function withTicks(env, fn) {
    const presence = await import("../lib/presence-idle.js");
    presence.markActivity({ authed: true });
    const prevLow = process.env.CONCORD_LOW_MEMORY_HOST;
    const prevOff = process.env.CONCORD_CONSOLIDATION_ON_LOW_MEMORY;
    process.env.CONCORD_LOW_MEMORY_HOST = "1";
    if (env.off) process.env.CONCORD_CONSOLIDATION_ON_LOW_MEMORY = "0";
    else delete process.env.CONCORD_CONSOLIDATION_ON_LOW_MEMORY;

    const jobs = MACROS.get("jobs") || new Map();
    const queue = MACROS.get("queue") || new Map();
    if (!MACROS.has("jobs")) MACROS.set("jobs", jobs);
    if (!MACROS.has("queue")) MACROS.set("queue", queue);
    const origJobs = jobs.get("tick");
    const origQueue = queue.get("tick");
    let jobCalls = 0;
    let queueCalls = 0;
    register("jobs", "tick", async () => { jobCalls++; return { ok: true }; }, { note: "intentional_shadow_ok" });
    register("queue", "tick", async () => { queueCalls++; return { ok: true }; }, { note: "intentional_shadow_ok" });
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.map((a) => String(a)).join(" "));
      return origLog(...args);
    };
    clearStamp();
    try {
      const result = await governorTick("interval");
      await fn({ result, jobCalls, queueCalls, logs });
    } finally {
      if (origJobs) jobs.set("tick", origJobs);
      else jobs.delete("tick");
      if (origQueue) queue.set("tick", origQueue);
      else queue.delete("tick");
      console.log = origLog;
      if (prevLow === undefined) delete process.env.CONCORD_LOW_MEMORY_HOST;
      else process.env.CONCORD_LOW_MEMORY_HOST = prevLow;
      if (prevOff === undefined) delete process.env.CONCORD_CONSOLIDATION_ON_LOW_MEMORY;
      else process.env.CONCORD_CONSOLIDATION_ON_LOW_MEMORY = prevOff;
    }
  }

  it("consolidation and jobs/queue run while the low-memory profile is on", async () => {
    await withTicks({ off: false }, ({ result, jobCalls, queueCalls, logs }) => {
      assert.equal(result.skipped, "low_memory_host", JSON.stringify(result));
      assert.equal(jobCalls, 1);
      assert.equal(queueCalls, 1);
      assert.ok(Number(STATE.settings.consolidationLastRunAt) > 0);
      assert.ok(logs.some((line) => line.includes("consolidation_cycle")));
    });
  });

  it("CONCORD_CONSOLIDATION_ON_LOW_MEMORY=0 skips the cycle and still ticks jobs", async () => {
    await withTicks({ off: true }, ({ result, jobCalls, queueCalls, logs }) => {
      assert.equal(result.skipped, "low_memory_host", JSON.stringify(result));
      assert.equal(jobCalls, 1);
      assert.equal(queueCalls, 1);
      assert.equal(Number(STATE.settings.consolidationLastRunAt) || 0, 0);
      assert.equal(logs.some((line) => line.includes("consolidation_cycle")), false);
    });
  });
});
