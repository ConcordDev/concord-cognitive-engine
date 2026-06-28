// Behavioral macro tests for the HR lens — the PHASE-2 LENS-DRIVEN GAP layer.
// These pin the EXACT field contract the live frontend surface drives, so a green
// test can never coexist with a dead-in-production calculator (the failure mode
// where a handler-ideal-shape test passes while the rendered component reads
// undefined fields — exactly what had silently killed the ENTIRE HrActionPanel
// result-card surface here before the 2026-06-28 alignment fix: all four cards
// — Comp / Turnover / Interview / PTO — rendered blank because the handlers
// returned a completely different field set than the component reads).
//
// One real channel:
//   • HrActionPanel.tsx → callMacro(action, input) →
//     apiHelpers.lens.runDomain('hr', action, { input }) → POST /api/lens/run
//     body { domain, action, input } → dispatch reads body.input, peels (flat →
//     no-op), sets virtualArtifact.data = input AND passes input as the 3rd
//     param. Handlers read artifact.data.* (== params here). Drives the 4 pure
//     analytics calculators: compensationBenchmark, turnoverAnalysis,
//     interviewScorecard, ptoBalance.
//   (The Workday/BambooHR HRIS core — employee/timeoff/onboarding/review/goal/
//    job/applicant/payroll/benefit/clock/course/compliance/self-service — is
//    pinned by hr-hris-domain-parity.test.js, NOT duplicated here.)
//
// Asserted, with the EXACT input each calculator sends and the EXACT fields its
// result card renders (cross-checked field-for-field against
// components/hr/HrActionPanel.tsx after the 2026-06-28 alignment fix):
//   - compensationBenchmark: sends FLAT { role, location }; card reads
//     role / market50 / market75 / rangeLow / rangeHigh / offerSuggestion.
//     (was DEAD: handler read data.salary/yearsExperience and returned
//     benchmarkSalary/percentile/competitive/recommendation → every comp card
//     blank, even the $market50 success-toast label was undefined.)
//   - turnoverAnalysis: sends FLAT { headcount, leaversLast12Months }; card
//     reads ratePct / benchmarkPct / topReason / band.  (was DEAD both ways:
//     handler read totalEmployees/departuresThisYear and returned
//     turnoverRate/industryAvg/riskLevel.)
//   - interviewScorecard: sends FLAT { candidate, scores:{dim:N} }; card reads
//     totalScore / passingScore / recommendation / topStrengths[] /
//     topWeaknesses[].  (was DEAD: handler read data.candidates[] array and
//     returned candidates[]/topCandidate/avgScore.)
//   - ptoBalance: sends FLAT { employeeId, annualDays }; card reads accrued /
//     used / remaining / rolloverDate.  (was DEAD: handler read totalPTO/usedPTO/
//     pendingRequests and returned monthsRemaining/burnRate/projectedYearEnd.)
//   - VALIDATION-REJECTION: missing role / non-positive headcount / no scores /
//     missing employeeId or non-positive annualDays → {ok:false} or empty-shape
//     message, never a crash.
//   - DEGRADE-GRACEFUL: the 4 calculators are stateless pure compute (ptoBalance
//     reads STATE-approved PTO best-effort) — they compute even with
//     globalThis._concordSTATE gone (never throw).
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc" / "12abc"):
//     coercion is Number()+Number.isFinite (NOT parseFloat) so no NaN/Infinity
//     leaks into any rendered money/percentage figure, no crash, and a "12abc"
//     prefix is REJECTED to the default rather than silently accepted as 12.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHRActions from "../domains/hr.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "hr", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So the calculators (read art.data) see
// the peeled input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`hr.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "hr", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper HrActionPanel.callMacro builds before dispatch:
//   runDomain('hr', action, { input }) → body.input === input (FLAT). The peel
// is a no-op on flat input, so this is the true end-to-end shape.
function callViaComponent(name, ctx, input = {}) {
  return call(name, ctx, input);
}

