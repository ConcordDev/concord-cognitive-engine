// Behavioral macro tests for the analytics lens calculator surface in
// server/domains/analytics.js — the four pure-compute "analyst bench" actions
// the /lenses/analytics page drives through AnalyticsActionPanel.tsx:
//   funnelAnalysis · cohortAnalysis · detectAnomalies · trendForecast
//
// COMPLEMENT to analytics-domain-parity.test.js (which pins the Mixpanel/
// Amplitude STATE-backed event substrate: event-track/funnel-build/retention-
// report/cohort-build/etc). This file pins the PATH-3 calculator surface that
// the component reaches via:
//   callMacro(action, { artifact: { data } })
//     → apiHelpers.lens.runDomain('analytics', action, { input: { artifact: { data } } })
//     → POST /api/lens/run  { domain:'analytics', name:action, input:{artifact:{data}} }
//     → _peelRedundantArtifactWrapper(body.input) collapses {artifact:{data:X}} → X
//     → LENS_ACTIONS handler(ctx, virtualArtifact={...,data:X}, X)   [3-ARG]
//
// THE COMPONENT-EXACT-SHAPE CONTRACT (the dead-calculator class this gate
// targets): every test drives the EXACT inner-data object the component sends
// (parseJSON of the textarea → {stages|cohorts|dataPoints:[...]}) THROUGH the
// real dispatch peel, then asserts the EXACT fields the component renders from
// r.result. The field map, component → handler, was diffed both directions:
//   funnelAnalysis  in {stages:[{name,count}]}        out {stages:[{stage,count,dropoff,conversionFromTop}],overallConversion,worstDropoff,worstDropoffRate}
//   cohortAnalysis  in {cohorts:[{name,initialUsers,retention[]}]} out {cohorts:[{cohort,initialUsers,retentionCurve:[{period,retained,rate}],avgRetention}],bestCohort}
//   detectAnomalies in {dataPoints:[{date,value}]}    out {mean,stdDev,totalPoints,anomaliesFound,anomalies:[{date,value,zScore,isAnomaly,direction}],threshold}
//   trendForecast   in {dataPoints:[{value}]}         out {trend,slope,dataPoints,lastValue,forecast:[{periodsAhead,predicted}],confidence}
// All four were already aligned (no rename needed); the diff is asserted below
// so a future component/handler rename surfaces here, not in silent blank UI.
//
// NOT shape-only: every test feeds KNOWN inputs and asserts the EXACT computed
// value (funnel conversion %, cohort retention curve + best cohort, z-score
// anomaly flagging, linear-regression slope/forecast, growth-rate trend).
//
// FAIL-CLOSED POISON: these are pure calculators (no wallet, no mint), so the
// risk is fail-OPEN non-finite output. parseFloat("1e999") and
// parseFloat("Infinity") both yield Infinity, and `Infinity || 0` is Infinity —
// so the naive `parseFloat(x) || 0` let a poisoned value flow into mean/stdDev/
// slope/predicted → JSON-serialised as null → blank in the UI. The domain was
// hardened with finNum/finInt/safeRound (non-finite → 0, every output FINITE)
// and Array.isArray guards (malformed non-array input degrades to a guidance
// message instead of throwing an uncaught TypeError). The poison block pins both.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnalyticsActions from "../domains/analytics.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "analytics", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Drive a calculator EXACTLY like the live dispatch does for the component's
// `callMacro(action, { artifact: { data } })` shape: the body.input is
// `{ artifact: { data: <inner> } }`, the dispatch peels one redundant layer,
// then invokes handler(ctx, virtualArtifact, peeled) with virtualArtifact.data
// === peeled. `inner` here is the object the component's parseJSON produces.
function callViaComponentShape(name, ctx, inner) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`analytics.${name} not registered`);
  const bodyInput = { artifact: { data: inner } };          // what callMacro wraps
  const peeled = peelRedundantArtifactWrapper(bodyInput);    // dispatch peel
  const virtualArtifact = { id: null, domain: "analytics", type: "domain_action", data: peeled, meta: {} };
  return fn(ctx, virtualArtifact, peeled);
}

