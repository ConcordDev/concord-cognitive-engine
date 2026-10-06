// Tier-2 contract tests for wallet lens parity macros
// (money requests / invoices, recurring transfers, social feed, split-the-bill,
// linked funding sources, QR pay, spending insights).
// Pins per-user scoping, validation, and core math invariants.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerWalletActions from "../domains/wallet.js";
import { executePurchase } from "../economy/transfer.js";
import { getBalance } from "../economy/balances.js";
import { runHeartbeatModuleNow } from "../emergent/heartbeat-registry.js";

function ledgerDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT,
      amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete', metadata_json TEXT DEFAULT '{}',
      request_id TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), ref_id TEXT);
  `);
  return db;
}
const r2 = (n) => Math.round(n * 100) / 100;

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`wallet.${name}`);
  if (!fn) throw new Error(`wallet.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerWalletActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ── Money requests / invoices ────────────────────────────────────────────────

describe("wallet — money requests", () => {
  it("requestCreate makes a pending request with a pay link", () => {
    const r = call("requestCreate", ctxA, { payerId: "user_b", amount: 50, note: "lunch" });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "pending");
    assert.equal(r.result.request.amount, 50);
    assert.equal(r.result.request.kind, "request");
    assert.match(r.result.request.payLink, /\?pay=req_/);
  });

  it("requestCreate rejects missing payer / non-positive amount", () => {
    assert.equal(call("requestCreate", ctxA, { amount: 10 }).ok, false);
    assert.equal(call("requestCreate", ctxA, { payerId: "user_b", amount: 0 }).ok, false);
  });

  it("invoice with line items is classified as invoice", () => {
    const r = call("requestCreate", ctxA, {
      payerId: "user_b",
      amount: 75,
      lineItems: [{ description: "design", amount: 50 }, { description: "hosting", amount: 25 }],
    });
    assert.equal(r.result.request.kind, "invoice");
    assert.equal(r.result.request.lineItems.length, 2);
  });

  it("requestList surfaces incoming requests to the payer with outstanding total", () => {
    call("requestCreate", ctxA, { payerId: "user_b", amount: 40 });
    const incoming = call("requestList", ctxB, { direction: "incoming" });
    assert.equal(incoming.result.requests.length, 1);
    assert.equal(incoming.result.outstandingTotal, 40);
  });

  it("INVARIANT: paying a request requires a real ledger transfer", () => {
    const created = call("requestCreate", ctxA, { payerId: "user_b", amount: 20 });
    const id = created.result.request.id;
    const byRequester = call("requestUpdate", ctxA, { id, status: "paid" });
    assert.equal(byRequester.ok, false);
    assert.match(byRequester.error, /only payer/);

    const noLedger = call("requestUpdate", ctxB, { id, status: "paid" });
    assert.equal(noLedger.ok, false);
    assert.equal(noLedger.error, "ledger_unavailable");
    assert.equal(call("requestList", ctxB, { direction: "incoming" }).result.requests[0].status, "pending");

    const empty = ledgerDb();
    const broke = call("requestUpdate", { ...ctxB, db: empty }, { id, status: "paid" });
    assert.equal(broke.ok, false);
    assert.equal(broke.error, "insufficient_balance");
    assert.equal(call("requestList", ctxB, { direction: "incoming" }).result.requests[0].status, "pending");

    const db = ledgerDb();
    executePurchase(db, { userId: "user_b", amount: 100 });
    const before = getBalance(db, "user_b").balance;
    const paid = call("requestUpdate", { ...ctxB, db }, { id, status: "paid" });
    assert.equal(paid.ok, true);
    assert.equal(paid.result.request.status, "paid");
    assert.ok(paid.result.request.paidAt);
    assert.ok(paid.result.transfer.batchId);
    assert.equal(r2(before - getBalance(db, "user_b").balance), 20);
    assert.ok(getBalance(db, "user_a").balance > 0);
    const again = call("requestUpdate", { ...ctxB, db }, { id, status: "paid" });
    assert.equal(again.ok, true);
    assert.equal(r2(getBalance(db, "user_b").balance), r2(before - 20));
  });
});

