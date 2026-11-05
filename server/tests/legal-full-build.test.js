// legal-full-build.test.js — build(legal): full lens build (LG-S3..S6).
//
// Pins the behaviours the R5 full pass priced:
//  · LG-S3 — legal-question citations are verified against the lens's own
//    procedure reference: the walked Q1 shape (30-day answer citing
//    §416.10) is corrected to §412.20 with the correction disclosed; a
//    cite outside the reference subset is flagged unverified, never
//    laundered; a federal question stays unchecked.
//  · LG-S5 — court-rules-deadline serves state response-time rules
//    sourced from the procedure reference (CA §412.20: 30 days from
//    2026-10-31 → 2026-11-30, the pass's own arithmetic) with citation +
//    disclaimer; the federal library is unchanged.
//  · LG-S6 — realization collection measured against the invoiced total
//    (the walk's 108% becomes exactly 100% on a settled invoice);
//    conflictCheck searches the workspace (not only the names handed to
//    it) and names its scope; docket cases link to matters both ways;
//    matters-detail totals carry unbilledHours on the unbilled basis.
//  · LG-S4 — law.courtlistener-search (the shared client Legal's citator
//    rides): a proper User-Agent is sent, and every upstream failure is a
//    plain-language unavailable state — no raw codes, no env-var names.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLegalActions from "../domains/legal.js";
import registerLawActions from "../domains/law.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}, artifactData = null) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  const artifact = artifactData === null ? { id: null, data: {}, meta: {} } : { id: "art_test", data: artifactData, meta: {} };
  return fn(ctx, artifact, params);
}
const legal = (name, ctx, params, artifactData) => call("legal", name, ctx, params, artifactData);
const law = (name, ctx, params) => call("law", name, ctx, params);

before(() => { registerLegalActions(register); registerLawActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.COURTLISTENER_API_TOKEN;
});

const ctxA = { actor: { userId: "lawyer_a" }, userId: "lawyer_a" };
const llmCtx = (payload) => ({
  actor: { userId: "lawyer_a" }, userId: "lawyer_a",
  llm: { chat: async () => ({ text: JSON.stringify(payload) }) },
});

/* ───────────────────────── LG-S3: citation verification ───────── */

