// server/tests/wallet-rebuild-sprint-a.test.js
//
// Wallet lens Sprint A — non-custodial-by-design substrate.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerWalletRebuildMacros from "../domains/wallet-rebuild.js";
import {
  linkAccount, getAccount, listAccounts, disconnectAccount,
  upsertBalance, getBalance, refreshConcordCoinBalance, unifiedBalances,
  ingestTransaction, listTransactions, categorizeTransaction,
  registerRecurring, listRecurring, cancelRecurring,
  listCategories, upsertCategory,
  getRailsConfig, updateRailsConfig,
  spendingSummary,
} from "../lib/wallet/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/243_wallet_rebuild.js");
  m.up(db);
  // Minimal economy_ledger stub for Concord Coin balance computation
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id TEXT, to_user_id TEXT,
      amount REAL, fee REAL, net REAL,
      status TEXT, created_at INTEGER
    );
  `);
  registerWalletRebuildMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Accounts ─────────────────────────────────────────────

describe("accounts (non-custodial)", () => {
  it("linkAccount accepts valid kind enum + non-custodial credentials_ref", () => {
    const r = linkAccount(db, "u_link", {
      nickname: "My Chase Checking", kind: "bank_checking",
      provider: "plaid", credentialsRef: "public-sandbox-token-xyz",
      institution: "Chase", accountMask: "1234",
    });
    assert.equal(r.ok, true);
    const a = getAccount(db, r.id, "u_link");
    assert.equal(a.kind, "bank_checking");
    assert.equal(a.provider, "plaid");
    assert.equal(a.credentials_ref, "public-sandbox-token-xyz");
    // Default readonly=1 (non-custodial principle)
    assert.equal(a.readonly, 1);
  });

  it("invalid kind rejected", () => {
    const r = linkAccount(db, "u_bad", { nickname: "X", kind: "bitcoin_savings" });
    assert.equal(r.reason, "invalid_kind");
  });

  it("Concord Coin account is unique per user (no dup)", () => {
    const r1 = linkAccount(db, "u_cc", { nickname: "Concord Coin", kind: "concord_coin" });
    const r2 = linkAccount(db, "u_cc", { nickname: "Concord Coin (2)", kind: "concord_coin" });
    assert.equal(r1.id, r2.id);
    assert.equal(r2.alreadyExists, true);
  });

  it("listAccounts excludes removed by default + filters by kind", () => {
    linkAccount(db, "u_la", { nickname: "Bank A", kind: "bank_checking" });
    const card = linkAccount(db, "u_la", { nickname: "Card", kind: "credit_card" });
    disconnectAccount(db, "u_la", card.id);
    const all = listAccounts(db, "u_la");
    assert.equal(all.length, 1);
    assert.equal(all[0].nickname, "Bank A");
    const withRemoved = listAccounts(db, "u_la", { includeRemoved: true });
    assert.equal(withRemoved.length, 2);
    const cardsOnly = listAccounts(db, "u_la", { kind: "credit_card" });
    assert.equal(cardsOnly.length, 0);  // removed_at IS NOT NULL filtered
  });
});

// ─── Balances + unified view ──────────────────────────────

describe("balances + Concord Coin live computation", () => {
  it("upsertBalance + getBalance round-trip", () => {
    const a = linkAccount(db, "u_bal", { nickname: "Brokerage", kind: "brokerage" });
    upsertBalance(db, a.id, { balanceCents: 1_500_000, currency: "USD", source: "provider" });
    const got = getBalance(db, a.id);
    assert.equal(got.balance_cents, 1500000);
    assert.equal(got.source, "provider");
  });

  it("Concord Coin balance computed live from economy_ledger", () => {
    // Seed economy_ledger
    db.prepare(`INSERT INTO economy_ledger (to_user_id, amount, fee, net, status) VALUES (?, ?, ?, ?, 'complete')`).run("u_cc_live", 100.0, 0, 100.0);
    db.prepare(`INSERT INTO economy_ledger (to_user_id, amount, fee, net, status) VALUES (?, ?, ?, ?, 'complete')`).run("u_cc_live", 50.5, 0, 50.5);
    db.prepare(`INSERT INTO economy_ledger (from_user_id, amount, fee, net, status) VALUES (?, ?, ?, ?, 'complete')`).run("u_cc_live", 30.0, 0, 30.0);
    const acc = linkAccount(db, "u_cc_live", { nickname: "Concord Coin", kind: "concord_coin", currency: "concord_coin" });
    const r = refreshConcordCoinBalance(db, "u_cc_live", acc.id);
    assert.equal(r.ok, true);
    // (100 + 50.5) - 30 = 120.5 → 12050 cents
    assert.equal(r.balanceCents, 12050);
    const bal = getBalance(db, acc.id);
    assert.equal(bal.balance_cents, 12050);
    assert.equal(bal.source, "live");
  });

  it("unifiedBalances includes all accounts + totals by currency", () => {
    const a1 = linkAccount(db, "u_uni", { nickname: "Bank", kind: "bank_checking" });
    const a2 = linkAccount(db, "u_uni", { nickname: "Concord Coin", kind: "concord_coin", currency: "concord_coin" });
    upsertBalance(db, a1.id, { balanceCents: 500000, currency: "USD" });
    upsertBalance(db, a2.id, { balanceCents: 5000, currency: "concord_coin" });
    const out = unifiedBalances(db, "u_uni", { refreshConcord: false });
    assert.equal(out.length, 2);
    const bank = out.find((a) => a.kind === "bank_checking");
    assert.equal(bank.balance_cents, 500000);
  });
});

// ─── Transactions ─────────────────────────────────────────

describe("transactions", () => {
  it("ingestTransaction dedupes on (account_id, source_provider_id)", () => {
    const a = linkAccount(db, "u_tx", { nickname: "TxBank", kind: "bank_checking" });
    const r1 = ingestTransaction(db, "u_tx", {
      accountId: a.id, sourceProviderId: "plaid-tx-1",
      direction: "debit", amountCents: 4250,
      counterparty: "Starbucks", category: "food.restaurants",
      occurredAt: Math.floor(Date.now() / 1000),
    });
    assert.equal(r1.ok, true);
    const r2 = ingestTransaction(db, "u_tx", {
      accountId: a.id, sourceProviderId: "plaid-tx-1",
      direction: "debit", amountCents: 4250,
      occurredAt: Math.floor(Date.now() / 1000),
    });
    assert.equal(r2.deduped, true);
  });

  it("rejects invalid direction + negative amount", () => {
    const a = linkAccount(db, "u_tx_bad", { nickname: "X", kind: "bank_checking" });
    const r1 = ingestTransaction(db, "u_tx_bad", {
      accountId: a.id, direction: "weird", amountCents: 100, occurredAt: 1,
    });
    assert.equal(r1.reason, "invalid_direction");
    const r2 = ingestTransaction(db, "u_tx_bad", {
      accountId: a.id, direction: "debit", amountCents: -100, occurredAt: 1,
    });
    assert.equal(r2.reason, "amount_must_be_non_negative");
  });

  it("listTransactions filterable by category + time window", () => {
    const a = linkAccount(db, "u_tx_filt", { nickname: "X", kind: "bank_checking" });
    const baseT = 2_000_000_000;
    ingestTransaction(db, "u_tx_filt", { accountId: a.id, sourceProviderId: "p1", direction: "debit", amountCents: 100, category: "food", occurredAt: baseT });
    ingestTransaction(db, "u_tx_filt", { accountId: a.id, sourceProviderId: "p2", direction: "debit", amountCents: 200, category: "transport", occurredAt: baseT + 100 });
    ingestTransaction(db, "u_tx_filt", { accountId: a.id, sourceProviderId: "p3", direction: "credit", amountCents: 5000, category: "income.salary", occurredAt: baseT + 200 });
    const food = listTransactions(db, "u_tx_filt", { category: "food" });
    assert.equal(food.length, 1);
    const recent = listTransactions(db, "u_tx_filt", { sinceTs: baseT + 50 });
    assert.equal(recent.length, 2);
  });

  it("categorizeTransaction updates category", () => {
    const a = linkAccount(db, "u_recat", { nickname: "X", kind: "bank_checking" });
    const r = ingestTransaction(db, "u_recat", { accountId: a.id, direction: "debit", amountCents: 999, occurredAt: 1, category: "shopping" });
    const c = categorizeTransaction(db, "u_recat", r.id, { category: "food.restaurants" });
    assert.equal(c.ok, true);
    const tx = listTransactions(db, "u_recat")[0];
    assert.equal(tx.category, "food.restaurants");
  });
});

// ─── Recurring ─────────────────────────────────────────────

describe("recurring subscriptions", () => {
  it("register + list + cancel round-trip", () => {
    const r = registerRecurring(db, "u_rec", {
      counterparty: "Netflix", typicalAmountCents: 1599,
      cadence: "monthly", category: "subscriptions",
    });
    assert.equal(r.ok, true);
    const list = listRecurring(db, "u_rec");
    assert.equal(list.length, 1);
    assert.equal(list[0].counterparty, "Netflix");
    cancelRecurring(db, "u_rec", r.id);
    const after = listRecurring(db, "u_rec");
    assert.equal(after.length, 0);
    const all = listRecurring(db, "u_rec", { activeOnly: false });
    assert.equal(all.length, 1);
  });
});

// ─── Categories ───────────────────────────────────────────

describe("categories", () => {
  it("system defaults seeded with all required types", () => {
    const cats = listCategories(db, "u_cat_test", { includeSystem: true });
    assert.ok(cats.find((c) => c.key === "food"));
    assert.ok(cats.find((c) => c.key === "income.salary"));
    assert.ok(cats.find((c) => c.key === "tax"));
    assert.ok(cats.find((c) => c.key === "concord_coin"));
  });

  it("custom category upsert works + supports budget cap", () => {
    upsertCategory(db, "u_cat_up", { key: "hobbies", label: "Hobbies", icon: "🎨", budgetMonthlyCents: 20000 });
    const cats = listCategories(db, "u_cat_up", { includeSystem: false });
    assert.equal(cats.find((c) => c.key === "hobbies")?.budget_monthly_cents, 20000);
  });
});

// ─── Rails config ─────────────────────────────────────────

describe("rails config (multi-rail routing)", () => {
  it("getRailsConfig lazy-creates default + updateRailsConfig accepts fields", () => {
    const c1 = getRailsConfig(db, "u_rails");
    assert.equal(c1.prefer_speed_over_cost, 1);
    assert.equal(c1.allow_concord_coin_first, 1);
    updateRailsConfig(db, "u_rails", { preferSpeedOverCost: false, maxFednowFeeCents: 50 });
    const c2 = getRailsConfig(db, "u_rails");
    assert.equal(c2.prefer_speed_over_cost, 0);
    assert.equal(c2.max_fednow_fee_cents, 50);
  });
});

// ─── Spending summary ────────────────────────────────────

describe("spending summary", () => {
  it("aggregates posted debits by category + computes net vs income", () => {
    const a = linkAccount(db, "u_sum", { nickname: "X", kind: "bank_checking" });
    const now = Math.floor(Date.now() / 1000);
    ingestTransaction(db, "u_sum", { accountId: a.id, sourceProviderId: "s1", direction: "debit", amountCents: 5000, category: "food", occurredAt: now });
    ingestTransaction(db, "u_sum", { accountId: a.id, sourceProviderId: "s2", direction: "debit", amountCents: 3000, category: "transport", occurredAt: now });
    ingestTransaction(db, "u_sum", { accountId: a.id, sourceProviderId: "s3", direction: "credit", amountCents: 50000, category: "income.salary", occurredAt: now });
    const s = spendingSummary(db, "u_sum", { sinceDays: 30 });
    assert.equal(s.totalSpendCents, 8000);
    assert.equal(s.totalIncomeCents, 50000);
    assert.equal(s.netCents, 42000);
    assert.ok(s.byCategory.find((c) => c.category === "food")?.total_cents === 5000);
  });
});

// ─── Macros end-to-end ───────────────────────────────────

describe("macros", () => {
  it("link → ingest → unified balance → summary flow via macros", async () => {
    const a = await MACROS.get("account_link")(ctx("u_mac"), { nickname: "TestBank", kind: "bank_checking", provider: "plaid", credentialsRef: "tok-x" });
    assert.equal(a.ok, true);
    await MACROS.get("balance_set")(ctx("u_mac"), { accountId: a.id, balanceCents: 100_000 });
    await MACROS.get("tx_ingest")(ctx("u_mac"), { accountId: a.id, direction: "debit", amountCents: 2500, category: "food", occurredAt: Math.floor(Date.now() / 1000) });
    const u = await MACROS.get("balance_unified")(ctx("u_mac"), { refreshConcord: false });
    assert.ok(u.accounts.find((x) => x.id === a.id));
    const s = await MACROS.get("spending_summary")(ctx("u_mac"));
    assert.equal(s.totalSpendCents, 2500);
  });

  it("rails_get returns defaults on first call", async () => {
    const r = await MACROS.get("rails_get")(ctx("u_rails_mac"));
    assert.equal(r.ok, true);
    assert.equal(r.config.prefer_speed_over_cost, 1);
  });
});
