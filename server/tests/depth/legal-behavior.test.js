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

describe("legal — matter/contact lifecycle (wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legal-t10"); });

  it("matters-update mutates string/number/enum fields in place and reads back", async () => {
    const m = await lensRun("legal", "matters-create", {
      params: { name: `Upd ${randomUUID().slice(0, 8)}`, clientName: "Old Co", hourlyRate: 100 },
    }, ctx);
    const id = m.result.matter.id;
    const upd = await lensRun("legal", "matters-update", {
      params: { id, clientName: "New Co", hourlyRate: 275, matterType: "litigation", status: "pending", billingType: "flat" },
    }, ctx);
    assert.equal(upd.result.matter.clientName, "New Co");
    assert.equal(upd.result.matter.hourlyRate, 275);
    assert.equal(upd.result.matter.matterType, "litigation");
    assert.equal(upd.result.matter.status, "pending");
    assert.equal(upd.result.matter.billingType, "flat");
    // Persisted: matters-detail reads the updated record back.
    const detail = await lensRun("legal", "matters-detail", { params: { id } }, ctx);
    assert.equal(detail.result.matter.clientName, "New Co");
    assert.equal(detail.result.matter.hourlyRate, 275);
  });

  it("matters-update on a missing matter is rejected", async () => {
    const bad = await lensRun("legal", "matters-update", { params: { id: "nope", clientName: "X" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /matter not found/);
  });

  it("matters-close flips status to 'closed' and stamps closedAt; reflected in status-filtered list", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Close ${randomUUID().slice(0, 8)}` } }, ctx);
    const id = m.result.matter.id;
    const closed = await lensRun("legal", "matters-close", { params: { id } }, ctx);
    assert.equal(closed.result.matter.status, "closed");
    assert.match(closed.result.matter.closedAt, /^\d{4}-\d{2}-\d{2}$/);
    const list = await lensRun("legal", "matters-list", { params: { status: "closed" } }, ctx);
    assert.ok(list.result.matters.some((x) => x.id === id));
    // An 'open' filter must NOT return the now-closed matter.
    const openList = await lensRun("legal", "matters-list", { params: { status: "open" } }, ctx);
    assert.ok(!openList.result.matters.some((x) => x.id === id));
  });

  it("matters-close on a missing matter is rejected", async () => {
    const bad = await lensRun("legal", "matters-close", { params: { id: "ghost" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /matter not found/);
  });

  it("contacts-update edits fields + kind; contacts-delete removes the row", async () => {
    const c = await lensRun("legal", "contacts-create", {
      params: { name: `Edit ${randomUUID().slice(0, 8)}`, kind: "client", email: "old@x.com" },
    }, ctx);
    const id = c.result.contact.id;
    const upd = await lensRun("legal", "contacts-update", {
      params: { id, email: "new@x.com", organization: "Globex", kind: "opposing_party" },
    }, ctx);
    assert.equal(upd.result.contact.email, "new@x.com");
    assert.equal(upd.result.contact.organization, "Globex");
    assert.equal(upd.result.contact.kind, "opposing_party");

    const del = await lensRun("legal", "contacts-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("legal", "contacts-list", {}, ctx);
    assert.ok(!list.result.contacts.some((x) => x.id === id));
  });

  it("contacts-update / contacts-delete on a missing id are rejected", async () => {
    const u = await lensRun("legal", "contacts-update", { params: { id: "nope", email: "x@x.com" } }, ctx);
    assert.equal(u.result.ok, false);
    assert.match(u.result.error, /contact not found/);
    const d = await lensRun("legal", "contacts-delete", { params: { id: "nope" } }, ctx);
    assert.equal(d.result.ok, false);
    assert.match(d.result.error, /contact not found/);
  });

  it("conflict-search matches a contact by name and links its related matter", async () => {
    const searchCtx = await depthCtx(`legal-conflict-${randomUUID().slice(0, 8)}`);
    const token = randomUUID().slice(0, 8);
    const orgName = `Zeta-${token} Holdings`;
    const c = await lensRun("legal", "contacts-create", { params: { name: orgName, kind: "opposing_party" } }, searchCtx);
    const m = await lensRun("legal", "matters-create", {
      params: { name: `Suit ${token}`, partyIds: [c.result.contact.id] },
    }, searchCtx);

    const hit = await lensRun("legal", "conflict-search", { params: { name: `zeta-${token}` } }, searchCtx);
    assert.equal(hit.result.hasConflict, true);
    // The matter name is "Suit <token>" (no "zeta"), so only the contact matches
    // the "zeta-<token>" query; the related matter rides along in contactHit.matters.
    assert.equal(hit.result.hits, 1);
    const contactHit = hit.result.matches.find((x) => x.kind === "contact");
    assert.ok(contactHit);
    assert.ok(contactHit.matters.some((mm) => mm.id === m.result.matter.id));

    // A query matching nothing → no conflict.
    const miss = await lensRun("legal", "conflict-search", { params: { name: "no-such-entity-xyz" } }, searchCtx);
    assert.equal(miss.result.hasConflict, false);
    assert.equal(miss.result.hits, 0);
  });

  it("conflict-search with no query is rejected", async () => {
    const bad = await lensRun("legal", "conflict-search", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name or query required/);
  });

  it("case-add stamps a 'filed' event + defaults to civil; case-list reads it back", async () => {
    const caseCtx = await depthCtx(`legal-case-${randomUUID().slice(0, 8)}`);
    const caption = `Doe v. Roe ${randomUUID().slice(0, 6)}`;
    const added = await lensRun("legal", "case-add", {
      params: { caption, caseNumber: "CV-2026-999", court: "N.D. Cal.", matterType: "bogus" },
    }, caseCtx);
    assert.equal(added.result.case.caption, caption);
    assert.equal(added.result.case.status, "active");
    assert.equal(added.result.case.matterType, "civil"); // invalid type falls back to civil
    assert.ok(added.result.case.events.some((e) => e.kind === "filed"));

    const list = await lensRun("legal", "case-list", {}, caseCtx);
    assert.ok(list.result.cases.some((c) => c.id === added.result.case.id && c.caption === caption));
  });

  it("case-add without caption/caseNumber is rejected", async () => {
    const bad = await lensRun("legal", "case-add", { params: { caption: "Only caption" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /caption and caseNumber required/);
  });
});

describe("legal — time/timer/invoice/calendar ops (wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legal-t10b"); });

  it("time-entries-delete removes an unbilled entry but refuses a billed one", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `TD ${randomUUID().slice(0, 8)}`, hourlyRate: 100 } }, ctx);
    const matterId = m.result.matter.id;
    const te = await lensRun("legal", "time-entries-create", { params: { matterId, hours: 2, description: "Scratch" } }, ctx);
    const teId = te.result.entry.id;

    const del = await lensRun("legal", "time-entries-delete", { params: { id: teId } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("legal", "time-entries-list", { params: { matterId } }, ctx);
    assert.ok(!list.result.entries.some((e) => e.id === teId));

    // Bill an entry, then deletion must be refused.
    const te2 = await lensRun("legal", "time-entries-create", { params: { matterId, hours: 1, description: "Keep" } }, ctx);
    await lensRun("legal", "invoices-from-time", { params: { matterId } }, ctx); // flips te2 → billed
    const refuse = await lensRun("legal", "time-entries-delete", { params: { id: te2.result.entry.id } }, ctx);
    assert.equal(refuse.result.ok, false);
    assert.match(refuse.result.error, /cannot delete a billed entry/);
  });

  it("timer-start → timer-stop auto-creates a time entry billed at the matter rate", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Tmr ${randomUUID().slice(0, 8)}`, hourlyRate: 360 } }, ctx);
    const matterId = m.result.matter.id;
    const started = await lensRun("legal", "timer-start", { params: { matterId, description: "Research" } }, ctx);
    const timerId = started.result.timer.id;

    const running = await lensRun("legal", "timer-list", {}, ctx);
    assert.ok(running.result.timers.some((t) => t.id === timerId));

    const stopped = await lensRun("legal", "timer-stop", { params: { id: timerId } }, ctx);
    assert.ok(stopped.result.hours >= 0.01); // floored at 0.01h
    assert.equal(stopped.result.entry.rate, 360);
    assert.equal(stopped.result.entry.fromTimer, true);
    assert.equal(stopped.result.entry.amount, Math.round(stopped.result.hours * 360 * 100) / 100);

    // Timer is consumed — no longer in the running list; the entry is in time list.
    const after = await lensRun("legal", "timer-list", {}, ctx);
    assert.ok(!after.result.timers.some((t) => t.id === timerId));
    const teList = await lensRun("legal", "time-entries-list", { params: { matterId } }, ctx);
    assert.ok(teList.result.entries.some((e) => e.id === stopped.result.entry.id && e.fromTimer === true));
  });

  it("timer-start on a missing matter and timer-stop on a missing timer are rejected", async () => {
    const noMatter = await lensRun("legal", "timer-start", { params: { matterId: "nope" } }, ctx);
    assert.equal(noMatter.result.ok, false);
    assert.match(noMatter.result.error, /matter not found/);
    const noTimer = await lensRun("legal", "timer-stop", { params: { id: "nope" } }, ctx);
    assert.equal(noTimer.result.ok, false);
    assert.match(noTimer.result.error, /timer not found/);
  });

  it("invoices-mark-paid flips an open invoice to paid; invoices-list status filter reflects it", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Inv ${randomUUID().slice(0, 8)}`, hourlyRate: 100 } }, ctx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 5, description: "Work" } }, ctx);
    const inv = await lensRun("legal", "invoices-from-time", { params: { matterId } }, ctx);
    const invoiceId = inv.result.invoice.id;
    assert.equal(inv.result.invoice.status, "open");

    const paid = await lensRun("legal", "invoices-mark-paid", { params: { id: invoiceId, paidVia: "wire" } }, ctx);
    assert.equal(paid.result.invoice.status, "paid");
    assert.equal(paid.result.invoice.paidVia, "wire");
    assert.match(paid.result.invoice.paidAt, /^\d{4}-\d{2}-\d{2}$/);

    const openList = await lensRun("legal", "invoices-list", { params: { matterId, status: "open" } }, ctx);
    assert.ok(!openList.result.invoices.some((i) => i.id === invoiceId));
    const paidList = await lensRun("legal", "invoices-list", { params: { matterId, status: "paid" } }, ctx);
    assert.ok(paidList.result.invoices.some((i) => i.id === invoiceId));
  });

  it("invoices-mark-paid on a missing invoice is rejected", async () => {
    const bad = await lensRun("legal", "invoices-mark-paid", { params: { id: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invoice not found/);
  });

  it("calendar-create stamps a numbered event; calendar-list returns it sorted by date ascending", async () => {
    const calCtx = await depthCtx(`legal-cal-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: `Cal ${randomUUID().slice(0, 8)}` } }, calCtx);
    const matterId = m.result.matter.id;
    const later = await lensRun("legal", "calendar-create", { params: { matterId, title: "Trial", kind: "hearing", date: "2026-09-01" } }, calCtx);
    const earlier = await lensRun("legal", "calendar-create", { params: { matterId, title: "Status conf", kind: "meeting", date: "2026-03-15" } }, calCtx);
    assert.match(later.result.event.number, /^EV-\d{5}$/);
    assert.equal(later.result.event.kind, "hearing");

    const list = await lensRun("legal", "calendar-list", { params: { matterId } }, calCtx);
    assert.equal(list.result.events.length, 2);
    assert.equal(list.result.events[0].id, earlier.result.event.id); // 2026-03-15 sorts before 2026-09-01
    assert.equal(list.result.events[1].id, later.result.event.id);
  });

  it("calendar-create without a title is rejected", async () => {
    const bad = await lensRun("legal", "calendar-create", { params: { date: "2026-01-01" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });
});

describe("legal — trust list / payments / intake list / dashboard (wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legal-t10c"); });

  it("trust-accounts-list returns created IOLTA accounts with their assigned numbers", async () => {
    const taCtx = await depthCtx(`legal-ta-${randomUUID().slice(0, 8)}`);
    const a = await lensRun("legal", "trust-account-create", { params: { name: "IOLTA A" } }, taCtx);
    const b = await lensRun("legal", "trust-account-create", { params: { name: "IOLTA B" } }, taCtx);
    const list = await lensRun("legal", "trust-accounts-list", {}, taCtx);
    assert.equal(list.result.accounts.length, 2);
    assert.ok(list.result.accounts.some((x) => x.id === a.result.account.id && x.name === "IOLTA A"));
    const rowB = list.result.accounts.find((x) => x.id === b.result.account.id);
    assert.ok(rowB);
    assert.match(rowB.number, /^TA-\d{3}$/);
  });

  it("payments-list aggregates total / fees / netReceived for a matter (card fee subtracted)", async () => {
    const payCtx = await depthCtx(`legal-pay-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "PayMatter", clientName: "Pay LLC" } }, payCtx);
    const matterId = m.result.matter.id;
    // Two retainer payments against the matter (no invoice): one card (fee), one ach (no fee).
    await lensRun("legal", "payment-record", { params: { matterId, amount: 1000, method: "card" } }, payCtx); // fee 29
    await lensRun("legal", "payment-record", { params: { matterId, amount: 500, method: "ach" } }, payCtx);   // fee 0

    const list = await lensRun("legal", "payments-list", { params: { matterId } }, payCtx);
    assert.equal(list.result.payments.length, 2);
    assert.equal(list.result.total, 1500);          // 1000 + 500
    assert.equal(list.result.processingFees, 29);   // 1000 * 0.029
    assert.equal(list.result.netReceived, 1471);    // 1500 - 29
  });

  it("payment-portal-summary computes per-invoice balance, totalDue and overdueCount for a client", async () => {
    const portalCtx = await depthCtx(`legal-portal-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "PortalM", clientName: "Portal Co", hourlyRate: 100 } }, portalCtx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 10, description: "Work" } }, portalCtx); // $1000
    // Force an overdue due date in the past.
    const inv = await lensRun("legal", "invoices-from-time", { params: { matterId, dueAt: "2000-01-01" } }, portalCtx);
    const invoiceId = inv.result.invoice.id;
    // Partial $400 payment via ACH.
    await lensRun("legal", "payment-record", { params: { invoiceId, amount: 400, method: "ach" } }, portalCtx);

    const sum = await lensRun("legal", "payment-portal-summary", { params: { matterId } }, portalCtx);
    assert.equal(sum.result.openInvoices.length, 1);
    const oi = sum.result.openInvoices[0];
    assert.equal(oi.total, 1000);
    assert.equal(oi.paid, 400);
    assert.equal(oi.balance, 600);    // 1000 - 400
    assert.equal(oi.overdue, true);   // dueAt 2000-01-01 < today
    assert.equal(sum.result.totalDue, 600);
    assert.equal(sum.result.totalPaid, 400);
    assert.equal(sum.result.overdueCount, 1);
  });

  it("intake-submissions-list filters by status and form; intake-forms-delete removes a form", async () => {
    const inCtx = await depthCtx(`legal-intake-${randomUUID().slice(0, 8)}`);
    const form = await lensRun("legal", "intake-forms-create", {
      params: { name: `Form ${randomUUID().slice(0, 8)}`, fields: [{ key: "name", label: "Name", type: "text", required: true }] },
    }, inCtx);
    const formId = form.result.form.id;
    const sub = await lensRun("legal", "intake-submit", { params: { formId, answers: { name: "Sam Q" } } }, inCtx);

    const newList = await lensRun("legal", "intake-submissions-list", { params: { formId, status: "new" } }, inCtx);
    assert.ok(newList.result.submissions.some((x) => x.id === sub.result.submission.id));
    const convertedList = await lensRun("legal", "intake-submissions-list", { params: { formId, status: "converted" } }, inCtx);
    assert.ok(!convertedList.result.submissions.some((x) => x.id === sub.result.submission.id));

    const del = await lensRun("legal", "intake-forms-delete", { params: { id: formId } }, inCtx);
    assert.equal(del.result.deleted, true);
    const forms = await lensRun("legal", "intake-forms-list", {}, inCtx);
    assert.ok(!forms.result.forms.some((f) => f.id === formId));
  });

  it("intake-forms-delete on a missing form is rejected", async () => {
    const bad = await lensRun("legal", "intake-forms-delete", { params: { id: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /form not found/);
  });

  it("dashboard-summary rolls up open matters, unbilled time/hours, trust balance, and contact count", async () => {
    const dashCtx = await depthCtx(`legal-dash-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "DashM", hourlyRate: 200 } }, dashCtx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 4, description: "Unbilled work" } }, dashCtx); // $800 / 4h unbilled
    await lensRun("legal", "contacts-create", { params: { name: "Dash Client", kind: "client" } }, dashCtx);
    const acct = await lensRun("legal", "trust-account-create", { params: { name: "Dash IOLTA" } }, dashCtx);
    await lensRun("legal", "trust-deposit", { params: { accountId: acct.result.account.id, matterId, amount: 1500 } }, dashCtx);

    const dash = await lensRun("legal", "dashboard-summary", {}, dashCtx);
    assert.equal(dash.result.openMatters, 1);
    assert.equal(dash.result.unbilledHours, 4);
    assert.equal(dash.result.unbilledTime, 800);    // round(4 * 200)
    assert.equal(dash.result.trustBalance, 1500);
    assert.equal(dash.result.contactCount, 1);
    assert.equal(dash.result.runningTimers, 0);
  });
});

describe("legal — templates / esign list / ai-digest / billing branches (wave 10 top-up r2)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("legal-t10d"); });

  it("doc-templates-list seeds the three canonical templates on first call (idempotent)", async () => {
    const seedCtx = await depthCtx(`legal-tpl-${randomUUID().slice(0, 8)}`);
    const first = await lensRun("legal", "doc-templates-list", {}, seedCtx);
    const names = first.result.templates.map((t) => t.name);
    assert.equal(first.result.templates.length, 3);
    assert.ok(names.includes("Engagement Letter"));
    assert.ok(names.includes("Demand Letter"));
    assert.ok(names.includes("Settlement Agreement"));
    assert.ok(first.result.templates.some((t) => t.kind === "agreement" && t.body.includes("{{client_name}}")));
    // Calling again does not re-seed (the seed only fires when the bucket is empty).
    const second = await lensRun("legal", "doc-templates-list", {}, seedCtx);
    assert.equal(second.result.templates.length, 3);
  });

  it("esign-envelopes-list filters by status: a sent envelope appears under 'sent', a completed one under 'completed'", async () => {
    const eCtx = await depthCtx(`legal-env-${randomUUID().slice(0, 8)}`);
    // Envelope A — left sent (unsigned).
    const mA = await lensRun("legal", "matters-create", { params: { name: `EnvA ${randomUUID().slice(0, 8)}` } }, eCtx);
    const tplA = await lensRun("legal", "doc-templates-create", { params: { name: "TA", body: "x" } }, eCtx);
    const genA = await lensRun("legal", "doc-generate", { params: { templateId: tplA.result.template.id, matterId: mA.result.matter.id } }, eCtx);
    const envA = await lensRun("legal", "esign-envelope-create", {
      params: { documentId: genA.result.document.id, recipients: [{ name: "A", email: "a@x.com" }] },
    }, eCtx);
    // Envelope B — fully signed → completed.
    const mB = await lensRun("legal", "matters-create", { params: { name: `EnvB ${randomUUID().slice(0, 8)}` } }, eCtx);
    const tplB = await lensRun("legal", "doc-templates-create", { params: { name: "TB", body: "y" } }, eCtx);
    const genB = await lensRun("legal", "doc-generate", { params: { templateId: tplB.result.template.id, matterId: mB.result.matter.id } }, eCtx);
    const envB = await lensRun("legal", "esign-envelope-create", {
      params: { documentId: genB.result.document.id, recipients: [{ name: "B", email: "b@x.com" }] },
    }, eCtx);
    await lensRun("legal", "esign-envelope-sign", { params: { envelopeId: envB.result.envelope.id, recipientId: envB.result.envelope.recipients[0].id } }, eCtx);

    const sent = await lensRun("legal", "esign-envelopes-list", { params: { status: "sent" } }, eCtx);
    assert.ok(sent.result.envelopes.some((e) => e.id === envA.result.envelope.id));
    assert.ok(!sent.result.envelopes.some((e) => e.id === envB.result.envelope.id));

    const completed = await lensRun("legal", "esign-envelopes-list", { params: { status: "completed" } }, eCtx);
    assert.ok(completed.result.envelopes.some((e) => e.id === envB.result.envelope.id));
    assert.ok(!completed.result.envelopes.some((e) => e.id === envA.result.envelope.id));

    const all = await lensRun("legal", "esign-envelopes-list", {}, eCtx);
    assert.equal(all.result.envelopes.length, 2);
  });

  it("ai-matter-update (no LLM in test ctx) returns the deterministic digest with exact hours/docs counts", async () => {
    const aiCtx = await depthCtx(`legal-ai-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "AI Digest Matter", hourlyRate: 100 } }, aiCtx);
    const matterId = m.result.matter.id;
    // Two time entries dated TODAY so they fall inside the 14-day window.
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 2, description: "Draft" } }, aiCtx);   // $200 / 2h
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 1.5, description: "Review" } }, aiCtx); // $150 / 1.5h
    const tpl = await lensRun("legal", "doc-templates-create", { params: { name: "Brief", body: "Body {{matter_name}}" } }, aiCtx);
    await lensRun("legal", "doc-generate", { params: { templateId: tpl.result.template.id, matterId } }, aiCtx);

    const upd = await lensRun("legal", "ai-matter-update", { params: { matterId } }, aiCtx);
    // `context` is the deterministic activity digest — always computed regardless of
    // whether an LLM enriches the prose `summary`.
    assert.ok(upd.result.context.includes("2 time entries")); // 2 entries logged
    assert.ok(upd.result.context.includes("3.50 hrs"));        // 2 + 1.5
    assert.ok(upd.result.context.includes("1 documents created"));
    assert.ok(typeof upd.result.summary === "string" && upd.result.summary.length > 0);
    assert.ok(["deterministic", "brain", "deterministic_after_brain_error"].includes(upd.result.source));
  });

  it("ai-matter-update on a missing matter is rejected", async () => {
    const bad = await lensRun("legal", "ai-matter-update", { params: { matterId: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /matter not found/);
  });

  it("time-entries-create with billable:false stamps amount 0 + non_billable status; list filters by status", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `NB ${randomUUID().slice(0, 8)}`, hourlyRate: 300 } }, ctx);
    const matterId = m.result.matter.id;
    const nb = await lensRun("legal", "time-entries-create", { params: { matterId, hours: 2, description: "Pro bono", billable: false } }, ctx);
    assert.equal(nb.result.entry.amount, 0);                  // non-billable → no value
    assert.equal(nb.result.entry.status, "non_billable");
    const billed = await lensRun("legal", "time-entries-create", { params: { matterId, hours: 1, description: "Billable" } }, ctx);
    assert.equal(billed.result.entry.status, "unbilled");

    const unbilledOnly = await lensRun("legal", "time-entries-list", { params: { matterId, status: "unbilled" } }, ctx);
    assert.ok(unbilledOnly.result.entries.some((e) => e.id === billed.result.entry.id));
    assert.ok(!unbilledOnly.result.entries.some((e) => e.id === nb.result.entry.id));
    const nbOnly = await lensRun("legal", "time-entries-list", { params: { matterId, status: "non_billable" } }, ctx);
    assert.ok(nbOnly.result.entries.some((e) => e.id === nb.result.entry.id));
    assert.ok(!nbOnly.result.entries.some((e) => e.id === billed.result.entry.id));
  });

  it("time-entries-create with hours <= 0 is rejected", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Z ${randomUUID().slice(0, 8)}`, hourlyRate: 100 } }, ctx);
    const bad = await lensRun("legal", "time-entries-create", { params: { matterId: m.result.matter.id, hours: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /hours must be > 0/);
  });

  it("matters-detail totals reflect billed/unbilled split + hours after invoicing", async () => {
    const dCtx = await depthCtx(`legal-detail-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "Detail Matter", hourlyRate: 100 } }, dCtx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 5, description: "ToBill" } }, dCtx); // $500
    await lensRun("legal", "invoices-from-time", { params: { matterId } }, dCtx);                                    // → billed
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 3, description: "Fresh" } }, dCtx);   // $300 unbilled

    const detail = await lensRun("legal", "matters-detail", { params: { id: matterId } }, dCtx);
    assert.equal(detail.result.totals.billed, 500);    // first entry billed
    assert.equal(detail.result.totals.unbilled, 300);  // second entry unbilled
    assert.equal(detail.result.totals.hours, 8);       // 5 + 3
    assert.equal(detail.result.invoices.length, 1);
  });

  it("trust-balance byMatter breaks down deposits/disbursements/balance per matter", async () => {
    const tCtx = await depthCtx(`legal-tb-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "TB Matter", clientName: "TB Co" } }, tCtx);
    const matterId = m.result.matter.id;
    const acct = await lensRun("legal", "trust-account-create", { params: { name: "TB IOLTA" } }, tCtx);
    const accountId = acct.result.account.id;
    await lensRun("legal", "trust-deposit", { params: { accountId, matterId, amount: 1000 } }, tCtx);
    await lensRun("legal", "trust-disburse", { params: { accountId, matterId, amount: 250 } }, tCtx);

    const bal = await lensRun("legal", "trust-balance", { params: { accountId } }, tCtx);
    assert.equal(bal.result.total, 750);          // 1000 - 250
    assert.equal(bal.result.txnCount, 2);
    const row = bal.result.byMatter.find((r) => r.matterId === matterId);
    assert.ok(row);
    assert.equal(row.deposits, 1000);
    assert.equal(row.disbursements, 250);
    assert.equal(row.balance, 750);
  });

  it("trust-deposit rejects a non-positive amount and a missing account", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `TD ${randomUUID().slice(0, 8)}` } }, ctx);
    const acct = await lensRun("legal", "trust-account-create", { params: { name: "Dep IOLTA" } }, ctx);
    const zero = await lensRun("legal", "trust-deposit", { params: { accountId: acct.result.account.id, matterId: m.result.matter.id, amount: 0 } }, ctx);
    assert.equal(zero.result.ok, false);
    assert.match(zero.result.error, /amount must be > 0/);
    const noAcct = await lensRun("legal", "trust-deposit", { params: { accountId: "nope", matterId: m.result.matter.id, amount: 100 } }, ctx);
    assert.equal(noAcct.result.ok, false);
    assert.match(noAcct.result.error, /trust account not found/);
  });

  it("invoices-from-time rejects a matter with no unbilled time entries", async () => {
    const m = await lensRun("legal", "matters-create", { params: { name: `Empty ${randomUUID().slice(0, 8)}`, hourlyRate: 100 } }, ctx);
    const bad = await lensRun("legal", "invoices-from-time", { params: { matterId: m.result.matter.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no unbilled time entries/);
  });

  it("budget-set rejects a missing matter and a negative budget; budget-report has null budgetStatus until set", async () => {
    const noMatter = await lensRun("legal", "budget-set", { params: { matterId: "nope", budgetAmount: 100 } }, ctx);
    assert.equal(noMatter.result.ok, false);
    assert.match(noMatter.result.error, /matter not found/);

    const m = await lensRun("legal", "matters-create", { params: { name: `BS ${randomUUID().slice(0, 8)}`, hourlyRate: 100 } }, ctx);
    const matterId = m.result.matter.id;
    const neg = await lensRun("legal", "budget-set", { params: { matterId, budgetAmount: -5 } }, ctx);
    assert.equal(neg.result.ok, false);
    assert.match(neg.result.error, /budgetAmount must be >= 0/);

    // No budget set yet → budget-report.budgetStatus is null; utilizationRate computes.
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 4, description: "Work" } }, ctx); // $400 / 4h
    const rep = await lensRun("legal", "budget-report", { params: { matterId } }, ctx);
    assert.equal(rep.result.budget, null);
    assert.equal(rep.result.budgetStatus, null);
    assert.equal(rep.result.workedValue, 400);
    assert.equal(rep.result.utilizationRate, 1); // all 4h billable / 4h worked
  });

  it("realization-rollup flags overBudget matters and totals across them", async () => {
    const rCtx = await depthCtx(`legal-roll2-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "Over Budget Matter", hourlyRate: 100 } }, rCtx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "budget-set", { params: { matterId, budgetAmount: 500 } }, rCtx);
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 8, description: "Work" } }, rCtx); // $800 worked > $500 budget

    const roll = await lensRun("legal", "realization-rollup", {}, rCtx);
    const row = roll.result.matters.find((x) => x.matterId === matterId);
    assert.ok(row);
    assert.equal(row.worked, 800);
    assert.equal(row.budgetAmount, 500);
    assert.equal(row.overBudget, true);              // 800 > 500
    assert.equal(roll.result.totals.worked, 800);
    assert.equal(roll.result.totals.mattersOverBudget, 1);
  });

  it("dashboard-summary surfaces open invoice total + overdue count", async () => {
    const dbCtx = await depthCtx(`legal-dash2-${randomUUID().slice(0, 8)}`);
    const m = await lensRun("legal", "matters-create", { params: { name: "Dash2 Matter", hourlyRate: 100 } }, dbCtx);
    const matterId = m.result.matter.id;
    await lensRun("legal", "time-entries-create", { params: { matterId, hours: 6, description: "Work" } }, dbCtx); // $600
    // Invoice with a past due date → overdue + open.
    await lensRun("legal", "invoices-from-time", { params: { matterId, dueAt: "2000-01-01" } }, dbCtx);

    const dash = await lensRun("legal", "dashboard-summary", {}, dbCtx);
    assert.equal(dash.result.openInvTotal, 600);   // round($600 open invoice)
    assert.equal(dash.result.overdueInvoices, 1);  // dueAt in the past, still open
    assert.equal(dash.result.unbilledTime, 0);     // all time billed onto the invoice
  });

  it("intake-convert honors a matterName override + maps an answers.description into the matter body", async () => {
    const icCtx = await depthCtx(`legal-ic-${randomUUID().slice(0, 8)}`);
    const form = await lensRun("legal", "intake-forms-create", {
      params: {
        name: `Override Intake ${randomUUID().slice(0, 8)}`,
        matterType: "family",
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "description", label: "Details", type: "textarea" },
        ],
      },
    }, icCtx);
    const sub = await lensRun("legal", "intake-submit", {
      params: { formId: form.result.form.id, answers: { name: "Robin Q", description: "Custody dispute details" } },
    }, icCtx);
    const conv = await lensRun("legal", "intake-convert", {
      params: { id: sub.result.submission.id, matterName: "Robin Q — Custody", hourlyRate: 225 },
    }, icCtx);
    assert.equal(conv.result.matter.name, "Robin Q — Custody");  // override applied
    assert.equal(conv.result.matter.matterType, "family");        // inherited from form
    assert.equal(conv.result.matter.hourlyRate, 225);             // passed through
    assert.equal(conv.result.matter.description, "Custody dispute details"); // answers.description mapped
    assert.equal(conv.result.contact.kind, "client");
  });
});
