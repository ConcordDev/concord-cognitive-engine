// Behavioral macro tests for the marketing lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surface drives,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields — as welding/hvac calculators were).
//
// The driven channel:
//   • components/marketing/MarketingActionPanel.tsx → a local
//       callMacro(action, { artifact: { data } }) →
//       apiHelpers.lens.runDomain('marketing', action, { input: { artifact:
//       { data } } }) → dispatch peels the redundant artifact wrapper →
//       handler reads artifact.data.* (== `data` here). Drives the 4 pure
//       calculators: campaignROI / abTestAnalysis / funnelOptimize /
//       audienceSegment.
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result card renders (cross-checked field-for-field against
// MarketingActionPanel.tsx):
//   - campaignROI → card reads campaign / grade / roi / costPerLead /
//       costPerAcquisition / conversionRate / profitable
//   - abTestAnalysis → card reads winner / lift / totalVisitors /
//       statisticallySignificant / variants[].name + conversionRate
//   - funnelOptimize → card reads overallConversion / biggestLeakage /
//       quickWin / stages[].stage + convFromTop + visitors + dropoff
//   - audienceSegment → card reads totalUsers / pareto / highValue /
//       segments[].segment + users + share + avgSpend
//   - real computed ROI / lift / conversion-funnel / segment-pareto values
//   - VALIDATION/degrade: <2 variants, <2 stages, empty users → {message}
//   - DEGRADE-GRACEFUL: the calculators are stateless pure compute — they
//       compute even with STATE gone (never throw).
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "Infinity" / "1e999"
//       / "abc" / zero): NO NaN/Infinity leaks into any rendered number.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketingActions from "../domains/marketing.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "marketing", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both the calculators (read
// artifact.data) and any params-reading macro see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`marketing.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "marketing", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper MarketingActionPanel.callMacro builds before dispatch:
//   runDomain('marketing', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. Proves the double
// wrap the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

// Recursively walk a value and assert every number is finite — no NaN/Infinity
// can reach a rendered metric.
function assertAllFinite(node, path = "result") {
  if (typeof node === "number") {
    assert.ok(Number.isFinite(node), `${path} leaked a non-finite number: ${node}`);
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`)); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) assertAllFinite(v, `${path}.${k}`);
  }
}

before(() => { registerMarketingActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "mkt_a", id: "mkt_a" }, userId: "mkt_a" };

/* ───────── registration: every calculator the panel drives ───────── */

describe("marketing lens — registration of the driven calculators", () => {
  it("registers every calculator MarketingActionPanel calls", () => {
    for (const m of ["campaignROI", "abTestAnalysis", "funnelOptimize", "audienceSegment"]) {
      assert.ok(ACTIONS.has(m), `marketing.${m} not registered`);
    }
  });
});

/* ───────── campaignROI: exact input + exact rendered fields ───────── */

describe("marketing.campaignROI — ROI/CPL/CPA/conversion (exact card fields)", () => {
  it("computes real ROI + cost metrics the card renders", () => {
    // EXACTLY actRoi(): { name, spend, revenue, leads, conversions }
    const r = callViaComponent("campaignROI", ctxA, {
      name: "Spring", spend: 1000, revenue: 3000, leads: 200, conversions: 50,
    });
    assert.equal(r.ok, true);
    const o = r.result;
    // every field the result card reads:
    assert.equal(o.campaign, "Spring");
    assert.equal(o.roi, 200);              // (3000-1000)/1000×100
    assert.equal(o.costPerLead, 5);        // 1000/200
    assert.equal(o.costPerAcquisition, 20); // 1000/50
    assert.equal(o.conversionRate, 25);    // 50/200×100
    assert.equal(o.profitable, true);
    assert.equal(o.grade, "strong");       // roi>100
    assertAllFinite(o);
  });

  it("grades a losing campaign negative + not profitable", () => {
    const o = callViaComponent("campaignROI", ctxA, { name: "Loss", spend: 5000, revenue: 1000 }).result;
    assert.equal(o.roi, -80);
    assert.equal(o.profitable, false);
    assert.equal(o.grade, "negative");
    assert.equal(o.costPerLead, 0);        // no leads → guarded /0
    assert.equal(o.costPerAcquisition, 0);
  });

  it("FAIL-CLOSED: poisoned numerics never leak NaN/Infinity into roi/revenue", () => {
    const o = callViaComponent("campaignROI", ctxA, {
      name: "x", spend: "abc", revenue: "Infinity", leads: "NaN", conversions: "1e999",
    }).result;
    assertAllFinite(o);          // would FAIL on the prior parseFloat('Infinity') leak
    assert.equal(o.spend, 0);
    assert.equal(o.revenue, 0);
    assert.equal(o.roi, 0);
  });

  it("FAIL-CLOSED: Infinity revenue with positive spend stays finite", () => {
    const o = callViaComponent("campaignROI", ctxA, {
      name: "y", spend: 100, revenue: Infinity, leads: 10, conversions: 2,
    }).result;
    assert.ok(Number.isFinite(o.roi), `roi leaked ${o.roi}`);
    assert.equal(o.revenue, 0);
    assert.equal(o.roi, -100);
  });
});

/* ───────── abTestAnalysis: exact input + exact rendered fields ───────── */

describe("marketing.abTestAnalysis — winner/lift/significance (exact card fields)", () => {
  it("computes per-variant rate, winner, lift and significance", () => {
    // actAb() pastes JSON → { variants: [...] }
    const r = callViaComponent("abTestAnalysis", ctxA, {
      variants: [
        { name: "Control", visitors: 1000, conversions: 50 }, // 5%
        { name: "Treatment", visitors: 1200, conversions: 84 }, // 7%
      ],
    });
    assert.equal(r.ok, true);
    const o = r.result;
    assert.equal(o.winner, "Treatment");
    assert.equal(o.lift, 40);              // (7-5)/5×100
    assert.equal(o.totalVisitors, 2200);
    assert.equal(o.statisticallySignificant, true); // >1000 visitors AND |lift|>5
    // the card maps variants[].name + conversionRate
    const byName = Object.fromEntries(o.variants.map((v) => [v.name, v.conversionRate]));
    assert.equal(byName.Control, 5);
    assert.equal(byName.Treatment, 7);
    assertAllFinite(o);
  });

  it("flags too-little data as not significant", () => {
    const o = callViaComponent("abTestAnalysis", ctxA, {
      variants: [
        { name: "A", visitors: 100, conversions: 5 },
        { name: "B", visitors: 120, conversions: 7 },
      ],
    }).result;
    assert.equal(o.statisticallySignificant, false);
    assert.match(o.recommendation, /Continue testing/);
  });

  it("DEGRADE: <2 variants returns the guidance message, not a crash", () => {
    const o = callViaComponent("abTestAnalysis", ctxA, { variants: [{ name: "Solo", visitors: 100, conversions: 5 }] }).result;
    assert.equal(typeof o.message, "string");
    assert.equal(o.variants, undefined);
  });

  it("FAIL-CLOSED: poisoned visitors/conversions never leak NaN/Infinity", () => {
    const o = callViaComponent("abTestAnalysis", ctxA, {
      variants: [
        { name: "A", visitors: "Infinity", conversions: "abc" },
        { name: "B", visitors: 1000, conversions: 50 },
      ],
    }).result;
    assertAllFinite(o);
    const byName = Object.fromEntries(o.variants.map((v) => [v.name, v.conversionRate]));
    assert.equal(byName.A, 0);   // poisoned → 0 conversions / floored visitors
    assert.equal(byName.B, 5);
  });
});

/* ───────── funnelOptimize: exact input + exact rendered fields ───────── */

describe("marketing.funnelOptimize — dropoff/leakage (exact card fields)", () => {
  it("computes per-stage dropoff, convFromTop and the biggest leak", () => {
    // actFunnel() pastes JSON → { stages: [...] }
    const r = callViaComponent("funnelOptimize", ctxA, {
      stages: [
        { name: "Visit", count: 1000 },
        { name: "Cart", count: 300 },
        { name: "Buy", count: 60 },
      ],
    });
    assert.equal(r.ok, true);
    const o = r.result;
    assert.equal(o.overallConversion, 6);  // 60/1000×100
    assert.equal(o.biggestLeakage, "Buy"); // 300→60 = 80% dropoff
    assert.match(o.quickWin, /Buy/);
    // the card maps stages[].stage + convFromTop + visitors + dropoff
    const cart = o.stages.find((s) => s.stage === "Cart");
    assert.equal(cart.visitors, 300);
    assert.equal(cart.dropoff, 70);        // 1-300/1000
    assert.equal(cart.convFromTop, 30);
    assert.equal(o.stages[0].dropoff, 0);  // top stage has no prior
    assertAllFinite(o);
  });

  it("DEGRADE: <2 stages returns the guidance message", () => {
    const o = callViaComponent("funnelOptimize", ctxA, { stages: [{ name: "Only", count: 500 }] }).result;
    assert.equal(typeof o.message, "string");
    assert.equal(o.stages, undefined);
  });

  it("FAIL-CLOSED: poisoned counts never leak NaN/Infinity or negative dropoff", () => {
    const o = callViaComponent("funnelOptimize", ctxA, {
      stages: [{ name: "A", count: "Infinity" }, { name: "B", count: "abc" }],
    }).result;
    assertAllFinite(o);
    for (const s of o.stages) {
      assert.ok(s.dropoff >= 0 && s.dropoff <= 100, `dropoff out of range: ${s.dropoff}`);
    }
  });

  it("FAIL-CLOSED: a growing stage clamps dropoff to 0 (no negative leak)", () => {
    const o = callViaComponent("funnelOptimize", ctxA, {
      stages: [{ name: "A", count: 100 }, { name: "B", count: 250 }],
    }).result;
    assert.equal(o.stages[1].dropoff, 0); // count grew → not negative
  });
});

/* ───────── audienceSegment: exact input + exact rendered fields ───────── */

describe("marketing.audienceSegment — segments/pareto (exact card fields)", () => {
  it("groups users into ranked segments with avg spend + share", () => {
    // actSeg() pastes JSON → { users: [...] }
    const r = callViaComponent("audienceSegment", ctxA, {
      users: [
        { segment: "vip", spend: 500 },
        { segment: "vip", spend: 300 },
        { segment: "free", spend: 0 },
        { segment: "free", spend: 0 },
      ],
    });
    assert.equal(r.ok, true);
    const o = r.result;
    assert.equal(o.totalUsers, 4);
    assert.equal(o.highValue, "vip");      // top by avgSpend
    // the card maps segments[].segment + users + share + avgSpend
    const vip = o.segments.find((s) => s.segment === "vip");
    assert.equal(vip.users, 2);
    assert.equal(vip.avgSpend, 400);       // (500+300)/2
    assert.equal(vip.share, 50);           // 2/4×100
    assert.match(o.pareto, />50%/);        // vip drives all revenue
    assertAllFinite(o);
  });

  it("accepts the tier/ltv aliases the calculator documents", () => {
    const o = callViaComponent("audienceSegment", ctxA, {
      users: [{ tier: "gold", ltv: 1200 }, { tier: "gold", ltv: 800 }],
    }).result;
    const gold = o.segments.find((s) => s.segment === "gold");
    assert.equal(gold.users, 2);
    assert.equal(gold.avgSpend, 1000);
  });

  it("DEGRADE: empty users returns the guidance message", () => {
    const o = callViaComponent("audienceSegment", ctxA, { users: [] }).result;
    assert.equal(typeof o.message, "string");
    assert.equal(o.segments, undefined);
  });

  it("FAIL-CLOSED: poisoned spend never leaks NaN/Infinity into totalSpend/avgSpend", () => {
    const o = callViaComponent("audienceSegment", ctxA, {
      users: [{ segment: "vip", spend: "Infinity" }, { segment: "vip", spend: "abc" }, { segment: "vip", spend: 100 }],
    }).result;
    assertAllFinite(o);            // would FAIL on the prior parseFloat('Infinity') leak
    const vip = o.segments.find((s) => s.segment === "vip");
    assert.equal(vip.totalSpend, 100); // poisoned spends collapse to 0
  });
});

/* ───────── degrade-graceful: stateless even with STATE gone ───────── */

describe("marketing calculators — degrade-graceful (stateless pure compute)", () => {
  it("compute with STATE entirely absent (never throw)", () => {
    delete globalThis._concordSTATE;
    assert.equal(callViaComponent("campaignROI", ctxA, { name: "S", spend: 100, revenue: 200 }).ok, true);
    assert.equal(callViaComponent("abTestAnalysis", ctxA, { variants: [{ name: "A", visitors: 10, conversions: 1 }, { name: "B", visitors: 10, conversions: 2 }] }).ok, true);
    assert.equal(callViaComponent("funnelOptimize", ctxA, { stages: [{ name: "A", count: 10 }, { name: "B", count: 5 }] }).ok, true);
    assert.equal(callViaComponent("audienceSegment", ctxA, { users: [{ segment: "x", spend: 1 }] }).ok, true);
  });

  it("handle a missing artifact.data without crashing", () => {
    // dispatch passes a virtualArtifact whose .data may be undefined
    for (const m of ["campaignROI", "abTestAnalysis", "funnelOptimize", "audienceSegment"]) {
      const fn = ACTIONS.get(m);
      const out = fn(ctxA, { id: null, meta: {} }, {});
      assert.equal(out.ok, true, `${m} threw/failed on missing data`);
    }
  });
});