describe("LG-S3 legal-question citation verification", () => {
  it("corrects the walked Q1 shape: 30-day answer citing §416.10 → §412.20, disclosed", async () => {
    const ctx = llmCtx({
      answer: "A defendant generally has 30 days after service of the summons to file an answer or other responsive pleading.",
      citations: [{ title: "California Code of Civil Procedure § 416.10", section: "416.10" }],
      caveats: [],
    });
    const r = await legal("legal-question", ctx, { question: "How long do I have to respond to a complaint in California?", jurisdiction: "US-CA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.citations[0].section, "412.20");
    assert.equal(r.result.citations[0].verification, "reference");
    assert.equal(r.result.citations[0].corrected, true);
    assert.ok(r.result.caveats.some(c => /corrected against the procedure reference/.test(c)), "correction disclosed in caveats");
  });

  it("flags a cite outside the reference subset as unverified (the §337 shape), never laundered", async () => {
    const ctx = llmCtx({
      answer: "The statute of limitations for a written contract is four years.",
      citations: [{ title: "California Code of Civil Procedure § 337", section: "337" }],
      caveats: [],
    });
    const r = await legal("legal-question", ctx, { question: "What is the limitations period for a written contract?", jurisdiction: "US-CA" });
    assert.equal(r.result.citations[0].section, "337");
    assert.equal(r.result.citations[0].verification, "unverified");
    assert.ok(r.result.caveats.some(c => /could not be verified/.test(c)));
  });

  it("marks a citation that matches the reference as verified, uncorrected", async () => {
    const ctx = llmCtx({
      answer: "A party may move for summary judgment where there is no triable issue of material fact.",
      citations: [{ title: "Cal. Civ. Proc. Code § 437c", section: "437c" }],
      caveats: [],
    });
    const r = await legal("legal-question", ctx, { question: "When can I move for summary judgment in California?", jurisdiction: "US-CA" });
    assert.equal(r.result.citations[0].verification, "reference");
    assert.equal(r.result.citations[0].corrected, undefined);
  });

  it("leaves federal citations unchecked", async () => {
    const ctx = llmCtx({
      answer: "An answer is due 21 days after service.",
      citations: [{ title: "Fed. R. Civ. P. 12(a)(1)(A)", section: "12" }],
      caveats: [],
    });
    const r = await legal("legal-question", ctx, { question: "Federal answer deadline?", jurisdiction: "US-Federal" });
    assert.equal(r.result.citations[0].verification, null);
  });
});

/* ───────────────────────── LG-S5: state deadline rules ────────── */

describe("LG-S5 court-rules-deadline state rules (from the procedure reference)", () => {
  it("computes CCP §412.20: 30 days from 2026-10-31 → 2026-11-30, with citation + disclaimer", () => {
    const r = legal("court-rules-deadline", ctxA, { rule: "ca-response", triggerDate: "2026-10-31" });
    assert.equal(r.ok, true);
    assert.equal(r.result.days, 30);
    assert.equal(r.result.adjustedDeadline, "2026-11-30");
    assert.match(r.result.citation, /412\.20/);
    assert.ok(r.result.disclaimer && r.result.disclaimer.length > 20);
    assert.ok(r.result.countingNote);
  });

  it("serves the other reference states' response windows (TX 20 · OH 28 · GA 30)", () => {
    assert.equal(legal("court-rules-deadline", ctxA, { rule: "tx-response", triggerDate: "2026-10-31" }).result.days, 20);
    assert.equal(legal("court-rules-deadline", ctxA, { rule: "oh-response", triggerDate: "2026-10-31" }).result.days, 28);
    assert.equal(legal("court-rules-deadline", ctxA, { rule: "ga-response", triggerDate: "2026-10-31" }).result.days, 30);
  });

  it("does not offer PA (its reference entry covers subsequent pleadings, not the response window)", () => {
    const r = legal("court-rules-deadline", ctxA, { rule: "pa-response", triggerDate: "2026-10-31" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown rule/);
  });

  it("federal library unchanged: FRCP 12 answer is 21 days", () => {
    const r = legal("court-rules-deadline", ctxA, { rule: "frcp-12-answer", triggerDate: "2026-10-31" });
    assert.equal(r.ok, true);
    assert.equal(r.result.days, 21);
    assert.equal(r.result.citation, undefined);
  });
});

/* ───────────────────────── LG-S6: rollup / conflicts / linking ── */

describe("LG-S6 realization-rollup collection basis", () => {
  it("an exactly-settled invoice collects at 100%, not 108% (the walk's numbers)", async () => {
    const m = legal("matters-create", ctxA, { name: "LG-S6 Matter", matterType: "litigation", hourlyRate: 200 }).result.matter;
    legal("time-entries-create", ctxA, { matterId: m.id, hours: 0.5, rate: 200 });
    legal("time-entries-create", ctxA, { matterId: m.id, hours: 0.01, rate: 200 });
    const inv = legal("invoices-from-time", ctxA, { matterId: m.id, taxRate: 0.08 }).result.invoice;
    assert.equal(inv.subtotal, 102);
    assert.equal(inv.total, 110.16);
    legal("payment-record", ctxA, { amount: 110.16, matterId: m.id, invoiceId: inv.id, method: "card" });
    const r = legal("realization-rollup", ctxA, {});
    const row = r.result.matters.find(x => x.matterId === m.id);
    assert.equal(row.billed, 102);
    assert.equal(row.billedTotal, 110.16);
    assert.equal(row.collected, 110.16);
    assert.equal(row.collectionRate, 1);
    assert.equal(r.result.totals.firmCollectionRate, 1);
  });
});

describe("LG-S6 conflictCheck workspace search", () => {
  it("finds a checked name standing in the workspace contacts (the walk's divergence)", () => {
    legal("contacts-create", ctxA, { name: "PR Probe Opposing", kind: "opposing_party" });
    const m = legal("matters-create", ctxA, { name: "Probe Matter", matterType: "litigation", clientName: "PR Probe Opposing" }).result.matter;
    void m;
    // Pristine shape: artifact data carries an unrelated client; the name
    // exists only in the workspace store.
    const r = legal("conflictCheck", ctxA, { checkAgainst: ["PR Probe Opposing"] }, { client: "Someone Else", parties: ["Someone Else"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasConflict, true);
    assert.ok(r.result.conflicts.some(c => c.conflictType === "workspace_contact" || c.conflictType === "workspace_matter"));
    assert.match(r.result.scope, /workspace contacts \+ matters/);
  });

  it("still reports the artifact-local direct-party hit", () => {
    const r = legal("conflictCheck", ctxA, { checkAgainst: ["Acme Corp"] }, { client: "Acme Corp", parties: [] });
    assert.equal(r.result.hasConflict, true);
    assert.ok(r.result.conflicts.some(c => c.conflictType === "direct_party"));
  });

  it("a genuinely absent name is clear — with the scope still named", () => {
    const r = legal("conflictCheck", ctxA, { checkAgainst: ["Nobody Here"] }, { client: "A", parties: ["A"] });
    assert.equal(r.result.hasConflict, false);
    assert.match(r.result.scope, /workspace/);
  });
});

describe("LG-S6 case↔matter linking", () => {
  it("links a docket case to a matter, reads it back both ways, rejects a dangling link", () => {
    const m = legal("matters-create", ctxA, { name: "Link Matter", matterType: "litigation" }).result.matter;
    const bad = legal("case-add", ctxA, { caption: "X v. Y", caseNumber: "1:26-cv-1", matterId: "mat_missing" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /matter not found/);
    const c = legal("case-add", ctxA, { caption: "Link v. Case", caseNumber: "1:26-cv-2", matterId: m.id }).result.case;
    assert.equal(c.matterId, m.id);
    assert.equal(legal("case-list", ctxA, { matterId: m.id }).result.cases.length, 1);
    assert.equal(legal("case-list", ctxA, {}).result.cases.length, 1);
    const detail = legal("matters-detail", ctxA, { id: m.id }).result;
    assert.equal(detail.cases.length, 1);
    assert.equal(detail.cases[0].caseNumber, "1:26-cv-2");
  });

  it("matters-detail totals carry unbilledHours on the unbilled basis", () => {
    const m = legal("matters-create", ctxA, { name: "Hours Matter", matterType: "litigation", hourlyRate: 200 }).result.matter;
    legal("time-entries-create", ctxA, { matterId: m.id, hours: 0.51, rate: 200 });
    const detail = legal("matters-detail", ctxA, { id: m.id }).result;
    assert.equal(detail.totals.unbilledHours, 0.51);
    assert.equal(detail.totals.hours, 0.51);
  });
});

/* ───────────────────────── LG-S4: CourtListener client ────────── */

describe("LG-S4 law.courtlistener-search error honesty + UA", () => {
  it("sends a User-Agent and maps a 401 to the plain-language key state (no raw plumbing)", async () => {
    let seenHeaders = null;
    globalThis.fetch = async (_url, opts) => { seenHeaders = opts?.headers || {}; return { ok: false, status: 401, json: async () => ({}) }; };
    const r = await law("courtlistener-search", ctxA, { query: "Plessy" });
    assert.equal(r.ok, false);
    assert.equal(r.unavailable, true);
    assert.match(r.error, /account key/);
    assert.doesNotMatch(r.error, /unreachable|COURTLISTENER_API_TOKEN|courtlistener 401/);
    assert.ok(seenHeaders["User-Agent"], "User-Agent header sent");
  });

  it("maps a network failure to the plain-language unavailable state", async () => {
    globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
    const r = await law("courtlistener-search", ctxA, { query: "Plessy" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unavailable/);
    assert.doesNotMatch(r.error, /unreachable|ENOTFOUND/);
  });

  it("returns mapped results when the upstream answers", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ count: 1, results: [{ id: 1, caseName: "Plessy v. Ferguson", court: "scotus", dateFiled: "1896-05-18", absolute_url: "/opinion/1/", citation: "163 U.S. 537", status: "Precedential" }] }),
    });
    const r = await law("courtlistener-search", ctxA, { query: "Plessy" });
    assert.equal(r.ok, true);
    assert.equal(r.result.results[0].caseName, "Plessy v. Ferguson");
  });
});
