// tests/depth/predict-authority-behavior.test.js — REAL behavioral tests for
// the P5 advisory-EV computation and the P6/P7 evidence-gated authority
// lifecycle (predict.authorityStatus / predict.promoteAuthority).
//
// This is the highest-stakes code in the whole Concord Predict x Dila
// integration: it's the one place a "stage" could plausibly be read as
// permission to trade. Every test below exists to pin one of the hard
// invariants documented in domains/predict.js's headers for these two
// macros — most importantly that authorityGranted/executionChannelExists
// are unconditionally false, and that PROMOTED requires an explicit human
// operatorId + confirm:true against FRESH evidence, never an assertion.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";

async function makeTrades(ctx, modelId, trades) {
  for (const t of trades) {
    const created = await lensRun("predict", "create", {
      params: {
        subject: t.subject || "X-USD", eventDefinition: "e", horizonSeconds: 60,
        modelId, forecastDistribution: { prob: 0.377 }, featureSnapshot: {}, decision: "BUY",
      },
    }, ctx);
    await lensRun("predict", "resolve", {
      params: { id: created.result.ticket.id, actualOutcome: t.outcome, actualValue: { realized_return_pct: t.realized } },
    }, ctx);
  }
}

describe("predict.reconcile — advisoryEv (P5, observational only)", () => {
  it("computes edge/ev from live hitRate vs benchmark hitRate, self-consistent with meanReturnPct", async () => {
    const ctx = await depthCtx("predict-advisory-ev");
    const modelId = `adv-ev-${Date.now().toString(36)}`;
    // Same 3-trade fixture as the P2 reconcile test: mean +10%, hitRate 2/3,
    // avgWin +20%, avgLoss -10%.
    await makeTrades(ctx, modelId, [
      { realized: 0.10, outcome: true }, { realized: -0.10, outcome: false }, { realized: 0.30, outcome: true },
    ]);
    const res = await lensRun("predict", "reconcile", {
      params: { modelId, benchmark: { meanReturnPct: 1.24, hitRate: 0.38, avgWinPct: 23.7, avgLossPct: -12.7 } },
    }, ctx);
    assert.equal(res.ok, true);
    const adv = res.result.advisoryEv;
    assert.ok(adv, "advisoryEv must be present when benchmark.hitRate + live win/loss/hitRate are all known");
    assert.equal(adv.forecastProbability, 0.6667);
    assert.equal(adv.marketProbability, 0.38);
    assert.deepEqual(adv.payoff, { win: 20, loss: 10 });
    // edge = 0.6667 - 0.38 = 0.2867
    assert.equal(adv.edge, 0.2867);
    // ev = 0.6667*20 - (1-0.6667)*10 - 0 = 13.334 - 3.333 = 10.001
    assert.equal(adv.evPctPerTrade, 10.001);
    // Self-consistency: ev computed from the SAME sample's own hitRate/win/loss
    // should closely track that sample's own mean return (10.0%) — it will
    // never be exactly equal (hitRate is rounded to 4dp first), but it must
    // be close, not wildly different.
    assert.ok(Math.abs(adv.evPctPerTrade - res.result.meanReturnPct) < 0.01);
    assert.match(adv.note, /OBSERVATIONAL ONLY/);
  });

  it("is null when no benchmark hitRate is supplied — never fabricates an EV from nothing", async () => {
    const ctx = await depthCtx("predict-advisory-ev-none");
    const modelId = `adv-ev-none-${Date.now().toString(36)}`;
    await makeTrades(ctx, modelId, [{ realized: 0.10, outcome: true }]);
    const res = await lensRun("predict", "reconcile", { params: { modelId } }, ctx);
    assert.equal(res.result.advisoryEv, null);
  });
});