before(() => {
  registerHRActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "hr_a", id: "hr_a" }, userId: "hr_a" };

// Helper: every numeric the component renders must be a real finite number
// (no NaN/Infinity leak). Strings are exempt; we scan only number-typed leaves.
function assertNoNonFiniteNumbers(obj, path = "result") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `${path} leaked a non-finite number: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFiniteNumbers(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const [k, v] of Object.entries(obj)) assertNoNonFiniteNumbers(v, `${path}.${k}`); }
}

/* ───────── registration: every macro the lens channel drives ───────── */

describe("hr lens — registration of the driven calculators", () => {
  it("registers every macro HrActionPanel drives", () => {
    for (const m of ["compensationBenchmark", "turnoverAnalysis", "interviewScorecard", "ptoBalance"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing hr.${m}`);
    }
  });
});

/* ───────────────────── compensationBenchmark ───────────────────── */

describe("hr.compensationBenchmark — EXACT fields the CompResult card renders", () => {
  it("renders role / market50 / market75 / rangeLow / rangeHigh / offerSuggestion with real computed values", () => {
    const r = callViaComponent("compensationBenchmark", ctxA, { role: "Senior Engineer", location: "SF" });
    assert.equal(r.ok, true);
    const x = r.result;
    // EXACT rendered fields (card reads x.role, x.market50, x.market75,
    // x.rangeLow, x.rangeHigh, x.offerSuggestion):
    assert.equal(x.role, "Senior Engineer");
    assert.equal(typeof x.market50, "number");
    assert.equal(typeof x.market75, "number");
    assert.equal(typeof x.rangeLow, "number");
    assert.equal(typeof x.rangeHigh, "number");
    assert.equal(typeof x.offerSuggestion, "number");
    // real math: base senior 165 * eng 1.15 = 189.75; SF loc 1.3 → 246.675 → 247.
    assert.equal(x.market50, 247);
    assert.equal(x.market75, Math.round(247 * 1.18)); // 291
    assert.equal(x.rangeLow, Math.round(247 * 0.78)); // 193
    assert.equal(x.rangeHigh, Math.round(247 * 1.22)); // 301
    assert.equal(x.offerSuggestion, Math.round((247 + 291) / 2)); // 269
    // ordering sanity: low < median < p75 < high.
    assert.ok(x.rangeLow < x.market50 && x.market50 < x.market75 && x.market75 < x.rangeHigh);
    assertNoNonFiniteNumbers(x);
  });

  it("a remote junior role benchmarks lower than an on-site senior role", () => {
    const jr = callViaComponent("compensationBenchmark", ctxA, { role: "Junior Developer", location: "remote" });
    const sr = callViaComponent("compensationBenchmark", ctxA, { role: "Staff Engineer", location: "NYC" });
    assert.equal(jr.ok, true);
    assert.equal(sr.ok, true);
    assert.ok(jr.result.market50 < sr.result.market50, "junior-remote < staff-NYC median");
    assertNoNonFiniteNumbers(jr.result);
    assertNoNonFiniteNumbers(sr.result);
  });

  it("VALIDATION: missing role → {ok:false}, never a crash", () => {
    const r = callViaComponent("compensationBenchmark", ctxA, { location: "SF" });
    assert.equal(r.ok, false);
    assert.equal(typeof (r.error || r.message), "string");
  });
});

/* ───────────────────── turnoverAnalysis ───────────────────── */

