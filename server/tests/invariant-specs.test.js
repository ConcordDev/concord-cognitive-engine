// server/tests/invariant-specs.test.js
//
// Bidirectional validation of the money-invariant models in
// server/lib/verification/invariant-specs.js, run through the bounded
// model checker (server/lib/verification/model-checker.js).
//
// The single most important test in this file is the double-credit one:
// it defines the deliberately-wrong balance predicate this repo actually
// shipped (summing every row with a to_user_id, instead of excluding the
// redundant debit-half row per CREDIT_ROW_PREDICATE), proves the checker
// catches it with a real counterexample trace, and proves that trace
// replays to reproduce the exact violation.
//
// Run WITHOUT --test-force-exit.
//   node --test server/tests/invariant-specs.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkModel, replayTrace } from "../lib/verification/model-checker.js";
import {
  buildLedgerConservationModel,
  buildTreasuryInvariantModel,
  buildRoyaltyCascadeModel,
  correctCreditPredicate,
  buggyCreditPredicateDoubleCounts,
} from "../lib/verification/invariant-specs.js";

describe("invariant-specs: ledger conservation — double-credit bug (CATCH direction)", () => {
  it("catches the deliberately reintroduced double-credit bug with a concrete counterexample trace", () => {
    const model = buildLedgerConservationModel({ creditPredicate: buggyCreditPredicateDoubleCounts });
    const result = checkModel(model, { maxStates: 5000, maxDepth: 6 });

    assert.equal(result.status, "violation", `expected a violation, got ${result.status}: ${result.note || ""}`);
    assert.equal(result.invariant, "circulating_never_exceeds_minted");

    // The counterexample must be a real action sequence that mints currency —
    // i.e. it must include at least one mint AND at least one transfer/purchase
    // action (a mint alone can never violate conservation on its own).
    assert.ok(result.trace.length > 0, "counterexample trace must not be empty");
    assert.ok(result.trace.some((a) => a.startsWith("mint(")), `trace should include a mint: ${JSON.stringify(result.trace)}`);
    assert.ok(
      result.trace.some((a) => a.startsWith("transfer(") || a.startsWith("marketplace_purchase(")),
      `trace should include a transfer/purchase: ${JSON.stringify(result.trace)}`,
    );

    // The violating state must show circulating balance strictly exceeding minted USD.
    const circulating = model._abstraction.circulating(result.state.rows);
    assert.ok(circulating > result.state.mintedUsd, `expected circulating (${circulating}) > mintedUsd (${result.state.mintedUsd})`);

    console.log("[double-credit counterexample]", JSON.stringify({ trace: result.trace, message: result.message }, null, 2));
  });

  it("counterexample trace REPLAYS to reproduce the exact violation (not a fabricated trace)", () => {
    const model = buildLedgerConservationModel({ creditPredicate: buggyCreditPredicateDoubleCounts });
    const result = checkModel(model, { maxStates: 5000, maxDepth: 6 });
    assert.equal(result.status, "violation");

    const replay = replayTrace(model, result.trace);
    assert.equal(replay.ok, true, `replay failed: ${replay.error || ""}`);
    assert.deepEqual(replay.finalState, result.state, "replayed final state must exactly match the BFS-discovered violating state");

    // Independently re-derive circulating > minted from the REPLAYED state
    // (not the BFS state) — proves the trace itself, not the checker's
    // internal bookkeeping, is what reproduces the bug.
    const circulating = model._abstraction.circulating(replay.finalState.rows);
    assert.ok(
      circulating > replay.finalState.mintedUsd,
      `replayed state should still show minted-from-nothing: circulating=${circulating} mintedUsd=${replay.finalState.mintedUsd}`,
    );
  });

  it("the minimal counterexample is exactly [mint, transfer] — two actions is enough to mint money", () => {
    // Documents the shape of the bug concretely: one mint to fund a balance,
    // one transfer, and the recipient is credited twice.
    const model = buildLedgerConservationModel({ creditPredicate: buggyCreditPredicateDoubleCounts });
    const result = checkModel(model, { maxStates: 5000, maxDepth: 6 });
    assert.equal(result.status, "violation");
    assert.equal(result.trace.length, 2, `expected the shortest violating trace to have length 2, got ${JSON.stringify(result.trace)}`);
  });
});