// ── Recurring / scheduled transfers ──────────────────────────────────────────

describe("wallet — scheduled transfers", () => {
  it("scheduleCreate computes a future nextRunAt", () => {
    const r = call("scheduleCreate", ctxA, { recipientId: "user_b", amount: 100, frequency: "weekly" });
    assert.equal(r.ok, true);
    assert.equal(r.result.schedule.status, "active");
    assert.ok(new Date(r.result.schedule.nextRunAt).getTime() > Date.now());
  });

  it("scheduleCreate rejects bad frequency", () => {
    const r = call("scheduleCreate", ctxA, { recipientId: "user_b", amount: 10, frequency: "hourly" });
    assert.equal(r.ok, false);
  });

  it("scheduleList reports monthly committed amount", () => {
    call("scheduleCreate", ctxA, { recipientId: "user_b", amount: 50, frequency: "monthly" });
    const l = call("scheduleList", ctxA);
    assert.equal(l.result.count, 1);
    assert.equal(l.result.monthlyCommitted, 50);
  });

  it("scheduleUpdate pauses and scheduleDelete removes", () => {
    const c = call("scheduleCreate", ctxA, { recipientId: "user_b", amount: 25, frequency: "daily" });
    const id = c.result.schedule.id;
    assert.equal(call("scheduleUpdate", ctxA, { id, status: "paused" }).result.schedule.status, "paused");
    assert.equal(call("scheduleDelete", ctxA, { id }).ok, true);
    assert.equal(call("scheduleList", ctxA).result.count, 0);
  });

  it("INVARIANT: schedules are per-user (no leak)", () => {
    call("scheduleCreate", ctxA, { recipientId: "user_b", amount: 30, frequency: "weekly" });
    assert.equal(call("scheduleList", ctxB).result.count, 0);
  });

  it("INVARIANT: send-now and the due sweep move CC, and a refusal leaves the schedule unsent", async () => {
    const created = call("scheduleCreate", ctxA, { recipientId: "user_b", amount: 10, frequency: "monthly" });
    const id = created.result.schedule.id;
    const refused = call("scheduleSendNow", ctxA, { id });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "ledger_unavailable");
    assert.equal(call("scheduleList", ctxA).result.schedules.find((s) => s.id === id).runsCompleted, 0);

    const db = ledgerDb();
    executePurchase(db, { userId: "user_a", amount: 100 });
    const before = getBalance(db, "user_a").balance;
    const sent = call("scheduleSendNow", { ...ctxA, db }, { id });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.schedule.runsCompleted, 1);
    assert.ok(sent.result.transfer.batchId);
    assert.equal(r2(before - getBalance(db, "user_a").balance), 10);
    assert.ok(getBalance(db, "user_b").balance > 0);

    const start = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const due = call("scheduleCreate", ctxA, { recipientId: "user_b", amount: 10, frequency: "monthly", startDate: start });
    assert.ok(new Date(due.result.schedule.nextRunAt).getTime() <= Date.now());
    const sweep = await runHeartbeatModuleNow("wallet-schedule-sweep", { state: globalThis._concordSTATE, db });
    assert.equal(sweep.ok, true);
    const after = call("scheduleList", ctxA).result.schedules.find((s) => s.id === due.result.schedule.id);
    assert.equal(after.runsCompleted, 1);
    assert.ok(after.lastTransfer.batchId);
    assert.equal(r2(before - getBalance(db, "user_a").balance), 20);
  });
});

// ── Social transaction feed ──────────────────────────────────────────────────

