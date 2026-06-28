// server/tests/insurance-lens-macros.test.js
//
// PHASE-2 component-exact-shape behavioral contract for the `insurance` lens.
//
// The insurance domain is registered through the canonical `register(domain,
// name, fn)` MACROS registry (registerInsuranceActions(register) in server.js),
// so the live POST /api/lens/run dispatch for these macros is:
//     rest = peelRedundantArtifactWrapper(body.input)   // dispatch normalizer
//     fn   = MACROS.get('insurance').get(action)
//     fn(ctx, rest)                                       // 2-arg register form
// The domain file's own legacy shim then rebuilds `(ctx, artifact, params)` from
// `rest`. We reproduce that EXACT chain HERMETICALLY — no server boot, no
// network, no LLM, no DB — by importing the real domain registrar + the real
// dispatch peel and wiring a tiny MACROS map.
//
// CRITICAL — these tests drive the EXACT wrapper the InsuranceActionPanel
// component sends (`callMacro(action, { artifact: { title, data } })`) and
// assert the EXACT fields it renders from `r.result`. A previous defect: the
// sole-key `{ artifact: { title, data } }` body is peeled to `artifact.data` by
// the dispatch, DROPPING `artifact.title` — so `riskScore.risk` (read from
// `artifact.title`) rendered blank in the live app while the handler-shape depth
// test (which passes `{ data }` directly) stayed green. Fixed by sending
// `risk` inside `data` (survives the peel) + a handler fallback. Pinned below.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerInsuranceActions from "../domains/insurance.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

// ── hermetic dispatch harness (no boot) ─────────────────────────────────────
const MACROS = new Map();
function register(domain, name, fn) {
  if (!MACROS.has(domain)) MACROS.set(domain, new Map());
  MACROS.get(domain).set(name, fn);
}

let CTX;
before(() => {
  // The parity/CRUD macros persist into globalThis._concordSTATE keyed by the
  // ctx userId; give them a real (empty) STATE so an empty {} returns a genuine
  // validation reason, never a no_db sentinel.
  globalThis._concordSTATE = globalThis._concordSTATE || {};
  registerInsuranceActions(register);
  CTX = { actor: { userId: "ins-test-user" } };
});

/** Exactly what POST /api/lens/run does for a register()-path macro. */
function dispatch(action, input) {
  const rest = peelRedundantArtifactWrapper(input || {});
  const fn = MACROS.get("insurance").get(action);
  assert.ok(fn, `macro insurance.${action} is not registered`);
  return fn(CTX, rest);
}

/** The component wraps every calculator call as { artifact: { title, data } }. */
const book = (data, title = "Insurance book") => ({ artifact: { title, data } });

