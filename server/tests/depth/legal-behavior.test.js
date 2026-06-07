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

describe("legal — deadline/compliance/conflict calc (wave 7 top-up)", () => {
  // LLM/research macros skipped (note skips): contract-analyze, legal-question,
  // ai-matter-update (all gated on ctx.llm.chat).

  it("complianceScore: score = round(compliant/total*100); overdue counts a past non-compliant deadline", async () => {
    const r = await lensRun("legal", "complianceScore", {
      data: {
        requirements: [
          { name: "A", status: "compliant" },
          { name: "B", status: "compliant" },
          { name: "C", status: "pending" },
          { name: "D", status: "pending", deadline: "2000-01-01" }, // past + not compliant → overdue
        ],
      },
    });
    assert.equal(r.result.total, 4);
    assert.equal(r.result.compliant, 2);
    assert.equal(r.result.score, 50);            // round(2/4*100)
    assert.equal(r.result.overdue, 1);           // only the past non-compliant one
    assert.equal(r.result.rating, "fair");       // 50..69
  });

  it("complianceScore: empty requirement set is a perfect score with no items", async () => {
    const r = await lensRun("legal", "complianceScore", { data: { requirements: [] } });
    assert.equal(r.result.score, 100);
    assert.equal(r.result.total, 0);
    assert.equal(r.result.overdue, 0);
  });

  it("contractRenewal (state jurisdiction = 'auto', far-past expiry): critical + actionRequired + autoRenewal", async () => {
    const r = await lensRun("legal", "contractRenewal", {
      data: { expiryDate: "2000-06-15", renewalType: "auto" },
    });
    assert.equal(r.result.expiryDate, "2000-06-15");
    assert.equal(r.result.autoRenewal, true);
    assert.equal(r.result.actionRequired, true);     // daysUntilExpiry (deeply negative) <= 60
    assert.equal(r.result.urgency, "critical");      // <= 14
    assert.ok(r.result.daysUntilExpiry < 0);         // expiry is in the past
  });

  it("contractRenewal: a contract with no expiry returns the no_expiry status", async () => {
    const r = await lensRun("legal", "contractRenewal", { data: { title: "Perpetual NDA" } });
    assert.equal(r.result.status, "no_expiry");
    assert.match(r.result.message, /No expiry/);
  });

  it("caseSummary: billingTotal = Σ(hours*rate); keyDates collects filing/closing/hearing/trial", async () => {
    const r = await lensRun("legal", "caseSummary", {
      data: {
        client: "Acme", opposingParty: "Beta LLC", status: "active",
        parties: ["Acme", "Beta LLC"],
        filingDate: "2026-01-10", trialDate: "2026-09-01", nextHearing: "2026-03-15",
        documents: [{ name: "Complaint" }, { name: "Answer" }],
        timeEntries: [
          { hours: 2, rate: 250 },   // 500
          { hours: 1, rate: 300 },   // 300
        ],
      },
    });
    assert.equal(r.result.billingTotal, 800);          // 500 + 300
    assert.equal(r.result.relatedDocumentsCount, 2);
    assert.equal(r.result.status, "active");
    const events = r.result.keyDates.map((k) => k.event);
    assert.ok(events.includes("Filing") && events.includes("Closing") === false);
    assert.ok(events.includes("Next Hearing") && events.includes("Trial"));
  });

  it("conflictCheck: a name matching a party/client/opposing party surfaces a direct_party conflict", async () => {
    const r = await lensRun("legal", "conflictCheck", {
      data: { parties: ["Acme"], client: "Acme", opposingParty: "Beta LLC" },
      params: { checkAgainst: ["Beta LLC", "Unrelated Inc"] },
    });
    assert.equal(r.result.hasConflict, true);
    assert.ok(r.result.conflicts.some((c) => c.name === "Beta LLC" && c.conflictType === "direct_party"));
    assert.ok(!r.result.conflicts.some((c) => c.name === "Unrelated Inc")); // no false positive
  });

  it("deadlineCheck: only items inside the daysAhead window appear, sorted by daysUntil ascending", async () => {
    const day = 86_400_000;
    const inWindow1 = new Date(Date.now() + 3 * day).toISOString().slice(0, 10);
    const inWindow2 = new Date(Date.now() + 10 * day).toISOString().slice(0, 10);
    const outOfWindow = new Date(Date.now() + 90 * day).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 5 * day).toISOString().slice(0, 10);
    const r = await lensRun("legal", "deadlineCheck", {
      data: { items: [
        { task: "Far", deadline: outOfWindow },
        { task: "Soon", deadline: inWindow2 },
        { task: "Sooner", deadline: inWindow1 },
        { task: "Past", deadline: past },
      ] },
      params: { daysAhead: 30 },
    });
    assert.equal(r.result.count, 2);                       // only the two in-window future items
    assert.equal(r.result.upcoming[0].task, "Sooner");    // sorted ascending by daysUntil
    assert.equal(r.result.upcoming[1].task, "Soon");
    assert.ok(!r.result.upcoming.some((i) => i.task === "Far" || i.task === "Past"));
  });

  it("ai-court-doc-to-calendar: a 'within 21 days' clause yields a deterministic suggested deadline date", async () => {
    const r = await lensRun("legal", "ai-court-doc-to-calendar", {
      params: {
        triggerDate: "2026-01-01",
        text: "The defendant must file an answer within 21 days of service of this complaint upon them.",
      },
    });
    assert.ok(r.result.count >= 1);
    const hit = r.result.suggestions.find((sg) => sg.source === "within_clause" && sg.days === 21);
    assert.ok(hit);
    assert.equal(hit.suggestedDate, "2026-01-22");  // 2026-01-01 + 21 days
    assert.equal(hit.kind, "deadline");
  });

  it("ai-court-doc-to-calendar rejects text that is too short", async () => {
    const bad = await lensRun("legal", "ai-court-doc-to-calendar", { params: { text: "too short" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /text too short/);
  });
});

describe("legal — document assembly + e-sign + intake CRUD (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legal-topup"); });

  it("doc-generate merges matter fields into a template; {{unknown}} tokens are left intact", async () => {
    const m = await lensRun("legal", "matters-create", {
      params: { name: `Demand Matter ${randomUUID().slice(0, 8)}`, clientName: "Acme Corp", caseNumber: "CV-2026-1" },
    }, ctx);
    const matterId = m.result.matter.id;
    const tpl = await lensRun("legal", "doc-templates-create", {
      params: { name: "Custom Notice", body: "Re {{matter_name}} (case {{case_number}}) for {{client_name}}. Ref: {{unknown_token}}", kind: "letter" },
    }, ctx);
    const templateId = tpl.result.template.id;

    const gen = await lensRun("legal", "doc-generate", { params: { templateId, matterId } }, ctx);
    assert.equal(gen.result.document.matterId, matterId);
    assert.match(gen.result.document.number, /^DOC-\d{5}$/);
    assert.ok(gen.result.document.body.includes("for Acme Corp"));
    assert.ok(gen.result.document.body.includes("case CV-2026-1"));
    assert.ok(gen.result.document.body.includes("{{unknown_token}}")); // unresolved token preserved
    assert.equal(gen.result.document.status, "draft");
  });

  it("doc-generate against a missing template is rejected", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `M ${randomUUID().slice(0, 8)}` } }, ctx);
    const bad = await lensRun("legal", "doc-generate", { params: { templateId: "nope", matterId: m.result.matter.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /template not found/);
  });

  it("esign envelope: create → sign → completed; doc status flips to 'signed' once all recipients sign", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Esign ${randomUUID().slice(0, 8)}` } }, ctx);
    const tpl = await lensRun("legal", "doc-templates-create", { params: { name: "Agreement", body: "Body {{matter_name}}" } }, ctx);
    const gen = await lensRun("legal", "doc-generate", { params: { templateId: tpl.result.template.id, matterId: m.result.matter.id } }, ctx);
    const documentId = gen.result.document.id;

    const env = await lensRun("legal", "esign-envelope-create", {
      params: { documentId, recipients: [{ name: "Signer One", email: "s1@example.com", role: "signer" }] },
    }, ctx);
    assert.match(env.result.envelope.number, /^ENV-\d{5}$/);
    assert.equal(env.result.envelope.status, "sent");
    const envelopeId = env.result.envelope.id;
    const recipientId = env.result.envelope.recipients[0].id;

    const signed = await lensRun("legal", "esign-envelope-sign", { params: { envelopeId, recipientId } }, ctx);
    assert.equal(signed.result.envelope.status, "completed");          // only recipient signed → completed
    assert.ok(signed.result.envelope.recipients.every((r) => r.status === "signed"));

    const docs = await lensRun("legal", "documents-list", { params: { matterId: m.result.matter.id } }, ctx);
    assert.ok(docs.result.documents.some((d) => d.id === documentId && d.status === "signed"));

    // Double-sign the same recipient → rejected.
    const dbl = await lensRun("legal", "esign-envelope-sign", { params: { envelopeId, recipientId } }, ctx);
    assert.equal(dbl.result.ok, false);
    assert.match(dbl.result.error, /already signed/);
  });

  it("esign-envelope-create without recipients is rejected", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `NoRcpt ${randomUUID().slice(0, 8)}` } }, ctx);
    const tpl = await lensRun("legal", "doc-templates-create", { params: { name: "T", body: "x" } }, ctx);
    const gen = await lensRun("legal", "doc-generate", { params: { templateId: tpl.result.template.id, matterId: m.result.matter.id } }, ctx);
    const bad = await lensRun("legal", "esign-envelope-create", { params: { documentId: gen.result.document.id, recipients: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /recipients required/);
  });

  it("intake-forms-create → intake-submit → intake-convert mints a client contact + intake matter", async () => {
    const form = await lensRun("legal", "intake-forms-create", {
      params: {
        name: `PI Intake ${randomUUID().slice(0, 8)}`,
        matterType: "litigation",
        fields: [
          { key: "name", label: "Full Name", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
          { key: "description", label: "What happened", type: "textarea" },
        ],
      },
    }, ctx);
    assert.match(form.result.form.number, /^IF-\d{4}$/);
    const formId = form.result.form.id;

    // Missing a required field → rejected.
    const missing = await lensRun("legal", "intake-submit", {
      params: { formId, answers: { name: "Pat Q" } }, // email required, absent
    }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /required fields missing/);

    const sub = await lensRun("legal", "intake-submit", {
      params: { formId, answers: { name: "Pat Q", email: "pat@example.com", description: "Slip and fall" } },
    }, ctx);
    assert.match(sub.result.submission.number, /^IS-\d{5}$/);
    assert.equal(sub.result.submission.status, "new");
    assert.equal(sub.result.submission.contactName, "Pat Q");
    const subId = sub.result.submission.id;

    const conv = await lensRun("legal", "intake-convert", { params: { id: subId } }, ctx);
    assert.equal(conv.result.contact.kind, "client");
    assert.equal(conv.result.contact.name, "Pat Q");
    assert.equal(conv.result.matter.status, "intake");
    assert.equal(conv.result.matter.matterType, "litigation");      // inherited from the form
    assert.equal(conv.result.submission.status, "converted");

    // Re-converting the same submission is rejected.
    const again = await lensRun("legal", "intake-convert", { params: { id: subId } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already converted/);
  });
});

describe("legal — billing/trust/reporting math (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legal-topup2"); });

  it("payment-record (card) deducts the 2.9% processing fee from the net; invoice flips paid when covered", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Card ${randomUUID().slice(0, 8)}`, hourlyRate: 100 } }, ctx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 10, description: "Work" } }, ctx); // $1000
    const inv = await lensRun("legal", "invoices-from-time", { params: { matterId } }, ctx);
    const invoiceId = inv.result.invoice.id;
    assert.equal(inv.result.invoice.total, 1000);

    const pay = await lensRun("legal", "payment-record", { params: { invoiceId, amount: 1000, method: "card" } }, ctx);
    assert.equal(pay.result.payment.processingFee, 29);    // 1000 * 0.029
    assert.equal(pay.result.payment.netAmount, 971);       // 1000 - 29
    assert.equal(pay.result.payment.invoiceBalanceAfter, 0); // gross $1000 covers $1000 total
    assert.equal(pay.result.invoice.status, "paid");
  });

  it("payment-record requires an invoiceId or matterId target", async () => {
    const bad = await lensRun("legal", "payment-record", { params: { amount: 50, method: "ach" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invoiceId or matterId required/);
  });

  it("trust-reconcile flags a 3-way out-of-balance when the bank statement differs from the book", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Recon ${randomUUID().slice(0, 8)}`, clientName: "Recon Co" } }, ctx);
    const matterId = m.result.matter.id;
    const acct = await lensRun("legal", "trust-account-create", { params: { name: "IOLTA Recon" } }, ctx);
    const accountId = acct.result.account.id;
    await lensRun("legal", "trust-deposit", { params: { accountId, matterId, amount: 1000 } }, ctx);
    await lensRun("legal", "trust-disburse", { params: { accountId, matterId, amount: 400 } }, ctx); // book = 600

    // Bank says 500 → out of balance against the $600 book.
    const out = await lensRun("legal", "trust-reconcile", { params: { accountId, bankBalance: 500 } }, ctx);
    assert.equal(out.result.bookBalance, 600);
    assert.equal(out.result.clientLedgerTotal, 600);    // single matter → book equals client ledger
    assert.equal(out.result.bookVsClient, 0);
    assert.equal(out.result.bookVsBank, 100);           // 600 - 500
    assert.equal(out.result.reconciled, false);
    assert.ok(out.result.warnings.some((w) => w.includes("bank")));

    // Correct the bank balance → reconciled.
    const ok = await lensRun("legal", "trust-reconcile", { params: { accountId, bankBalance: 600 } }, ctx);
    assert.equal(ok.result.reconciled, true);
    assert.equal(ok.result.warnings.length, 0);
  });

  it("budget-report budgetStatus alerts once worked value crosses the threshold of the set budget", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Budget ${randomUUID().slice(0, 8)}`, hourlyRate: 100 } }, ctx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "budget-set", { params: { matterId, budgetAmount: 1000, budgetHours: 10, alertThreshold: 0.8 } }, ctx);
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 9, description: "Work" } }, ctx); // $900 worked

    const rep = await lensRun("legal", "budget-report", { params: { matterId } }, ctx);
    assert.equal(rep.result.workedValue, 900);
    assert.equal(rep.result.budget.budgetAmount, 1000);
    assert.equal(rep.result.budgetStatus.consumedFraction, 0.9);    // 900/1000
    assert.equal(rep.result.budgetStatus.remaining, 100);           // 1000 - 900
    assert.equal(rep.result.budgetStatus.overBudget, false);
    assert.equal(rep.result.budgetStatus.alert, true);              // 0.9 >= 0.8 threshold
    assert.equal(rep.result.budgetStatus.hoursConsumedFraction, 0.9); // 9/10
  });

  it("realization-rollup totals worked/billed/collected and computes firm realization & collection rates", async () => {
    const rollCtx = await depthCtx(`legal-rollup-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "Rollup One", hourlyRate: 200 } }, rollCtx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 10, description: "Work" } }, rollCtx); // worked $2000
    const inv = await lensRun("legal", "invoices-from-time", { params: { matterId } }, rollCtx);                       // billed $2000
    await lensRun("legal", "payment-record", { params: { invoiceId: inv.result.invoice.id, amount: 1500, method: "ach" } }, rollCtx); // collected $1500

    const roll = await lensRun("legal", "realization-rollup", {}, rollCtx);
    assert.equal(roll.result.totals.worked, 2000);
    assert.equal(roll.result.totals.billed, 2000);
    assert.equal(roll.result.totals.collected, 1500);
    assert.equal(roll.result.totals.firmRealizationRate, 1);     // billed/worked = 2000/2000
    assert.equal(roll.result.totals.firmCollectionRate, 0.75);   // collected/billed = 1500/2000
    assert.ok(roll.result.matters.some((r) => r.matterId === matterId && r.realizationRate === 1));
  });
});