describe("wallet — social feed", () => {
  it("feedPost requires counterparty and note", () => {
    assert.equal(call("feedPost", ctxA, { note: "hi" }).ok, false);
    assert.equal(call("feedPost", ctxA, { counterparty: "user_b" }).ok, false);
    const ok = call("feedPost", ctxA, { counterparty: "user_b", note: "dinner", emoji: "🍕" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.entry.emoji, "🍕");
  });

  it("feedList hides private entries from others but shows to owner", () => {
    call("feedPost", ctxA, { counterparty: "user_b", note: "secret", visibility: "private" });
    const otherView = call("feedList", ctxB, { scope: "all" });
    assert.equal(otherView.result.entries.length, 0);
    const ownerView = call("feedList", ctxA, { scope: "mine" });
    assert.equal(ownerView.result.entries.length, 1);
  });

  it("feedLike toggles a like and accepts comments", () => {
    const p = call("feedPost", ctxA, { counterparty: "user_b", note: "trip" });
    const id = p.result.entry.id;
    const like = call("feedLike", ctxB, { id, comment: "nice!" });
    assert.equal(like.result.liked, true);
    assert.equal(like.result.entry.likes.length, 1);
    assert.equal(like.result.entry.comments.length, 1);
    const unlike = call("feedLike", ctxB, { id });
    assert.equal(unlike.result.liked, false);
  });
});

// ── Split-the-bill ───────────────────────────────────────────────────────────

describe("wallet — split the bill", () => {
  it("splitCreate splits evenly with the creator included", () => {
    const r = call("splitCreate", ctxA, { total: 90, participants: ["user_b", "user_c"], title: "Dinner" });
    assert.equal(r.ok, true);
    assert.equal(r.result.split.shares.length, 3);
    const sum = r.result.split.shares.reduce((s, x) => s + x.amount, 0);
    assert.equal(Math.round(sum * 100) / 100, 90);
  });

  it("INVARIANT: shares sum to the total even with rounding remainder", () => {
    const r = call("splitCreate", ctxA, { total: 100, participants: ["user_b", "user_c"] });
    const sum = r.result.split.shares.reduce((s, x) => s + x.amount, 0);
    assert.equal(Math.round(sum * 100) / 100, 100);
  });

  it("splitCreate rejects custom shares that do not sum to total", () => {
    const r = call("splitCreate", ctxA, {
      total: 100,
      participants: ["user_b"],
      shares: { user_a: 40, user_b: 40 },
    });
    assert.equal(r.ok, false);
  });

  it("INVARIANT: a split share is paid only after that member's Concord Coin moves", () => {
    const c = call("splitCreate", ctxA, { total: 60, participants: ["user_b"] });
    const id = c.result.split.id;
    const creatorShare = c.result.split.shares.find((s) => s.userId === "user_a");
    assert.equal(creatorShare.settlement, "covered");
    assert.equal(creatorShare.paid, true);

    const noLedger = call("splitSettle", ctxB, { id });
    assert.equal(noLedger.ok, false);
    assert.equal(noLedger.error, "ledger_unavailable");
    const unpaid = call("splitList", ctxA).result.splits.find((s) => s.id === id);
    assert.equal(unpaid.shares.find((s) => s.userId === "user_b").paid, false);
    assert.equal(unpaid.status, "open");

    const db = ledgerDb();
    const byCreator = call("splitSettle", { ...ctxA, db }, { id, memberId: "user_b" });
    assert.equal(byCreator.ok, false);
    assert.match(byCreator.error, /only that member/);

    executePurchase(db, { userId: "user_b", amount: 100 });
    const before = getBalance(db, "user_b").balance;
    const s = call("splitSettle", { ...ctxB, db }, { id });
    assert.equal(s.ok, true);
    assert.equal(s.result.split.status, "settled");
    assert.equal(s.result.outstandingOwed, 0);
    assert.equal(s.result.split.shares.find((sh) => sh.userId === "user_b").settlement, "ledger");
    assert.ok(s.result.transfer.batchId);
    assert.equal(r2(before - getBalance(db, "user_b").balance), 30);
  });

  it("splitList shows splits where the user is a participant", () => {
    call("splitCreate", ctxA, { total: 50, participants: ["user_b"] });
    assert.equal(call("splitList", ctxB).result.count, 1);
  });
});

// ── Linked funding sources ───────────────────────────────────────────────────

describe("wallet — funding sources", () => {
  it("cardAdd stores only last4 and rejects bad input", () => {
    assert.equal(call("cardAdd", ctxA, { type: "card", label: "Visa" }).ok, false);
    const r = call("cardAdd", ctxA, { type: "card", label: "Visa", last4: "4242", brand: "Visa" });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.last4, "4242");
    assert.equal(r.result.card.isDefault, true);
  });

  it("cardSetDefault moves the default flag", () => {
    const a = call("cardAdd", ctxA, { type: "card", label: "A", last4: "1111" });
    const b = call("cardAdd", ctxA, { type: "bank", label: "B", last4: "2222" });
    assert.equal(a.result.card.isDefault, true);
    assert.equal(b.result.card.isDefault, false);
    call("cardSetDefault", ctxA, { id: b.result.card.id });
    const list = call("cardList", ctxA).result.cards;
    assert.equal(list.find(c => c.id === b.result.card.id).isDefault, true);
    assert.equal(list.find(c => c.id === a.result.card.id).isDefault, false);
  });

  it("cardRemove reassigns default to remaining card", () => {
    const a = call("cardAdd", ctxA, { type: "card", label: "A", last4: "1111" });
    call("cardAdd", ctxA, { type: "bank", label: "B", last4: "2222" });
    call("cardRemove", ctxA, { id: a.result.card.id });
    const list = call("cardList", ctxA).result.cards;
    assert.equal(list.length, 1);
    assert.equal(list[0].isDefault, true);
  });

  it("paypal type allows no last4", () => {
    const r = call("cardAdd", ctxA, { type: "paypal", label: "PayPal" });
    assert.equal(r.ok, true);
  });
});