describe("predict.authorityStatus — evidence-gated stage (P6/P7)", () => {
  it("n=0 -> IDEA, and authorityGranted/executionChannelExists are always false", async () => {
    const ctx = await depthCtx("predict-authority-idea");
    const modelId = `auth-idea-${Date.now().toString(36)}`;
    const res = await lensRun("predict", "authorityStatus", { params: { modelId } }, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.result.stage, "IDEA");
    assert.equal(res.result.evidenceStage, "IDEA");
    assert.equal(res.result.n, 0);
    assert.equal(res.result.authorityGranted, false);
    assert.equal(res.result.executionChannelExists, false);
  });

  it("below minTestedN -> SHADOW; at/above minTestedN but below minValidatedN -> TESTED; at/above minValidatedN -> VALIDATED", async () => {
    const ctx = await depthCtx("predict-authority-ladder");
    const modelId = `auth-ladder-${Date.now().toString(36)}`;

    // Every ticket here forecasts the SAME 0.377 probability and (by design
    // of this fixture) mostly resolves "true" -- that's a genuinely bad
    // calibration signal on its own (see the dedicated calibration-capping
    // test below), which would otherwise confound this test's actual
    // subject: the N-COUNT ladder. Pass a maximally permissive ECE ceiling
    // (ECE is bounded in [0,1] — see lib/calibration-math.js#computeECE)
    // so calibration is never the reason a stage does or doesn't advance
    // here.
    const NO_CALIBRATION_GATE = { calibrationEceCeiling: 1 };

    // 1 trade, low thresholds so the ladder is testable without 100 rows.
    await makeTrades(ctx, modelId, [{ realized: 0.05, outcome: true }]);
    const shadow = await lensRun("predict", "authorityStatus", {
      params: { modelId, minTestedN: 2, minValidatedN: 4, ...NO_CALIBRATION_GATE },
    }, ctx);
    assert.equal(shadow.result.evidenceStage, "SHADOW");
    assert.equal(shadow.result.transitioned, true); // (new) -> SHADOW

    // 1 more trade -> n=2 reaches minTestedN=2, below minValidatedN=4.
    await makeTrades(ctx, modelId, [{ realized: 0.08, outcome: true }]);
    const tested = await lensRun("predict", "authorityStatus", {
      params: { modelId, minTestedN: 2, minValidatedN: 4, ...NO_CALIBRATION_GATE },
    }, ctx);
    assert.equal(tested.result.evidenceStage, "TESTED");
    assert.equal(tested.result.transitioned, true); // SHADOW -> TESTED

    // 2 more trades -> n=4 reaches minValidatedN=4.
    await makeTrades(ctx, modelId, [{ realized: 0.03, outcome: true }, { realized: -0.02, outcome: false }]);
    const validated = await lensRun("predict", "authorityStatus", {
      params: { modelId, minTestedN: 2, minValidatedN: 4, ...NO_CALIBRATION_GATE },
    }, ctx);
    assert.equal(validated.result.n, 4);
    assert.equal(validated.result.evidenceStage, "VALIDATED");
    assert.equal(validated.result.authorityGranted, false);
    assert.equal(validated.result.executionChannelExists, false);
  });

  it("HALT_CANDIDATE overrides everything -> HALTED, regardless of n", async () => {
    const ctx = await depthCtx("predict-authority-halt");
    const modelId = `auth-halt-${Date.now().toString(36)}`;
    await makeTrades(ctx, modelId, [
      { realized: -0.20, outcome: false }, { realized: -0.25, outcome: false }, { realized: -0.15, outcome: false },
    ]);
    const res = await lensRun("predict", "authorityStatus", {
      params: { modelId, minTestedN: 1, minValidatedN: 2, stopRule: [{ n: 3, minMeanReturnPct: -5 }] },
    }, ctx);
    assert.equal(res.result.evidenceStage, "HALTED");
    assert.equal(res.result.stage, "HALTED");
    assert.equal(res.result.authorityGranted, false);
  });
});