describe("invariant-specs: ledger conservation — correct predicate (PASS direction)", () => {
  it("passes clean (no violation) under the real CREDIT_ROW_PREDICATE semantics", () => {
    const model = buildLedgerConservationModel({ creditPredicate: correctCreditPredicate });
    const result = checkModel(model, { maxStates: 5000, maxDepth: 6 });

    assert.notEqual(result.status, "violation", `unexpected violation: ${result.message || ""}`);
    assert.notEqual(result.status, "error");
    assert.notEqual(result.status, "nondeterministic_action");
    assert.ok(
      ["no_violation_found", "state_space_exhausted", "depth_bound_reached"].includes(result.status),
      `unexpected status: ${result.status}`,
    );
  });

  it("with generous bounds, the correct predicate's model is fully (exhaustively) explored clean", () => {
    const model = buildLedgerConservationModel({ creditPredicate: correctCreditPredicate });
    const result = checkModel(model, { maxStates: 20000, maxDepth: 10 });
    assert.equal(result.status, "no_violation_found");
    assert.equal(result.exhaustive, true);
    assert.ok(result.statesExplored > 1);
  });
});

describe("invariant-specs: treasury invariant (mint/purchase/withdraw sequences)", () => {
  it("circulating <= total_usd holds at every reachable state under the correct predicate", () => {
    const model = buildTreasuryInvariantModel({ creditPredicate: correctCreditPredicate });
    const result = checkModel(model, { maxStates: 20000, maxDepth: 8 });
    assert.notEqual(result.status, "violation");
    assert.notEqual(result.status, "error");
  });

  it("the same treasury model catches the double-credit bug too (shared abstraction, shared defect)", () => {
    const model = buildTreasuryInvariantModel({ creditPredicate: buggyCreditPredicateDoubleCounts });
    const result = checkModel(model, { maxStates: 5000, maxDepth: 6 });
    assert.equal(result.status, "violation");
  });
});

describe("invariant-specs: royalty cascade — 30% cap", () => {
  it("total ancestor payout never exceeds 30% of the sale price when the cap is enforced (real behavior)", () => {
    const model = buildRoyaltyCascadeModel({ enforceCap: true, saleAmount: 1000 });
    const result = checkModel(model, { maxStates: 5000, maxDepth: 10 });
    assert.notEqual(result.status, "violation", `unexpected violation: ${result.message || ""}`);
  });

  it("catches an uncapped royalty cascade exceeding 30% via breadth (multiple direct citations), with a replayable counterexample", () => {
    // A single linear chain's geometric decay alone stays under 30% within
    // 50 generations — the cap is what actually protects against BREADTH
    // (many distinct direct citations at low generation). This model proves
    // the checker catches that scenario when cap enforcement is removed.
    const model = buildRoyaltyCascadeModel({ enforceCap: false, saleAmount: 1000 });
    const result = checkModel(model, { maxStates: 5000, maxDepth: 10 });
    assert.equal(result.status, "violation");
    assert.equal(result.invariant, "royalty_never_exceeds_cap");

    const replay = replayTrace(model, result.trace);
    assert.equal(replay.ok, true);
    assert.equal(replay.finalState.lastPayout, result.state.lastPayout);
    assert.ok(replay.finalState.lastPayout > 0.30 * replay.finalState.lastAmount + 0.02);
  });

  it("a >50-generation citation attempt is bounded (clamped), never left to loop unbounded", () => {
    // generationChoices includes 9999 (an attempted runaway/deep reference);
    // the model clamps it to MAX_CASCADE_DEPTH=50 exactly like
    // getAncestorChain(db, contentId, maxDepth) bounds real lineage traversal.
    const model = buildRoyaltyCascadeModel({ enforceCap: true, saleAmount: 1000 });
    const result = checkModel(model, { maxStates: 5000, maxDepth: 10 });
    assert.notEqual(result.status, "violation");
    // Directly confirm the clamp happened by replaying a trace that cites gen=9999.
    const withRunaway = replayTrace(model, ["citeAncestor(gen=9999)", "purchase(1000)"]);
    assert.equal(withRunaway.ok, true);
    assert.ok(withRunaway.finalState.ancestors.every((a) => a.generation <= 50));
  });
});

describe("invariant-specs: honest incompleteness applied to a real money model", () => {
  it("a tightly capped exploration of the ledger model reports state_space_exhausted, not success", () => {
    const model = buildLedgerConservationModel({ creditPredicate: correctCreditPredicate });
    const result = checkModel(model, { maxStates: 3, maxDepth: 100 });
    assert.equal(result.status, "state_space_exhausted");
    assert.equal(result.exhaustive, false);
    assert.notEqual(result.status, "no_violation_found");
  });
});