describe("insurance lens — component-exact calculator contracts (real dispatch + peel)", () => {
  // ── coverageGap ── component renders: gapCount, gaps[], expiringSoon.length,
  //                   coveredTypes, totalPolicies
  it("coverageGap: renders gapCount/gaps/coveredTypes/expiringSoon from the exact book wrapper", () => {
    const soon = new Date(Date.now() + 10 * 86400000).toISOString();
    const r = dispatch(
      "coverageGap",
      book({ policies: [{ type: "auto" }, { type: "home", expiryDate: soon }], claims: [] }),
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPolicies, 2);
    // catalog = health/auto/home/life/liability/umbrella; auto+home held → 4 gaps
    assert.equal(r.result.gapCount, 4);
    assert.deepEqual(r.result.gaps.slice().sort(), ["health", "liability", "life", "umbrella"]);
    assert.ok(r.result.coveredTypes.includes("auto"));
    assert.ok(r.result.coveredTypes.includes("home"));
    // home expires in 10d (≤30) → exactly one expiringSoon entry
    assert.equal(r.result.expiringSoon.length, 1);
  });

  // ── lossRatioReport ── component renders: lossRatio, assessment,
  //                       premiumsCollected, claimsPaid, claimFrequency, averageSeverity
  it("lossRatioReport: lossRatio = paid/premiums; renders every money field finite", () => {
    const r = dispatch(
      "lossRatioReport",
      book({
        policies: [{ premium: 1000 }, { premium: 1000 }],
        claims: [
          { status: "paid", amount: 800 },
          { status: "closed", amount: 400 },
          { status: "open", amount: 999 }, // excluded from claimsPaid
        ],
      }),
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.premiumsCollected, 2000);
    assert.equal(r.result.claimsPaid, 1200); // 800 + 400
    assert.equal(r.result.lossRatio, 60); // 1200/2000*100
    assert.equal(r.result.assessment, "profitable"); // 60 is NOT > 60
    assert.equal(r.result.claimFrequency, 1.5); // 3 claims / 2 policies
    assert.equal(r.result.averageSeverity, 400); // claimsPaid 1200 / totalClaims 3
    // Every rendered money/ratio field must be finite (Insurance money invariant).
    for (const k of ["premiumsCollected", "claimsPaid", "lossRatio", "claimFrequency", "averageSeverity"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k} must be finite, got ${r.result[k]}`);
    }
  });

  it("lossRatioReport: a high-loss book grades 'unprofitable'", () => {
    const r = dispatch(
      "lossRatioReport",
      book({ policies: [{ premium: 1000 }], claims: [{ status: "paid", amount: 1500 }] }),
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.lossRatio, 150);
    assert.equal(r.result.assessment, "unprofitable");
  });

  // ── renewalAlert ── component renders: urgentCount, premiumAtRisk,
  //                    totalUpcomingRenewals, within30Days[], within60Days[]
  it("renewalAlert: buckets by 30/60/90 windows; premiumAtRisk sums the at-risk book", () => {
    const in10 = new Date(Date.now() + 10 * 86400000).toISOString();
    const in45 = new Date(Date.now() + 45 * 86400000).toISOString();
    const r = dispatch(
      "renewalAlert",
      book({
        policies: [
          { policyNumber: "P1", premium: 500, expiryDate: in10 },
          { policyNumber: "P2", premium: 300, expiryDate: in45 },
        ],
      }),
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.urgentCount, 1); // only P1 ≤30d
    assert.equal(r.result.within30Days.length, 1);
    assert.equal(r.result.within60Days.length, 1);
    assert.equal(r.result.totalUpcomingRenewals, 2);
    assert.equal(r.result.premiumAtRisk, 800); // 500 + 300
    assert.equal(r.result.within30Days[0].policyNumber, "P1");
    assert.ok(Number.isFinite(r.result.premiumAtRisk));
  });

  // ── riskScore ── THE component-exact-shape regression. Component renders:
  //                risk, normalizedScore, level, rawScore, mitigatedScore,
  //                probability, impact. `risk` was blank pre-fix (title dropped
  //                by the dispatch peel). It now travels inside `data.risk`.
  it("riskScore: renders a NON-BLANK risk label from data.risk (peel-survival regression)", () => {
    const r = dispatch("riskScore", {
      artifact: { title: "Cyber breach", data: { risk: "Cyber breach", probability: 4, impact: 5 } },
    });
    assert.equal(r.ok, true);
    // The defect: with the title dropped by the peel, r.result.risk was
    // undefined and the panel's "Risk · …" card rendered blank.
    assert.equal(r.result.risk, "Cyber breach");
    assert.equal(r.result.rawScore, 20); // 4 × 5
    assert.equal(r.result.normalizedScore, 80); // 20/25 × 100
    assert.equal(r.result.level, "critical"); // ≥15
    assert.equal(r.result.probability, 4);
    assert.equal(r.result.impact, 5);
    assert.ok(Number.isFinite(r.result.normalizedScore));
    assert.ok(Number.isFinite(r.result.mitigatedScore));
  });

  it("riskScore: low probability×impact grades 'low'", () => {
    const r = dispatch("riskScore", {
      artifact: { title: "Minor", data: { risk: "Minor", probability: 1, impact: 2 } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.rawScore, 2);
    assert.equal(r.result.level, "low");
    assert.equal(r.result.risk, "Minor");
  });

  // ── carrier-rate (AmsWorkbench comparative rate run) ──
  it("carrier-rate: scores appointed carriers; cheapest/spread/bestFit are finite", () => {
    // seed two carriers for this user via the real carrier-add macro
    const a = dispatch("carrier-add", { name: "Acme Mutual", lines: ["auto"], baseCommissionPct: 12, rateIndex: 0.9, claimsServiceScore: 8, amBestRating: "A+" });
    assert.equal(a.ok, true);
    const b = dispatch("carrier-add", { name: "Budget Auto", lines: ["auto"], baseCommissionPct: 10, rateIndex: 1.3, claimsServiceScore: 5 });
    assert.equal(b.ok, true);
    const r = dispatch("carrier-rate", { line: "auto", basePremium: 1000, riskFactor: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.carrierCount, 2);
    // Acme 1000×0.9 = 900 ; Budget 1000×1.3 = 1300 → cheapest 900, spread 400
    assert.equal(r.result.cheapest, 900);
    assert.equal(r.result.spread, 400);
    assert.equal(r.result.bestPrice.carrier, "Acme Mutual");
    assert.ok(r.result.bestFit);
    for (const q of r.result.quotes) {
      assert.ok(Number.isFinite(q.annualPremium));
      assert.ok(Number.isFinite(q.commission));
      assert.ok(Number.isFinite(q.fitScore));
    }
  });
});

describe("insurance lens — validation rejection + degrade-graceful", () => {
  it("coverageGap: an empty book degrades to all-gaps, never throws", () => {
    const r = dispatch("coverageGap", book({ policies: [], claims: [] }));
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPolicies, 0);
    assert.equal(r.result.gapCount, 6); // all 6 catalog types missing
  });

  it("lossRatioReport: zero premiums → lossRatio 0 (no divide-by-zero, finite)", () => {
    const r = dispatch("lossRatioReport", book({ policies: [], claims: [] }));
    assert.equal(r.ok, true);
    assert.equal(r.result.lossRatio, 0);
    assert.equal(r.result.assessment, "profitable");
    assert.ok(Number.isFinite(r.result.lossRatio));
  });

  it("carrier-rate: rejects a non-positive basePremium with a real reason", () => {
    const r = dispatch("carrier-rate", { line: "home", basePremium: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /basePremium must be > 0/);
  });

  it("carrier-rate: a line no appointed carrier writes returns a real reason, not an empty quote list", () => {
    const r = dispatch("carrier-rate", { line: "marine_cargo_xyz", basePremium: 1000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /No appointed carrier/i);
  });
});

describe("insurance lens — fail-CLOSED poisoned-numeric (Number.isFinite money guard)", () => {
  // Insurance does premium/risk/payout math; a poisoned numeric must be
  // REJECTED before it can serialise as null/Infinity into a rendered money or
  // score field — NOT clamped into a silently-accepted result.
  for (const bad of [Infinity, -Infinity, NaN, 1e308, -5]) {
    it(`riskScore: rejects poisoned probability=${String(bad)} (no null/Infinity score)`, () => {
      const r = dispatch("riskScore", {
        artifact: { title: "x", data: { risk: "x", probability: bad, impact: 5 } },
      });
      assert.equal(r.ok, false, `expected ok:false for probability=${String(bad)}`);
      assert.match(r.error, /invalid_probability/);
    });
    it(`riskScore: rejects poisoned impact=${String(bad)}`, () => {
      const r = dispatch("riskScore", {
        artifact: { title: "x", data: { risk: "x", probability: 3, impact: bad } },
      });
      assert.equal(r.ok, false);
      assert.match(r.error, /invalid_impact/);
    });
  }

  it("carrier-rate: rejects a poisoned basePremium before the rate multiply", () => {
    const r = dispatch("carrier-rate", { line: "auto", basePremium: Infinity, riskFactor: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid_basePremium/);
  });

  it("carrier-rate: rejects a poisoned riskFactor", () => {
    const r = dispatch("carrier-rate", { line: "auto", basePremium: 1000, riskFactor: 1e308 });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid_riskFactor/);
  });

  it("pact-write: rejects poisoned payoutSparks (death-insurance money guard)", () => {
    const r = dispatch("pact-write", { beneficiaryUserId: "friend_1", payoutSparks: 1e308, premiumSparks: 50, durationDays: 30 });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid_payoutSparks/);
  });
});