describe("hr.turnoverAnalysis — EXACT fields the TurnoverResult card renders", () => {
  it("renders ratePct / benchmarkPct / topReason / band with real computed values", () => {
    const r = callViaComponent("turnoverAnalysis", ctxA, { headcount: 100, leaversLast12Months: 30 });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.ratePct, "number");
    assert.equal(typeof x.benchmarkPct, "number");
    assert.equal(typeof x.topReason, "string");
    assert.equal(typeof x.band, "string");
    // real math: avgHeadcount = 100 + 30/2 = 115; rate = 30/115*100 = 26.08 → 26.1.
    assert.equal(x.ratePct, 26.1);
    assert.equal(x.benchmarkPct, 13);
    assert.equal(x.band, "critical"); // > 25
    assert.equal(x.topReason, "Compensation below market");
    assertNoNonFiniteNumbers(x);
  });

  it("a low-leaver company reads a healthy/low band below the benchmark", () => {
    const r = callViaComponent("turnoverAnalysis", ctxA, { headcount: 200, leaversLast12Months: 10 });
    assert.equal(r.ok, true);
    // avgHeadcount = 205; rate = 10/205*100 = 4.88 → 4.9 → "low".
    assert.equal(r.result.ratePct, 4.9);
    assert.ok(r.result.ratePct < r.result.benchmarkPct);
    assert.equal(r.result.band, "low");
    assertNoNonFiniteNumbers(r.result);
  });

  it("VALIDATION: non-positive headcount → {ok:false}, never a divide-by-zero crash", () => {
    const r = callViaComponent("turnoverAnalysis", ctxA, { headcount: 0, leaversLast12Months: 5 });
    assert.equal(r.ok, false);
    assert.equal(typeof (r.error || r.message), "string");
  });
});

/* ───────────────────── interviewScorecard ───────────────────── */

describe("hr.interviewScorecard — EXACT fields the InterviewResult card renders", () => {
  it("renders totalScore / passingScore / recommendation / topStrengths / topWeaknesses with real computed values", () => {
    // HrActionPanel parses the textarea into { dim: N } and sends scores as an
    // object map, candidate as a string.
    const r = callViaComponent("interviewScorecard", ctxA, {
      candidate: "Dana",
      scores: { technical: 5, communication: 4, culture: 2, systems: 1 },
    });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.totalScore, "number");
    assert.equal(typeof x.passingScore, "number");
    assert.equal(typeof x.recommendation, "string");
    assert.ok(Array.isArray(x.topStrengths), "topStrengths is the array the card maps");
    assert.ok(Array.isArray(x.topWeaknesses), "topWeaknesses is the array the card maps");
    // real math: mean(5,4,2,1)=3 → 3/5*100 = 60 → totalScore 60.
    assert.equal(x.totalScore, 60);
    assert.equal(x.passingScore, 70);
    assert.equal(x.recommendation, "maybe"); // 55..69
    // strengths = dims ≥4 (technical, communication), sorted desc.
    assert.deepEqual(x.topStrengths, ["technical", "communication"]);
    // weaknesses = dims ≤2 (culture 2, systems 1), sorted asc.
    assert.deepEqual(x.topWeaknesses, ["systems", "culture"]);
    assertNoNonFiniteNumbers(x);
  });

  it("an all-strong candidate clears the bar with a strong-hire / hire recommendation", () => {
    const r = callViaComponent("interviewScorecard", ctxA, {
      candidate: "Sam",
      scores: { technical: 5, communication: 5, culture: 5, experience: 4 },
    });
    assert.equal(r.ok, true);
    // mean(5,5,5,4)=4.75 → 95 → strong-hire (≥88).
    assert.equal(r.result.totalScore, 95);
    assert.equal(r.result.recommendation, "strong-hire");
    assert.ok(r.result.totalScore >= r.result.passingScore);
    assert.equal(r.result.topWeaknesses.length, 0);
    assertNoNonFiniteNumbers(r.result);
  });

  it("VALIDATION: no scores → empty-shape message; missing candidate → {ok:false}", () => {
    const noScores = callViaComponent("interviewScorecard", ctxA, { candidate: "Lee", scores: {} });
    assert.equal(noScores.ok, true);
    assert.equal(noScores.result.message, "Add interview scores (one per line: dimension 1-5).");
    const noName = callViaComponent("interviewScorecard", ctxA, { scores: { technical: 4 } });
    assert.equal(noName.ok, false);
    assert.equal(typeof (noName.error || noName.message), "string");
  });
});

