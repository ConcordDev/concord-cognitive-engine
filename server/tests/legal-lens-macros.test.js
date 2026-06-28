// legal-lens-macros.test.js — Phase-2 component-exact-shape behavioral gate.
//
// Drives each legal calculator with the EXACT inner-data object the live
// surfaces send (LegalActionPanel.callMacro channel + page.tsx handleAction
// channel), through the REAL 3-arg dispatch contract, and asserts the EXACT
// fields the components render — with real computed values, validation
// rejection, degrade-graceful, and fail-CLOSED poisoned-numeric handling.
//
// Dispatch fidelity: /api/lens/run peels a sole-key {artifact:{data}} wrapper,
// then sets virtualArtifact.data = rest AND passes rest as params (same object).
// So the handler sees artifact.data.X and params.X as the same plain object.
// callLens() reproduces that exactly (data === params === input).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLegalActions from "../domains/legal.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

// Reproduce the real dispatch: peel one redundant {artifact:{data}} layer, then
// hand the SAME object as both artifact.data and params.
function callLens(name, input = {}, ctx = baseCtx) {
  const fn = ACTIONS.get(`legal.${name}`);
  assert.ok(fn, `legal.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input || {});
  const virtualArtifact = { id: input?.id ?? null, title: input?.title, domain: "legal", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

const baseCtx = { actor: { userId: "lawyer_a" }, userId: "lawyer_a" };

before(() => { registerLegalActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

// A fixed "today" anchor so day-deltas are deterministic relative to run time.
function isoIn(days) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ───────────────────────── deadlineCheck ─────────────────────────
   LegalActionPanel.actDeadline sends { items: [{name,deadline,severity}],
   daysAhead }. Handler returns { upcoming:[...item, daysUntil], count }.
   Panel renders upcoming[].name / .daysUntil / .severity and count. */
describe("legal.deadlineCheck (LegalActionPanel)", () => {
  it("computes real daysUntil + count for the EXACT panel input", () => {
    const input = { items: [
      { name: "Answer due", deadline: isoIn(10), severity: "high" },
      { name: "Discovery cutoff", deadline: isoIn(40), severity: "medium" },
    ], daysAhead: 3650 };
    const r = callLens("deadlineCheck", input);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.upcoming.length, 2);
    // sorted ascending by daysUntil; closest first
    assert.equal(r.result.upcoming[0].name, "Answer due");
    assert.equal(r.result.upcoming[0].daysUntil, 10);
    assert.equal(r.result.upcoming[0].severity, "high");
    assert.equal(r.result.upcoming[1].daysUntil, 40);
  });

  it("degrades graceful on empty items (no throw, count 0)", () => {
    const r = callLens("deadlineCheck", { items: [], daysAhead: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.upcoming, []);
  });

  it("fail-CLOSED on poisoned deadline string (dropped, count finite)", () => {
    const r = callLens("deadlineCheck", { items: [{ name: "bad", deadline: "Infinity", severity: "high" }], daysAhead: 3650 });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.count));
    assert.equal(r.result.count, 0); // NaN daysUntil filtered out
  });
});

/* ───────────────────────── contractRenewal ──────────────────────
   actRenewal calls per-contract with { expiryDate, renewalType, title }.
   Handler returns { daysUntilExpiry, urgency, autoRenewal, actionRequired }. */
describe("legal.contractRenewal (LegalActionPanel)", () => {
  it("computes daysUntilExpiry + urgency band for the EXACT input", () => {
    const r = callLens("contractRenewal", { expiryDate: isoIn(10), renewalType: "manual", title: "MSA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.daysUntilExpiry, 10);
    assert.equal(r.result.urgency, "critical"); // <=14
    assert.equal(r.result.autoRenewal, false);
    assert.equal(r.result.actionRequired, true); // <=60
  });

  it("auto-renewal flag + medium urgency band", () => {
    const r = callLens("contractRenewal", { expiryDate: isoIn(45), renewalType: "auto", title: "Lease" });
    assert.equal(r.result.autoRenewal, true);
    assert.equal(r.result.urgency, "medium"); // <=60
    assert.equal(r.result.actionRequired, true);
  });

  it("degrades graceful when no expiry date", () => {
    const r = callLens("contractRenewal", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "no_expiry");
  });

  it("fail-CLOSED daysUntilExpiry stays finite for a far-future date", () => {
    const r = callLens("contractRenewal", { expiryDate: isoIn(400), renewalType: "manual" });
    assert.ok(Number.isFinite(r.result.daysUntilExpiry));
    assert.equal(r.result.urgency, "low");
  });

  it("fail-CLOSED on poisoned expiry date (no NaN urgency leak)", () => {
    const r = callLens("contractRenewal", { expiryDate: "Infinity", renewalType: "manual" });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "no_expiry");
    assert.equal(r.result.daysUntilExpiry, undefined);
  });
});

/* ───────────────────────── conflictCheck ────────────────────────
   actConflict sends { client, parties:[A], checkAgainst:[B] }.
   Handler returns { conflicts:[{name,conflictType,caseId}], hasConflict, checkedAt }. */
describe("legal.conflictCheck (LegalActionPanel)", () => {
  it("flags a direct-party conflict for the EXACT input", () => {
    const input = { id: "case_1", client: "Acme Co", parties: ["Acme Co"], checkAgainst: ["Acme Co"] };
    const r = callLens("conflictCheck", input);
    assert.equal(r.ok, true);
    assert.equal(r.result.hasConflict, true);
    assert.equal(r.result.conflicts.length, 1);
    assert.equal(r.result.conflicts[0].name, "Acme Co");
    assert.equal(r.result.conflicts[0].conflictType, "direct_party");
    assert.ok(typeof r.result.checkedAt === "string");
  });

  it("clear when checkAgainst name is unrelated", () => {
    const r = callLens("conflictCheck", { client: "Acme Co", parties: ["Acme Co"], checkAgainst: ["Globex"] });
    assert.equal(r.result.hasConflict, false);
    assert.deepEqual(r.result.conflicts, []);
  });

  it("degrades graceful with no checkAgainst (no throw)", () => {
    const r = callLens("conflictCheck", { client: "Acme Co", parties: ["Acme Co"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasConflict, false);
  });
});

/* ───────────────────────── complianceAudit ──────────────────────
   actAudit sends { requirements:[{name,deadline,status}] }.
   Handler returns { score, rating, passed, failed, findings, checklist, ... }.
   Panel renders score + rating + findings.length. */
describe("legal.complianceAudit (LegalActionPanel)", () => {
  it("scores requirements for the EXACT input", () => {
    const input = { requirements: [
      { name: "CLE credits", deadline: isoIn(30), status: "compliant" },
      { name: "Trust recon", deadline: isoIn(-5), status: "pending" }, // overdue
    ] };
    const r = callLens("complianceAudit", input);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRequirements, 2);
    assert.equal(r.result.passed, 1);
    assert.equal(r.result.failed, 1);
    assert.equal(r.result.score, 50);
    assert.equal(r.result.rating, "fair"); // 50 => fair
    assert.equal(r.result.findings.length, 1);
    assert.equal(r.result.findings[0].requirement, "Trust recon");
    assert.equal(r.result.findings[0].severity, "high"); // overdue
  });

  it("degrades graceful on empty requirements (perfect score)", () => {
    const r = callLens("complianceAudit", { requirements: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 100);
    assert.equal(r.result.rating, "excellent");
  });
});

/* ───────────────────────── complianceScore (page inline) ────────
   page.tsx renders score / total / compliant / overdue. */
describe("legal.complianceScore (page inline panel)", () => {
  it("computes score/compliant/overdue for the EXACT rendered fields", () => {
    const input = { requirements: [
      { status: "compliant" },
      { status: "compliant" },
      { status: "overdue" },
      { deadline: isoIn(-3), status: "pending" }, // overdue by date
    ] };
    const r = callLens("complianceScore", input);
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 4);
    assert.equal(r.result.compliant, 2);
    assert.equal(r.result.score, 50);
    assert.equal(r.result.overdue, 2);
    assert.equal(r.result.rating, "fair");
  });

  it("degrades graceful on empty (total 0, score 100)", () => {
    const r = callLens("complianceScore", { requirements: [] });
    assert.equal(r.result.total, 0);
    assert.equal(r.result.score, 100);
  });
});

/* ───────────────────────── deadlineCalculator (page inline) ─────
   page.tsx button. Reads filingDate + jurisdiction; returns deadlines[]. */
describe("legal.deadlineCalculator (page inline panel)", () => {
  it("computes jurisdiction deadlines for the EXACT input", () => {
    const r = callLens("deadlineCalculator", { filingDate: isoIn(0), jurisdiction: "federal" });
    assert.equal(r.ok, true);
    assert.equal(r.result.jurisdiction, "federal");
    assert.equal(r.result.deadlines.length, 5);
    const resp = r.result.deadlines.find(d => d.event === "Response Due");
    assert.equal(resp.daysFromFiling, 21); // federal responseDays
    assert.ok(Number.isFinite(resp.daysRemaining));
    assert.ok(["past", "urgent", "upcoming", "future"].includes(resp.status));
  });

  it("validation: rejects missing filing date", () => {
    const r = callLens("deadlineCalculator", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.error, "No filing date provided");
  });

  it("fail-CLOSED on poisoned filing date (no RangeError throw)", () => {
    const r = callLens("deadlineCalculator", { filingDate: "Infinity" });
    assert.equal(r.ok, true);
    assert.equal(r.result.error, "Invalid filing date");
  });
});

/* ───────────────────────── generateInvoice (page inline) ────────
   page.tsx handleAction('generateInvoice'). Reads timeEntries/expenses;
   returns subtotal/taxAmount/total. */
describe("legal.generateInvoice (page inline panel)", () => {
  it("sums labor + expenses + tax for the EXACT input", () => {
    const input = {
      client: "Acme Co",
      timeEntries: [
        { date: isoIn(-2), description: "Drafting", attorney: "JD", hours: 2, rate: 300 },
        { date: isoIn(-1), description: "Review", attorney: "JD", hours: 1.5, rate: 300 },
      ],
      expenses: [{ description: "Filing fee", amount: 50 }],
    };
    const r = callLens("generateInvoice", { ...input, taxRate: 0.1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalHours, 3.5);
    assert.equal(r.result.laborSubtotal, 1050); // 2*300 + 1.5*300
    assert.equal(r.result.expenseSubtotal, 50);
    assert.equal(r.result.subtotal, 1100);
    assert.equal(r.result.taxAmount, 110); // 1100 * 0.1
    assert.equal(r.result.total, 1210);
    assert.ok(Number.isFinite(r.result.total));
  });

  it("degrades graceful with no entries (zero totals)", () => {
    const r = callLens("generateInvoice", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 0);
    assert.equal(r.result.total, 0);
  });

  it("fail-CLOSED on poisoned numeric (Infinity hours coerced to 0, total finite)", () => {
    const r = callLens("generateInvoice", {
      timeEntries: [{ description: "x", hours: "Infinity", rate: "1e999" }],
      expenses: [{ description: "y", amount: "Infinity" }],
      taxRate: "Infinity",
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.total), "total must be finite");
    assert.ok(Number.isFinite(r.result.subtotal));
    assert.ok(Number.isFinite(r.result.taxAmount));
    assert.equal(r.result.total, 0);
  });
});

/* ───────────────────────── caseSummary (page inline) ────────────
   page.tsx handleAction('caseSummary'). Reads parties/timeEntries/etc;
   returns billingTotal + keyDates. */
describe("legal.caseSummary (page inline panel)", () => {
  it("computes billingTotal + keyDates for the EXACT input", () => {
    const input = {
      id: "case_42",
      title: "Smith v. Jones",
      client: "Smith",
      opposingParty: "Jones",
      parties: ["Smith", "Jones"],
      status: "active",
      filingDate: isoIn(-100),
      documents: [{}, {}],
      timeEntries: [{ hours: 3, rate: 250 }, { hours: 1, rate: 250 }],
      nextHearing: isoIn(20),
    };
    const r = callLens("caseSummary", input);
    assert.equal(r.ok, true);
    assert.equal(r.result.caseId, "case_42");
    assert.equal(r.result.title, "Smith v. Jones");
    assert.equal(r.result.billingTotal, 1000); // 3*250 + 1*250
    assert.equal(r.result.relatedDocumentsCount, 2);
    assert.ok(r.result.keyDates.some(k => k.event === "Filing"));
    assert.ok(r.result.keyDates.some(k => k.event === "Next Hearing"));
  });

  it("fail-CLOSED on poisoned billing numerics (billingTotal finite)", () => {
    const r = callLens("caseSummary", {
      id: "c", title: "t",
      timeEntries: [{ hours: "Infinity", rate: "1e999" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.billingTotal));
    assert.equal(r.result.billingTotal, 0);
  });
});
