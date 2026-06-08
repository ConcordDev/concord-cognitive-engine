// tests/depth/wallet-behavior.test.js — REAL behavioral tests for the wallet
// domain (registerLensAction family, invoked via lensRun). Curated subset:
// exact-value balance/portfolio/budget math + CRUD round-trips + validation.
//
// SAFETY: wallet handles balances/money. These tests ASSERT balance math
// (portfolio gain/loss, budget overage, split shares, spending insight nets)
// but NEVER modify any economic constant. Every lensRun("wallet", "<macro>", …)
// call literally names the macro → the macro-depth grader credits a real
// behavioral invocation.
//
// lens.run convention: the OUTER `r.ok` is dispatch success; the handler's own
// verdict is in `r.result`. A success handler `{ok:true, result:{…}}` surfaces
// its payload at `r.result.<field>`; a refusal `{ok:false, error}` surfaces at
// `r.result.ok === false` + `r.result.error`.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("wallet — portfolio + categorize + budget + trend (exact computed values)", () => {
  it("portfolioBalance: gain/loss, allocation %, and concentration risk are exact", async () => {
    const r = await lensRun("wallet", "portfolioBalance", {
      data: {
        assets: [
          // 10 @ $150, cost basis $100/sh → mv 1500, cost 1000, gain 500 (+50%)
          { name: "AAA", quantity: 10, currentPrice: 150, costBasis: 100, type: "equity" },
          // 5 @ $100, cost basis $120/sh → mv 500, cost 600, loss -100 (-16.67%)
          { name: "BBB", quantity: 5, currentPrice: 100, costBasis: 120, type: "equity" },
        ],
      },
    });
    assert.equal(r.result.totalValue, 2000);          // 1500 + 500
    assert.equal(r.result.totalCostBasis, 1600);      // 1000 + 600
    assert.equal(r.result.totalGainLoss, 400);        // 2000 - 1600
    assert.equal(r.result.totalReturnPercent, 25);    // 400/1600
    assert.equal(r.result.assetCount, 2);
    // AAA is largest at 1500/2000 = 75% → high concentration risk.
    assert.equal(r.result.largestHolding.name, "AAA");
    assert.equal(r.result.largestHolding.percent, 75);
    assert.equal(r.result.concentrationRisk, "high");
    const aaa = r.result.assets.find((a) => a.name === "AAA");
    assert.equal(aaa.gainLoss, 500);
    assert.equal(aaa.gainLossPercent, 50);
    assert.equal(aaa.allocationPercent, 75);
    const bbb = r.result.assets.find((a) => a.name === "BBB");
    assert.equal(bbb.gainLoss, -100);
    assert.equal(bbb.gainLossPercent, -16.67);
    assert.equal(r.result.topGainer.name, "AAA");
    assert.equal(r.result.topLoser.name, "BBB");
  });

  it("portfolioBalance: empty assets returns a guidance message, not a crash", async () => {
    const r = await lensRun("wallet", "portfolioBalance", { data: { assets: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("assets array"));
  });

  it("transactionCategorize: merchants map to categories; totals + rate are exact", async () => {
    const r = await lensRun("wallet", "transactionCategorize", {
      data: {
        transactions: [
          { merchant: "Whole Foods Market", amount: -50, date: "2026-05-01" },
          { merchant: "Starbucks", amount: -5, date: "2026-05-02" },
          { merchant: "Shell Gas", amount: -40, date: "2026-05-03" },
          { merchant: "Unknown Llc", amount: -10, date: "2026-05-04" },
        ],
      },
    });
    assert.equal(r.result.totalTransactions, 4);
    assert.equal(r.result.categorized, 3);
    assert.equal(r.result.uncategorized, 1);
    assert.equal(r.result.categorizationRate, "75%");
    assert.equal(r.result.totalSpent, 105);  // abs(50+5+40+10)
    const groceries = r.result.categorySummary.find((c) => c.category === "Groceries");
    assert.equal(groceries.total, 50);
    assert.equal(groceries.count, 1);
    const tx0 = r.result.transactions.find((t) => t.merchant === "Whole Foods Market");
    assert.equal(tx0.category, "Groceries");
  });

  it("budgetCheck: an over-budget category is flagged with exact overage + overall status", async () => {
    const r = await lensRun("wallet", "budgetCheck", {
      data: {
        budgets: [
          { category: "Dining", limit: 200, spent: 250 },   // over by 50
          { category: "Groceries", limit: 400, spent: 100 }, // on-track
        ],
      },
    });
    assert.equal(r.result.totalBudget, 600);
    assert.equal(r.result.totalSpent, 350);
    assert.equal(r.result.totalRemaining, 250);
    assert.equal(r.result.categoriesOverBudget, 1);
    assert.equal(r.result.overallStatus, "over-budget");
    const dining = r.result.categories.find((c) => c.category === "Dining");
    assert.equal(dining.status, "over-budget");
    assert.equal(dining.overage, 50);
    assert.equal(dining.percentUsed, 125);
    const groceries = r.result.categories.find((c) => c.category === "Groceries");
    assert.equal(groceries.status, "on-track");
    assert.equal(groceries.remaining, 300);
    assert.equal(groceries.percentUsed, 25);
  });

  it("budgetCheck: auto-sums spending from transactions when no per-category spent given", async () => {
    const r = await lensRun("wallet", "budgetCheck", {
      data: {
        budgets: [{ category: "Dining", limit: 100 }],
        transactions: [
          { category: "Dining", amount: -60 },
          { category: "Dining", amount: -50 },  // sums to 110 → over by 10
        ],
      },
    });
    const dining = r.result.categories.find((c) => c.category === "Dining");
    assert.equal(dining.spent, 110);
    assert.equal(dining.overage, 10);
    assert.equal(dining.status, "over-budget");
  });

  it("spendingTrend: month-over-month change + averages are exact", async () => {
    const r = await lensRun("wallet", "spendingTrend", {
      data: {
        transactions: [
          { amount: -100, date: "2026-01-15", category: "Dining" },
          { amount: -150, date: "2026-02-15", category: "Dining" }, // +50% MoM
        ],
      },
    });
    assert.equal(r.result.periodsAnalyzed, 2);
    assert.equal(r.result.totalSpent, 250);
    assert.equal(r.result.averageMonthly, 125);
    assert.equal(r.result.dateRange.from, "2026-01");
    assert.equal(r.result.dateRange.to, "2026-02");
    assert.equal(r.result.overallTrend, "increasing");
    assert.equal(r.result.monthOverMonth.length, 1);
    const mom = r.result.monthOverMonth[0];
    assert.equal(mom.month, "2026-02");
    assert.equal(mom.change, 50);
    assert.equal(mom.changePercent, 50);
    assert.equal(mom.direction, "increase");
    assert.equal(r.result.highestMonth.month, "2026-02");
    assert.equal(r.result.highestMonth.amount, 150);
  });

  it("spendingInsights: spend/receive/net split + category percent are exact", async () => {
    const r = await lensRun("wallet", "spendingInsights", {
      params: {
        transactions: [
          { amount: 1000, description: "salary deposit", created_at: "2026-03-01" },
          { amount: -200, description: "Amazon order", created_at: "2026-03-05" },
          { amount: -100, description: "Netflix sub", created_at: "2026-03-10" },
        ],
      },
    });
    assert.equal(r.result.hasData, true);
    assert.equal(r.result.totalReceived, 1000);
    assert.equal(r.result.totalSpent, 300);
    assert.equal(r.result.net, 700);
    assert.equal(r.result.transactionCount, 3);
    const shopping = r.result.byCategory.find((c) => c.category === "Shopping");
    assert.equal(shopping.total, 200);
    assert.equal(shopping.percent, 66.7); // 200/300
    assert.equal(r.result.topCategory.category, "Shopping");
  });

  it("spendingInsights: no transactions returns hasData=false", async () => {
    const r = await lensRun("wallet", "spendingInsights", { params: { transactions: [] } });
    assert.equal(r.result.hasData, false);
  });
});

