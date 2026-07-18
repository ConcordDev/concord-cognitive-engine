/**
 * Pinning tests for the live ethos-invariant enforcement history (server.js,
 * ~line 2924 "Ethos invariant enforcement history").
 *
 * Closes docs/WAVE4_INVENTORY.md's "lock" row: the sovereignty dashboard's
 * "invariants" were a frozen constant with no live, runtime-checked
 * pass/fail history, even though enforceEthosInvariant() genuinely runs on
 * every action (~139 call sites) and genuinely passes/throws. This suite
 * proves:
 *   1. A passing call appends a real { result: "pass" } event.
 *   2. A blocked call appends a real { result: "blocked", invariant }
 *      event BEFORE throwing, and still throws the exact original error.
 *   3. The ring buffer is bounded (never grows past the cap) even under
 *      more than `cap` calls, while the total-checks counter keeps
 *      counting every call (bounded storage, unbounded honest counting).
 *   4. Recording can never alter enforceEthosInvariant's pass/throw
 *      contract -- a passing call still returns `true`, a blocked call
 *      still throws the same Error it always threw.
 *
 * Run: node --test server/tests/ethos-enforcement-history.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";

let T;
registerServerCleanExit(() => T);

before(async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  if (!process.env.STATE_PATH) {
    process.env.STATE_PATH = path.join(os.tmpdir(), `concord-ethos-history-state-${process.pid}-${Date.now()}.json`);
  }
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(os.tmpdir(), `concord-ethos-history-${process.pid}-${Date.now()}.db`);
  }
  T = (await import("../server.js")).__TEST__;
});

// Helper: unique per-test action tokens so we can find "our" events inside
// a buffer that may already contain events from boot-time / other calls
// within this same process.
let seq = 0;
function uniqueAction(prefix) {
  seq++;
  return `${prefix}_${process.pid}_${seq}`;
}

describe("enforceEthosInvariant pass path is recorded", () => {
  it("appends a result:'pass' event for an ordinary action name and still returns true", () => {
    const action = uniqueAction("read_dtu_ordinary");
    const before = T.getEthosEnforcementSnapshot().enforcementStats.totalChecks;

    const ret = T.enforceEthosInvariant(action);
    assert.equal(ret, true, "a passing call must still return true");

    const snap = T.getEthosEnforcementSnapshot();
    assert.equal(snap.enforcementStats.totalChecks, before + 1, "totalChecks must increment by exactly 1");

    const found = snap.recentEnforcement.find((e) => e.action === action);
    assert.ok(found, "the recorded event for this action must be present in the buffer");
    assert.equal(found.result, "pass");
    assert.equal(found.invariant, null);
    assert.equal(typeof found.at, "string");
    assert.ok(!Number.isNaN(Date.parse(found.at)), "at must be a parseable ISO timestamp");
  });
});

describe("enforceEthosInvariant blocked path is recorded AND still throws", () => {
  it("NO_TELEMETRY: records a blocked event before throwing, with the exact original error message", () => {
    const action = uniqueAction("telemetry_report");
    const beforeBlocked = T.getEthosEnforcementSnapshot().enforcementStats.totalBlocked;

    assert.throws(
      () => T.enforceEthosInvariant(action),
      (err) => {
        assert.equal(err.message, "Ethos invariant: telemetry forbidden");
        return true;
      },
      "a blocked call must still throw the exact same error it always threw"
    );

    const snap = T.getEthosEnforcementSnapshot();
    assert.equal(snap.enforcementStats.totalBlocked, beforeBlocked + 1, "totalBlocked must increment by exactly 1");

    const found = snap.recentEnforcement.find((e) => e.action === action);
    assert.ok(found, "the recorded event for this blocked action must be present in the buffer");
    assert.equal(found.result, "blocked");
    assert.equal(found.invariant, "NO_TELEMETRY");
  });

  it("NO_ADS: token-boundary match on 'ads' records blocked with the right invariant id", () => {
    const action = uniqueAction("show_ads");
    assert.throws(() => T.enforceEthosInvariant(action));
    const snap = T.getEthosEnforcementSnapshot();
    const found = snap.recentEnforcement.find((e) => e.action === action);
    assert.ok(found);
    assert.equal(found.result, "blocked");
    assert.equal(found.invariant, "NO_ADS");
  });

  it("a non-boundary substring match ('inference_add_fact') is NOT blocked and is NOT recorded as blocked", () => {
    // Regression guard for the token-boundary fix documented right above
    // enforceEthosInvariant in server.js -- 'add' must not match the 'ad'/'ads'
    // token list via substring.
    const action = uniqueAction("inference_add_fact");
    const ret = T.enforceEthosInvariant(action);
    assert.equal(ret, true);
    const found = T.getEthosEnforcementSnapshot().recentEnforcement.find((e) => e.action === action);
    assert.ok(found);
    assert.equal(found.result, "pass");
  });
});

describe("ring buffer is bounded and never throws", () => {
  it("stays at or below capacity after far more than `cap` enforcement calls", () => {
    const cap = T.ETHOS_ENFORCEMENT_HISTORY_CAP;
    assert.equal(typeof cap, "number");
    assert.ok(cap > 0);

    const overflow = cap + 137; // deliberately > cap
    for (let i = 0; i < overflow; i++) {
      T.enforceEthosInvariant(uniqueAction("bulk_pass_ok"));
    }

    const snap = T.getEthosEnforcementSnapshot();
    assert.ok(
      snap.recentEnforcement.length <= cap,
      `buffer length ${snap.recentEnforcement.length} must never exceed cap ${cap}`
    );
    assert.ok(
      snap.enforcementStats.bufferedCount <= cap,
      `bufferedCount ${snap.enforcementStats.bufferedCount} must never exceed cap ${cap}`
    );
    // bufferedCount saturates at the cap once more than `cap` events have
    // been recorded overall (bounded storage)...
    assert.equal(snap.enforcementStats.bufferedCount, cap);
    // ...while totalChecks keeps counting every real call, unbounded
    // (honest counting, independent of the storage cap).
    assert.ok(snap.enforcementStats.totalChecks >= overflow);
    assert.equal(snap.enforcementStats.capacity, cap);
  });

  it("recentEnforcement events are in chronological (oldest-first) order", () => {
    const snap = T.getEthosEnforcementSnapshot();
    const times = snap.recentEnforcement.map((e) => Date.parse(e.at));
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] >= times[i - 1], "events must be non-decreasing in timestamp order");
    }
  });

  it("enforcementStats reports an honest runtime-since-boot scope, not a persisted/CI scope", () => {
    const snap = T.getEthosEnforcementSnapshot();
    assert.equal(snap.enforcementStats.scope, "runtime-since-boot");
    assert.equal(typeof snap.enforcementStats.bootAt, "string");
    assert.ok(!Number.isNaN(Date.parse(snap.enforcementStats.bootAt)));
  });
});

describe("recording can never alter the enforcement contract", () => {
  it("every ETHOS_INVARIANTS-gated blocked action still throws even after thousands of recordings", () => {
    // Sanity: hammer the recorder, then confirm the four gated invariants
    // still throw with their original messages -- proves the ring buffer's
    // internal state can never leak into or break the throw/return path.
    for (let i = 0; i < 50; i++) T.enforceEthosInvariant(uniqueAction("noise"));

    assert.throws(() => T.enforceEthosInvariant("telemetry"), /telemetry forbidden/);
    assert.throws(() => T.enforceEthosInvariant("ads"), /ads forbidden/);
    assert.throws(() => T.enforceEthosInvariant("monitor"), /monitoring forbidden/);
    assert.throws(() => T.enforceEthosInvariant("profile"), /profiling forbidden/);
    assert.equal(T.enforceEthosInvariant("harmless_action"), true);
  });
});