// ── QR pay / receive ─────────────────────────────────────────────────────────

describe("wallet — QR pay", () => {
  it("qrGenerate then qrResolve round-trips recipient + amount", () => {
    const gen = call("qrGenerate", ctxA, { amount: 25, note: "coffee" });
    assert.equal(gen.ok, true);
    const res = call("qrResolve", ctxB, { token: gen.result.token });
    assert.equal(res.ok, true);
    assert.equal(res.result.recipientId, "user_a");
    assert.equal(res.result.amount, 25);
    assert.equal(res.result.amountLocked, true);
  });

  it("qrResolve rejects a malformed token", () => {
    assert.equal(call("qrResolve", ctxA, { token: "not-base64-json" }).ok, false);
  });

  it("qrGenerate without amount yields an open-amount code", () => {
    const gen = call("qrGenerate", ctxA, {});
    const res = call("qrResolve", ctxB, { token: gen.result.token });
    assert.equal(res.result.amount, null);
    assert.equal(res.result.amountLocked, false);
  });
});

// ── Spending insights ────────────────────────────────────────────────────────

describe("wallet — spending insights", () => {
  it("returns hasData false on empty input", () => {
    const r = call("spendingInsights", ctxA, { transactions: [] });
    assert.equal(r.result.hasData, false);
  });

  it("aggregates spend by category and month from real transactions", () => {
    const r = call("spendingInsights", ctxA, {
      transactions: [
        { amount: -20, description: "Starbucks coffee", created_at: "2026-01-05" },
        { amount: -50, description: "Walmart grocery", created_at: "2026-01-10" },
        { amount: -30, description: "Netflix", created_at: "2026-02-01" },
        { amount: 100, description: "earning", created_at: "2026-02-02" },
      ],
    });
    assert.equal(r.result.hasData, true);
    assert.equal(r.result.totalSpent, 100);
    assert.equal(r.result.totalReceived, 100);
    assert.equal(r.result.net, 0);
    assert.equal(r.result.monthSeries.length, 2);
    assert.ok(r.result.byCategory.length >= 2);
    assert.ok(r.result.topCategory);
  });
});
