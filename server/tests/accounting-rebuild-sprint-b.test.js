// server/tests/accounting-rebuild-sprint-b.test.js
//
// Tier-2 contract tests for accounting rebuild Sprint B (AI surface).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerAccountingRebuildMacros from "../domains/accounting-rebuild.js";
import registerAccountingAiMacros, { suggestCategoryDeterministic, benfordTest, roundNumberCluster } from "../domains/accounting-ai.js";
import {
  getOrSeedDefaultEntity, listCoa, postJournalEntry, createInvoice, markInvoiceSent,
} from "../lib/accounting/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["234_accounting_rebuild", "235_accounting_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerAccountingRebuildMacros(register);
  registerAccountingAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId, llm = null) { return { db, actor: { userId }, llm }; }

// ─── Deterministic categorizer ───────────────────────────────

describe("suggestCategoryDeterministic", () => {
  it("rent memo → 6010", () => {
    const codes = new Set(["6010", "6020", "6900"]);
    const r = suggestCategoryDeterministic("Monthly rent for the office", codes);
    assert.equal(r.code, "6010");
  });

  it("utilities bill → 6020", () => {
    const codes = new Set(["6010", "6020", "6900"]);
    const r = suggestCategoryDeterministic("Electric bill payment", codes);
    assert.equal(r.code, "6020");
  });

  it("software → 6050", () => {
    const codes = new Set(["6050", "6900"]);
    const r = suggestCategoryDeterministic("GitHub subscription", codes);
    assert.equal(r.code, "6050");
  });

  it("unmatched falls back to 6900 Other Expenses if available", () => {
    const codes = new Set(["6900"]);
    const r = suggestCategoryDeterministic("Unknown random thing", codes);
    assert.equal(r.code, "6900");
    assert.equal(r.matched, "fallback");
  });

  it("returns null when no codes match", () => {
    const codes = new Set(["1010"]);
    const r = suggestCategoryDeterministic("random transaction", codes);
    assert.equal(r, null);
  });
});

// ─── Benford ────────────────────────────────────────────────

describe("benfordTest", () => {
  it("rejects sample size < 30", () => {
    const r = benfordTest([1, 2, 3]);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "min_30_samples");
  });

  it("low chi-squared on Benford-conforming data", () => {
    const amounts = [];
    // Synthetic Benford-y data: log-uniform distribution
    for (let i = 0; i < 200; i++) {
      amounts.push(Math.pow(10, Math.random() * 4));
    }
    const r = benfordTest(amounts);
    assert.equal(r.ok, true);
    assert.equal(r.distribution.length, 9);
    // Should usually NOT violate (log-uniform follows Benford well)
    // Just check the math runs to completion
  });

  it("high chi-squared on uniformly distributed amounts (Benford violation)", () => {
    const amounts = [];
    // Uniform distribution from 1 to 9 first-digit
    for (let i = 0; i < 200; i++) {
      amounts.push(Math.floor(Math.random() * 9) + 1);
    }
    const r = benfordTest(amounts);
    assert.equal(r.ok, true);
    // Uniform should fail Benford (each digit ~1/9, expected first-digit dist is heavy on 1)
    assert.ok(r.chiSquared > 15.51, `expected violation, got chi-squared=${r.chiSquared}`);
    assert.equal(r.violates, true);
  });
});

describe("roundNumberCluster", () => {
  it("flags suspicious when >= 30% of amounts end in .00", () => {
    const amounts = [100.00, 200.00, 300.00, 400.50, 500.00, 615.27, 720.00, 875.50, 999.00, 1100.00];
    const r = roundNumberCluster(amounts);
    assert.equal(r.ok, true);
    assert.equal(r.count, 7);
    assert.equal(r.pctRound, 70);
    assert.equal(r.suspicious, true);
  });

  it("does not flag when most amounts have cents", () => {
    const amounts = Array.from({ length: 20 }, () => Math.random() * 1000);
    const r = roundNumberCluster(amounts);
    assert.equal(r.suspicious, false);
  });
});

// ─── Anomaly scan integration ────────────────────────────────

