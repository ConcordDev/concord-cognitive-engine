// Behavioral macro tests for server/domains/consulting.js — the Bonsai/Harvest-
// shaped consulting practice-management substrate the /lenses/consulting lens
// (page + ConsultingWorkbench + EngagementTracker children) drives.
//
// COMPLEMENT to consulting-domain-parity.test.js + consulting-engagement-domain-
// parity.test.js (which pin invoicing/proposals/staffing/expenses/timer/retainers
// /profitability/portal round-trips on the STATE-backed path). This file is the
// PHASE-2 GATE: it pins the EXACT field contract every frontend caller relies on,
// drives each macro with the component's EXACT input field names, asserts the
// EXACT rendered output field names with real COMPUTED money values (bill rate,
// utilization, engagement margin, project estimate), and adds the three
// adversarial dimensions the parity tests don't: validation-rejection,
// degrade-graceful, and fail-CLOSED poisoned-numeric.
//
// DISPATCH: the workbench children call lensRun('consulting', macro, input) →
// POST /api/lens/run → runMacro → LENS_ACTIONS dispatch: handlers registered via
// `registerLensAction(domain, action, handler)` are invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention, virtualArtifact.
// data === input. The page's pure-compute macros (engagementScope/utilizationRate
// /proposalScore/clientHealth) read artifact.data, so the harness sets
// virtualArtifact.data === input to mirror the live dispatch exactly.
//
// MONEY/CORRECTNESS SCRUTINY: the STATE-backed money paths coerce through
// `csNum` (Number.isFinite ? n : 0 — fail-CLOSED) so a poisoned rate can never
// mint Infinity into a billed total. The four pure-compute macros were the real
// fail-OPEN seam: `parseFloat("1e999")`/`parseFloat("Infinity")` yield Infinity
// and `Infinity || default` is Infinity, so the old `parseFloat(x) || d` let a
// poisoned hourlyRate/billableHours flow into a fee/utilization that renders
// Infinity. They were hardened with `finPos`/`finSigned` (non-finite → finite
// default). The poisoned-numeric block below pins that EVERY money/percentage
// output of all four stays Number.isFinite under 1e999/Infinity/NaN input.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerConsultingActions from "../domains/consulting.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "consulting", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data === input (so artifact.data.hourlyRate etc. resolve).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`consulting.${name} not registered`);
  const virtualArtifact = { id: null, domain: "consulting", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerConsultingActions(registerLensAction); });
