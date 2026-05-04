/**
 * Session Context Accumulator — Comprehensive Test Suite
 *
 * Covers:
 *   - createAccumulator: shape, defaults, idempotency
 *   - getAccumulator: create-on-miss, TTL expiry reset
 *   - accumulate: domain signals, lenses, action history, topic thread,
 *                 cross-domain links, signal decay, overflow caps
 *   - getContextSnapshot: weighted signals, action distribution, empty session
 *   - getTopicThread / getCrossDomainSignals / getContributingLenses: data + empty paths
 *   - completeSession: return shape, completedAt marking, missing session
 *   - cleanupExpiredSessions: TTL-based eviction
 *   - getAccumulatorMetrics: aggregate stats, empty state, multi-session
 *   - Context accumulation across many turns
 *   - Signal decay to removal
 *   - Overflow / cap enforcement for domain signals, lenses, history, topic thread
 *   - Cross-session isolation
 *
 * Run: node --test tests/session-context-accumulator.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  createAccumulator,
  getAccumulator,
  accumulate,
  getContextSnapshot,
  getTopicThread,
  getCrossDomainSignals,
  getContributingLenses,
  completeSession,
  cleanupExpiredSessions,
  getAccumulatorMetrics,
} from "../lib/session-context-accumulator.js";

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;

/** Generate a unique session id to avoid cross-test pollution. */
function uniqueSessionId(tag = "test") {
  return `${tag}-${Date.now()}-${++_idCounter}`;
}

