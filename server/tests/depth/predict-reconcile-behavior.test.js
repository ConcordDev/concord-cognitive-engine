// tests/depth/predict-reconcile-behavior.test.js — REAL behavioral tests for
// predict.reconcile (Concord Predict × Dila integration, P2: live-vs-backtest
// reconciliation). Every expected value is hand-computed independently of
// the implementation, per this repo's compute-don't-guess testing doctrine.
//
// Distinct from predict.calibration (grades forecast-probability honesty via
// Brier/log-loss): this grades whether live TRADE ECONOMICS (mean return,
// hit rate, win/loss magnitude, hold period, max favorable excursion) match
// what a backtest claimed. See domains/predict.js's predict.reconcile header
// for the full unit convention (returns are PERCENT, hitRate is a fraction).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";

const DAY_MS = 86400000;

describe("predict.reconcile — live-vs-backtest economics", () => {
  it("no resolved tickets for the model -> honest empty report, not a crash", async () => {
    const ctx = await depthCtx("predict-reconcile-empty");
    const res = await lensRun("predict", "reconcile", { params: { modelId: "no_such_model_xyz" } }, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.result.n, 0);
    assert.match(res.result.message, /No resolved live trades/);
  });

  it("computes mean/stddev/hitRate/avgWin/avgLoss/avgHold/avgMFE from 3 real resolved trades", async () => {
    const { STATE } = await load();
    const db = STATE.db;
    const ctx = await depthCtx("predict-reconcile-econ");
    const modelId = `recon-test-${Date.now().toString(36)}`;

    // Hand-picked so every aggregate is an exact, easily-verified number:
    //   returns: +10%, -10%, +30%  -> mean = +10.0%,  sample stddev = 20.0%
    //   outcomes: win, loss, win   -> hitRate = 2/3 = 0.6667
    //   wins: +10%, +30%           -> avgWin = +20.0%
    //   losses: -10%               -> avgLoss = -10.0%
    //   MFE: 10%, 5%, 30%          -> avgMFE = 45/3 = 15.0%
    //   holds: all backdated to exactly 10 days -> avgHoldDays = 10.0
    const trades = [
      { subject: "AAA-USD", realized: 0.10, mfe: 0.10, outcome: true },
      { subject: "BBB-USD", realized: -0.10, mfe: 0.05, outcome: false },
      { subject: "CCC-USD", realized: 0.30, mfe: 0.30, outcome: true },
    ];

    const ids = [];
    for (const t of trades) {
      const created = await lensRun("predict", "create", {
        params: {
          subject: t.subject, eventDefinition: "e", horizonSeconds: 60,
          modelId, forecastDistribution: { prob: 0.377 }, featureSnapshot: {},
        },
      }, ctx);
      assert.equal(created.ok, true);
      const id = created.result.ticket.id;
      const resolved = await lensRun("predict", "resolve", {
        params: {
          id, actualOutcome: t.outcome,
          actualValue: { realized_return_pct: t.realized, mfe_pct: t.mfe },
          resolutionSource: "test",
        },
      }, ctx);
      assert.equal(resolved.ok, true);
      ids.push(id);
    }

    // Backdate so the hold period is deterministic: every ticket created
    // 10 days before it resolved. (created_at/resolved_at are otherwise
    // real Date.now()-based timestamps a few ms apart, which would make
    // avgHoldDays ~0 and untestable as an exact number.)
    for (const id of ids) {
      const outcome = db.prepare("SELECT resolved_at FROM prediction_outcomes WHERE prediction_id = ?").get(id);
      db.prepare("UPDATE prediction_tickets SET created_at = ? WHERE id = ?").run(outcome.resolved_at - 10 * DAY_MS, id);
    }

    const res = await lensRun("predict", "reconcile", { params: { modelId } }, ctx);
    assert.equal(res.ok, true);
    const live = res.result;
    assert.equal(live.n, 3);
    assert.equal(live.nWithReturn, 3);
    assert.equal(live.nWithMfe, 3);
    assert.equal(live.meanReturnPct, 10);
    assert.equal(live.stdDevPct, 20);
    assert.equal(live.hitRate, 0.6667);
    assert.equal(live.avgWinPct, 20);
    assert.equal(live.avgLossPct, -10);
    assert.equal(live.avgHoldDays, 10);
    assert.equal(live.avgMfePct, 15);

    // Benchmark comparison — hand-computed deltas against a stand-in for
    // dila-tools' STRATEGY_EXPECTATIONS.md numbers.
    const withBenchmark = await lensRun("predict", "reconcile", {
      params: {
        modelId,
        benchmark: { meanReturnPct: 1.24, hitRate: 0.38, avgWinPct: 23.7, avgLossPct: -12.7, avgHoldDays: 25.2 },
      },
    }, ctx);
    const cmp = withBenchmark.result.comparison;
    assert.ok(cmp);
    assert.equal(cmp.deltaMeanReturnPct, 8.76);   // 10.0 - 1.24
    assert.equal(cmp.deltaHitRate, 0.2867);       // 0.6667 - 0.38
    assert.equal(cmp.deltaAvgWinPct, -3.7);       // 20.0 - 23.7
    assert.equal(cmp.deltaAvgLossPct, 2.7);       // -10.0 - (-12.7)
    assert.equal(cmp.deltaAvgHoldDays, -15.2);    // 10.0 - 25.2

    // Stop rule — n=3 reaches the n<=3 checkpoint but not the n<=5 one.
    // Live mean (+10.0%) is well above both floors -> not a halt candidate.
    const withStopRule = await lensRun("predict", "reconcile", {
      params: {
        modelId,
        stopRule: [{ n: 2, minMeanReturnPct: -5 }, { n: 5, minMeanReturnPct: -2 }],
      },
    }, ctx);
    const sr = withStopRule.result.stopRule;
    assert.ok(sr);
    assert.deepEqual(sr.currentCheckpoint, { n: 2, minMeanReturnPct: -5 });
    assert.deepEqual(sr.nextCheckpoint, { n: 5, minMeanReturnPct: -2 });
    assert.equal(sr.status, "WITHIN_EXPECTED_VARIANCE");
    assert.equal(withStopRule.result.dtuId, null); // no halt -> no finding recorded
  });

  it("flags HALT_CANDIDATE and records a durable finding when live mean falls below the stop-rule floor", async () => {
    const { STATE } = await load();
    const db = STATE.db;
    const ctx = await depthCtx("predict-reconcile-halt");
    const modelId = `recon-halt-${Date.now().toString(36)}`;

    // 4 losing trades, mean -20% — deliberately catastrophic so it trips
    // even a generous floor.
    for (let i = 0; i < 4; i++) {
      const created = await lensRun("predict", "create", {
        params: {
          subject: `HALT${i}-USD`, eventDefinition: "e", horizonSeconds: 60,
          modelId, forecastDistribution: { prob: 0.377 }, featureSnapshot: {},
        },
      }, ctx);
      await lensRun("predict", "resolve", {
        params: { id: created.result.ticket.id, actualOutcome: false, actualValue: { realized_return_pct: -0.20 } },
      }, ctx);
    }

    const res = await lensRun("predict", "reconcile", {
      params: { modelId, stopRule: [{ n: 4, minMeanReturnPct: -7.64 }] },
    }, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.result.meanReturnPct, -20);
    assert.equal(res.result.stopRule.status, "HALT_CANDIDATE");
    assert.ok(res.result.dtuId, "a HALT_CANDIDATE must record a durable finding");

    const dtuRow = db.prepare("SELECT id FROM dtus WHERE id = ?").get(res.result.dtuId);
    assert.ok(dtuRow, "the recorded finding must actually exist in the dtus table");
  });
});