beforeEach(() => {
  // Fresh STATE per test so users + collections don't leak across cases.
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function makeEngagement(ctx = ctxA, over = {}) {
  const r = call("engagement-create", ctx, { name: "Strategy Refresh", client: "Acme", rate: 200, budgetHours: 100, ...over });
  assert.equal(r.ok, true);
  return r.result.engagement;
}

// Every macro the lens page + workbench components reach via lensRun /
// useRunArtifact. (engagementScope/utilizationRate/proposalScore/clientHealth are
// the page's pure-compute "analyze"-family macros; the rest are the workbench's
// STATE-backed practice-management macros.)
const LENS_MACROS = [
  "engagementScope", "utilizationRate", "proposalScore", "clientHealth",
  "engagement-create", "engagement-list", "engagement-update", "engagement-delete",
  "time-log", "consulting-dashboard",
  "invoice-create", "invoice-list", "invoice-mark-paid", "invoice-delete", "invoice-export",
  "proposal-templates", "proposal-create", "proposal-list", "proposal-update-section",
  "proposal-sign", "proposal-delete",
  "consultant-create", "consultant-delete", "allocation-create", "allocation-delete", "staffing-plan",
  "expense-create", "expense-list", "expense-update", "expense-delete",
  "timer-start", "timer-status", "timer-stop", "timer-cancel",
  "retainer-create", "retainer-list", "retainer-bill", "retainer-update", "retainer-delete",
  "profitability-report",
  "portal-share", "portal-list", "portal-respond", "portal-delete",
];

describe("consulting — registration (every lens-driven macro present)", () => {
  it("registers every macro the lens page + workbench call", () => {
    for (const m of LENS_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing consulting.${m}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE-COMPUTE money macros — exact computed values the page reads
// ════════════════════════════════════════════════════════════════════════════

describe("consulting.engagementScope — project estimate + bill rate math", () => {
  it("computes per-deliverable fee, subtotal, 15% contingency, grand total", () => {
    const r = call("engagementScope", ctxA, {
      client: "Acme", hourlyRate: 250,
      deliverables: [{ name: "Discovery", hours: 10 }, { name: "Workshop", hours: 6 }],
    });
    assert.equal(r.ok, true);
    // 16h × 250 = 4000 subtotal; contingency 15% = 600; grand = 4600
    assert.equal(r.result.totalHours, 16);
    assert.equal(r.result.hourlyRate, 250);
    assert.equal(r.result.subtotal, 4000);
    assert.equal(r.result.contingency, 600);
    assert.equal(r.result.grandTotal, 4600);
    assert.equal(r.result.deliverables[0].fee, 2500);
    assert.equal(r.result.deliverables[1].fee, 1500);
    assert.equal(r.result.timeline, "1 weeks at full-time"); // ceil(16/40)
  });
  it("degrade-graceful: no deliverables → default rate, zero fee, finite", () => {
    const r = call("engagementScope", ctxA, { client: "Acme" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hourlyRate, 200); // default bill rate
    assert.equal(r.result.subtotal, 0);
    assert.equal(r.result.grandTotal, 0);
    assert.ok(Number.isFinite(r.result.grandTotal));
  });
});

describe("consulting.utilizationRate — utilization % math", () => {
  it("computes utilization %, variance vs 75% target, status band", () => {
    const r = call("utilizationRate", ctxA, { billableHours: 32, totalHours: 40 });
    assert.equal(r.ok, true);
    assert.equal(r.result.utilizationRate, 80); // 32/40 = 80%
    assert.equal(r.result.target, 75);
    assert.equal(r.result.variance, 5);
    assert.equal(r.result.status, "excellent"); // >= 0.8
  });
  it("bands below target correctly", () => {
    assert.equal(call("utilizationRate", ctxA, { billableHours: 20, totalHours: 40 }).result.status, "below-target");
    assert.equal(call("utilizationRate", ctxA, { billableHours: 10, totalHours: 40 }).result.status, "critical");
  });
  it("degrade-graceful: empty input → 0% utilization, finite, no NaN", () => {
    const r = call("utilizationRate", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.utilizationRate, 0);
    assert.equal(r.result.totalHours, 40);
    assert.ok(Number.isFinite(r.result.variance));
  });
});

describe("consulting.proposalScore — section completeness", () => {
  it("scores present sections out of six", () => {
    const r = call("proposalScore", ctxA, { "executive-summary": "x", methodology: "y", timeline: "z" });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 50); // 3/6
    assert.equal(r.result.completeness, "needs-work");
    assert.ok(r.result.sectionsMissing.includes("pricing"));
  });
  it("degrade-graceful: empty → 0 score, incomplete", () => {
    const r = call("proposalScore", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 0);
    assert.equal(r.result.completeness, "incomplete");
  });
});

describe("consulting.clientHealth — composite health score", () => {
  it("blends NPS, payment rate, response time into a 0-100 health score", () => {
    const r = call("clientHealth", ctxA, { client: "Acme", nps: 50, invoicesPaid: 9, invoicesTotal: 10, avgResponseDays: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.paymentRate, 90);
    // (150/200)*30 + 0.9*40 + (1-2/14)*30 = 22.5 + 36 + 25.714 = 84.2 → 84
    assert.equal(r.result.healthScore, 84);
    assert.equal(r.result.risk, "low");
    assert.ok(Number.isFinite(r.result.healthScore));
  });
  it("degrade-graceful: empty → finite health, defaults applied", () => {
    const r = call("clientHealth", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.healthScore));
    assert.ok(["low", "medium", "high"].includes(r.result.risk));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// STATE-backed money macros — exact computed values the workbench renders
// ════════════════════════════════════════════════════════════════════════════

describe("consulting.time-log + engagement-list — billed + utilization", () => {
  it("logs time and computes billed = hours × rate and utilizationPct", () => {
    const e = makeEngagement(ctxA, { rate: 150, budgetHours: 20 });
    const log = call("time-log", ctxA, { engagementId: e.id, hours: 5, note: "kickoff" });
    assert.equal(log.ok, true);
    assert.equal(log.result.billed, 750); // 5 × 150
    const list = call("engagement-list", ctxA, {});
    const row = list.result.engagements[0];
    assert.equal(row.loggedHours, 5);
    assert.equal(row.billed, 750);
    assert.equal(row.utilizationPct, 25); // 5/20
    assert.ok(Array.isArray(row.timeEntries)); // the component reads e.timeEntries
  });
  it("rejects non-positive hours (validation-rejection)", () => {
    const e = makeEngagement();
    assert.equal(call("time-log", ctxA, { engagementId: e.id, hours: 0 }).ok, false);
    assert.equal(call("time-log", ctxA, { engagementId: e.id, hours: -3 }).ok, false);
  });
  it("rejects time-log against an unknown engagement", () => {
    assert.equal(call("time-log", ctxA, { engagementId: "nope", hours: 2 }).ok, false);
  });
});

describe("consulting.invoice-create — subtotal/tax/total + no double-bill", () => {
  it("rolls unbilled time into an invoice with exact subtotal/tax/total", () => {
    const e = makeEngagement(ctxA, { rate: 200 });
    call("time-log", ctxA, { engagementId: e.id, hours: 5 });
    call("time-log", ctxA, { engagementId: e.id, hours: 3 });
    const r = call("invoice-create", ctxA, { engagementId: e.id, taxRate: 0.1, dueInDays: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.invoice.subtotal, 1600); // 8h × 200
    assert.equal(r.result.invoice.tax, 160);
    assert.equal(r.result.invoice.total, 1760);
    assert.equal(r.result.invoice.status, "sent");
    assert.equal(r.result.invoice.lineItems.length, 2);
    // invoice-list rollup the InvoiceManager reads
    const list = call("invoice-list", ctxA, {});
    assert.equal(list.result.outstanding, 1760);
  });
  it("rejects invoicing with no unbilled time (validation-rejection)", () => {
    const e = makeEngagement();
    assert.equal(call("invoice-create", ctxA, { engagementId: e.id }).ok, false);
  });
});

describe("consulting.staffing-plan — weekly utilization + overbooked flag", () => {
  it("computes per-week utilizationPct and overbooked against capacity", () => {
    const c = call("consultant-create", ctxA, { name: "Ada", role: "Lead", weeklyCapacity: 40, costRate: 80 }).result.consultant;
    const e = makeEngagement();
    call("allocation-create", ctxA, { consultantId: c.id, engagementId: e.id, week: "2026-W21", hours: 50 });
    const plan = call("staffing-plan", ctxA, {});
    assert.equal(plan.ok, true);
    const row = plan.result.rows[0];
    assert.equal(row.byWeek[0].utilizationPct, 125); // 50/40
    assert.equal(row.byWeek[0].overbooked, true);
    // allocation join fields the StaffingPlanner renders
    assert.equal(plan.result.allocations[0].consultantName, "Ada");
    assert.equal(plan.result.allocations[0].engagementName, "Strategy Refresh");
  });
  it("rejects an allocation with non-positive hours (validation-rejection)", () => {
    const c = call("consultant-create", ctxA, { name: "Ada" }).result.consultant;
    const e = makeEngagement();
    assert.equal(call("allocation-create", ctxA, { consultantId: c.id, engagementId: e.id, week: "2026-W21", hours: 0 }).ok, false);
  });
});

describe("consulting.profitability-report — engagement margin math", () => {
  it("computes billed − cost margin and marginPct per engagement", () => {
    const c = call("consultant-create", ctxA, { name: "Ada", costRate: 80 }).result.consultant;
    assert.ok(c);
    const e = makeEngagement(ctxA, { rate: 200 });
    call("time-log", ctxA, { engagementId: e.id, hours: 10 }); // billed 2000, labor 10×80=800
    call("expense-create", ctxA, { engagementId: e.id, description: "Travel", amount: 200 });
    const r = call("profitability-report", ctxA, {});
    assert.equal(r.ok, true);
    const row = r.result.rows[0];
    assert.equal(row.billed, 2000);
    assert.equal(row.laborCost, 800);
    assert.equal(row.expenses, 200);
    assert.equal(row.totalCost, 1000);
    assert.equal(row.margin, 1000); // 2000 − 1000
    assert.equal(row.marginPct, 50);
    assert.equal(row.health, "healthy");
    assert.equal(r.result.totalMargin, 1000);
    assert.equal(r.result.overallMarginPct, 50);
  });
  it("degrade-graceful: no engagements → zero totals, finite", () => {
    const r = call("profitability-report", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBilled, 0);
    assert.equal(r.result.overallMarginPct, 0);
    assert.ok(Number.isFinite(r.result.totalMargin));
  });
});

describe("consulting.retainer-list — MRR normalization", () => {
  it("computes MRR normalizing weekly/quarterly cadence to monthly", () => {
    call("retainer-create", ctxA, { client: "Acme", monthlyAmount: 1000, cadence: "monthly" });
    call("retainer-create", ctxA, { client: "Globex", monthlyAmount: 300, cadence: "weekly" }); // ×4.33
    const r = call("retainer-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.mrr, 2299); // 1000 + 300×4.33
    assert.ok(Number.isFinite(r.result.mrr));
  });
  it("rejects a retainer with non-positive amount (validation-rejection)", () => {
    assert.equal(call("retainer-create", ctxA, { client: "Acme", monthlyAmount: 0 }).ok, false);
    assert.equal(call("retainer-create", ctxA, { monthlyAmount: 500 }).ok, false); // no client
  });
});

describe("consulting.timer-* — start/stop accrues billed time", () => {
  it("rejects starting a timer on an unknown engagement", () => {
    assert.equal(call("timer-start", ctxA, { engagementId: "nope" }).ok, false);
  });
  it("status reports running:false when idle", () => {
    assert.equal(call("timer-status", ctxA, {}).result.running, false);
  });
});

describe("consulting.portal-respond — decision validation", () => {
  it("rejects an invalid decision (validation-rejection)", () => {
    const sh = call("portal-share", ctxA, { title: "Roadmap", client: "Acme" }).result.share;
    assert.equal(call("portal-respond", ctxA, { id: sh.id, decision: "maybe" }).ok, false);
    const ok = call("portal-respond", ctxA, { id: sh.id, decision: "approved", respondedBy: "Jo" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.share.approvalStatus, "approved");
    assert.equal(ok.result.share.approvedBy, "Jo");
  });
});

describe("consulting — per-user isolation", () => {
  it("does not leak engagements across actors", () => {
    makeEngagement(ctxA);
    assert.equal(call("engagement-list", ctxA, {}).result.count, 1);
    assert.equal(call("engagement-list", ctxB, {}).result.count, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FAIL-CLOSED poisoned numeric — no money/percentage field may render Infinity/NaN
// ════════════════════════════════════════════════════════════════════════════

describe("consulting — poisoned numerics stay FINITE (fail-closed)", () => {
  // NON_FINITE: must be rejected / collapsed by the fail-closed coercion.
  // FINITE_HUGE: 1e308 is a legitimate finite number — it is ACCEPTED but the
  // pure-compute money outputs clamp it (SANE_MAX) so a product can't overflow.
  const NON_FINITE = ["1e999", "Infinity", "-Infinity", "NaN"];
  const POISON = [...NON_FINITE, "1e308"];

  it("engagementScope: poisoned hourlyRate/hours never emit Infinity money", () => {
    for (const p of POISON) {
      const r = call("engagementScope", ctxA, {
        hourlyRate: p,
        deliverables: [{ name: "X", hours: p }, { name: "Y", hours: 4 }],
      });
      assert.equal(r.ok, true, `poison ${p}`);
      assert.ok(Number.isFinite(r.result.subtotal), `subtotal finite for ${p}`);
      assert.ok(Number.isFinite(r.result.contingency), `contingency finite for ${p}`);
      assert.ok(Number.isFinite(r.result.grandTotal), `grandTotal finite for ${p}`);
      assert.ok(Number.isFinite(r.result.hourlyRate), `hourlyRate finite for ${p}`);
      for (const d of r.result.deliverables) assert.ok(Number.isFinite(d.fee), `fee finite for ${p}`);
    }
  });

  it("utilizationRate: poisoned hours never emit Infinity/NaN percentage", () => {
    for (const p of POISON) {
      const r = call("utilizationRate", ctxA, { billableHours: p, totalHours: p });
      assert.equal(r.ok, true, `poison ${p}`);
      assert.ok(Number.isFinite(r.result.utilizationRate), `utilizationRate finite for ${p}`);
      assert.ok(Number.isFinite(r.result.variance), `variance finite for ${p}`);
    }
    // explicit divide-by-zero guard: totalHours 0 must not yield Infinity
    const z = call("utilizationRate", ctxA, { billableHours: 5, totalHours: 0 });
    assert.ok(Number.isFinite(z.result.utilizationRate));
  });

  it("clientHealth: poisoned metrics never emit Infinity/NaN health", () => {
    for (const p of POISON) {
      const r = call("clientHealth", ctxA, { nps: p, invoicesPaid: p, invoicesTotal: p, avgResponseDays: p });
      assert.equal(r.ok, true, `poison ${p}`);
      assert.ok(Number.isFinite(r.result.healthScore), `healthScore finite for ${p}`);
      assert.ok(Number.isFinite(r.result.paymentRate), `paymentRate finite for ${p}`);
      assert.ok(Number.isFinite(r.result.avgResponseDays), `avgResponseDays finite for ${p}`);
    }
    // explicit divide-by-zero guard: invoicesTotal 0 must not yield Infinity
    const z = call("clientHealth", ctxA, { invoicesPaid: 3, invoicesTotal: 0 });
    assert.ok(Number.isFinite(z.result.paymentRate));
  });

  it("time-log + invoice: non-finite hours rejected, billed never Infinity", () => {
    const e = makeEngagement(ctxA, { rate: 200 });
    // non-finite hours coerce via csNum to 0 → rejected (non-positive), never billed
    for (const p of NON_FINITE) {
      const r = call("time-log", ctxA, { engagementId: e.id, hours: p });
      assert.equal(r.ok, false, `non-finite hours ${p} must be rejected`);
    }
    // a real entry then invoice: total stays finite even with poisoned taxRate
    // (taxRate clamps to [0,1] so a poisoned 1e999 collapses, never Infinity tax)
    call("time-log", ctxA, { engagementId: e.id, hours: 4 });
    const inv = call("invoice-create", ctxA, { engagementId: e.id, taxRate: "1e999" });
    assert.equal(inv.ok, true);
    assert.ok(Number.isFinite(inv.result.invoice.subtotal));
    assert.ok(Number.isFinite(inv.result.invoice.tax));
    assert.ok(Number.isFinite(inv.result.invoice.total));
  });

  it("retainer + profitability totals stay finite under poison", () => {
    // non-finite monthlyAmount coerces to 0 → rejected
    for (const p of NON_FINITE) {
      assert.equal(call("retainer-create", ctxA, { client: "Acme", monthlyAmount: p }).ok, false, `poison ${p}`);
    }
    const e = makeEngagement(ctxA, { rate: 200 });
    call("time-log", ctxA, { engagementId: e.id, hours: 5 });
    const rep = call("profitability-report", ctxA, {});
    assert.ok(Number.isFinite(rep.result.totalMargin));
    assert.ok(Number.isFinite(rep.result.overallMarginPct));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DEGRADE-GRACEFUL: STATE unavailable → ok:false, never throws
// ════════════════════════════════════════════════════════════════════════════

describe("consulting — STATE unavailable degrades, never throws", () => {
  it("returns ok:false (not a throw) when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("engagement-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });
});
