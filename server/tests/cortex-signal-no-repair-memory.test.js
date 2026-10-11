// #1172 failure signals must not teach repair memory, and a throwing
// macro must not grow the pain store without a small cap.
//
// Burst, 5xx, logger-forwarded, and feed DB failures pass learn:false.
// The accumulator (and recurring_error on a repeat) still records them.
// matchErrorPattern / repair_knowledge do not. Macro-throw pain is
// deduped by signature and hard-capped at MACRO_THROW_PAIN_CAP; the
// avoidance-learning map otherwise only stops at ~100k.
//
// Run: node --test --import=./tests/preload/no-egress.mjs tests/cortex-signal-no-repair-memory.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig030 from "../migrations/030_repair_enhanced.js";
import logger from "../logger.js";
import { emitFeedEvent } from "../emergent/feed.js";
import {
  configureRepairPersistence,
  getAllRepairPatterns,
  getErrorAccumulator,
  getRecentRepairDTUs,
  matchErrorPattern,
  observe,
  setSecurityMatcher,
} from "../emergent/repair-cortex.js";
import { getPainHistory, getPainMetrics } from "../emergent/avoidance-learning.js";
import {
  MACRO_THROW_PAIN_CAP,
  failureSignalStats,
  reportHttpFailure,
  reportMacroUncaughtThrow,
  resetFailureSignalsForTests,
} from "../lib/cortex-failure-signals.js";

function knowledgeCount(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM repair_knowledge").get().c;
}

function remembers(fragment) {
  return getAllRepairPatterns().patterns.some((row) => String(row.pattern).includes(fragment));
}

function threatIds() {
  return new Set(
    getRecentRepairDTUs(500).dtus
      .filter((row) => row.action === "security_threat_in_error")
      .map((row) => row.id),
  );
}

function httpReq(id) {
  return {
    id,
    method: "GET",
    baseUrl: "/api/members",
    route: { path: "/:id" },
    path: "/api/members/11111111-2222-3333-4444-555555555555",
  };
}

