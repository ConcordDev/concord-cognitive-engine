// Batch 020 — incident_watch chunking: K-signal sync slices + setImmediate
// yields + ~2s wall; backlog drains across ticks; decisions match unchunked.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { classifyForWatch, classifySignal } from "../../lib/incident-engine/classify.js";
import {
  INCIDENT_SIGNALS_PER_SLICE,
  INCIDENT_TICK_WALL_MS,
  DEDUPE_WINDOW_MINUTES,
  ensureIncidentSchema,
  processSignalBacklog,
  runIncidentWatchTick,
  decisionFingerprint,
  persistedDecisionFingerprint,
  yieldToEventLoop,
  _backlogForTest,
} from "../../lib/incident-engine/watch-tick.js";

const NOOP_HOOKS = {
  sendTelegram: async () => false,
  executeRecovery: async () => ({
    ok: false,
    detail: "test_noop",
    duration_ms: 0,
    verified: false,
    verify_detail: "skipped",
  }),
};

function memDb() {
  const db = new Database(":memory:");
  ensureIncidentSchema(db);
  return db;
}

function makeSignals(n, prefix = "sig") {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      source: `${prefix}_src_${i}`,
      kind: `${prefix}_novel_${i}`,
      severity: "warn",
      message: `${prefix} message ${i}`,
    });
  }
  return out;
}

describe("incident classify (parity with Python organ)", () => {
  it("classifies concord_backend_down", () => {
    const r = classifySignal({ source: "concord_health", ok: false });
    assert.equal(r.incidentClass, "concord_backend_down");
    assert.equal(r.severity, "critical");
    assert.equal(r.escalateTo, "operator");
  });

  it("unknown → unknown_class + operator on watch path", () => {
    const r = classifyForWatch({ source: "never_seen", kind: "totally_novel" });
    assert.equal(r.incidentClass, "unknown_class");
    assert.equal(r.escalateTo, "operator");
  });

  it("dedupe window constant is 5 minutes", () => {
    assert.equal(DEDUPE_WINDOW_MINUTES, 5);
  });

  it("documents K=10 and ~2s wall defaults", () => {
    assert.equal(INCIDENT_SIGNALS_PER_SLICE, 10);
    assert.equal(INCIDENT_TICK_WALL_MS, 2000);
  });
});

