// server/tests/wallet-rebuild-sprint-b.test.js
//
// Wallet Sprint B — AI surface: categorization cascade + anomaly scan
// + subscription discovery + cashflow forecast + tax summary.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerWalletRebuildMacros from "../domains/wallet-rebuild.js";
import registerWalletAiMacros, { categorizeDeterministic, findSubscriptionCandidates } from "../domains/wallet-ai.js";
import { linkAccount, ingestTransaction, upsertBalance, registerRecurring } from "../lib/wallet/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["243_wallet_rebuild", "244_wallet_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS economy_ledger (id INTEGER PRIMARY KEY, from_user_id TEXT, to_user_id TEXT, amount REAL, fee REAL, net REAL, status TEXT)`);
  registerWalletRebuildMacros(register);
  registerWalletAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Deterministic categorization ─────────────────────────

describe("categorizeDeterministic", () => {
  it("Starbucks → food.restaurants", () => {
    const r = categorizeDeterministic("STARBUCKS #1234 SEATTLE WA");
    assert.equal(r.category, "food.restaurants");
  });

  it("DoorDash → food.restaurants", () => {
    const r = categorizeDeterministic("DOORDASH*MCDONALDS");
    assert.equal(r.category, "food.restaurants");
  });

  it("Whole Foods → food.groceries", () => {
    const r = categorizeDeterministic("WHOLE FOODS MARKET");
    assert.equal(r.category, "food.groceries");
  });

  it("Shell → transport.fuel", () => {
    const r = categorizeDeterministic("SHELL OIL 12345");
    assert.equal(r.category, "transport.fuel");
  });

  it("Netflix → subscriptions", () => {
    const r = categorizeDeterministic("Netflix monthly");
    assert.equal(r.category, "subscriptions");
  });

  it("Delta Airlines → travel", () => {
    const r = categorizeDeterministic("DELTA AIRLINES BWI");
    assert.equal(r.category, "travel");
  });

  it("payroll + credit direction → income.salary", () => {
    const r = categorizeDeterministic("ACME CORP PAYROLL", "credit");
    assert.equal(r.category, "income.salary");
  });

  it("unmatched returns null", () => {
    const r = categorizeDeterministic("xyzabc123random");
    assert.equal(r, null);
  });
});

// ─── Subscription discovery heuristic ─────────────────────

describe("findSubscriptionCandidates", () => {
  it("detects monthly Netflix charges", () => {
    const baseT = 2_000_000_000;
    const txs = [
      { direction: "debit", counterparty: "Netflix", amount_cents: 1599, occurred_at: baseT },
      { direction: "debit", counterparty: "Netflix", amount_cents: 1599, occurred_at: baseT + 30 * 86400 },
      { direction: "debit", counterparty: "Netflix", amount_cents: 1599, occurred_at: baseT + 60 * 86400 },
      { direction: "debit", counterparty: "Netflix", amount_cents: 1599, occurred_at: baseT + 90 * 86400 },
    ];
    const cands = findSubscriptionCandidates(txs);
    assert.equal(cands.length, 1);
    assert.equal(cands[0].counterparty, "Netflix");
    assert.equal(cands[0].cadence, "monthly");
    assert.equal(cands[0].sample_count, 4);
    assert.ok(cands[0].confidence > 0.7);
  });

  it("detects weekly groceries", () => {
    const baseT = 2_000_000_000;
    const txs = [];
    for (let i = 0; i < 5; i++) {
      txs.push({ direction: "debit", counterparty: "Whole Foods", amount_cents: 8500, occurred_at: baseT + i * 7 * 86400 });
    }
    const cands = findSubscriptionCandidates(txs);
    assert.ok(cands.find((c) => c.cadence === "weekly"));
  });

  it("ignores < 3 occurrences", () => {
    const baseT = 2_000_000_000;
    const txs = [
      { direction: "debit", counterparty: "Random Store", amount_cents: 500, occurred_at: baseT },
      { direction: "debit", counterparty: "Random Store", amount_cents: 500, occurred_at: baseT + 30 * 86400 },
    ];
    const cands = findSubscriptionCandidates(txs);
    assert.equal(cands.length, 0);
  });

  it("ignores credits", () => {
    const baseT = 2_000_000_000;
    const txs = [];
    for (let i = 0; i < 5; i++) {
      txs.push({ direction: "credit", counterparty: "Paycheck", amount_cents: 500000, occurred_at: baseT + i * 14 * 86400 });
    }
    const cands = findSubscriptionCandidates(txs);
    assert.equal(cands.length, 0);
  });
});

// ─── Rule + LLM cascade via macro ────────────────────────

describe("tx_categorize_suggest cascade", () => {
  it("rule hits first with confidence 0.95", async () => {
    const r = await MACROS.get("categorize_learn_rule")(ctx("u_cat_rule"), {
      pattern: "magic-merchant-x", patternKind: "substring", targetCategory: "shopping",
    });
    assert.equal(r.ok, true);
    const sug = await MACROS.get("tx_categorize_suggest")(ctx("u_cat_rule"), { text: "Payment to magic-merchant-x Inc" });
    assert.equal(sug.source, "rule");
    assert.equal(sug.category, "shopping");
    assert.equal(sug.confidence, 0.95);
  });

  it("falls back to deterministic when no rule matches", async () => {
    const sug = await MACROS.get("tx_categorize_suggest")(ctx("u_det"), { text: "STARBUCKS #99" });
    assert.equal(sug.source, "deterministic");
    assert.equal(sug.category, "food.restaurants");
  });

  it("missing text rejected", async () => {
    const sug = await MACROS.get("tx_categorize_suggest")(ctx("u_x"), {});
    assert.equal(sug.reason, "text_required");
  });
});

// ─── Anomaly scan ─────────────────────────────────────────

describe("anomaly_scan", () => {
  it("duplicate charge within 10min detected as duplicate_charge", async () => {
    const a = linkAccount(db, "u_dup", { nickname: "X", kind: "bank_checking" });
    const t = Math.floor(Date.now() / 1000);
    ingestTransaction(db, "u_dup", { accountId: a.id, sourceProviderId: "s1", direction: "debit", amountCents: 8500, counterparty: "Coffee Shop", occurredAt: t });
    ingestTransaction(db, "u_dup", { accountId: a.id, sourceProviderId: "s2", direction: "debit", amountCents: 8500, counterparty: "Coffee Shop", occurredAt: t + 60 });
    const r = await MACROS.get("anomaly_scan")(ctx("u_dup"));
    assert.equal(r.ok, true);
    const dup = r.anomalies.find((x) => x.kind === "duplicate_charge");
    assert.ok(dup);
    assert.equal(dup.detail.amount_cents, 8500);
  });

  it("spending spike detected when 7d total >= 1.5x baseline", async () => {
    const a = linkAccount(db, "u_spike", { nickname: "X", kind: "bank_checking" });
    const now = Math.floor(Date.now() / 1000);
    // Baseline: $50/day for last 90 days (excluding most recent 7) = small steady spending
    for (let i = 8; i < 60; i++) {
      ingestTransaction(db, "u_spike", { accountId: a.id, sourceProviderId: `b${i}`, direction: "debit", amountCents: 5000, occurredAt: now - i * 86400 });
    }
    // Recent: 7 days with $200/day spending (4x baseline)
    for (let i = 0; i < 7; i++) {
      ingestTransaction(db, "u_spike", { accountId: a.id, sourceProviderId: `r${i}`, direction: "debit", amountCents: 20000, occurredAt: now - i * 86400 });
    }
    const r = await MACROS.get("anomaly_scan")(ctx("u_spike"));
    assert.ok(r.anomalies.find((x) => x.kind === "spending_spike"));
  });

  it("anomaly_acknowledge removes from unack list", async () => {
    const a = linkAccount(db, "u_ack", { nickname: "X", kind: "bank_checking" });
    const t = Math.floor(Date.now() / 1000);
    ingestTransaction(db, "u_ack", { accountId: a.id, sourceProviderId: "s1", direction: "debit", amountCents: 999, counterparty: "X", occurredAt: t });
    ingestTransaction(db, "u_ack", { accountId: a.id, sourceProviderId: "s2", direction: "debit", amountCents: 999, counterparty: "X", occurredAt: t + 30 });
    await MACROS.get("anomaly_scan")(ctx("u_ack"));
    const before = await MACROS.get("anomaly_list")(ctx("u_ack"));
    assert.ok(before.anomalies.length >= 1);
    const id = before.anomalies[0].id;
    await MACROS.get("anomaly_acknowledge")(ctx("u_ack"), { id, note: "reviewed" });
    const after = await MACROS.get("anomaly_list")(ctx("u_ack"));
    assert.ok(!after.anomalies.find((a) => a.id === id));
  });
});

// ─── Subscription discovery via macro ────────────────────

describe("subscription_discover macro", () => {
  it("detects + persists Netflix monthly + allows promote", async () => {
    const a = linkAccount(db, "u_sub", { nickname: "X", kind: "bank_checking" });
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 4; i++) {
      ingestTransaction(db, "u_sub", { accountId: a.id, sourceProviderId: `nf${i}`, direction: "debit", amountCents: 1599, counterparty: "Netflix", occurredAt: now - i * 30 * 86400 });
    }
    const r = await MACROS.get("subscription_discover")(ctx("u_sub"));
    assert.equal(r.ok, true);
    assert.ok(r.candidates.length >= 1);
    const list = await MACROS.get("subscription_predictions_list")(ctx("u_sub"));
    const pred = list.predictions.find((p) => p.counterparty === "Netflix");
    assert.ok(pred);
    const promoted = await MACROS.get("subscription_promote")(ctx("u_sub"), { id: pred.id });
    assert.equal(promoted.ok, true);
    assert.ok(promoted.recurringId);
  });

  it("dismiss hides from list", async () => {
    const a = linkAccount(db, "u_dis", { nickname: "X", kind: "bank_checking" });
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 4; i++) {
      ingestTransaction(db, "u_dis", { accountId: a.id, sourceProviderId: `d${i}`, direction: "debit", amountCents: 2999, counterparty: "FalseAlarm Co", occurredAt: now - i * 30 * 86400 });
    }
    await MACROS.get("subscription_discover")(ctx("u_dis"));
    const list = await MACROS.get("subscription_predictions_list")(ctx("u_dis"));
    const id = list.predictions[0].id;
    await MACROS.get("subscription_dismiss")(ctx("u_dis"), { id });
    const after = await MACROS.get("subscription_predictions_list")(ctx("u_dis"));
    assert.ok(!after.predictions.find((p) => p.id === id));
  });
});

// ─── Cashflow forecast ───────────────────────────────────

describe("cashflow_forecast", () => {
  it("computes 30-day projection from 90-day history", async () => {
    const a = linkAccount(db, "u_cf", { nickname: "Bank", kind: "bank_checking" });
    upsertBalance(db, a.id, { balanceCents: 100000, currency: "USD" });
    const now = Math.floor(Date.now() / 1000);
    // 90 days of $100/day spending + $200/day income
    for (let i = 0; i < 90; i++) {
      ingestTransaction(db, "u_cf", { accountId: a.id, sourceProviderId: `s${i}`, direction: "debit", amountCents: 10000, occurredAt: now - i * 86400 });
      ingestTransaction(db, "u_cf", { accountId: a.id, sourceProviderId: `i${i}`, direction: "credit", amountCents: 20000, occurredAt: now - i * 86400 });
    }
    const r = await MACROS.get("cashflow_forecast")(ctx("u_cf"), { horizonDays: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.horizonDays, 30);
    // $200/day × 30 = $6000 income; $100/day × 30 = $3000 spend; net +$3000 = 300000c
    assert.equal(r.projectedIncomeCents, 600000);
    assert.equal(r.projectedSpendCents, 300000);
    assert.equal(r.projectedNetCents, 300000);
    // Ending balance = current 100000 + 600000 - 300000 - 0 recurring = 400000
    assert.ok(r.endingBalanceCents >= 350000 && r.endingBalanceCents <= 450000);
  });

  it("60-day horizon projects 2x daily averages", async () => {
    const a = linkAccount(db, "u_cf60", { nickname: "Bank", kind: "bank_checking" });
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 90; i++) {
      ingestTransaction(db, "u_cf60", { accountId: a.id, sourceProviderId: `s60_${i}`, direction: "debit", amountCents: 5000, occurredAt: now - i * 86400 });
    }
    const r = await MACROS.get("cashflow_forecast")(ctx("u_cf60"), { horizonDays: 60 });
    // $50/day × 60 = $3000 spend
    assert.equal(r.projectedSpendCents, 300000);
  });

  it("invalid horizon snaps to 30", async () => {
    const r = await MACROS.get("cashflow_forecast")(ctx("u_cf_bad"), { horizonDays: 999 });
    assert.equal(r.horizonDays, 30);
  });
});

// ─── Tax summary ─────────────────────────────────────────

describe("tax_summary_compose", () => {
  it("aggregates income + tax-related expenses for a year with mandatory disclaimer", async () => {
    const a = linkAccount(db, "u_tax", { nickname: "X", kind: "bank_checking" });
    const t = Math.floor(new Date("2026-06-15T00:00:00Z").getTime() / 1000);
    ingestTransaction(db, "u_tax", { accountId: a.id, sourceProviderId: "p1", direction: "credit", amountCents: 5000000, category: "income.salary", occurredAt: t });
    ingestTransaction(db, "u_tax", { accountId: a.id, sourceProviderId: "p2", direction: "debit", amountCents: 200000, category: "tax", occurredAt: t });
    ingestTransaction(db, "u_tax", { accountId: a.id, sourceProviderId: "p3", direction: "debit", amountCents: 150000, category: "health", occurredAt: t });
    const r = await MACROS.get("tax_summary_compose")(ctx("u_tax"), { year: 2026 });
    assert.equal(r.ok, true);
    assert.equal(r.totalIncomeCents, 5000000);
    assert.equal(r.totalTaxRelatedCents, 350000);
    assert.ok(r.summary.includes("$50000.00"));  // income $50k
    assert.ok(r.disclaimer.includes("not tax advice"));
  });
});

// ─── AI runs provenance ──────────────────────────────────

describe("ai_runs_recent", () => {
  it("each AI macro records a run entry", async () => {
    await MACROS.get("tx_categorize_suggest")(ctx("u_ai_log"), { text: "STARBUCKS test" });
    const r = await MACROS.get("ai_runs_recent")(ctx("u_ai_log"));
    assert.equal(r.ok, true);
    assert.ok(r.runs.length >= 1);
    assert.equal(r.runs[0].kind, "categorize");
  });
});