describe("failure signals do not teach repair memory", { concurrency: false }, () => {
  let db;
  let prevState;
  let prevConcord;

  before(() => {
    db = new Database(":memory:");
    mig030.up(db);
    configureRepairPersistence(db);
    setSecurityMatcher({
      quickScan() {
        return { matched: true, severity: "critical", signatureId: "sig", fixId: "fix", action: "alert", layer: "test" };
      },
    });
    prevState = globalThis.STATE;
    prevConcord = globalThis._concordSTATE;
    const state = { repairMemory: new Map() };
    globalThis.STATE = state;
    globalThis._concordSTATE = state;
    resetFailureSignalsForTests();
  });

  after(() => {
    configureRepairPersistence(null);
    setSecurityMatcher(null);
    globalThis.STATE = prevState;
    globalThis._concordSTATE = prevConcord;
    resetFailureSignalsForTests();
    try { db.close(); } catch { /* noop */ }
  });

  it("a matching burst, 5xx, log, and feed signal adds no repair memory and still counts", () => {
    const stamp = `atk_${Date.now()}`;
    const httpMessage = `no such column: ${stamp}_http`;
    const logMessage = `no such column: ${stamp}_log`;
    const feedMessage = `no such column: ${stamp}_feed`;
    assert.ok(matchErrorPattern(httpMessage), "the fixture must be a real ERROR_PATTERN");
    assert.ok(matchErrorPattern(logMessage));
    assert.ok(matchErrorPattern(feedMessage));
    assert.ok(matchErrorPattern("burst 403 x10 /api/no such column: b fp=abc"));

    const rowsBefore = knowledgeCount(db);
    const memoryBefore = getAllRepairPatterns().patterns.length;
    const threatsBefore = threatIds();
    const accBefore = getErrorAccumulator().size;

    const httpErr = new Error(httpMessage);
    reportHttpFailure(httpReq(`${stamp}-a`), httpErr, 500);
    reportHttpFailure(httpReq(`${stamp}-b`), httpErr, 500);

    const burstPath = "/api/no such column: b";
    for (let i = 0; i < 10; i++) {
      reportHttpFailure({
        id: `${stamp}-burst-${i}`,
        method: "GET",
        path: burstPath,
      }, new Error("denied"), 403);
    }

    logger.error("unit", "handler failed", { error: logMessage });

    const feedDb = {
      open: true,
      prepare() {
        return { run() { throw new Error(feedMessage); } };
      },
    };
    const fed = emitFeedEvent({ type: "dream", data: { dream: "secret-dream-text" } }, feedDb, null);
    assert.equal(typeof fed.id, "string");

    assert.equal(knowledgeCount(db), rowsBefore);
    assert.equal(getAllRepairPatterns().patterns.length, memoryBefore);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM repair_knowledge WHERE symptoms LIKE ?").get(`%${stamp}%`).c,
      0,
    );
    for (const fragment of [`${stamp}_http`, `${stamp}_log`, `${stamp}_feed`, "no such column: b"]) {
      assert.equal(remembers(fragment), false, fragment);
    }
    assert.equal(
      getRecentRepairDTUs(500).dtus.filter((row) => row.action === "security_threat_in_error" && !threatsBefore.has(row.id)).length,
      0,
    );

    const entries = getErrorAccumulator().entries;
    const httpHit = entries.find((row) => row.context === "http_500:/api/members/:id" && String(row.message).includes(`${stamp}_http`));
    assert.ok(httpHit, "the 5xx stays in the accumulator");
    assert.equal(httpHit.count, 2);
    assert.ok(matchErrorPattern(httpHit.message));

    const recurring = getRecentRepairDTUs(500).dtus.filter((row) =>
      row.action === "recurring_error" && String(row.details?.message || "").includes(`${stamp}_http`));
    assert.ok(recurring.length >= 1, "a repeated 5xx still emits recurring_error");
    assert.ok(recurring.some((row) => row.details.count >= 2));

    const burstHit = entries.find((row) => String(row.context).startsWith("http_burst_403:"));
    assert.ok(burstHit, "the burst stays in the accumulator");
    assert.match(burstHit.message, /no such column: b/);
    assert.ok(matchErrorPattern(burstHit.message));
    assert.equal(String(burstHit.message).includes("secret-dream-text"), false);

    const logHit = entries.find((row) => String(row.context).startsWith("log:error:") && String(row.message).includes(`${stamp}_log`));
    assert.ok(logHit, "the logger line stays in the accumulator");
    assert.ok(matchErrorPattern(logHit.message));

    const feedHit = entries.find((row) => String(row.context).startsWith("log:error:") && String(row.message).includes(`${stamp}_feed`));
    assert.ok(feedHit, "the feed DB failure stays in the accumulator");
    assert.ok(matchErrorPattern(feedHit.message));
    assert.equal(String(feedHit.message).includes("secret-dream-text"), false);

    assert.ok(getErrorAccumulator().size >= accBefore + 4);

    const control = `no such column: ${stamp}_control`;
    observe(new Error(control), "billing");
    assert.equal(remembers(`${stamp}_control`), true);
    assert.equal(getAllRepairPatterns().patterns.length, memoryBefore + 1);
    assert.equal(knowledgeCount(db), rowsBefore + 1);
    assert.equal(
      getRecentRepairDTUs(500).dtus.filter((row) => row.action === "security_threat_in_error" && !threatsBefore.has(row.id)).length,
      1,
    );
  });

  it("many macro throws keep the pain store at the cap and still observe", () => {
    resetFailureSignalsForTests();
    assert.ok(MACRO_THROW_PAIN_CAP >= 1 && MACRO_THROW_PAIN_CAP <= 64);

    const before = getPainMetrics().totalPainEvents;
    const obsBefore = failureSignalStats().observeCalls;
    const accBefore = getErrorAccumulator().size;

    const same = new Error("identical-macro-throw");
    for (let i = 0; i < 200; i++) {
      const pain = reportMacroUncaughtThrow(same, "members", "hot");
      assert.equal(pain.ok, true);
      if (i === 0) assert.equal(typeof pain.painId, "string");
      else assert.equal(pain.deduped, true);
    }
    assert.equal(getPainMetrics().totalPainEvents - before, 1);
    assert.equal(getPainHistory("macro:members.hot", 100).length, 1);

    const uniqueThrows = MACRO_THROW_PAIN_CAP * 10;
    for (let i = 0; i < uniqueThrows; i++) {
      const pain = reportMacroUncaughtThrow(new Error(`distinct-macro-throw-${i}`), "members", `n${i}`);
      assert.equal(pain.ok, true);
      if (i < MACRO_THROW_PAIN_CAP - 1) {
        assert.equal(typeof pain.painId, "string");
        assert.equal(pain.capped, undefined);
      } else {
        assert.equal(pain.capped, true);
        assert.equal(pain.painId, undefined);
      }
    }

    assert.equal(getPainMetrics().totalPainEvents - before, MACRO_THROW_PAIN_CAP);
    assert.equal(getPainHistory("macro:members.n0", 20).length, 1);
    assert.equal(getPainHistory(`macro:members.n${MACRO_THROW_PAIN_CAP - 1}`, 20).length, 0);
    assert.equal(failureSignalStats().observeCalls - obsBefore, 200 + uniqueThrows);
    assert.equal(getErrorAccumulator().size - accBefore, 1 + uniqueThrows);

    const repeated = getErrorAccumulator().entries.find((row) =>
      row.context === "macro_uncaught_throw:members.hot" && String(row.message).includes("identical-macro-throw"));
    assert.ok(repeated, "throws past the pain cap are still observed");
    assert.equal(repeated.count, 200);
  });
});
