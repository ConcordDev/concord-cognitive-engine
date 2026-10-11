// Anonymous frontend reports must not teach repair memory.
//
// ingest -> capture -> observe() used to call matchErrorPattern on the first
// sighting and INSERT a repair_knowledge row per distinct message. learn:false
// keeps the report in the bounded accumulator only. A separate cap evicts the
// oldest learned pattern so the map cannot grow without a ceiling.
//
// Run: node --test --test-concurrency=2 server/tests/frontend-error-no-repair-memory.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig030 from "../migrations/030_repair_enhanced.js";
import { ingestFrontendError, _resetFrontendErrorIntakeForTest } from "../lib/frontend-error-intake.js";
import {
  ERROR_CONTEXT,
  REPAIR_MEMORY_CAP,
  addToRepairMemory,
  configureRepairPersistence,
  getAllRepairPatterns,
  getErrorAccumulator,
  getRecentRepairDTUs,
  matchErrorPattern,
  observe,
  setSecurityMatcher,
} from "../emergent/repair-cortex.js";

const MESSAGES = [
  "ReferenceError: attackerA is not defined",
  "Cannot find module 'attacker-mod'",
  "no such column: attacker_col",
];

function knowledgeCount(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM repair_knowledge").get().c;
}

function remembers(fragment) {
  return getAllRepairPatterns().patterns.some((row) => String(row.pattern).includes(fragment));
}

describe("frontend errors do not teach repair memory", { concurrency: false }, () => {
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
    _resetFrontendErrorIntakeForTest();
  });

  after(() => {
    configureRepairPersistence(null);
    setSecurityMatcher(null);
    globalThis.STATE = prevState;
    globalThis._concordSTATE = prevConcord;
    try { db.close(); } catch { /* noop */ }
  });

  it("a matching frontend report creates no repair_knowledge row and no repair-memory entry", () => {
    const rowsBefore = knowledgeCount(db);
    const memoryBefore = getAllRepairPatterns().patterns.length;
    const threatsBefore = new Set(
      getRecentRepairDTUs(500).dtus.filter((row) => row.action === "security_threat_in_error").map((row) => row.id),
    );

    for (const message of MESSAGES) {
      const result = ingestFrontendError({
        error: { message, name: "Error" },
        lens: "world",
        route: "/lenses/world",
      });
      assert.equal(result.ok, true);
    }

    assert.equal(knowledgeCount(db), rowsBefore);
    assert.equal(getAllRepairPatterns().patterns.length, memoryBefore);
    for (const fragment of ["attackerA", "attacker-mod", "attacker_col"]) {
      assert.equal(remembers(fragment), false);
    }

    const captured = ERROR_CONTEXT.getRecent(20).find((row) => String(row.error.message).includes("attackerA"));
    assert.ok(captured, "the report stays in the ERROR_CONTEXT buffer");
    assert.equal(captured.context.module, "frontend:world");
    assert.equal(captured.context.trigger, "frontend_render");
    assert.ok(matchErrorPattern(captured.error.message), "the stored message still matches a repair pattern");

    const accumulated = getErrorAccumulator().entries.find((row) => row.context === "frontend:world" && String(row.message).includes("attackerA"));
    assert.ok(accumulated, "the report stays in the error accumulator");

    const newThreats = getRecentRepairDTUs(500).dtus.filter((row) => row.action === "security_threat_in_error" && !threatsBefore.has(row.id));
    assert.equal(newThreats.length, 0);
  });

  it("a non-frontend observe() still learns and can log a security threat", () => {
    const honest = `ReferenceError: honest${Date.now()} is not defined`;
    const rowsBefore = knowledgeCount(db);
    const memoryBefore = getAllRepairPatterns().patterns.length;
    const threatsBefore = new Set(
      getRecentRepairDTUs(500).dtus.filter((row) => row.action === "security_threat_in_error").map((row) => row.id),
    );

    observe(new Error(honest), "billing");

    assert.equal(remembers(`honest`), true);
    assert.equal(getAllRepairPatterns().patterns.length, memoryBefore + 1);
    assert.equal(knowledgeCount(db), rowsBefore + 1);
    const newThreats = getRecentRepairDTUs(500).dtus.filter((row) => row.action === "security_threat_in_error" && !threatsBefore.has(row.id));
    assert.equal(newThreats.length, 1);

    const quiet = `no such column: quiet_${Date.now()}`;
    const rowsQuiet = knowledgeCount(db);
    observe(new Error(quiet), "billing", { learn: false });
    assert.equal(remembers("quiet_"), false);
    assert.equal(knowledgeCount(db), rowsQuiet);
  });

  it("the repair-memory cap evicts the oldest pattern", () => {
    const stamp = `cap-${Date.now()}`;
    let n = 0;
    while (getAllRepairPatterns().patterns.length < REPAIR_MEMORY_CAP) {
      addToRepairMemory(`${stamp}-fill-${n}`, { name: "fill" });
      n += 1;
      assert.ok(n <= REPAIR_MEMORY_CAP + 2);
    }
    const oldest = getAllRepairPatterns().patterns[0].pattern;
    const fresh = `${stamp}-fresh`;
    addToRepairMemory(fresh, { name: "fresh" });

    const patterns = getAllRepairPatterns().patterns;
    assert.equal(patterns.length, REPAIR_MEMORY_CAP);
    assert.equal(patterns.some((row) => row.pattern === oldest), false);
    assert.equal(patterns.some((row) => row.pattern === fresh), true);
    assert.equal(globalThis.STATE.repairMemory.size, REPAIR_MEMORY_CAP);
    assert.equal([...globalThis.STATE.repairMemory.values()].some((row) => row.pattern === oldest), false);
    assert.equal([...globalThis.STATE.repairMemory.values()].some((row) => row.pattern === fresh), true);
    assert.equal(knowledgeCount(db), REPAIR_MEMORY_CAP);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM repair_knowledge WHERE symptoms = ?").get(oldest).c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM repair_knowledge WHERE symptoms = ?").get(fresh).c, 1);
  });
});
