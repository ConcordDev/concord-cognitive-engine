// tests/depth/legal-behavior.test.js — REAL behavioral tests for the legal
// domain (registerLensAction family, via lensRun). Exact-value calcs read
// artifact.data ({ data }); the Clio-parity CRUD macros are STATE-backed and
// scope by ctx.actor.userId, so they round-trip on a shared depthCtx.
//
// lens.run wrapping: success → { ok:true, result:<return> }; a handler that
// returns { ok:false, error } surfaces as { ok:true, result:{ ok:false, error } }.
// So success asserts r.result.<field>; rejection asserts r.result.ok === false.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("legal — calc/contract macros (exact values)", () => {
  it("generateInvoice: labor = Σ(hours*rate); tax = subtotal*rate; total = subtotal+tax", async () => {
    const r = await lensRun("legal", "generateInvoice", {
      data: {
        client: "Acme Corp",
        timeEntries: [
          { hours: 2, rate: 300, description: "Draft motion" },   // 600
          { hours: 1.5, rate: 400, description: "Hearing prep" },  // 600
        ],
        expenses: [{ description: "Filing fee", amount: 50 }],
      },
      params: { taxRate: 0.1 },
    });
    assert.equal(r.result.totalHours, 3.5);          // 2 + 1.5
    assert.equal(r.result.laborSubtotal, 1200);      // 600 + 600
    assert.equal(r.result.expenseSubtotal, 50);
    assert.equal(r.result.subtotal, 1250);           // 1200 + 50
    assert.equal(r.result.taxAmount, 125);           // 1250 * 0.10
    assert.equal(r.result.total, 1375);              // 1250 + 125
  });

  it("complianceAudit: score = passed/total*100; rating banded; overdue is high-severity", async () => {
    const r = await lensRun("legal", "complianceAudit", {
      data: {
        requirements: [
          { name: "Annual report", status: "compliant" },
          { name: "Privacy policy", status: "compliant" },
          { name: "Tax filing", status: "compliant" },
          { name: "Old license", status: "pending", deadline: "2000-01-01" }, // overdue
        ],
      },
    });
    assert.equal(r.result.totalRequirements, 4);
    assert.equal(r.result.passed, 3);
    assert.equal(r.result.failed, 1);
    assert.equal(r.result.score, 75);               // 3/4 * 100
    assert.equal(r.result.rating, "good");          // 70..89
    assert.ok(r.result.findings.some((f) => f.severity === "high" && f.reason === "overdue"));
  });

  it("deadlineCalculator (federal): response/motion/trial dates are exact calendar offsets", async () => {
    const r = await lensRun("legal", "deadlineCalculator", {
      data: { filingDate: "2026-03-01", jurisdiction: "federal" },
    });
    const byEvent = Object.fromEntries(r.result.deadlines.map((d) => [d.event, d]));
    assert.equal(r.result.jurisdiction, "federal");
    assert.equal(byEvent["Response Due"].date, "2026-03-22");        // +21
    assert.equal(byEvent["Discovery Cutoff"].date, "2026-08-28");    // +180
    assert.equal(byEvent["Motion Deadline"].date, "2026-09-11");     // +180+14
    assert.equal(byEvent["Estimated Trial"].date, "2027-03-01");     // +365
  });

  it("court-rules-deadline frcp-12-answer: 21 days, no weekend/holiday roll for a Thu landing", async () => {
    const r = await lensRun("legal", "court-rules-deadline", {
      params: { rule: "frcp-12-answer", triggerDate: "2026-01-01" },
    });
    assert.equal(r.result.days, 21);
    assert.equal(r.result.ruleName, "FRCP 12(a)(1)(A) — Answer to complaint");
    assert.equal(r.result.rawDeadline, "2026-01-22");      // Thursday
    assert.equal(r.result.adjustedDeadline, "2026-01-22"); // no roll needed
    assert.equal(r.result.rolledForward, false);
  });

  it("court-rules-deadline: a deadline landing on a weekend rolls forward to the next business day", async () => {
    // 2026-01-03 is a Saturday; +21 = 2026-01-24 (Saturday) → rolls to Mon 2026-01-26.
    const r = await lensRun("legal", "court-rules-deadline", {
      params: { rule: "frcp-12-answer", triggerDate: "2026-01-03" },
    });
    assert.equal(r.result.rawDeadline, "2026-01-24");      // Saturday
    assert.equal(r.result.adjustedDeadline, "2026-01-26"); // following Monday
    assert.equal(r.result.rolledForward, true);
  });
});

