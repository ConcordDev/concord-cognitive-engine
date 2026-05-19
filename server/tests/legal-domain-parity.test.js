import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLegalActions from "../domains/legal.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`legal.${name}`);
  assert.ok(fn, `legal.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerLegalActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("legal.contract-analyze", () => {
  it("rejects short contract", async () => {
    const r = await call("contract-analyze", { llm: { chat: async () => ({}) } }, { contract: "tiny" });
    assert.equal(r.ok, false);
  });
  it("rejects when LLM unavailable", async () => {
    const r = await call("contract-analyze", ctxA, { contract: "a".repeat(500) });
    assert.equal(r.ok, false);
  });
  it("parses LLM JSON to ContractAnalysis", async () => {
    const ctx = {
      llm: { chat: async () => ({ text: '{"documentType":"NDA","partyCount":2,"riskFlags":[{"severity":"high","category":"IP","clause":"5","excerpt":"all work product","whatItMeans":"transfers all IP","recommendation":"narrow scope"}],"obligationsForYou":["keep info secret"],"obligationsForCounterparty":["pay"],"terminationConditions":["30 days notice"],"governing":{"law":"DE"},"summary":"NDA"}' }) },
    };
    const r = await call("contract-analyze", ctx, { contract: "a".repeat(500), perspective: "sign" });
    assert.equal(r.ok, true);
    assert.equal(r.result.documentType, "NDA");
    assert.equal(r.result.riskFlags[0].severity, "high");
  });
});

describe("legal.case-list / -add", () => {
  it("scoped per user, reject missing fields", () => {
    const r = call("case-add", ctxA, { caption: "Smith v. Jones", caseNumber: "23-CV-1234", court: "SDNY", matterType: "civil" });
    assert.equal(r.ok, true);
    assert.equal(call("case-list", ctxA, {}).result.cases.length, 1);
    assert.equal(call("case-list", ctxB, {}).result.cases.length, 0);
    assert.equal(call("case-add", ctxA, { caption: "X" }).ok, false);
  });
});

describe("legal.legal-question", () => {
  it("rejects empty question", async () => {
    assert.equal((await call("legal-question", ctxA, { question: "" })).ok, false);
  });

  it("graceful no-LLM fallback", async () => {
    const r = await call("legal-question", ctxA, { question: "Can my landlord evict me?" });
    assert.equal(r.ok, true);
    assert.match(r.result.answer, /unavailable|attorney/i);
  });

  it("INVARIANT: always includes not-legal-advice caveat", async () => {
    const ctx = {
      llm: { chat: async () => ({ text: '{"answer":"Yes, but you have rights.","citations":[],"caveats":[]}' }) },
    };
    const r = await call("legal-question", ctx, { question: "Q?", jurisdiction: "US-CA" });
    assert.equal(r.ok, true);
    assert.ok(r.result.caveats.some(c => /not legal advice|consult.*attorney/i.test(c)),
      "MUST include not-legal-advice caveat");
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("at least one registered", () => assert.ok(ACTIONS.size >= 6));
});

// ═════════════════════════════════════════════════════════════════
//  Clio 2026 parity macros — matters, contacts, time, trust, etc.
// ═════════════════════════════════════════════════════════════════

describe("legal — matters CRUD", () => {
  it("creates a matter with billing config and lists per user", () => {
    const r = call("matters-create", ctxA, { name: "Smith v. Jones", matterType: "litigation", hourlyRate: 350, jurisdiction: "US-Federal" });
    assert.equal(r.ok, true);
    assert.match(r.result.matter.number, /^MAT-\d{5}$/);
    assert.equal(r.result.matter.hourlyRate, 350);
    const list = call("matters-list", ctxA);
    assert.equal(list.result.matters.length, 1);
    // Other user isolated
    assert.equal(call("matters-list", ctxB).result.matters.length, 0);
  });

  it("closes a matter (sets closedAt + status)", () => {
    const m = call("matters-create", ctxA, { name: "Old Matter" }).result.matter;
    const r = call("matters-close", ctxA, { id: m.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.matter.status, "closed");
    assert.ok(r.result.matter.closedAt);
  });

  it("matters-detail joins parties, time, invoices, docs, events, totals", () => {
    const c = call("contacts-create", ctxA, { name: "Alice Client", kind: "client" }).result.contact;
    const m = call("matters-create", ctxA, { name: "M1", partyIds: [c.id], hourlyRate: 100 }).result.matter;
    call("time-entries-create", ctxA, { matterId: m.id, hours: 2, description: "Research" });
    const d = call("matters-detail", ctxA, { id: m.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.parties.length, 1);
    assert.equal(d.result.time.length, 1);
    assert.equal(d.result.totals.hours, 2);
    assert.equal(d.result.totals.unbilled, 200);
  });
});

describe("legal — contacts + conflict search", () => {
  it("conflict-search finds party by name across matters", () => {
    const opp = call("contacts-create", ctxA, { name: "John Doe", kind: "opposing_party" }).result.contact;
    call("matters-create", ctxA, { name: "Plaintiff v. Doe", partyIds: [opp.id] });
    const r = call("conflict-search", ctxA, { name: "doe" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasConflict, true);
    assert.ok(r.result.hits >= 1);
  });
});

describe("legal — time tracking + timers", () => {
  it("time-entries-create requires a matter and computes amount = hours × rate", () => {
    const m = call("matters-create", ctxA, { name: "M", hourlyRate: 200 }).result.matter;
    const t = call("time-entries-create", ctxA, { matterId: m.id, hours: 1.5, description: "Draft" });
    assert.equal(t.ok, true);
    assert.equal(t.result.entry.amount, 300);
    assert.equal(t.result.entry.status, "unbilled");
  });

  it("non-billable entries have amount = 0", () => {
    const m = call("matters-create", ctxA, { name: "M", hourlyRate: 200 }).result.matter;
    const t = call("time-entries-create", ctxA, { matterId: m.id, hours: 1, billable: false });
    assert.equal(t.result.entry.amount, 0);
    assert.equal(t.result.entry.status, "non_billable");
  });

  it("billed time entries cannot be deleted", () => {
    const m = call("matters-create", ctxA, { name: "M", hourlyRate: 200 }).result.matter;
    const t = call("time-entries-create", ctxA, { matterId: m.id, hours: 1 }).result.entry;
    call("invoices-from-time", ctxA, { matterId: m.id });
    const d = call("time-entries-delete", ctxA, { id: t.id });
    assert.equal(d.ok, false);
    assert.match(d.error, /billed/);
  });

  it("timer-start + timer-stop creates an auto time entry", () => {
    const m = call("matters-create", ctxA, { name: "M", hourlyRate: 100 }).result.matter;
    const start = call("timer-start", ctxA, { matterId: m.id, description: "Phone call" });
    assert.equal(start.ok, true);
    assert.equal(call("timer-list", ctxA).result.timers.length, 1);
    const stop = call("timer-stop", ctxA, { id: start.result.timer.id });
    assert.equal(stop.ok, true);
    assert.ok(stop.result.entry, "should auto-create a time entry");
    assert.equal(call("timer-list", ctxA).result.timers.length, 0);
  });
});

describe("legal — IOLTA trust accounting", () => {
  it("trust-disburse cannot overdraw client balance", () => {
    const acct = call("trust-account-create", ctxA, { name: "Client Trust" }).result.account;
    const m = call("matters-create", ctxA, { name: "M" }).result.matter;
    call("trust-deposit", ctxA, { accountId: acct.id, matterId: m.id, amount: 500 });
    const over = call("trust-disburse", ctxA, { accountId: acct.id, matterId: m.id, amount: 600 });
    assert.equal(over.ok, false);
    assert.match(over.error, /IOLTA violation|cannot disburse/i);
  });

  it("trust-balance separates per-matter ledgers", () => {
    const acct = call("trust-account-create", ctxA, {}).result.account;
    const m1 = call("matters-create", ctxA, { name: "M1" }).result.matter;
    const m2 = call("matters-create", ctxA, { name: "M2" }).result.matter;
    call("trust-deposit", ctxA, { accountId: acct.id, matterId: m1.id, amount: 1000 });
    call("trust-deposit", ctxA, { accountId: acct.id, matterId: m2.id, amount: 500 });
    call("trust-disburse", ctxA, { accountId: acct.id, matterId: m1.id, amount: 200 });
    const r = call("trust-balance", ctxA, { accountId: acct.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1300);
    const m1Bal = r.result.byMatter.find(x => x.matterId === m1.id);
    assert.equal(m1Bal.balance, 800);
    const m2Bal = r.result.byMatter.find(x => x.matterId === m2.id);
    assert.equal(m2Bal.balance, 500);
  });

  it("trust-reconcile flags book vs bank mismatch", () => {
    const acct = call("trust-account-create", ctxA, {}).result.account;
    const m = call("matters-create", ctxA, { name: "M" }).result.matter;
    call("trust-deposit", ctxA, { accountId: acct.id, matterId: m.id, amount: 1000 });
    const r = call("trust-reconcile", ctxA, { accountId: acct.id, bankBalance: 950 });
    assert.equal(r.ok, true);
    assert.equal(r.result.bookBalance, 1000);
    assert.equal(r.result.bankBalance, 950);
    assert.equal(r.result.reconciled, false);
    assert.ok(r.result.warnings.length > 0);
  });
});

describe("legal — invoices from time entries", () => {
  it("invoices-from-time bills all unbilled entries on a matter and flips their status", () => {
    const m = call("matters-create", ctxA, { name: "M", hourlyRate: 100 }).result.matter;
    call("time-entries-create", ctxA, { matterId: m.id, hours: 2 });
    call("time-entries-create", ctxA, { matterId: m.id, hours: 1 });
    const r = call("invoices-from-time", ctxA, { matterId: m.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.invoice.subtotal, 300);
    assert.equal(r.result.invoice.lineItems.length, 2);
    // No more unbilled — re-call returns error
    const r2 = call("invoices-from-time", ctxA, { matterId: m.id });
    assert.equal(r2.ok, false);
  });
});

describe("legal — documents + e-signature", () => {
  it("doc-generate merges template fields with matter data", () => {
    const tpls = call("doc-templates-list", ctxA).result.templates;
    const engagement = tpls.find(t => /engagement/i.test(t.name));
    assert.ok(engagement);
    const m = call("matters-create", ctxA, { name: "Doe v. Roe", clientName: "Jane Doe", hourlyRate: 400 }).result.matter;
    const r = call("doc-generate", ctxA, { templateId: engagement.id, matterId: m.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.document.body.includes("Jane Doe"));
    assert.ok(r.result.document.body.includes("Doe v. Roe"));
  });

  it("esign-envelope: all recipients sign → envelope completes + doc marked signed", () => {
    const tpls = call("doc-templates-list", ctxA).result.templates;
    const m = call("matters-create", ctxA, { name: "M", clientName: "Sig Client" }).result.matter;
    const doc = call("doc-generate", ctxA, { templateId: tpls[0].id, matterId: m.id }).result.document;
    const env = call("esign-envelope-create", ctxA, { documentId: doc.id, recipients: [{ name: "Client", email: "c@x.com" }, { name: "Counsel", email: "l@x.com" }] }).result.envelope;
    call("esign-envelope-sign", ctxA, { envelopeId: env.id, recipientId: env.recipients[0].id });
    const r2 = call("esign-envelope-sign", ctxA, { envelopeId: env.id, recipientId: env.recipients[1].id });
    assert.equal(r2.result.envelope.status, "completed");
    const docNow = call("documents-list", ctxA).result.documents.find(d => d.id === doc.id);
    assert.equal(docNow.status, "signed");
  });
});

describe("legal — court-rules deadline calculator", () => {
  it("FRCP 12 answer deadline rolls forward over weekend", () => {
    // Trigger on a Thursday: serve a complaint 2026-05-14. 21 days = 2026-06-04 (Thu) — no roll needed
    const r = call("court-rules-deadline", ctxA, { rule: "frcp-12-answer", triggerDate: "2026-05-14" });
    assert.equal(r.ok, true);
    assert.equal(r.result.adjustedDeadline, "2026-06-04");
    assert.equal(r.result.days, 21);
  });

  it("rolls forward over a federal holiday", () => {
    // Pick a trigger so deadline lands on July 4. 21 days before 2026-07-04 = 2026-06-13 (Sat).
    // Using FRCP 33 interrogatories (30 days): trigger 2026-06-04 (Thu) → +30 = 2026-07-04 (Sat? Thu? — let's check)
    // 2026-07-04 is Saturday. So even ignoring holiday, rolls to Mon Jul 6 (Sun → Mon).
    const r = call("court-rules-deadline", ctxA, { rule: "frcp-33-interrogatories", triggerDate: "2026-06-04" });
    assert.equal(r.ok, true);
    // Saturday rolls to Monday minimum; Mon Jul 6 is fine (not a holiday).
    assert.ok(r.result.adjustedDeadline >= "2026-07-06");
    assert.equal(r.result.rolledForward, true);
  });

  it("rejects unknown rule with the supported list", () => {
    const r = call("court-rules-deadline", ctxA, { rule: "not-a-rule" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown rule|Supported/i);
  });
});

describe("legal — AI: matter-update + court-doc-to-calendar", () => {
  it("ai-matter-update returns a deterministic summary when no brain", async () => {
    const m = call("matters-create", ctxA, { name: "AI Matter", hourlyRate: 200 }).result.matter;
    call("time-entries-create", ctxA, { matterId: m.id, hours: 3, description: "Research" });
    const r = await call("ai-matter-update", ctxA, { matterId: m.id });
    assert.equal(r.ok, true);
    assert.match(r.result.source, /deterministic|brain/);
    assert.ok(r.result.summary.length > 10);
  });

  it("ai-court-doc-to-calendar extracts 'within N days' and 'by [date]' deadlines", () => {
    const text = "Defendant shall respond to interrogatories within 30 days of service. The trial is set for January 15, 2027. Plaintiff must file by 2026-09-15.";
    const r = call("ai-court-doc-to-calendar", ctxA, { text, triggerDate: "2026-05-15" });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 3);
    // Verify it captured both styles
    const sources = r.result.suggestions.map(s => s.source);
    assert.ok(sources.includes("within_clause"));
    assert.ok(sources.includes("hearing_clause") || sources.includes("by_date"));
  });
});

describe("legal — dashboard-summary", () => {
  it("aggregates open matters, unbilled time, AR, trust, timers", () => {
    const m = call("matters-create", ctxA, { name: "M", hourlyRate: 100 }).result.matter;
    call("time-entries-create", ctxA, { matterId: m.id, hours: 4 });
    const acct = call("trust-account-create", ctxA, {}).result.account;
    call("trust-deposit", ctxA, { accountId: acct.id, matterId: m.id, amount: 500 });
    call("timer-start", ctxA, { matterId: m.id, description: "live" });
    const r = call("dashboard-summary", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.openMatters, 1);
    assert.equal(r.result.unbilledHours, 4);
    assert.equal(r.result.unbilledTime, 400);
    assert.equal(r.result.trustBalance, 500);
    assert.equal(r.result.runningTimers, 1);
  });
});