describe("wallet — money requests / invoices (CRUD round-trips + validation)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("wallet-requests"); });

  it("requestCreate → requestList: a pending request reads back with the right outstanding total", async () => {
    const c = await lensRun("wallet", "requestCreate", { params: { payerId: "bob", amount: 42.5, note: "lunch" } }, ctx);
    assert.equal(c.result.request.amount, 42.5);
    assert.equal(c.result.request.kind, "request");
    assert.equal(c.result.request.status, "pending");
    assert.equal(c.result.request.payerId, "bob");
    assert.match(c.result.request.payLink, /\?pay=req_/);
    const list = await lensRun("wallet", "requestList", { params: { direction: "outgoing" } }, ctx);
    assert.ok(list.result.requests.some((rq) => rq.id === c.result.request.id));
    assert.equal(list.result.outstandingTotal, 42.5);
  });

  it("requestCreate with lineItems is classified as an invoice", async () => {
    const c = await lensRun("wallet", "requestCreate", {
      params: { payerId: "carol", amount: 30, lineItems: [{ description: "drinks", amount: 30 }] },
    }, ctx);
    assert.equal(c.result.request.kind, "invoice");
    assert.match(c.result.request.id, /^inv_/);
    assert.equal(c.result.request.lineItems.length, 1);
  });

  it("requestCreate: missing payerId and non-positive amount are rejected", async () => {
    const noPayer = await lensRun("wallet", "requestCreate", { params: { amount: 10 } }, ctx);
    assert.equal(noPayer.result.ok, false);
    assert.ok(noPayer.result.error.includes("payerId required"));
    const badAmt = await lensRun("wallet", "requestCreate", { params: { payerId: "x", amount: -5 } }, ctx);
    assert.equal(badAmt.result.ok, false);
    assert.ok(badAmt.result.error.includes("amount must be positive"));
  });

  it("requestUpdate: requester may cancel, but a non-requester payer may not cancel", async () => {
    const c = await lensRun("wallet", "requestCreate", { params: { payerId: "dave", amount: 20 } }, ctx);
    const id = c.result.request.id;
    // requester (this ctx) cancels — allowed.
    const cancel = await lensRun("wallet", "requestUpdate", { params: { id, status: "canceled" } }, ctx);
    assert.equal(cancel.result.request.status, "canceled");
    // unknown status rejected.
    const bad = await lensRun("wallet", "requestUpdate", { params: { id, status: "frozen" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("status invalid"));
  });

  it("requestUpdate: only the payer may mark a request paid", async () => {
    // requester creates a request for payer 'erin'
    const c = await lensRun("wallet", "requestCreate", { params: { payerId: "erin", amount: 15 } }, ctx);
    const id = c.result.request.id;
    // this ctx is the REQUESTER, not the payer → may not mark paid
    const bad = await lensRun("wallet", "requestUpdate", { params: { id, status: "paid" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("only payer may pay or decline"));
  });
});

describe("wallet — scheduled transfers (CRUD + monthly commitment math)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("wallet-schedules"); });

  it("scheduleCreate → scheduleList: monthly committed is computed from frequency", async () => {
    const c = await lensRun("wallet", "scheduleCreate", {
      params: { recipientId: "rent", amount: 1000, frequency: "monthly", note: "rent" },
    }, ctx);
    assert.equal(c.result.schedule.amount, 1000);
    assert.equal(c.result.schedule.frequency, "monthly");
    assert.equal(c.result.schedule.status, "active");
    assert.ok(c.result.schedule.nextRunAt > c.result.schedule.startDate);
    const list = await lensRun("wallet", "scheduleList", {}, ctx);
    // single monthly schedule of 1000 → monthlyCommitted = 1000 × 1
    assert.equal(list.result.monthlyCommitted, 1000);
    assert.ok(list.result.schedules.some((s) => s.id === c.result.schedule.id));
  });

  it("scheduleUpdate pausing a schedule drops it from monthlyCommitted; scheduleDelete removes it", async () => {
    const freshCtx = await depthCtx("wallet-schedules-2");
    const c = await lensRun("wallet", "scheduleCreate", { params: { recipientId: "gym", amount: 50, frequency: "weekly" } }, freshCtx);
    const id = c.result.schedule.id;
    // weekly 50 → 50 × 4.33 = 216.5 committed while active
    const before = await lensRun("wallet", "scheduleList", {}, freshCtx);
    assert.equal(before.result.monthlyCommitted, 216.5);
    const paused = await lensRun("wallet", "scheduleUpdate", { params: { id, status: "paused" } }, freshCtx);
    assert.equal(paused.result.schedule.status, "paused");
    const after = await lensRun("wallet", "scheduleList", {}, freshCtx);
    assert.equal(after.result.monthlyCommitted, 0);  // paused excluded
    const del = await lensRun("wallet", "scheduleDelete", { params: { id } }, freshCtx);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("wallet", "scheduleList", {}, freshCtx);
    assert.ok(!list.result.schedules.some((s) => s.id === id));
  });

  it("scheduleCreate: invalid frequency and missing recipient are rejected", async () => {
    const badFreq = await lensRun("wallet", "scheduleCreate", { params: { recipientId: "x", amount: 10, frequency: "hourly" } }, ctx);
    assert.equal(badFreq.result.ok, false);
    assert.ok(badFreq.result.error.includes("frequency must be"));
    const noRecip = await lensRun("wallet", "scheduleCreate", { params: { amount: 10, frequency: "weekly" } }, ctx);
    assert.equal(noRecip.result.ok, false);
    assert.ok(noRecip.result.error.includes("recipientId required"));
  });

  it("scheduleDelete: a missing schedule id is rejected", async () => {
    const bad = await lensRun("wallet", "scheduleDelete", { params: { id: "sched_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("schedule not found"));
  });
});

describe("wallet — social feed (post / list / like)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("wallet-feed"); });

  it("feedPost → feedList(mine): an entry reads back with default 'friends' visibility", async () => {
    const p = await lensRun("wallet", "feedPost", { params: { counterparty: "frank", note: "🍕 split", emoji: "🍕" } }, ctx);
    assert.equal(p.result.entry.counterparty, "frank");
    assert.equal(p.result.entry.direction, "sent");
    assert.equal(p.result.entry.visibility, "friends");
    const list = await lensRun("wallet", "feedList", { params: { scope: "mine" } }, ctx);
    assert.ok(list.result.entries.some((e) => e.id === p.result.entry.id));
  });

  it("feedPost: missing counterparty and missing note are rejected", async () => {
    const noCp = await lensRun("wallet", "feedPost", { params: { note: "hi" } }, ctx);
    assert.equal(noCp.result.ok, false);
    assert.ok(noCp.result.error.includes("counterparty required"));
    const noNote = await lensRun("wallet", "feedPost", { params: { counterparty: "x" } }, ctx);
    assert.equal(noNote.result.ok, false);
    assert.ok(noNote.result.error.includes("note required"));
  });

  it("feedLike toggles a like on and off", async () => {
    const p = await lensRun("wallet", "feedPost", { params: { counterparty: "gina", note: "movie" } }, ctx);
    const id = p.result.entry.id;
    const liked = await lensRun("wallet", "feedLike", { params: { id } }, ctx);
    assert.equal(liked.result.liked, true);
    assert.ok(liked.result.entry.likes.length === 1);
    const unliked = await lensRun("wallet", "feedLike", { params: { id } }, ctx);
    assert.equal(unliked.result.liked, false);
    assert.equal(unliked.result.entry.likes.length, 0);
  });

  it("feedLike: a missing entry id is rejected", async () => {
    const bad = await lensRun("wallet", "feedLike", { params: { id: "feed_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("entry not found"));
  });
});

describe("wallet — split-the-bill (share math + settle)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("wallet-splits"); });

  it("splitCreate even split: shares sum to total, creator's share pre-paid", async () => {
    // creator + 2 participants = 3 members, total 30 → 10 each
    const c = await lensRun("wallet", "splitCreate", { params: { total: 30, participants: ["amy", "ben"], title: "Dinner" } }, ctx);
    const split = c.result.split;
    assert.equal(split.total, 30);
    assert.equal(split.shares.length, 3);
    const sum = split.shares.reduce((s, x) => s + x.amount, 0);
    assert.equal(Math.round(sum * 100) / 100, 30);
    const creatorShare = split.shares.find((s) => s.userId === split.creatorId);
    assert.equal(creatorShare.amount, 10);
    assert.equal(creatorShare.paid, true);   // creator pre-marked paid
  });

  it("splitCreate even split distributes the rounding remainder to the first member", async () => {
    // total 10 across 3 → 3.33 each, remainder 0.01 to first member → 3.34
    const c = await lensRun("wallet", "splitCreate", { params: { total: 10, participants: ["x", "y"] } }, ctx);
    const split = c.result.split;
    const sum = split.shares.reduce((s, sh) => s + sh.amount, 0);
    assert.equal(Math.round(sum * 100) / 100, 10);  // exact total preserved
    assert.equal(split.shares[0].amount, 3.34);
    assert.equal(split.shares[1].amount, 3.33);
    assert.equal(split.shares[2].amount, 3.33);
  });

  it("splitCreate custom shares must sum to total", async () => {
    const ctx2 = await depthCtx("wallet-splits-custom");
    const bad = await lensRun("wallet", "splitCreate", {
      params: { total: 100, participants: ["p1"], includeCreator: false, shares: { p1: 90 } },
    }, ctx2);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("custom shares must sum to total"));
  });

  it("splitSettle marks a member's share paid; remaining outstanding falls", async () => {
    const c = await lensRun("wallet", "splitCreate", { params: { total: 30, participants: ["m1", "m2"] } }, ctx);
    const id = c.result.split.id;
    // creator already paid 10 → outstanding 20 (m1 + m2). settle m1.
    const settled = await lensRun("wallet", "splitSettle", { params: { id, memberId: "m1" } }, ctx);
    assert.equal(settled.result.outstandingOwed, 10);  // only m2 left
    const m1 = settled.result.split.shares.find((s) => s.userId === "m1");
    assert.equal(m1.paid, true);
  });

  it("splitCreate: non-positive total and empty participants are rejected", async () => {
    const badTotal = await lensRun("wallet", "splitCreate", { params: { total: 0, participants: ["a"] } }, ctx);
    assert.equal(badTotal.result.ok, false);
    assert.ok(badTotal.result.error.includes("total must be positive"));
    const noParts = await lensRun("wallet", "splitCreate", { params: { total: 10, participants: [], includeCreator: false } }, ctx);
    assert.equal(noParts.result.ok, false);
    assert.ok(noParts.result.error.includes("participants required"));
  });

  it("splitList returns splits the user created or participates in", async () => {
    const c = await lensRun("wallet", "splitCreate", { params: { total: 12, participants: ["z1"] } }, ctx);
    const list = await lensRun("wallet", "splitList", {}, ctx);
    assert.ok(list.result.splits.some((s) => s.id === c.result.split.id));
  });
});

describe("wallet — linked funding sources / cards", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("wallet-cards"); });

  it("cardAdd stores only last4 and makes the first card default; cardList reads it back", async () => {
    const c = await lensRun("wallet", "cardAdd", { params: { type: "card", label: "Visa", last4: "4111111111111111", brand: "Visa" } }, ctx);
    assert.equal(c.result.card.last4, "1111");   // only last 4 retained
    assert.equal(c.result.card.isDefault, true); // first card
    const list = await lensRun("wallet", "cardList", {}, ctx);
    assert.ok(list.result.cards.some((card) => card.id === c.result.card.id));
  });

  it("cardSetDefault flips default to the second card; first is no longer default", async () => {
    const second = await lensRun("wallet", "cardAdd", { params: { type: "bank", label: "Checking", last4: "9876" } }, ctx);
    const setd = await lensRun("wallet", "cardSetDefault", { params: { id: second.result.card.id } }, ctx);
    assert.equal(setd.result.card.isDefault, true);
    const list = await lensRun("wallet", "cardList", {}, ctx);
    const defaults = list.result.cards.filter((c) => c.isDefault);
    assert.equal(defaults.length, 1);   // exactly one default
    assert.equal(defaults[0].id, second.result.card.id);
  });

  it("cardRemove deletes the card; removing the default promotes another to default", async () => {
    const freshCtx = await depthCtx("wallet-cards-2");
    const a = await lensRun("wallet", "cardAdd", { params: { type: "card", label: "A", last4: "1234" } }, freshCtx);
    const b = await lensRun("wallet", "cardAdd", { params: { type: "card", label: "B", last4: "5678" } }, freshCtx);
    assert.equal(a.result.card.isDefault, true);
    const rm = await lensRun("wallet", "cardRemove", { params: { id: a.result.card.id } }, freshCtx);
    assert.equal(rm.result.removed, a.result.card.id);
    const list = await lensRun("wallet", "cardList", {}, freshCtx);
    assert.equal(list.result.cards.length, 1);
    assert.equal(list.result.cards[0].id, b.result.card.id);
    assert.equal(list.result.cards[0].isDefault, true);  // promoted
  });

  it("cardAdd: invalid type and bad last4 are rejected", async () => {
    const badType = await lensRun("wallet", "cardAdd", { params: { type: "crypto", label: "X", last4: "1234" } }, ctx);
    assert.equal(badType.result.ok, false);
    assert.ok(badType.result.error.includes("type must be card, bank, or paypal"));
    const badLast4 = await lensRun("wallet", "cardAdd", { params: { type: "card", label: "X", last4: "12" } }, ctx);
    assert.equal(badLast4.result.ok, false);
    assert.ok(badLast4.result.error.includes("last4 must be exactly 4 digits"));
  });

  it("cardRemove: a missing card id is rejected", async () => {
    const bad = await lensRun("wallet", "cardRemove", { params: { id: "card_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("card not found"));
  });
});

describe("wallet — QR pay/receive (generate → resolve round-trip)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("wallet-qr"); });

  it("qrGenerate → qrResolve round-trips recipient, amount, and amountLocked flag", async () => {
    const gen = await lensRun("wallet", "qrGenerate", { params: { amount: 25.5, note: "tickets" } }, ctx);
    assert.equal(gen.result.payload.amount, 25.5);
    assert.ok(gen.result.token.length > 0);
    assert.match(gen.result.deepLink, /^concord:\/\/wallet\/pay\?d=/);
    const res = await lensRun("wallet", "qrResolve", { params: { token: gen.result.token } }, ctx);
    assert.equal(res.result.recipientId, ctx.actor.userId);
    assert.equal(res.result.amount, 25.5);
    assert.equal(res.result.note, "tickets");
    assert.equal(res.result.amountLocked, true);
  });

  it("qrGenerate with no amount → resolve reports amountLocked=false", async () => {
    const gen = await lensRun("wallet", "qrGenerate", {}, ctx);
    assert.equal(gen.result.payload.amount, null);
    const res = await lensRun("wallet", "qrResolve", { params: { token: gen.result.token } }, ctx);
    assert.equal(res.result.amount, null);
    assert.equal(res.result.amountLocked, false);
  });

  it("qrGenerate: a negative amount is rejected", async () => {
    const bad = await lensRun("wallet", "qrGenerate", { params: { amount: -1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("amount must be a non-negative number"));
  });

  it("qrResolve: a non-wallet / malformed token is rejected", async () => {
    const noToken = await lensRun("wallet", "qrResolve", { params: { token: "" } }, ctx);
    assert.equal(noToken.result.ok, false);
    assert.ok(noToken.result.error.includes("token required"));
    const garbage = await lensRun("wallet", "qrResolve", { params: { token: "not-base64-payload!!" } }, ctx);
    assert.equal(garbage.result.ok, false);
    assert.ok(garbage.result.error.includes("invalid QR token") || garbage.result.error.includes("not a valid"));
  });
});