describe("legal — matter / contact / time CRUD round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legal-crud"); });

  it("matters-create → matters-list → matters-detail reads back the persisted matter", async () => {
    const name = `Estate of ${randomUUID().slice(0, 8)}`;
    const created = await lensRun("legal", "matters-create", {
      params: { name, clientName: "Jane Doe", matterType: "probate", hourlyRate: 250 },
    }, ctx);
    const matterId = created.result.matter.id;
    assert.ok(matterId);
    assert.match(created.result.matter.number, /^MAT-\d{5}$/);
    assert.equal(created.result.matter.matterType, "probate");
    assert.equal(created.result.matter.status, "open");

    const list = await lensRun("legal", "matters-list", {}, ctx);
    assert.ok(list.result.matters.some((m) => m.id === matterId && m.name === name));

    const detail = await lensRun("legal", "matters-detail", { params: { id: matterId } }, ctx);
    assert.equal(detail.result.matter.id, matterId);
    assert.equal(detail.result.totals.trustBalance, 0);
  });

  it("time-entries-create stamps amount = hours*rate and reads back via time-entries-list", async () => {
    const m = await lensRun("legal", "matters-create", {
      params: { name: `Litigation ${randomUUID().slice(0, 8)}`, hourlyRate: 200 },
    }, ctx);
    const matterId = m.result.matter.id;
    const te = await lensRun("legal", "time-entries-create", {
      params: { matterId, hours: 3, description: "Deposition" },
    }, ctx);
    assert.equal(te.result.entry.rate, 200);          // inherits matter.hourlyRate
    assert.equal(te.result.entry.amount, 600);        // 3 * 200
    assert.equal(te.result.entry.status, "unbilled");

    const list = await lensRun("legal", "time-entries-list", { params: { matterId } }, ctx);
    assert.ok(list.result.entries.some((e) => e.id === te.result.entry.id && e.amount === 600));
  });

  it("contacts-create → contacts-list round-trips a client contact", async () => {
    const name = `Contact ${randomUUID().slice(0, 8)}`;
    const c = await lensRun("legal", "contacts-create", {
      params: { name, kind: "opposing_party", email: "x@example.com" },
    }, ctx);
    assert.equal(c.result.contact.kind, "opposing_party");
    assert.match(c.result.contact.number, /^P-\d{5}$/);
    const list = await lensRun("legal", "contacts-list", {}, ctx);
    assert.ok(list.result.contacts.some((x) => x.id === c.result.contact.id && x.name === name));
  });

  it("invoices-from-time bills unbilled entries; budget-report computes realization & collection", async () => {
    const m = await lensRun("legal", "matters-create", {
      params: { name: `Billing ${randomUUID().slice(0, 8)}`, hourlyRate: 100, clientName: "Pay Co" },
    }, ctx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 10, description: "Work" } }, ctx); // $1000 worked

    const inv = await lensRun("legal", "invoices-from-time", { params: { matterId } }, ctx);
    assert.equal(inv.result.invoice.subtotal, 1000);  // 10h * $100
    assert.equal(inv.result.invoice.total, 1000);     // no tax
    const invoiceId = inv.result.invoice.id;

    // Pay half via ACH (no processing fee → amount applied in full).
    const pay = await lensRun("legal", "payment-record", { params: { invoiceId, amount: 500, method: "ach" } }, ctx);
    assert.equal(pay.result.payment.processingFee, 0);
    assert.equal(pay.result.payment.netAmount, 500);

    const rep = await lensRun("legal", "budget-report", { params: { matterId } }, ctx);
    assert.equal(rep.result.workedValue, 1000);
    assert.equal(rep.result.billedValue, 1000);
    assert.equal(rep.result.collectedValue, 500);
    assert.equal(rep.result.realizationRate, 1);      // billed/worked = 1000/1000
    assert.equal(rep.result.collectionRate, 0.5);     // collected/billed = 500/1000
  });

  it("trust-disburse enforces the IOLTA no-overdraw invariant", async () => {
    const m = await lensRun("legal", "matters-create", {
      params: { name: `Trust ${randomUUID().slice(0, 8)}`, clientName: "Trust Co" },
    }, ctx);
    const matterId = m.result.matter.id;
    const acct = await lensRun("legal", "trust-account-create", { params: { name: "IOLTA Main" } }, ctx);
    const accountId = acct.result.account.id;
    await lensRun("legal", "trust-deposit", { params: { accountId, matterId, amount: 300 } }, ctx);

    const good = await lensRun("legal", "trust-disburse", { params: { accountId, matterId, amount: 100 } }, ctx);
    assert.equal(good.result.txn.kind, "disbursement");

    const bal = await lensRun("legal", "trust-balance", { params: { matterId } }, ctx);
    assert.equal(bal.result.total, 200);              // 300 deposit − 100 disbursement

    // Overdraw the remaining $200 client balance → IOLTA violation.
    const bad = await lensRun("legal", "trust-disburse", { params: { accountId, matterId, amount: 500 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /IOLTA violation/);
  });
});

describe("legal — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legal-validation"); });

  it("matters-create without a name is rejected", async () => {
    const bad = await lensRun("legal", "matters-create", { params: { clientName: "X" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("time-entries-create on a missing matter is rejected", async () => {
    const bad = await lensRun("legal", "time-entries-create", { params: { matterId: "nope", hours: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /matter not found/);
  });

  it("court-rules-deadline with an unknown rule is rejected", async () => {
    const bad = await lensRun("legal", "court-rules-deadline", { params: { rule: "made-up", triggerDate: "2026-01-01" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unknown rule/);
  });
});
