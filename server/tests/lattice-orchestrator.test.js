/**
 * Tier-2 contract tests for Layer 12: lattice orchestrator.
 *
 * The orchestrator wires four already-built emergent engines into the
 * heartbeat-registry: drift-monitor (contradiction detection),
 * breakthrough-clusters (cross-domain synthesis), cnet-federation
 * (peer-discovery + DTU-flow), and routes drift findings into hlr-engine
 * (multi-mode reasoning).
 *
 * Each handler must:
 *   - return { ok: true|false } never throw
 *   - report a `reason` when ok=false
 *   - tolerate missing dependencies (modules unavailable, STATE missing,
 *     no clusters, no subscriptions)
 *
 * Run: node --test tests/lattice-orchestrator.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  initLatticeOrchestrator,
  runPeriodicDriftScan,
  runBreakthroughResearchPass,
  runFederationPoll,
} from "../emergent/lattice-orchestrator.js";

describe("runPeriodicDriftScan: lifecycle", () => {
  it("returns { ok:false, reason:'state_not_initialised' } before init", async () => {
    initLatticeOrchestrator(null);
    const r = await runPeriodicDriftScan({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "state_not_initialised");
  });

  it("returns ok with scan payload after init (no throw)", async () => {
    // Minimal STATE shape that drift-monitor can read.
    const STATE = {
      dtus: new Map(),
      sessions: new Map(),
      _startedAt: Date.now(),
    };
    initLatticeOrchestrator(STATE);
    const r = await runPeriodicDriftScan({});
    // Either ok:true with scan, or ok:false with a reason — never a throw.
    assert.ok(typeof r === "object" && r !== null);
    assert.ok(typeof r.ok === "boolean");
    if (!r.ok) assert.ok(typeof r.reason === "string");
  });
});

describe("runBreakthroughResearchPass: lifecycle", () => {
  it("returns ok with cluster count (zero-tolerant)", async () => {
    const r = await runBreakthroughResearchPass({});
    assert.ok(typeof r === "object" && r !== null);
    assert.ok(typeof r.ok === "boolean");
    if (r.ok) {
      assert.ok(typeof r.clusters === "number");
      assert.ok(typeof r.advanced === "number");
      assert.ok(r.advanced <= r.clusters);
    } else {
      assert.ok(typeof r.reason === "string");
    }
  });

  it("never throws on empty cluster set", async () => {
    // The handler should handle zero clusters gracefully — either by
    // returning { ok: true, clusters: 0 } or by a reason. The failure mode
    // we're guarding against is an uncaught throw.
    let threw = false;
    try {
      await runBreakthroughResearchPass({});
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
  });
});

describe("runFederationPoll: lifecycle", () => {
  it("returns ok or reason without throwing", async () => {
    const r = await runFederationPoll({});
    assert.ok(typeof r === "object" && r !== null);
    assert.ok(typeof r.ok === "boolean");
    // ok=true: poll happened (received[], autoIngested, maybe reason='no_subscriptions')
    // ok=false: federation_unavailable | no_pollGlobal | poll_threw
    // Federation pollGlobal uses `error` for its own failure modes;
    // orchestrator wraps with `reason` for ours. Either is acceptable.
    if (!r.ok) {
      const hasShape = typeof r.reason === "string" || typeof r.error === "string";
      assert.ok(hasShape, "expected reason or error on failure");
    }
  });

  it("never throws", async () => {
    let threw = false;
    try { await runFederationPoll({}); }
    catch { threw = true; }
    assert.equal(threw, false);
  });
});

describe("initLatticeOrchestrator: idempotent", () => {
  it("can be called multiple times without error", () => {
    const STATE_A = { dtus: new Map(), sessions: new Map() };
    const STATE_B = { dtus: new Map(), sessions: new Map() };
    initLatticeOrchestrator(STATE_A);
    initLatticeOrchestrator(STATE_B);
    initLatticeOrchestrator(null);
    initLatticeOrchestrator(STATE_A);
    // Should not throw and should leave the orchestrator with whatever
    // was passed last.
    assert.ok(true);
  });
});

describe("Layer 12 invariant: handlers have heartbeat-compatible signature", () => {
  it("each handler accepts ({ db, state, tickCount }) and returns a plain object", async () => {
    initLatticeOrchestrator({ dtus: new Map(), sessions: new Map() });

    const a = await runPeriodicDriftScan({ db: null, state: {}, tickCount: 0 });
    const b = await runBreakthroughResearchPass({ db: null, state: {}, tickCount: 0 });
    const c = await runFederationPoll({ db: null, state: {}, tickCount: 0 });

    for (const r of [a, b, c]) {
      assert.ok(typeof r === "object" && r !== null);
      assert.ok(typeof r.ok === "boolean");
    }
  });
});

// Regression: the drift→HLR resolution path (lattice-orchestrator.js ~line 102)
// was a DEAD CALLER for months — runHLR returned {ok:false} on every drift alert
// because the call (1) passed an `input` field (runHLR reads `topic`/`question`),
// (2) used mode "constraint_check" (not a valid REASONING_MODES value), and
// (3) read the synthesised conclusion from `r.output.synthesizedConclusion`
// (it's returned at the TOP LEVEL). This pins the corrected contract the
// orchestrator now depends on so the path can't silently die again.
describe("Layer 12 regression: drift→HLR resolution call is live (not a dead caller)", () => {
  it("runHLR with the orchestrator's corrected args returns ok:true + real conclusions", async () => {
    const { runHLR } = await import("../emergent/hlr-engine.js");
    const r = runHLR({
      question: "Drift alert: goodhart. Metric divergence — does this violate the system's invariants?",
      mode: "deductive",
      tags: ["drift_resolution"],
    });
    assert.equal(r.ok, true, "corrected call must succeed");
    assert.ok(Array.isArray(r.chains) && r.chains.length >= 1, "must produce reasoning chains");
    assert.ok(r.chains.some((c) => c.conclusion), "chains carry conclusions the orchestrator collects");
    assert.ok(r.synthesizedConclusion, "synthesizedConclusion is TOP-LEVEL (not under r.output)");
    assert.equal(r.output, undefined, "there is no r.output — reading r.output.* was the bug");
  });

  it("the OLD broken shapes each fail (proving the bug was real)", async () => {
    const { runHLR } = await import("../emergent/hlr-engine.js");
    // Wrong field name: `input` instead of topic/question.
    const wrongField = runHLR({ input: "Drift alert: goodhart", mode: "deductive" });
    assert.equal(wrongField.ok, false);
    assert.equal(wrongField.error, "topic_or_question_required");
    // Invalid mode: constraint_check is not a REASONING_MODES value.
    const badMode = runHLR({ question: "Drift alert: goodhart", mode: "constraint_check" });
    assert.equal(badMode.ok, false);
    assert.equal(badMode.error, "invalid_mode");
  });
});