describe("predict.promoteAuthority — the ONLY path to PROMOTED, and it still cannot move money", () => {
  it("refuses without confirm:true", async () => {
    const ctx = await depthCtx("predict-promote-noconfirm");
    const res = await lensRun("predict", "promoteAuthority", {
      params: { modelId: "m", operatorId: "dutch" },
    }, ctx);
    assert.equal(res.result.ok, false);
    assert.equal(res.result.reason, "confirmation_required");
  });

  it("refuses without operatorId even with confirm:true", async () => {
    const ctx = await depthCtx("predict-promote-nooperator");
    const res = await lensRun("predict", "promoteAuthority", {
      params: { modelId: "m", confirm: true },
    }, ctx);
    assert.equal(res.result.ok, false);
    assert.equal(res.result.reason, "missing_operator_id");
  });

  it("refuses when evidenceStage is not VALIDATED (recomputed fresh, not trusted from a stale claim)", async () => {
    const ctx = await depthCtx("predict-promote-notvalidated");
    const modelId = `promote-notvalid-${Date.now().toString(36)}`;
    await makeTrades(ctx, modelId, [{ realized: 0.05, outcome: true }]); // n=1, way below default thresholds
    const res = await lensRun("predict", "promoteAuthority", {
      params: { modelId, operatorId: "dutch", confirm: true },
    }, ctx);
    assert.equal(res.result.ok, false);
    assert.equal(res.result.reason, "not_validated");
    assert.equal(res.result.evidenceStage, "SHADOW");
  });

  it("succeeds when VALIDATED, records a durable DTU, and STILL reports zero real authority", async () => {
    const { STATE } = await load();
    const db = STATE.db;
    const ctx = await depthCtx("predict-promote-success");
    const modelId = `promote-ok-${Date.now().toString(36)}`;
    await makeTrades(ctx, modelId, [{ realized: 0.10, outcome: true }, { realized: 0.08, outcome: true }]);

    const promoted = await lensRun("predict", "promoteAuthority", {
      params: { modelId, operatorId: "dutch", confirm: true, minTestedN: 1, minValidatedN: 2, calibrationEceCeiling: 1, note: "test promotion" },
    }, ctx);
    assert.equal(promoted.ok, true);
    assert.equal(promoted.result.stage, "PROMOTED");
    assert.equal(promoted.result.promotedBy, "dutch");
    assert.equal(promoted.result.authorityGranted, false);
    assert.equal(promoted.result.executionChannelExists, false);
    assert.match(promoted.result.note, /does NOT grant real trading authority/);
    assert.ok(promoted.result.dtuId);

    const dtuRow = db.prepare("SELECT id FROM dtus WHERE id = ?").get(promoted.result.dtuId);
    assert.ok(dtuRow, "the promotion must be recorded as a real, queryable DTU");

    const row = db.prepare("SELECT * FROM predict_authority_state WHERE model_id = ?").get(modelId);
    assert.equal(row.stage, "PROMOTED");
    assert.equal(row.promoted_by, "dutch");

    // Promotion is STICKY: a later authorityStatus call with thresholds that
    // would normally read this exact n as merely TESTED must still report
    // the PERSISTED stage as PROMOTED (evidence alone cannot revoke a human
    // promotion) — while evidenceStage tells the truth about current data.
    const after = await lensRun("predict", "authorityStatus", {
      params: { modelId, minTestedN: 1, minValidatedN: 100, calibrationEceCeiling: 1 }, // n=2 no longer clears this minValidatedN
    }, ctx);
    assert.equal(after.result.stage, "PROMOTED");
    assert.equal(after.result.evidenceStage, "TESTED");

    // But a HALT_CANDIDATE MUST override even a PROMOTED stage — safety
    // beats a standing authorization. Add catastrophic trades and re-check.
    await makeTrades(ctx, modelId, [{ realized: -0.50, outcome: false }, { realized: -0.60, outcome: false }]);
    const halted = await lensRun("predict", "authorityStatus", {
      params: { modelId, stopRule: [{ n: 4, minMeanReturnPct: -5 }] },
    }, ctx);
    assert.equal(halted.result.evidenceStage, "HALTED");
    assert.equal(halted.result.stage, "HALTED", "a HALT_CANDIDATE must override PROMOTED, not defer to it");
  });
});