describe("anomaly_scan via macro", () => {
  it("detects negative_equity when equity total < 0", async () => {
    const e = getOrSeedDefaultEntity(db, "u_neg_equity");
    const accs = listCoa(db, e.id);
    const equity = accs.find((a) => a.code === "3010");
    const cash = accs.find((a) => a.code === "1010");
    // Force negative equity: debit equity, credit cash (e.g. owner withdrawal beyond contribution)
    postJournalEntry(db, e.id, {
      date: "2026-05-15",
      lines: [{ accountId: equity.id, debit: 5000, credit: 0 }, { accountId: cash.id, debit: 0, credit: 5000 }],
      postedBy: "u_neg_equity",
    });
    const r = await MACROS.get("anomaly_scan")(ctx("u_neg_equity"), { startDate: "2026-01-01", endDate: "2026-12-31" });
    assert.equal(r.ok, true);
    assert.ok(r.anomalies.find((a) => a.kind === "negative_equity"));
  });

  it("detects duplicate_invoice (same customer + total)", async () => {
    const e = getOrSeedDefaultEntity(db, "u_dup_inv");
    createInvoice(db, e.id, { customerName: "AcmeDupes", lines: [{ description: "x", quantity: 1, unitPrice: 500, taxRate: 0 }] });
    createInvoice(db, e.id, { customerName: "AcmeDupes", lines: [{ description: "y", quantity: 1, unitPrice: 500, taxRate: 0 }] });
    const r = await MACROS.get("anomaly_scan")(ctx("u_dup_inv"));
    const dup = r.anomalies.find((a) => a.kind === "duplicate_invoice");
    assert.ok(dup);
    assert.equal(dup.detail.customerName, "AcmeDupes");
    assert.equal(dup.detail.total, 500);
  });

  it("anomaly_list with unackOnly returns unacknowledged only + ack marks them off", async () => {
    const e = getOrSeedDefaultEntity(db, "u_ack");
    // Force at least one anomaly via duplicate invoice
    createInvoice(db, e.id, { customerName: "DupForAck", lines: [{ description: "x", quantity: 1, unitPrice: 250, taxRate: 0 }] });
    createInvoice(db, e.id, { customerName: "DupForAck", lines: [{ description: "y", quantity: 1, unitPrice: 250, taxRate: 0 }] });
    await MACROS.get("anomaly_scan")(ctx("u_ack"));
    const r1 = await MACROS.get("anomaly_list")(ctx("u_ack"), { unackOnly: true });
    assert.ok(r1.anomalies.length > 0);
    const id = r1.anomalies[0].id;
    await MACROS.get("anomaly_acknowledge")(ctx("u_ack"), { id, note: "reviewed" });
    const r2 = await MACROS.get("anomaly_list")(ctx("u_ack"), { unackOnly: true });
    assert.ok(!r2.anomalies.find((a) => a.id === id));
  });
});

// ─── Categorize macro ────────────────────────────────────────

describe("categorize_suggest macro", () => {
  it("hits a learned rule first", async () => {
    const e = getOrSeedDefaultEntity(db, "u_cat_rule");
    const accs = listCoa(db, e.id);
    const rent = accs.find((a) => a.code === "6010");
    const r = await MACROS.get("categorize_learn_rule")(ctx("u_cat_rule"), {
      pattern: "magic-landlord-name",
      patternKind: "substring",
      targetAccountId: rent.id,
    });
    assert.equal(r.ok, true);
    const sug = await MACROS.get("categorize_suggest")(ctx("u_cat_rule"), { memo: "Payment to magic-landlord-name for Q3" });
    assert.equal(sug.source, "rule");
    assert.equal(sug.accountId, rent.id);
    assert.equal(sug.confidence, 0.95);
  });

  it("falls back to deterministic pattern when no rule matches", async () => {
    const e = getOrSeedDefaultEntity(db, "u_cat_det");
    const sug = await MACROS.get("categorize_suggest")(ctx("u_cat_det"), { memo: "Office rent for May" });
    assert.equal(sug.source, "deterministic");
    const acc = await MACROS.get("account_get")(ctx("u_cat_det"), { id: sug.accountId });
    assert.equal(acc.account.code, "6010");
  });

  it("rule list shows learned rules", async () => {
    const list = await MACROS.get("categorize_rules_list")(ctx("u_cat_rule"));
    assert.ok(list.rules.find((r) => r.pattern === "magic-landlord-name"));
  });
});

// ─── Narrative composer ────────────────────────────────────