describe("processSignalBacklog chunking", () => {
  it("yields setImmediate between slices so a macrotask can interleave", async () => {
    const db = memDb();
    const signals = makeSignals(25, "yield");
    let macrotaskAt = -1;
    let seen = 0;
    setImmediate(() => {
      macrotaskAt = seen;
    });
    await processSignalBacklog(db, signals, {
      signalsPerSlice: 10,
      tickWallMs: Number.POSITIVE_INFINITY,
      hooks: NOOP_HOOKS,
      onSyncSlice: ({ signalCount }) => {
        seen += signalCount;
      },
    });
    assert.equal(seen, 25);
    assert.ok(
      macrotaskAt > 0 && macrotaskAt < 25,
      `macrotask should interleave mid-drain (saw after ${macrotaskAt})`,
    );
    db.close();
  });

  it("does not yield for a single slice", async () => {
    const db = memDb();
    let macrotaskRan = false;
    setImmediate(() => {
      macrotaskRan = true;
    });
    await processSignalBacklog(db, makeSignals(5, "one"), {
      signalsPerSlice: 10,
      tickWallMs: Number.POSITIVE_INFINITY,
      hooks: NOOP_HOOKS,
    });
    assert.equal(macrotaskRan, false);
    db.close();
  });

  it("500-signal backlog: every sync slice < 25ms and drains across ticks", async () => {
    const signals = makeSignals(500, "bulk");
    const db = memDb();
    const sliceSyncMs = [];
    let ticks = 0;
    let fakeNow = 0;
    _backlogForTest([]);

    // Seed carry with the full backlog (same as a truncated prior gather).
    // Fake wall +600ms/slice ⇒ ~3 slices/tick under the 2s budget.
    _backlogForTest(signals);

    while (ticks < 80) {
      const count = db.prepare("SELECT COUNT(*) AS c FROM incident_state").get().c;
      if (count >= 500 && _backlogForTest().length === 0) break;
      ticks += 1;
      fakeNow = 0;
      await runIncidentWatchTick({
        db,
        signalsPerSlice: INCIDENT_SIGNALS_PER_SLICE,
        tickWallMs: INCIDENT_TICK_WALL_MS,
        hooks: NOOP_HOOKS,
        now: () => fakeNow,
        onSyncSlice: ({ syncMs }) => {
          sliceSyncMs.push(syncMs);
          fakeNow += 600;
        },
        // No gatherSignals — drain the carry queue only.
      });
    }

    const finalCount = db.prepare("SELECT COUNT(*) AS c FROM incident_state").get().c;
    assert.equal(finalCount, 500, "all 500 unique class/source pairs should persist");
    assert.equal(_backlogForTest().length, 0, "carry queue must be empty");
    assert.ok(ticks > 1, `expected multi-tick drain, got ticks=${ticks}`);
    assert.ok(sliceSyncMs.length > 1, "expected multiple sync slices");
    for (const ms of sliceSyncMs) {
      assert.ok(ms < 25, `sync slice ${ms}ms must be < 25ms`);
    }

    // Identical final decisions vs a fresh unchunked pass on the same fixture.
    const dbRef = memDb();
    const unchunked = await processSignalBacklog(dbRef, signals, {
      chunked: false,
      hooks: NOOP_HOOKS,
    });
    assert.deepEqual(
      persistedDecisionFingerprint(db),
      persistedDecisionFingerprint(dbRef),
      "multi-tick drain must match unchunked persisted decisions",
    );
    assert.equal(unchunked.processed, 500);

    db.close();
    dbRef.close();
    _backlogForTest([]);
  });

  it("chunked path decisions match unchunked path on a fixture set", async () => {
    const fixture = [
      ...makeSignals(20, "fix"),
      { source: "concord_health", ok: false, kind: "concord_backend_down" },
      { kind: "browser_organ_observation_stale", age_seconds: 2400 },
      { kind: "refusal_field_active" },
      {
        source: "sentinel_alert",
        kind: "browser_organ",
        message: "consecutive warns",
      },
      // duplicate of first fixture signal → dedupe on second pass only;
      // within one pass sources are unique except we append a repeat:
      { source: "fix_src_0", kind: "fix_novel_0", severity: "warn", message: "dup" },
    ];

    const dbUn = memDb();
    const dbCh = memDb();
    const unchunked = await processSignalBacklog(dbUn, fixture, {
      chunked: false,
      hooks: NOOP_HOOKS,
    });
    const chunked = await processSignalBacklog(dbCh, fixture, {
      chunked: true,
      signalsPerSlice: 10,
      tickWallMs: Number.POSITIVE_INFINITY,
      hooks: NOOP_HOOKS,
    });

    assert.deepEqual(
      decisionFingerprint(chunked.results),
      decisionFingerprint(unchunked.results),
      "chunked vs unchunked result decisions must match",
    );
    assert.deepEqual(
      persistedDecisionFingerprint(dbCh),
      persistedDecisionFingerprint(dbUn),
      "persisted rows must match",
    );

    // Same-pass dedupe: last signal shares class/source with first → deduped
    const deduped = chunked.results.filter((r) => r.status === "deduped");
    assert.ok(deduped.length >= 1, "fixture repeat must dedupe within 5m window");

    dbUn.close();
    dbCh.close();
  });

  it("wall-time truncate leaves remaining for the next tick; dedupe preserves prior decisions", async () => {
    const signals = makeSignals(30, "wall");
    const db = memDb();
    let fakeNow = 0;
    const first = await processSignalBacklog(db, signals, {
      signalsPerSlice: 10,
      tickWallMs: 2000,
      hooks: NOOP_HOOKS,
      now: () => fakeNow,
      onSyncSlice: () => {
        fakeNow += 1500;
      },
    });
    assert.equal(first.truncated, true);
    assert.ok(first.remaining > 0);
    const afterFirst = db.prepare("SELECT COUNT(*) AS c FROM incident_state").get().c;
    assert.ok(afterFirst > 0 && afterFirst < 30);

    fakeNow = 0;
    const second = await processSignalBacklog(db, signals, {
      signalsPerSlice: 10,
      tickWallMs: Number.POSITIVE_INFINITY,
      hooks: NOOP_HOOKS,
      now: () => fakeNow,
    });
    assert.equal(second.truncated, false);
    const afterSecond = db.prepare("SELECT COUNT(*) AS c FROM incident_state").get().c;
    assert.equal(afterSecond, 30);
    // First-tick rows still present; re-seen signals are deduped not duplicated
    const deduped = second.results.filter((r) => r.status === "deduped").length;
    assert.ok(deduped >= afterFirst);
    db.close();
  });
});

describe("yieldToEventLoop", () => {
  it("schedules on the check phase (setImmediate)", async () => {
    const order = [];
    const p = yieldToEventLoop().then(() => order.push("yield"));
    setImmediate(() => order.push("other"));
    await p;
    await new Promise((r) => setImmediate(r));
    assert.ok(order.includes("yield"));
    assert.ok(order.includes("other"));
  });
});