/* ───────────────────── ptoBalance ───────────────────── */

describe("hr.ptoBalance — EXACT fields the PtoResult card renders", () => {
  it("renders accrued / used / remaining / rolloverDate with real computed values", () => {
    const r = callViaComponent("ptoBalance", ctxA, { employeeId: "emp_42", annualDays: 24 });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.accrued, "number");
    assert.equal(typeof x.used, "number");
    assert.equal(typeof x.remaining, "number");
    assert.equal(typeof x.rolloverDate, "string");
    assert.equal(x.employeeId, "emp_42");
    // accrued = annualDays/12 * monthsElapsed; used 0 with no STATE PTO →
    // remaining === accrued; rolloverDate is the next Jan 1.
    const now = new Date();
    const expectedAccrued = Math.round((24 / 12) * (now.getMonth() + 1) * 10) / 10;
    assert.equal(x.accrued, expectedAccrued);
    assert.equal(x.used, 0);
    assert.equal(x.remaining, expectedAccrued);
    assert.equal(x.rolloverDate, `${now.getFullYear() + 1}-01-01`);
    // accrual never exceeds the annual grant.
    assert.ok(x.accrued <= 24);
    assertNoNonFiniteNumbers(x);
  });

  it("approved PTO on STATE reduces remaining below accrued", () => {
    const now = new Date();
    const year = now.getFullYear();
    globalThis._concordSTATE = {
      hrLens: {
        timeoff: new Map([["hr_a", [
          { employeeId: "emp_9", kind: "vacation", status: "approved", startDate: `${year}-03-01`, days: 3 },
          { employeeId: "emp_9", kind: "sick", status: "approved", startDate: `${year}-04-01`, days: 1.5 },
          { employeeId: "emp_9", kind: "vacation", status: "pending", startDate: `${year}-05-01`, days: 5 }, // not counted
        ]]]),
      },
    };
    const r = callViaComponent("ptoBalance", ctxA, { employeeId: "emp_9", annualDays: 20 });
    assert.equal(r.ok, true);
    assert.equal(r.result.used, 4.5); // 3 + 1.5 approved; pending ignored
    const accrued = Math.round((20 / 12) * (now.getMonth() + 1) * 10) / 10;
    assert.equal(r.result.accrued, accrued);
    assert.equal(r.result.remaining, Math.round((accrued - 4.5) * 10) / 10);
    assert.ok(r.result.remaining < r.result.accrued);
    assertNoNonFiniteNumbers(r.result);
  });

  it("VALIDATION: missing employeeId or non-positive annualDays → {ok:false}", () => {
    const noId = callViaComponent("ptoBalance", ctxA, { annualDays: 20 });
    assert.equal(noId.ok, false);
    const zero = callViaComponent("ptoBalance", ctxA, { employeeId: "e", annualDays: 0 });
    assert.equal(zero.ok, false);
    assert.equal(typeof (zero.error || zero.message), "string");
  });
});

/* ───────── DEGRADE-GRACEFUL: pure compute survives STATE loss ───────── */

describe("hr lens — degrade-graceful (stateless calculators never throw)", () => {
  it("compensationBenchmark / turnoverAnalysis / interviewScorecard / ptoBalance compute with STATE gone", () => {
    globalThis._concordSTATE = undefined;
    globalThis._concordSaveStateDebounced = undefined;
    const cases = [
      ["compensationBenchmark", { role: "Product Manager", location: "Austin" }],
      ["turnoverAnalysis", { headcount: 50, leaversLast12Months: 7 }],
      ["interviewScorecard", { candidate: "Q", scores: { technical: 4, culture: 3 } }],
      ["ptoBalance", { employeeId: "emp_x", annualDays: 15 }],
    ];
    for (const [name, input] of cases) {
      const r = callViaComponent(name, ctxA, input);
      assert.equal(r.ok, true, `${name} must degrade-graceful with no STATE`);
      assertNoNonFiniteNumbers(r.result);
    }
  });
});