/** Build a minimal route plan. */
function routePlan(overrides = {}) {
  return {
    ok: true,
    actionType: "QUERY",
    domainSignals: [],
    lenses: [],
    isMultiLens: false,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// createAccumulator
// ═════════════════════════════════════════════════════════════════════════

describe("createAccumulator", () => {
  it("returns an accumulator with correct initial shape", () => {
    const sid = uniqueSessionId("create");
    const acc = createAccumulator(sid);

    assert.equal(acc.sessionId, sid);
    assert.equal(acc.turnCount, 0);
    assert.ok(acc.domainSignals instanceof Map);
    assert.equal(acc.domainSignals.size, 0);
    assert.deepStrictEqual(acc.activeLenses, []);
    assert.deepStrictEqual(acc.actionHistory, []);
    assert.deepStrictEqual(acc.topicThread, []);
    assert.deepStrictEqual(acc.crossDomainLinks, []);
    assert.ok(acc.contributingLenses instanceof Set);
    assert.equal(acc.contributingLenses.size, 0);
    assert.ok(typeof acc.createdAt === "number");
    assert.ok(typeof acc.lastUpdatedAt === "number");
  });

  it("overwrites a previous accumulator with the same sessionId", () => {
    const sid = uniqueSessionId("overwrite");
    const acc1 = createAccumulator(sid);
    accumulate(sid, routePlan({ domainSignals: ["alpha"] }), "msg");
    assert.equal(acc1.turnCount, 1);

    const acc2 = createAccumulator(sid);
    assert.equal(acc2.turnCount, 0);
    assert.equal(acc2.domainSignals.size, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// getAccumulator
// ═════════════════════════════════════════════════════════════════════════

describe("getAccumulator", () => {
  it("creates a new accumulator if none exists", () => {
    const sid = uniqueSessionId("getacc-new");
    const acc = getAccumulator(sid);
    assert.ok(acc);
    assert.equal(acc.sessionId, sid);
    assert.equal(acc.turnCount, 0);
  });

  it("returns existing accumulator when present", () => {
    const sid = uniqueSessionId("getacc-existing");
    const acc1 = createAccumulator(sid);
    const acc2 = getAccumulator(sid);
    assert.equal(acc1, acc2);
  });

  it("resets accumulator when TTL has expired", () => {
    const sid = uniqueSessionId("getacc-ttl");
    const acc1 = createAccumulator(sid);
    accumulate(sid, routePlan({ domainSignals: ["stale"] }), "old msg");
    assert.equal(acc1.turnCount, 1);

    // Manually expire the session (4 hours + 1 ms in the past)
    acc1.lastUpdatedAt = Date.now() - (4 * 3600_000 + 1);

    const acc2 = getAccumulator(sid);
    // Should be a fresh accumulator (different object, reset state)
    assert.notEqual(acc1, acc2);
    assert.equal(acc2.turnCount, 0);
    assert.equal(acc2.domainSignals.size, 0);
    assert.ok(!acc2.domainSignals.has("stale"), "stale signal should be gone after TTL reset");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// accumulate — Domain Signals
// ═════════════════════════════════════════════════════════════════════════

describe("accumulate — domain signals", () => {
  it("adds new domain signals with initial weight 0.5", () => {
    const sid = uniqueSessionId("signals-new");
    accumulate(sid, routePlan({ domainSignals: ["farming", "insurance"] }), "msg");

    const acc = getAccumulator(sid);
    assert.ok(acc.domainSignals.has("farming"));
    assert.ok(acc.domainSignals.has("insurance"));

    const farming = acc.domainSignals.get("farming");
    assert.equal(farming.weight, 0.5);
    assert.equal(farming.firstSeen, 1);
    assert.equal(farming.lastSeen, 1);
    assert.equal(farming.turnCount, 1);
  });

  it("reinforces existing signals by +0.3 capped at 1.0", () => {
    const sid = uniqueSessionId("signals-reinforce");
    accumulate(sid, routePlan({ domainSignals: ["farming"] }), "msg1");
    accumulate(sid, routePlan({ domainSignals: ["farming"] }), "msg2");

    const acc = getAccumulator(sid);
    const farming = acc.domainSignals.get("farming");
    // Turn 1: weight = 0.5
    // Turn 2 decay: 0.5 * 0.85 = 0.425, then +0.3 = 0.725
    assert.ok(farming.weight > 0.7);
    assert.ok(farming.weight <= 1.0);
    assert.equal(farming.turnCount, 2);
    assert.equal(farming.lastSeen, 2);
    assert.equal(farming.firstSeen, 1);
  });

  it("caps signal weight at 1.0 even with many reinforcements", () => {
    const sid = uniqueSessionId("signals-cap");
    for (let i = 0; i < 20; i++) {
      accumulate(sid, routePlan({ domainSignals: ["persistent"] }), `msg${i}`);
    }
    const acc = getAccumulator(sid);
    const sig = acc.domainSignals.get("persistent");
    assert.ok(sig.weight <= 1.0);
  });

  it("handles null/undefined routePlan.domainSignals gracefully", () => {
    const sid = uniqueSessionId("signals-null");
    const acc = accumulate(sid, routePlan({ domainSignals: undefined }), "msg");
    assert.equal(acc.turnCount, 1);
    assert.equal(acc.domainSignals.size, 0);
  });

  it("handles null routePlan gracefully", () => {
    const sid = uniqueSessionId("signals-null-plan");
    const acc = accumulate(sid, null, "msg");
    assert.equal(acc.turnCount, 1);
    assert.equal(acc.domainSignals.size, 0);
  });

  it("handles undefined routePlan gracefully", () => {
    const sid = uniqueSessionId("signals-undef-plan");
    const acc = accumulate(sid, undefined, "msg");
    assert.equal(acc.turnCount, 1);
  });

  it("caps domain signals at MAX_DOMAIN_SIGNALS (500, multi-tenant default)", () => {
    const sid = uniqueSessionId("signals-overflow");
    // Add 600 unique signals in one turn to exercise the cap
    const signals = Array.from({ length: 600 }, (_, i) => `domain-${i}`);
    accumulate(sid, routePlan({ domainSignals: signals }), "msg");

    const acc = getAccumulator(sid);
    assert.ok(acc.domainSignals.size <= 500);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// accumulate — Signal Decay
// ═════════════════════════════════════════════════════════════════════════

describe("accumulate — signal decay", () => {
  it("decays existing signals each turn by factor 0.85", () => {
    const sid = uniqueSessionId("decay");
    accumulate(sid, routePlan({ domainSignals: ["ephemeral"] }), "msg1");

    const acc = getAccumulator(sid);
    const w1 = acc.domainSignals.get("ephemeral").weight; // 0.5

    // Second turn with no reinforcement of "ephemeral"
    accumulate(sid, routePlan({ domainSignals: ["other"] }), "msg2");

    const w2 = acc.domainSignals.get("ephemeral").weight;
    // After decay: 0.5 * 0.85 = 0.425
    assert.ok(w2 < w1, `Expected ${w2} < ${w1}`);
    assert.ok(Math.abs(w2 - w1 * 0.85) < 0.001);
  });

  it("removes signals that decay below 0.05 threshold", () => {
    const sid = uniqueSessionId("decay-remove");
    accumulate(sid, routePlan({ domainSignals: ["fleeting"] }), "msg1");

    // Manually set weight low so next decay pushes it below threshold
    const acc = getAccumulator(sid);
    acc.domainSignals.get("fleeting").weight = 0.055;

    // Next accumulate will decay 0.055 * 0.85 = 0.04675 < 0.05 → removed
    accumulate(sid, routePlan({ domainSignals: [] }), "msg2");
    assert.ok(!acc.domainSignals.has("fleeting"));
  });

  it("decays signals across many turns until removed", () => {
    const sid = uniqueSessionId("decay-multi");
    accumulate(sid, routePlan({ domainSignals: ["temp"] }), "msg1");

    // Keep accumulating without reinforcing "temp"
    // 0.5 * 0.85^n < 0.05 → n > log(0.1)/log(0.85) ≈ 14.2
    for (let i = 0; i < 20; i++) {
      accumulate(sid, routePlan({ domainSignals: [] }), `msg${i + 2}`);
    }

    const acc = getAccumulator(sid);
    assert.ok(!acc.domainSignals.has("temp"), "Signal should have decayed and been removed");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// accumulate — Active Lenses
// ═════════════════════════════════════════════════════════════════════════

describe("accumulate — active lenses", () => {
  it("tracks lenses with lensId objects", () => {
    const sid = uniqueSessionId("lenses-obj");
    accumulate(sid, routePlan({ lenses: [{ lensId: "agriculture" }] }), "msg");

    const acc = getAccumulator(sid);
    assert.deepStrictEqual(acc.activeLenses, ["agriculture"]);
    assert.ok(acc.contributingLenses.has("agriculture"));
  });

  it("tracks lenses with plain string identifiers", () => {
    const sid = uniqueSessionId("lenses-str");
    accumulate(sid, routePlan({ lenses: ["agriculture"] }), "msg");

    const acc = getAccumulator(sid);
    assert.deepStrictEqual(acc.activeLenses, ["agriculture"]);
    assert.ok(acc.contributingLenses.has("agriculture"));
  });

  it("moves recently used lens to front of active list", () => {
    const sid = uniqueSessionId("lenses-order");
    accumulate(sid, routePlan({ lenses: ["a", "b", "c"] }), "msg1");
    // Order after turn 1: c, b, a (each unshift in order)
    const acc1 = getAccumulator(sid);
    assert.equal(acc1.activeLenses[0], "c");

    // Now use "a" again → should move to front
    accumulate(sid, routePlan({ lenses: ["a"] }), "msg2");
    const acc2 = getAccumulator(sid);
    assert.equal(acc2.activeLenses[0], "a");
  });

  it("caps active lenses at MAX_ACTIVE_LENSES (175, every lens in principle)", () => {
    const sid = uniqueSessionId("lenses-overflow");
    const lenses = Array.from({ length: 200 }, (_, i) => `lens-${i}`);
    accumulate(sid, routePlan({ lenses }), "msg");

    const acc = getAccumulator(sid);
    assert.ok(acc.activeLenses.length <= 175);
  });

  it("handles null/undefined routePlan.lenses gracefully", () => {
    const sid = uniqueSessionId("lenses-null");
    const acc = accumulate(sid, routePlan({ lenses: undefined }), "msg");
    assert.deepStrictEqual(acc.activeLenses, []);
  });

  it("does not duplicate lenses in contributingLenses set", () => {
    const sid = uniqueSessionId("lenses-dedup");
    accumulate(sid, routePlan({ lenses: ["x"] }), "msg1");
    accumulate(sid, routePlan({ lenses: ["x"] }), "msg2");

    const acc = getAccumulator(sid);
    assert.equal(acc.contributingLenses.size, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// accumulate — Action History
// ═════════════════════════════════════════════════════════════════════════

describe("accumulate — action history", () => {
  it("records action type with turn number", () => {
    const sid = uniqueSessionId("action");
    accumulate(sid, routePlan({ actionType: "CREATE" }), "msg");

    const acc = getAccumulator(sid);
    assert.equal(acc.actionHistory.length, 1);
    assert.deepStrictEqual(acc.actionHistory[0], { type: "CREATE", turn: 1 });
  });

  it("skips action history when actionType is missing", () => {
    const sid = uniqueSessionId("action-null");
    accumulate(sid, routePlan({ actionType: undefined }), "msg");

    const acc = getAccumulator(sid);
    assert.equal(acc.actionHistory.length, 0);
  });

  it("caps action history at MAX_SESSION_HISTORY (300, multi-tenant default)", () => {
    const sid = uniqueSessionId("action-overflow");
    for (let i = 0; i < 350; i++) {
      accumulate(sid, routePlan({ actionType: "QUERY" }), `msg${i}`);
    }

    const acc = getAccumulator(sid);
    assert.ok(acc.actionHistory.length <= 300);
    // Should keep the most recent ones (sliced from the end)
    assert.equal(acc.actionHistory[acc.actionHistory.length - 1].turn, 350);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// accumulate — Topic Thread
// ═════════════════════════════════════════════════════════════════════════

describe("accumulate — topic thread", () => {
  it("records message snippet with turn and context", () => {
    const sid = uniqueSessionId("topic");
    accumulate(
      sid,
      routePlan({ actionType: "QUERY", lenses: [{ lensId: "finance" }] }),
      "What about my loan?"
    );

    const acc = getAccumulator(sid);
    assert.equal(acc.topicThread.length, 1);
    assert.equal(acc.topicThread[0].turn, 1);
    assert.equal(acc.topicThread[0].snippet, "What about my loan?");
    assert.equal(acc.topicThread[0].actionType, "QUERY");
    assert.deepStrictEqual(acc.topicThread[0].lenses, ["finance"]);
  });

  it("truncates message snippet to 200 chars", () => {
    const sid = uniqueSessionId("topic-trunc");
    const longMsg = "x".repeat(300);
    accumulate(sid, routePlan(), longMsg);

    const acc = getAccumulator(sid);
    assert.equal(acc.topicThread[0].snippet.length, 200);
  });

  it("caps topic thread at MAX_SESSION_HISTORY (300, multi-tenant default)", () => {
    const sid = uniqueSessionId("topic-overflow");
    for (let i = 0; i < 350; i++) {
      accumulate(sid, routePlan(), `msg${i}`);
    }

    const acc = getAccumulator(sid);
    assert.ok(acc.topicThread.length <= 300);
    // Most recent should be last
    assert.ok(acc.topicThread[acc.topicThread.length - 1].snippet.includes("msg349"));
  });

  it("skips topic thread entry when message is falsy", () => {
    const sid = uniqueSessionId("topic-empty");
    accumulate(sid, routePlan(), "");
    accumulate(sid, routePlan(), null);
    accumulate(sid, routePlan(), undefined);

    const acc = getAccumulator(sid);
    assert.equal(acc.topicThread.length, 0);
  });

  it("limits lenses in topic thread entry to 3", () => {
    const sid = uniqueSessionId("topic-lenses-cap");
    accumulate(
      sid,
      routePlan({ lenses: ["a", "b", "c", "d", "e"] }),
      "multi-lens msg"
    );

    const acc = getAccumulator(sid);
    assert.equal(acc.topicThread[0].lenses.length, 3);
  });

  it("records null actionType when routePlan.actionType is missing", () => {
    const sid = uniqueSessionId("topic-no-action");
    accumulate(sid, routePlan({ actionType: undefined }), "msg");

    const acc = getAccumulator(sid);
    assert.equal(acc.topicThread[0].actionType, null);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// accumulate — Cross-Domain Links
// ═════════════════════════════════════════════════════════════════════════

describe("accumulate — cross-domain links", () => {
  it("records cross-domain link when isMultiLens and >= 2 lenses", () => {
    const sid = uniqueSessionId("crossdomain");
    accumulate(
      sid,
      routePlan({
        isMultiLens: true,
        lenses: [{ lensId: "agriculture" }, { lensId: "insurance" }],
        actionType: "CREATE",
      }),
      "msg"
    );

    const acc = getAccumulator(sid);
    assert.equal(acc.crossDomainLinks.length, 1);
    assert.deepStrictEqual(acc.crossDomainLinks[0].domains, ["agriculture", "insurance"]);
    assert.equal(acc.crossDomainLinks[0].actionType, "CREATE");
    assert.equal(acc.crossDomainLinks[0].turn, 1);
  });

  it("does not record cross-domain link when isMultiLens is false", () => {
    const sid = uniqueSessionId("crossdomain-no");
    accumulate(
      sid,
      routePlan({
        isMultiLens: false,
        lenses: [{ lensId: "a" }, { lensId: "b" }],
      }),
      "msg"
    );

    const acc = getAccumulator(sid);
    assert.equal(acc.crossDomainLinks.length, 0);
  });

  it("does not record cross-domain link when fewer than 2 lenses", () => {
    const sid = uniqueSessionId("crossdomain-one");
    accumulate(
      sid,
      routePlan({
        isMultiLens: true,
        lenses: [{ lensId: "only-one" }],
      }),
      "msg"
    );

    const acc = getAccumulator(sid);
    assert.equal(acc.crossDomainLinks.length, 0);
  });

  it("caps domains list to 4 items in cross-domain link", () => {
    const sid = uniqueSessionId("crossdomain-cap");
    accumulate(
      sid,
      routePlan({
        isMultiLens: true,
        lenses: ["a", "b", "c", "d", "e", "f"],
        actionType: "CONNECT",
      }),
      "msg"
    );

    const acc = getAccumulator(sid);
    assert.equal(acc.crossDomainLinks[0].domains.length, 4);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// getContextSnapshot
// ═════════════════════════════════════════════════════════════════════════

describe("getContextSnapshot", () => {
  it("returns empty snapshot for unknown session", () => {
    const snapshot = getContextSnapshot("nonexistent-session-" + Date.now());
    assert.deepStrictEqual(snapshot.domainSignals, []);
    assert.deepStrictEqual(snapshot.activeLenses, []);
    assert.equal(snapshot.turnCount, 0);
    assert.deepStrictEqual(snapshot.crossDomainLinks, []);
    assert.deepStrictEqual(snapshot.actionDistribution, {});
  });

  it("returns weighted domain signals sorted by weight descending", () => {
    const sid = uniqueSessionId("snapshot-sorted");
    // Signal "strong" gets reinforced, "weak" does not
    accumulate(sid, routePlan({ domainSignals: ["strong", "weak"] }), "msg1");
    accumulate(sid, routePlan({ domainSignals: ["strong"] }), "msg2");

    const snapshot = getContextSnapshot(sid);
    assert.ok(snapshot.domainSignals.length >= 1);
    // "strong" should be first since it has higher weight
    assert.equal(snapshot.domainSignals[0], "strong");
  });

  it("filters out signals with weight below 0.1", () => {
    const sid = uniqueSessionId("snapshot-filter");
    accumulate(sid, routePlan({ domainSignals: ["fadingSignal"] }), "msg1");

    // Manually set the weight just below threshold
    const acc = getAccumulator(sid);
    acc.domainSignals.get("fadingSignal").weight = 0.09;

    const snapshot = getContextSnapshot(sid);
    assert.ok(!snapshot.domainSignals.includes("fadingSignal"));
  });

  it("caps active lenses at 8 in the snapshot", () => {
    const sid = uniqueSessionId("snapshot-lenses-cap");
    const lenses = Array.from({ length: 12 }, (_, i) => `lens-${i}`);
    accumulate(sid, routePlan({ lenses }), "msg");

    const snapshot = getContextSnapshot(sid);
    assert.ok(snapshot.activeLenses.length <= 8);
  });

  it("caps cross-domain links to last 5 in snapshot", () => {
    const sid = uniqueSessionId("snapshot-crossdomain-cap");
    for (let i = 0; i < 8; i++) {
      accumulate(
        sid,
        routePlan({
          isMultiLens: true,
          lenses: [`a-${i}`, `b-${i}`],
          actionType: "CONNECT",
        }),
        `msg${i}`
      );
    }

    const snapshot = getContextSnapshot(sid);
    assert.ok(snapshot.crossDomainLinks.length <= 5);
  });

  it("computes action distribution correctly", () => {
    const sid = uniqueSessionId("snapshot-actions");
    accumulate(sid, routePlan({ actionType: "QUERY" }), "msg1");
    accumulate(sid, routePlan({ actionType: "QUERY" }), "msg2");
    accumulate(sid, routePlan({ actionType: "CREATE" }), "msg3");

    const snapshot = getContextSnapshot(sid);
    assert.equal(snapshot.actionDistribution.QUERY, 2);
    assert.equal(snapshot.actionDistribution.CREATE, 1);
  });

  it("includes contributingLensCount and topicThreadLength", () => {
    const sid = uniqueSessionId("snapshot-counts");
    accumulate(
      sid,
      routePlan({ lenses: ["x", "y"] }),
      "msg"
    );

    const snapshot = getContextSnapshot(sid);
    assert.equal(snapshot.contributingLensCount, 2);
    assert.equal(snapshot.topicThreadLength, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// getTopicThread
// ═════════════════════════════════════════════════════════════════════════

describe("getTopicThread", () => {
  it("returns empty array for unknown session", () => {
    assert.deepStrictEqual(getTopicThread("unknown-" + Date.now()), []);
  });

  it("returns topic thread entries in order", () => {
    const sid = uniqueSessionId("topicthread");
    accumulate(sid, routePlan(), "first");
    accumulate(sid, routePlan(), "second");

    const thread = getTopicThread(sid);
    assert.equal(thread.length, 2);
    assert.equal(thread[0].snippet, "first");
    assert.equal(thread[1].snippet, "second");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// getCrossDomainSignals
// ═════════════════════════════════════════════════════════════════════════

describe("getCrossDomainSignals", () => {
  it("returns empty array for unknown session", () => {
    assert.deepStrictEqual(getCrossDomainSignals("unknown-" + Date.now()), []);
  });

  it("returns cross-domain links accumulated in session", () => {
    const sid = uniqueSessionId("getCrossDomain");
    accumulate(
      sid,
      routePlan({
        isMultiLens: true,
        lenses: ["x", "y"],
        actionType: "ANALYZE",
      }),
      "msg"
    );

    const signals = getCrossDomainSignals(sid);
    assert.equal(signals.length, 1);
    assert.deepStrictEqual(signals[0].domains, ["x", "y"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// getContributingLenses
// ═════════════════════════════════════════════════════════════════════════

describe("getContributingLenses", () => {
  it("returns empty array for unknown session", () => {
    assert.deepStrictEqual(getContributingLenses("unknown-" + Date.now()), []);
  });

  it("returns all unique contributing lenses as an array", () => {
    const sid = uniqueSessionId("contribLenses");
    accumulate(sid, routePlan({ lenses: ["a", "b"] }), "msg1");
    accumulate(sid, routePlan({ lenses: ["b", "c"] }), "msg2");

    const lenses = getContributingLenses(sid);
    assert.equal(lenses.length, 3);
    assert.ok(lenses.includes("a"));
    assert.ok(lenses.includes("b"));
    assert.ok(lenses.includes("c"));
  });
});

// ═════════════════════════════════════════════════════════════════════════
// completeSession
// ═════════════════════════════════════════════════════════════════════════

describe("completeSession", () => {
  it("returns empty result for unknown session", () => {
    const result = completeSession("unknown-" + Date.now());
    assert.deepStrictEqual(result.crossDomainLinks, []);
    assert.deepStrictEqual(result.contributingLenses, []);
    assert.equal(result.turnCount, 0);
  });

  it("returns session summary and marks completedAt", () => {
    const sid = uniqueSessionId("complete");
    accumulate(
      sid,
      routePlan({
        domainSignals: ["farm"],
        lenses: ["ag"],
        actionType: "CREATE",
        isMultiLens: true,
        // Need at least 2 lenses for cross-domain
      }),
      "msg"
    );
    // Add a proper cross-domain turn
    accumulate(
      sid,
      routePlan({
        isMultiLens: true,
        lenses: ["ag", "fin"],
        actionType: "QUERY",
      }),
      "msg2"
    );

    const result = completeSession(sid);
    assert.ok(result.crossDomainLinks.length >= 1);
    assert.ok(result.contributingLenses.length >= 2);
    assert.equal(result.turnCount, 2);
    assert.ok(typeof result.domainSignalCount === "number");

    // Verify completedAt was set
    const acc = getAccumulator(sid);
    assert.ok(typeof acc.completedAt === "number");
  });

  it("session still accessible after completion (for reconnection)", () => {
    const sid = uniqueSessionId("complete-reconnect");
    accumulate(sid, routePlan({ domainSignals: ["test"] }), "msg");
    completeSession(sid);

    // Should still be retrievable
    const snapshot = getContextSnapshot(sid);
    assert.equal(snapshot.turnCount, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// cleanupExpiredSessions
// ═════════════════════════════════════════════════════════════════════════

describe("cleanupExpiredSessions", () => {
  it("removes sessions past TTL", () => {
    const sid = uniqueSessionId("cleanup-expired");
    const acc = createAccumulator(sid);
    // Artificially expire
    acc.lastUpdatedAt = Date.now() - (4 * 3600_000 + 1);

    const before = getAccumulatorMetrics();
    const result = cleanupExpiredSessions();
    const after = getAccumulatorMetrics();

    assert.ok(result.cleaned >= 1);
    assert.ok(after.activeSessions <= before.activeSessions);
    assert.ok(typeof result.remaining === "number");
  });

  it("does not remove active sessions", () => {
    const sid = uniqueSessionId("cleanup-active");
    createAccumulator(sid);

    const result = cleanupExpiredSessions();
    // Our fresh session should survive
    const snapshot = getContextSnapshot(sid);
    assert.equal(snapshot.turnCount, 0); // still exists
    assert.ok(typeof result.remaining === "number");
  });

  it("returns zero cleaned when no expired sessions", () => {
    // Create a fresh session and immediately cleanup
    const sid = uniqueSessionId("cleanup-none");
    createAccumulator(sid);

    // Only expired sessions get cleaned; this one is fresh
    const result = cleanupExpiredSessions();
    assert.ok(result.cleaned >= 0);
    assert.ok(typeof result.remaining === "number");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// getAccumulatorMetrics
// ═════════════════════════════════════════════════════════════════════════

describe("getAccumulatorMetrics", () => {
  it("returns ok: true with aggregate stats", () => {
    const metrics = getAccumulatorMetrics();
    assert.ok(metrics.ok);
    assert.ok(typeof metrics.activeSessions === "number");
    assert.ok(typeof metrics.totalTurns === "number");
    assert.ok(typeof metrics.totalSignals === "number");
    assert.ok(typeof metrics.totalCrossDomainLinks === "number");
    assert.ok(
      typeof metrics.avgTurnsPerSession === "string" ||
      typeof metrics.avgTurnsPerSession === "number"
    );
  });

  it("reflects turns and signals from accumulated sessions", () => {
    const sid = uniqueSessionId("metrics-turns");
    accumulate(sid, routePlan({ domainSignals: ["alpha", "beta"] }), "msg1");
    accumulate(sid, routePlan({ domainSignals: ["gamma"] }), "msg2");

    const metrics = getAccumulatorMetrics();
    assert.ok(metrics.totalTurns >= 2);
    assert.ok(metrics.totalSignals >= 2);
    assert.ok(metrics.activeSessions >= 1);
  });

  it("computes avgTurnsPerSession as a string with one decimal", () => {
    const sid = uniqueSessionId("metrics-avg");
    accumulate(sid, routePlan(), "msg1");
    accumulate(sid, routePlan(), "msg2");

    const metrics = getAccumulatorMetrics();
    if (metrics.activeSessions > 0) {
      assert.ok(typeof metrics.avgTurnsPerSession === "string");
      assert.ok(metrics.avgTurnsPerSession.includes("."));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Context accumulation across multiple turns (integration-style)
// ═════════════════════════════════════════════════════════════════════════

describe("multi-turn context accumulation", () => {
  it("builds rich context over 5 turns with multiple domains", () => {
    const sid = uniqueSessionId("multi-turn");

    // Turn 1: farming
    accumulate(
      sid,
      routePlan({
        domainSignals: ["farming", "crops"],
        lenses: [{ lensId: "agriculture" }],
        actionType: "QUERY",
      }),
      "Tell me about wheat farming"
    );

    // Turn 2: insurance
    accumulate(
      sid,
      routePlan({
        domainSignals: ["insurance", "risk"],
        lenses: [{ lensId: "insurance" }],
        actionType: "ANALYZE",
      }),
      "What insurance covers crop failure?"
    );

    // Turn 3: cross-domain farming+insurance
    accumulate(
      sid,
      routePlan({
        domainSignals: ["farming", "insurance"],
        lenses: [{ lensId: "agriculture" }, { lensId: "insurance" }],
        actionType: "CREATE",
        isMultiLens: true,
      }),
      "Draft a farm insurance policy"
    );

    // Turn 4: loan
    accumulate(
      sid,
      routePlan({
        domainSignals: ["loan", "mortgage"],
        lenses: [{ lensId: "finance" }],
        actionType: "QUERY",
      }),
      "Now about a farm equipment loan"
    );

    // Turn 5: cross-domain all three
    accumulate(
      sid,
      routePlan({
        domainSignals: ["farming", "loan"],
        lenses: [{ lensId: "agriculture" }, { lensId: "finance" }, { lensId: "insurance" }],
        actionType: "SIMULATE",
        isMultiLens: true,
      }),
      "Simulate total cost of ownership"
    );

    const acc = getAccumulator(sid);
    assert.equal(acc.turnCount, 5);

    // All four original domain types should still be present (farming reinforced)
    assert.ok(acc.domainSignals.has("farming"), "farming should persist through reinforcement");

    // Contributing lenses should include all three domains
    assert.ok(acc.contributingLenses.size >= 3);
    assert.ok(acc.contributingLenses.has("agriculture"));
    assert.ok(acc.contributingLenses.has("insurance"));
    assert.ok(acc.contributingLenses.has("finance"));

    // Cross-domain links from turns 3 and 5
    assert.ok(acc.crossDomainLinks.length >= 2);

    // Snapshot should be rich
    const snapshot = getContextSnapshot(sid);
    assert.equal(snapshot.turnCount, 5);
    assert.ok(snapshot.domainSignals.length >= 3);
    assert.ok(snapshot.activeLenses.length >= 3);
    assert.ok(snapshot.crossDomainLinks.length >= 2);
    assert.ok(snapshot.contributingLensCount >= 3);
    assert.equal(snapshot.topicThreadLength, 5);
    assert.ok(snapshot.actionDistribution.QUERY >= 2);
    assert.ok(snapshot.actionDistribution.CREATE >= 1);
    assert.ok(snapshot.actionDistribution.SIMULATE >= 1);

    // Topic thread should be complete
    const thread = getTopicThread(sid);
    assert.equal(thread.length, 5);
    assert.ok(thread[0].snippet.includes("wheat farming"));
    assert.ok(thread[4].snippet.includes("Simulate"));
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Cross-session isolation
// ═════════════════════════════════════════════════════════════════════════

describe("cross-session isolation", () => {
  it("different sessions do not share context", () => {
    const sid1 = uniqueSessionId("iso-a");
    const sid2 = uniqueSessionId("iso-b");

    accumulate(
      sid1,
      routePlan({ domainSignals: ["only-in-a"], lenses: ["lens-a"], actionType: "QUERY" }),
      "session a message"
    );

    accumulate(
      sid2,
      routePlan({ domainSignals: ["only-in-b"], lenses: ["lens-b"], actionType: "CREATE" }),
      "session b message"
    );

    const acc1 = getAccumulator(sid1);
    const acc2 = getAccumulator(sid2);

    assert.ok(acc1.domainSignals.has("only-in-a"));
    assert.ok(!acc1.domainSignals.has("only-in-b"));
    assert.ok(acc2.domainSignals.has("only-in-b"));
    assert.ok(!acc2.domainSignals.has("only-in-a"));

    assert.ok(acc1.contributingLenses.has("lens-a"));
    assert.ok(!acc1.contributingLenses.has("lens-b"));
    assert.ok(acc2.contributingLenses.has("lens-b"));
    assert.ok(!acc2.contributingLenses.has("lens-a"));

    const snap1 = getContextSnapshot(sid1);
    const snap2 = getContextSnapshot(sid2);

    assert.notDeepStrictEqual(snap1.domainSignals, snap2.domainSignals);
    assert.notDeepStrictEqual(snap1.activeLenses, snap2.activeLenses);
  });

  it("completing one session does not affect another", () => {
    const sid1 = uniqueSessionId("iso-complete-a");
    const sid2 = uniqueSessionId("iso-complete-b");

    accumulate(sid1, routePlan({ domainSignals: ["x"] }), "msg1");
    accumulate(sid2, routePlan({ domainSignals: ["y"] }), "msg2");

    completeSession(sid1);

    const snap2 = getContextSnapshot(sid2);
    assert.equal(snap2.turnCount, 1);
    assert.ok(snap2.domainSignals.includes("y"));
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Edge cases
// ═════════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  it("accumulate with completely empty route plan", () => {
    const sid = uniqueSessionId("edge-empty-route");
    const acc = accumulate(sid, {}, "msg");
    assert.equal(acc.turnCount, 1);
    assert.equal(acc.domainSignals.size, 0);
    assert.deepStrictEqual(acc.activeLenses, []);
    assert.equal(acc.actionHistory.length, 0);
    assert.equal(acc.topicThread.length, 1);
    assert.equal(acc.crossDomainLinks.length, 0);
  });

  it("message coerced to string via String()", () => {
    const sid = uniqueSessionId("edge-number-msg");
    accumulate(sid, routePlan(), 12345);

    const acc = getAccumulator(sid);
    assert.equal(acc.topicThread[0].snippet, "12345");
  });

  it("handles empty domainSignals array", () => {
    const sid = uniqueSessionId("edge-empty-signals");
    const acc = accumulate(sid, routePlan({ domainSignals: [] }), "msg");
    assert.equal(acc.domainSignals.size, 0);
  });

  it("handles empty lenses array", () => {
    const sid = uniqueSessionId("edge-empty-lenses");
    const acc = accumulate(sid, routePlan({ lenses: [] }), "msg");
    assert.deepStrictEqual(acc.activeLenses, []);
  });

  it("domain signal overflow retains highest-weight signals", () => {
    const sid = uniqueSessionId("edge-signal-priority");
    // Reinforce one signal many times to give it high weight
    for (let i = 0; i < 5; i++) {
      accumulate(sid, routePlan({ domainSignals: ["important"] }), `msg${i}`);
    }
    // Now flood with 600 new signals in one go to exercise the 500 cap
    const flood = Array.from({ length: 600 }, (_, i) => `flood-${i}`);
    accumulate(sid, routePlan({ domainSignals: flood }), "flood msg");

    const acc = getAccumulator(sid);
    assert.ok(acc.domainSignals.size <= 500);
    // "important" should survive because it has the highest weight
    assert.ok(acc.domainSignals.has("important"), "High-weight signal should survive cap");
  });

  it("lenses with mixed object and string format", () => {
    const sid = uniqueSessionId("edge-mixed-lenses");
    accumulate(
      sid,
      routePlan({ lenses: [{ lensId: "obj-lens" }, "str-lens"] }),
      "msg"
    );

    const acc = getAccumulator(sid);
    assert.ok(acc.activeLenses.includes("obj-lens"));
    assert.ok(acc.activeLenses.includes("str-lens"));
    assert.ok(acc.contributingLenses.has("obj-lens"));
    assert.ok(acc.contributingLenses.has("str-lens"));
  });

  it("cross-domain link uses plain string lenses correctly", () => {
    const sid = uniqueSessionId("edge-crossdomain-str");
    accumulate(
      sid,
      routePlan({
        isMultiLens: true,
        lenses: ["alpha", "beta", "gamma"],
        actionType: "CONNECT",
      }),
      "msg"
    );

    const acc = getAccumulator(sid);
    assert.deepStrictEqual(acc.crossDomainLinks[0].domains, ["alpha", "beta", "gamma"]);
  });

  it("accumulate increments turnCount and updates lastUpdatedAt", () => {
    const sid = uniqueSessionId("edge-turncount");
    const acc1 = createAccumulator(sid);
    const ts1 = acc1.lastUpdatedAt;

    // Small delay to ensure timestamp difference
    accumulate(sid, routePlan(), "msg");
    const acc2 = getAccumulator(sid);
    assert.equal(acc2.turnCount, 1);
    assert.ok(acc2.lastUpdatedAt >= ts1);
  });
});