before(() => { registerAnalyticsActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

const CALCULATORS = ["funnelAnalysis", "cohortAnalysis", "detectAnomalies", "trendForecast"];

describe("analytics calculators — registration", () => {
  it("registers every calculator the AnalyticsActionPanel reaches", () => {
    for (const m of CALCULATORS) assert.ok(ACTIONS.has(m), `analytics.${m} not registered`);
  });
});

describe("analytics.funnelAnalysis — component-exact shape + values", () => {
  it("computes stage-by-stage conversion the component renders", () => {
    // Component textarea JSON → parseJSON<{stages}> → {stages:[{name,count}]}.
    const inner = { stages: [
      { name: "Visit", count: 1000 },
      { name: "Signup", count: 400 },
      { name: "Buy", count: 80 },
    ] };
    const r = callViaComponentShape("funnelAnalysis", ctxA, inner);
    assert.equal(r.ok, true);
    // EXACT fields the FunnelResult interface / result card reads:
    assert.ok(Array.isArray(r.result.stages));
    assert.deepEqual(
      r.result.stages.map((s) => ({ stage: s.stage, count: s.count, dropoff: s.dropoff, conversionFromTop: s.conversionFromTop })),
      [
        { stage: "Visit", count: 1000, dropoff: 0, conversionFromTop: 100 },
        { stage: "Signup", count: 400, dropoff: 60, conversionFromTop: 40 },
        { stage: "Buy", count: 80, dropoff: 80, conversionFromTop: 8 },
      ],
    );
    assert.equal(r.result.overallConversion, 8);   // 80/1000
    assert.equal(r.result.worstDropoff, "Buy");
    assert.equal(r.result.worstDropoffRate, 80);
  });

  it("names a stage with a fallback when name is absent (component renders s.stage)", () => {
    const r = callViaComponentShape("funnelAnalysis", ctxA, { stages: [{ count: 50 }, { count: 25 }] });
    assert.equal(r.result.stages[0].stage, "Stage 1");
    assert.equal(r.result.stages[1].stage, "Stage 2");
    assert.equal(r.result.stages[1].conversionFromTop, 50);
  });

  it("validation: <2 stages returns a guidance message, not a broken stages render", () => {
    const r = callViaComponentShape("funnelAnalysis", ctxA, { stages: [{ name: "Only", count: 10 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.stages, undefined);
    assert.match(r.result.message, /at least 2/i);
  });

  it("degrade-graceful: non-array stages does not throw (returns guidance)", () => {
    const r = callViaComponentShape("funnelAnalysis", ctxA, { stages: "nope" });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });

  it("fail-CLOSED poison: 1e999 / Infinity / NaN counts collapse to FINITE", () => {
    const r = callViaComponentShape("funnelAnalysis", ctxA, {
      stages: [{ name: "A", count: "1e999" }, { name: "B", count: "Infinity" }, { name: "C", count: "NaN" }],
    });
    assert.equal(r.ok, true);
    for (const s of r.result.stages) {
      assert.ok(Number.isFinite(s.count), `count not finite: ${s.count}`);
      assert.ok(Number.isFinite(s.dropoff), `dropoff not finite: ${s.dropoff}`);
      assert.ok(Number.isFinite(s.conversionFromTop), `conv not finite: ${s.conversionFromTop}`);
    }
    assert.ok(Number.isFinite(r.result.overallConversion));
  });
});

describe("analytics.cohortAnalysis — component-exact shape + retention values", () => {
  it("builds the retention curve + best cohort the component renders", () => {
    const inner = { cohorts: [
      { name: "Jan", initialUsers: 1000, retention: [800, 600, 500] },
      { name: "Feb", initialUsers: 1000, retention: [900, 850, 800] },
    ] };
    const r = callViaComponentShape("cohortAnalysis", ctxA, inner);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.cohorts));
    const jan = r.result.cohorts.find((c) => c.cohort === "Jan");
    // retentionCurve[].{period,retained,rate} — EXACT component read.
    assert.deepEqual(jan.retentionCurve, [
      { period: 1, retained: 800, rate: 80 },
      { period: 2, retained: 600, rate: 60 },
      { period: 3, retained: 500, rate: 50 },
    ]);
    assert.equal(jan.initialUsers, 1000);
    assert.equal(jan.avgRetention, 63);            // round((80+60+50)/3)
    // Feb retains better → bestCohort.
    assert.equal(r.result.bestCohort, "Feb");
  });

  it("uses period as the cohort label when name is absent", () => {
    const r = callViaComponentShape("cohortAnalysis", ctxA, {
      cohorts: [{ period: "2026-W01", initialUsers: 200, retention: [100] }],
    });
    assert.equal(r.result.cohorts[0].cohort, "2026-W01");
    assert.equal(r.result.cohorts[0].retentionCurve[0].rate, 50);
  });

  it("validation: empty cohorts returns a guidance message", () => {
    const r = callViaComponentShape("cohortAnalysis", ctxA, { cohorts: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.cohorts, undefined);
    assert.match(r.result.message, /cohort/i);
  });

  it("degrade-graceful: non-array cohorts / non-array retention does not throw", () => {
    assert.ok(callViaComponentShape("cohortAnalysis", ctxA, { cohorts: "nope" }).result.message);
    const r = callViaComponentShape("cohortAnalysis", ctxA, { cohorts: [{ name: "X", initialUsers: 10, retention: "nope" }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.cohorts[0].retentionCurve, []);
  });

  it("fail-CLOSED poison: divide-by-zero + poisoned retention stays FINITE", () => {
    const r = callViaComponentShape("cohortAnalysis", ctxA, {
      cohorts: [{ name: "P", initialUsers: "1e999", retention: ["Infinity", "NaN", 5] }, { name: "Z", initialUsers: 0, retention: [10] }],
    });
    assert.equal(r.ok, true);
    for (const c of r.result.cohorts) {
      assert.ok(Number.isFinite(c.initialUsers));
      assert.ok(Number.isFinite(c.avgRetention));
      for (const p of c.retentionCurve) {
        assert.ok(Number.isFinite(p.retained) && Number.isFinite(p.rate), `non-finite retention p=${JSON.stringify(p)}`);
      }
    }
  });
});

describe("analytics.detectAnomalies — component-exact shape + statistical summary", () => {
  it("flags 2σ outliers and reports mean/stdDev the component renders", () => {
    // 6 baseline points ~10 + one spike at 100 → mean 22.86, z(100)=2.45 (>2σ).
    const inner = { dataPoints: [
      { date: "d1", value: 10 }, { date: "d2", value: 11 }, { date: "d3", value: 10 },
      { date: "d4", value: 9 }, { date: "d5", value: 10 }, { date: "d6", value: 10 },
      { date: "d7", value: 100 },
    ] };
    const r = callViaComponentShape("detectAnomalies", ctxA, inner);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPoints, 7);
    assert.equal(r.result.mean, 22.86);
    assert.equal(r.result.threshold, "2 std deviations");
    assert.equal(r.result.anomaliesFound, 1);
    // anomalies[].{date,value,zScore,direction} — EXACT component read.
    assert.equal(r.result.anomalies[0].date, "d7");
    assert.equal(r.result.anomalies[0].value, 100);
    assert.equal(r.result.anomalies[0].direction, "high");
    assert.ok(r.result.anomalies[0].zScore > 2);
  });

  it("flat series reports zero anomalies (component shows the all-clear state)", () => {
    const r = callViaComponentShape("detectAnomalies", ctxA, {
      dataPoints: [{ value: 5 }, { value: 5 }, { value: 5 }, { value: 5 }, { value: 5 }],
    });
    assert.equal(r.result.anomaliesFound, 0);
    assert.equal(r.result.stdDev, 0);
    assert.equal(r.result.mean, 5);
    // date fallback when neither date nor label given (component renders a.date).
    // (no anomalies surfaced, but the field path is exercised by the mapper)
  });

  it("validation: <5 points returns a guidance message", () => {
    const r = callViaComponentShape("detectAnomalies", ctxA, { dataPoints: [{ value: 1 }, { value: 2 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.anomaliesFound, undefined);
    assert.match(r.result.message, /5 data points/i);
  });

  it("degrade-graceful: non-array dataPoints does not throw", () => {
    const r = callViaComponentShape("detectAnomalies", ctxA, { dataPoints: "nope" });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });

  it("fail-CLOSED poison: 1e999/Infinity/NaN values keep mean/stdDev/zScore FINITE", () => {
    const r = callViaComponentShape("detectAnomalies", ctxA, {
      dataPoints: [{ value: "1e999" }, { value: "Infinity" }, { value: "NaN" }, { value: 1 }, { value: 2 }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.mean), `mean not finite: ${r.result.mean}`);
    assert.ok(Number.isFinite(r.result.stdDev), `stdDev not finite: ${r.result.stdDev}`);
    for (const a of r.result.anomalies) assert.ok(Number.isFinite(a.value) && Number.isFinite(a.zScore));
  });
});

describe("analytics.trendForecast — component-exact shape + growth-rate trend", () => {
  it("computes upward slope + linear forecast the component renders", () => {
    // perfect +10/period line: 10,20,30,40 → slope 10, trend upward.
    const inner = { dataPoints: [{ value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }] };
    const r = callViaComponentShape("trendForecast", ctxA, inner);
    assert.equal(r.ok, true);
    assert.equal(r.result.trend, "upward");
    assert.equal(r.result.slope, 10);
    assert.equal(r.result.dataPoints, 4);
    assert.equal(r.result.lastValue, 40);
    assert.equal(r.result.confidence, "low");      // n<10
    // forecast[].{periodsAhead,predicted} — EXACT component read; +1p = 50.
    assert.deepEqual(r.result.forecast.map((f) => f.periodsAhead), [1, 2, 3, 5, 7]);
    assert.equal(r.result.forecast.find((f) => f.periodsAhead === 1).predicted, 50);
    assert.equal(r.result.forecast.find((f) => f.periodsAhead === 5).predicted, 90);
  });

  it("downward and flat trends classify correctly", () => {
    const down = callViaComponentShape("trendForecast", ctxA, { dataPoints: [{ value: 100 }, { value: 50 }, { value: 0 }] });
    assert.equal(down.result.trend, "downward");
    assert.ok(down.result.slope < 0);
    const flat = callViaComponentShape("trendForecast", ctxA, { dataPoints: [{ value: 5 }, { value: 5 }, { value: 5 }] });
    assert.equal(flat.result.trend, "flat");
    assert.equal(flat.result.slope, 0);
  });

  it("validation: <3 points returns a guidance message", () => {
    const r = callViaComponentShape("trendForecast", ctxA, { dataPoints: [{ value: 1 }, { value: 2 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.forecast, undefined);
    assert.match(r.result.message, /3 data points/i);
  });

  it("degrade-graceful: non-array dataPoints does not throw", () => {
    const r = callViaComponentShape("trendForecast", ctxA, { dataPoints: "nope" });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });

  it("fail-CLOSED poison: 1e999/Infinity values keep slope + every forecast FINITE", () => {
    const r = callViaComponentShape("trendForecast", ctxA, {
      dataPoints: [{ value: "1e999" }, { value: "Infinity" }, { value: 3 }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.slope), `slope not finite: ${r.result.slope}`);
    assert.ok(Number.isFinite(r.result.lastValue));
    assert.ok(["upward", "downward", "flat"].includes(r.result.trend));
    for (const f of r.result.forecast) assert.ok(Number.isFinite(f.predicted), `predicted not finite: ${f.predicted}`);
  });
});