/* ───────── FAIL-CLOSED: poisoned numerics never leak NaN/Infinity ───────── */

describe("hr lens — fail-CLOSED on poisoned numerics (Number.isFinite, not parseFloat)", () => {
  it("turnoverAnalysis: 'Infinity' / 'NaN' / '12abc' headcount+leavers never leak a non-finite ratePct", () => {
    // 'Infinity' headcount must NOT be accepted (parseFloat would → Infinity →
    // 0% rate that looks valid) → collapses to 0 → non-positive → {ok:false}.
    const r = callViaComponent("turnoverAnalysis", ctxA, { headcount: "Infinity", leaversLast12Months: "NaN" });
    assert.equal(r.ok, false, "'Infinity' headcount rejected, not accepted as a real N");
    // a valid headcount but poisoned leavers → leavers falls to 0, rate stays finite.
    const r2 = callViaComponent("turnoverAnalysis", ctxA, { headcount: 80, leaversLast12Months: "12abc" });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.leaversLast12Months, 0, "'12abc' rejected to 0, not accepted as 12");
    assert.ok(Number.isFinite(r2.result.ratePct));
    assertNoNonFiniteNumbers(r2.result);
  });

  it("ptoBalance: poisoned annualDays / poisoned STATE days never produce NaN/Infinity", () => {
    // 'Infinity' annualDays rejected → non-positive → {ok:false}.
    const r = callViaComponent("ptoBalance", ctxA, { employeeId: "e", annualDays: "Infinity" });
    assert.equal(r.ok, false);
    // poisoned used-day rows on STATE must not poison the math.
    const now = new Date();
    globalThis._concordSTATE = {
      hrLens: {
        timeoff: new Map([["hr_a", [
          { employeeId: "emp_p", kind: "vacation", status: "approved", startDate: `${now.getFullYear()}-02-01`, days: "NaN" },
          { employeeId: "emp_p", kind: "vacation", status: "approved", startDate: `${now.getFullYear()}-02-02`, days: 2 },
        ]]]),
      },
    };
    const r2 = callViaComponent("ptoBalance", ctxA, { employeeId: "emp_p", annualDays: 18 });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.used, 2, "the NaN-days row collapses to 0, the real 2-day row counts");
    assert.ok(Number.isFinite(r2.result.remaining));
    assertNoNonFiniteNumbers(r2.result);
  });

  it("interviewScorecard: out-of-range '12abc' / 99 scores are clamped/rejected, totalScore stays in [0,100]", () => {
    const r = callViaComponent("interviewScorecard", ctxA, {
      candidate: "Z",
      scores: { technical: "12abc", communication: 99, culture: 4 },
    });
    assert.equal(r.ok, true);
    // '12abc' → 0 (dropped, score>0 filter), 99 → clamp 5, culture 4. mean(5,4)=4.5 → 90.
    assert.equal(r.result.totalScore, 90);
    assert.ok(r.result.totalScore >= 0 && r.result.totalScore <= 100, "totalScore never leaves [0,100]");
    assertNoNonFiniteNumbers(r.result);
  });

  it("compensationBenchmark: a role with no salary/numeric input still yields finite $k figures", () => {
    const r = callViaComponent("compensationBenchmark", ctxA, { role: "Recruiter", location: "" });
    assert.equal(r.ok, true);
    for (const k of ["market50", "market75", "rangeLow", "rangeHigh", "offerSuggestion"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k} must be finite`);
      assert.ok(r.result[k] > 0, `${k} must be a positive $k figure`);
    }
    assertNoNonFiniteNumbers(r.result);
  });
});