describe("narrative_compose", () => {
  it("deterministic P&L narrative includes revenue + expenses + net income", async () => {
    const e = getOrSeedDefaultEntity(db, "u_narr_pl");
    const accs = listCoa(db, e.id);
    const cash = accs.find((a) => a.code === "1010");
    const rev = accs.find((a) => a.code === "4010");
    const rent = accs.find((a) => a.code === "6010");
    postJournalEntry(db, e.id, {
      date: "2026-06-15",
      lines: [{ accountId: cash.id, debit: 10000, credit: 0 }, { accountId: rev.id, debit: 0, credit: 10000 }],
      postedBy: "u_narr_pl",
    });
    postJournalEntry(db, e.id, {
      date: "2026-06-20",
      lines: [{ accountId: rent.id, debit: 2500, credit: 0 }, { accountId: cash.id, debit: 0, credit: 2500 }],
      postedBy: "u_narr_pl",
    });
    const r = await MACROS.get("narrative_compose")(ctx("u_narr_pl"), {
      kind: "profit_loss",
      startDate: "2026-06-01", endDate: "2026-06-30",
      deterministic: true,
    });
    assert.equal(r.ok, true);
    assert.ok(r.narrative.includes("10000.00"));
    assert.ok(r.narrative.includes("2500.00"));
    assert.ok(r.narrative.includes("7500.00"));  // net income
    assert.ok(Array.isArray(r.bullets));
  });

  it("balance sheet narrative tones reflect deterministic prose", async () => {
    const e = getOrSeedDefaultEntity(db, "u_narr_bs");
    const r = await MACROS.get("narrative_compose")(ctx("u_narr_bs"), {
      kind: "balance_sheet",
      tone: "executive",
      deterministic: true,
    });
    assert.equal(r.ok, true);
    assert.ok(r.narrative.length > 0);
  });

  it("narratives_list returns recent narratives", async () => {
    const r = await MACROS.get("narratives_list")(ctx("u_narr_pl"));
    assert.ok(r.narratives.length > 0);
  });
});

// ─── Receipt extraction ───────────────────────────────────

describe("receipt_extract + convert_to_je", () => {
  it("manual extraction creates pending extraction", async () => {
    const e = getOrSeedDefaultEntity(db, "u_receipt");
    const r = await MACROS.get("receipt_extract")(ctx("u_receipt"), {
      vendor: "GitHub",
      total: 21,
      receiptDate: "2026-05-18",
      lineItems: [{ description: "GitHub Pro subscription", quantity: 1, unitPrice: 21, total: 21 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.extracted.vendor, "GitHub");
    assert.equal(r.extracted.total, 21);
    // Should suggest 6050 Software Subscriptions via deterministic match
    assert.equal(r.suggestedAccountCode, "6050");
    const pending = await MACROS.get("receipt_extractions_pending")(ctx("u_receipt"));
    assert.equal(pending.extractions.length, 1);
  });

  it("convert_to_je posts a balanced JE + marks extraction converted", async () => {
    const e = getOrSeedDefaultEntity(db, "u_conv");
    const accs = listCoa(db, e.id);
    const cash = accs.find((a) => a.code === "1010");
    const r = await MACROS.get("receipt_extract")(ctx("u_conv"), { vendor: "AT&T", total: 89, receiptDate: "2026-05-18" });
    const conv = await MACROS.get("receipt_convert_to_je")(ctx("u_conv"), {
      id: r.id, cashAccountId: cash.id, expenseAccountId: r.suggestedAccountId || accs.find((a) => a.code === "6900").id,
    });
    assert.equal(conv.ok, true);
    assert.ok(conv.number.startsWith("JE-"));
    // Re-fetch the extraction — should be marked converted
    const pending = await MACROS.get("receipt_extractions_pending")(ctx("u_conv"));
    assert.equal(pending.extractions.length, 0);
  });

  it("convert_to_je refuses if already converted", async () => {
    const e = getOrSeedDefaultEntity(db, "u_conv2");
    const accs = listCoa(db, e.id);
    const cash = accs.find((a) => a.code === "1010");
    const expense = accs.find((a) => a.code === "6900");
    const r = await MACROS.get("receipt_extract")(ctx("u_conv2"), { vendor: "Once", total: 50 });
    await MACROS.get("receipt_convert_to_je")(ctx("u_conv2"), { id: r.id, cashAccountId: cash.id, expenseAccountId: expense.id });
    const again = await MACROS.get("receipt_convert_to_je")(ctx("u_conv2"), { id: r.id, cashAccountId: cash.id, expenseAccountId: expense.id });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "already_converted");
  });
});
