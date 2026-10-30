// Natural-shape acceptance for the analytics bench series tools
// (detectAnomalies / trendForecast) — Review 4 F3 / remainder slice R4.
//
// The documented bench shape is { dataPoints: [{ date, value }] } and it is
// pinned by analytics-lens-macros.test.js. F3's failure record is about the
// shapes a user reaches for FIRST:
//   - bare-number points, { dataPoints: [100, 102, ...] } — the old code
//     mapped finNum(d?.value) over them, zeroing every value, and returned
//     a computed-looking result over zeros (mean 0, no anomalies) instead
//     of analysing the series the user actually pasted.
//   - container aliases, { series: [...] } / { values: [...] } — the old
//     code read only .dataPoints and answered the "need N points"
//     guidance as if nothing had been pasted.
// Both now normalise (domains/analytics.js benchPoints) into the ONE
// computation path; this suite pins that the natural shapes compute the
// SAME result as the documented shape over the same series, driven
// through the real dispatch peel exactly like the component sends it.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnalyticsActions from "../domains/analytics.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "analytics", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

function callViaComponentShape(name, ctx, inner) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`analytics.${name} not registered`);
  const bodyInput = { artifact: { data: inner } };
  const peeled = peelRedundantArtifactWrapper(bodyInput);
  const virtualArtifact = { id: null, domain: "analytics", type: "domain_action", data: peeled, meta: {} };
  return fn(ctx, virtualArtifact, peeled);
}

before(() => { registerAnalyticsActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
// A series with one obvious spike: ten ~100s and a 500.
const VALUES = [100, 102, 98, 101, 99, 100, 103, 97, 100, 102, 500];
const DOCUMENTED = { dataPoints: VALUES.map((v, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, value: v })) };

describe("analytics bench — natural shapes compute like the documented shape", () => {
  it("detectAnomalies: bare-number points find the spike (not a zeroed series)", () => {
    const r = callViaComponentShape("detectAnomalies", ctxA, { dataPoints: VALUES });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPoints, VALUES.length);
    assert.ok(r.result.mean > 100, `mean should reflect the real series, got ${r.result.mean}`);
    assert.equal(r.result.anomaliesFound, 1);
    assert.equal(r.result.anomalies[0].value, 500);
    assert.equal(r.result.anomalies[0].direction, "high");
  });

  it("detectAnomalies: bare and documented shapes agree on the statistics", () => {
    const bare = callViaComponentShape("detectAnomalies", ctxA, { dataPoints: VALUES });
    const doc = callViaComponentShape("detectAnomalies", ctxA, DOCUMENTED);
    assert.equal(bare.result.mean, doc.result.mean);
    assert.equal(bare.result.stdDev, doc.result.stdDev);
    assert.equal(bare.result.anomaliesFound, doc.result.anomaliesFound);
    // Bare points carry no date; the fallback label names the position.
    assert.equal(bare.result.anomalies[0].date, "Point 10");
    assert.equal(doc.result.anomalies[0].date, "2024-01-11");
  });

  it("detectAnomalies: series / values container aliases are the same series", () => {
    for (const key of ["series", "values"]) {
      const r = callViaComponentShape("detectAnomalies", ctxA, { [key]: VALUES.map((v) => ({ value: v })) });
      assert.equal(r.ok, true, key);
      assert.equal(r.result.totalPoints, VALUES.length, key);
      assert.equal(r.result.anomaliesFound, 1, key);
    }
  });

  it("trendForecast: bare-number points forecast from the real values", () => {
    const rising = [10, 20, 30, 40, 50];
    const r = callViaComponentShape("trendForecast", ctxA, { dataPoints: rising });
    assert.equal(r.ok, true);
    assert.equal(r.result.trend, "upward");
    assert.equal(r.result.slope, 10);
    assert.equal(r.result.lastValue, 50);
    assert.equal(r.result.forecast[0].predicted, 60);
    const doc = callViaComponentShape("trendForecast", ctxA, { dataPoints: rising.map((v) => ({ value: v })) });
    assert.deepEqual(r.result.forecast, doc.result.forecast);
  });

  it("guidance still fires for genuinely short input in any container", () => {
    const short = callViaComponentShape("detectAnomalies", ctxA, { dataPoints: [1, 2] });
    assert.match(short.result.message, /at least 5/);
    const empty = callViaComponentShape("trendForecast", ctxA, { values: [] });
    assert.match(empty.result.message, /at least 3/);
  });
});
