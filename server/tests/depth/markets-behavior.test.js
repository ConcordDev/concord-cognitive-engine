// tests/depth/markets-behavior.test.js — REAL behavioral tests for the
// `markets` domain (registerLensAction family, invoked via lensRun).
//
// SKIPPED (network/LLM — live Yahoo Finance fetch, no egress in CI):
//   futures-board, forex-quotes, depth-of-book, quote-history.
// These call globalThis.fetch against query1.finance.yahoo.com and are
// non-deterministic; the no-egress preload blocks them anyway. Everything
// tested below is pure deterministic compute or in-memory STATE CRUD:
//   options-chain (Black-Scholes greeks), the prediction-market substrate
//   (create/list/get/odds/position-open/cashout/resolve/order-book/leaderboard),
//   and per-user alerts CRUD.
//
// NOTE on wrapping: `lens.run` UNWRAPS the handler's `{ok,result}` — the OUTER
// r.ok is always dispatch-success (true); the handler verdict + payload live in
// r.result. A handler rejection ({ok:false,error}) surfaces as r.result.ok===false
// + r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("markets — options-chain Black-Scholes (exact computed values)", () => {
  it("options-chain: strike ladder is 11 strikes stepped by round(spot*2.5%)", async () => {
    // spot 450 → strikeStep = max(1, round(450*0.025)) = round(11.25) = 11
    // strikes from 450-55=395 to 450+55=505 inclusive, step 11 → 11 strikes
    const r = await lensRun("markets", "options-chain", {
      params: { symbol: "spy", spot: 450, iv: 0.2, r: 0.05, daysToExpiry: 30 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.symbol, "SPY");           // upper-cased
    assert.equal(r.result.chain.length, 11);
    const strikes = r.result.chain.map((c) => c.strike);
    assert.equal(strikes[0], 395);
    assert.equal(strikes[10], 505);
    // step between adjacent strikes is exactly 11
    assert.equal(strikes[1] - strikes[0], 11);
  });

  it("options-chain: ATM call delta ≈ 0.5–0.6 and put-call parity ordering holds", async () => {
    const r = await lensRun("markets", "options-chain", {
      params: { symbol: "SPY", spot: 450, iv: 0.2, r: 0.05, daysToExpiry: 30 },
    });
    assert.equal(r.ok, true);
    // find the strike nearest spot (450) — it is 450 (395 + 5*11)
    const atm = r.result.chain.find((c) => c.strike === 450);
    assert.ok(atm, "expected a 450 strike in the ladder");
    // ATM call delta for a slightly-OTM-of-forward option sits ~0.5–0.62
    assert.ok(atm.call.delta > 0.5 && atm.call.delta < 0.65,
      `ATM call delta ${atm.call.delta} out of band`);
    // put delta = call delta - e^{-qT} ; with q=0 → putDelta = callDelta - 1
    assert.ok(Math.abs(atm.put.delta - (atm.call.delta - 1)) < 1e-3,
      `put-call delta parity broken: call ${atm.call.delta} put ${atm.put.delta}`);
    // gamma + vega are strictly positive at ATM
    assert.ok(atm.gamma > 0 && atm.vega > 0);
  });

  it("options-chain: deep ITM call mark exceeds intrinsic, deep OTM call mark is small", async () => {
    const r = await lensRun("markets", "options-chain", {
      params: { spot: 450, iv: 0.2, r: 0.05, daysToExpiry: 30 },
    });
    assert.equal(r.ok, true);
    const itm = r.result.chain.find((c) => c.strike === 395); // 55 in the money
    const otm = r.result.chain.find((c) => c.strike === 505); // 55 out of the money
    // ITM call mark must be at least its intrinsic value (spot-strike = 55)
    assert.ok(itm.call.mark >= 55, `ITM call mark ${itm.call.mark} < intrinsic 55`);
    // deep-OTM call worth far less than the deep-ITM call
    assert.ok(otm.call.mark < itm.call.mark);
  });

  it("options-chain: rejects iv outside (0,5] and non-positive daysToExpiry", async () => {
    const badIv = await lensRun("markets", "options-chain", { params: { spot: 450, iv: 6 } });
    assert.equal(badIv.result.ok, false);
    assert.match(badIv.result.error, /iv must be/);
    // NB: daysToExpiry 0 falls through `Number(x) || 30` to the default; only a
    // NEGATIVE value survives the coercion to trip the `<= 0` guard.
    const badDte = await lensRun("markets", "options-chain", { params: { spot: 450, iv: 0.2, daysToExpiry: -5 } });
    assert.equal(badDte.result.ok, false);
    assert.match(badDte.result.error, /daysToExpiry must be/);
  });
});

describe("markets — prediction-market parimutuel substrate (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("markets-pm"); });

  it("market-create seeds a symmetric pool → implied YES probability is exactly 0.5", async () => {
    const r = await lensRun("markets", "market-create", {
      params: {
        question: "Will it rain in Concordia tomorrow?",
        resolutionCriteria: "Resolves YES if measurable rain falls.",
        category: "world", seedSparks: 10,
      },
    }, ctx);
    assert.equal(r.ok, true);
    const m = r.result.market;
    assert.equal(m.poolYes, 5);          // seed 10 split symmetric
    assert.equal(m.poolNo, 5);
    assert.equal(m.yesProbability, 0.5);
    assert.equal(m.status, "open");
  });

  it("market-create rejects a too-short question", async () => {
    const r = await lensRun("markets", "market-create", {
      params: { question: "short", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /question must be at least 8 characters/);
  });

  it("market-odds: parimutuel payout preview is exact for a symmetric 5/5 pool", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Exact odds market check question", resolutionCriteria: "Resolves on evidence link." },
    }, ctx);
    const marketId = created.result.market.id;
    // pool is 5/5. stake 10 on YES: payout = 10 + (10/(5+10))*5 = 10 + 50/15 = 13.3333
    const odds = await lensRun("markets", "market-odds", { params: { marketId, stake: 10 } }, ctx);
    assert.equal(odds.ok, true);
    assert.ok(Math.abs(odds.result.yesStakePayoutIfWin - 13.33) < 0.01,
      `yes payout ${odds.result.yesStakePayoutIfWin} != ~13.33`);
    assert.ok(Math.abs(odds.result.yesMultiple - 1.333) < 0.001,
      `yes multiple ${odds.result.yesMultiple} != ~1.333`);
  });

  it("position-open → my-positions: a YES bet round-trips with entryPrice = pre-bet probability", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Position round-trip market question", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const marketId = created.result.market.id;
    const pos = await lensRun("markets", "position-open", {
      params: { marketId, side: "yes", stakeSparks: 15 },
    }, ctx);
    assert.equal(pos.ok, true);
    assert.equal(pos.result.position.entryPrice, 0.5);   // probBefore on a 5/5 pool
    assert.equal(pos.result.position.stakeSparks, 15);
    // pool moved: poolYes 5 → 20
    assert.equal(pos.result.market.poolYes, 20);
    const posId = pos.result.position.id;
    const mine = await lensRun("markets", "my-positions", {}, ctx);
    assert.ok(mine.result.positions.some((p) => p.id === posId && p.side === "yes"));
  });

  it("position-open rejects an invalid side", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Bad side rejection market question", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const bad = await lensRun("markets", "position-open", {
      params: { marketId: created.result.market.id, side: "maybe", stakeSparks: 10 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /side must be yes or no/);
  });

  it("market-resolve pays the winning side its stake + share of losing pool; loser PnL = -stake", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Resolution settlement market question", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const marketId = created.result.market.id;
    // Two opposing bets of 10 each onto the 5/5 seed.
    const yesPos = await lensRun("markets", "position-open", { params: { marketId, side: "yes", stakeSparks: 10 } }, ctx);
    const noPos  = await lensRun("markets", "position-open", { params: { marketId, side: "no",  stakeSparks: 10 } }, ctx);
    // After both bets: poolYes = 15, poolNo = 15.
    const res = await lensRun("markets", "market-resolve", {
      params: { marketId, outcome: "yes", evidence: "Observed YES per the official record." },
    }, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.result.market.status, "resolved");
    assert.equal(res.result.market.outcome, "yes");
    assert.equal(res.result.settlement.winners, 1);
    assert.equal(res.result.settlement.losers, 1);
    // Verify the loser's realized PnL via my-positions: -10.
    const mine = await lensRun("markets", "my-positions", {}, ctx);
    const lost = mine.result.positions.find((p) => p.id === noPos.result.position.id);
    assert.equal(lost.status, "lost");
    assert.equal(lost.realizedPnl, -10);
    const won = mine.result.positions.find((p) => p.id === yesPos.result.position.id);
    assert.equal(won.status, "won");
    // winner payout = stake + (stake/winPool)*losePool = 10 + (10/15)*15 = 20
    assert.ok(Math.abs(won.payoutSparks - 20) < 0.01, `winner payout ${won.payoutSparks} != ~20`);
  });

  it("market-resolve is creator-only: a different user cannot resolve", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Creator-only resolution market question", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const other = await depthCtx("markets-pm-other");
    const res = await lensRun("markets", "market-resolve", {
      params: { marketId: created.result.market.id, outcome: "yes", evidence: "Some evidence string." },
    }, other);
    assert.equal(res.result.ok, false);
    assert.match(res.result.error, /only the market creator can resolve/);
  });

  it("order-place rests then order-book aggregates it; order-cancel closes it", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Limit order book market question test", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const marketId = created.result.market.id;
    // limit 0.30 on a market currently at 0.50 → does NOT fill (sidePrice 0.5 > 0.3)
    const ord = await lensRun("markets", "order-place", {
      params: { marketId, side: "yes", limitPrice: 0.3, stakeSparks: 12 },
    }, ctx);
    assert.equal(ord.ok, true);
    assert.equal(ord.result.immediatelyFilled, false);
    const book = await lensRun("markets", "order-book", { params: { marketId } }, ctx);
    assert.equal(book.result.restingCount, 1);
    assert.ok(book.result.yesBids.some((b) => b.price === 0.3 && b.size === 12));
    const cancel = await lensRun("markets", "order-cancel", { params: { orderId: ord.result.order.id } }, ctx);
    assert.equal(cancel.result.order.status, "cancelled");
  });
});

describe("markets — alerts CRUD (per-user, shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("markets-alerts"); });

  it("alert-create → alerts-list → alert-cancel round-trips with upper-cased symbol", async () => {
    const created = await lensRun("markets", "alert-create", {
      params: { symbol: "spy", condition: "price_above", threshold: 500 },
    }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.alert.symbol, "SPY");
    assert.equal(created.result.alert.status, "active");
    const id = created.result.alert.id;
    const list = await lensRun("markets", "alerts-list", {}, ctx);
    assert.ok(list.result.alerts.some((a) => a.id === id && a.threshold === 500));
    const cancel = await lensRun("markets", "alert-cancel", { params: { id } }, ctx);
    assert.equal(cancel.result.alert.status, "cancelled");
  });

  it("alert-create rejects an unknown condition", async () => {
    const bad = await lensRun("markets", "alert-create", {
      params: { symbol: "SPY", condition: "price_sideways", threshold: 100 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /condition must be/);
  });

  it("alert-create rejects a missing symbol and a non-numeric threshold", async () => {
    const noSym = await lensRun("markets", "alert-create", {
      params: { condition: "price_above", threshold: 100 },
    }, ctx);
    assert.equal(noSym.result.ok, false);
    assert.match(noSym.result.error, /symbol required/);
    const badThresh = await lensRun("markets", "alert-create", {
      params: { symbol: "SPY", condition: "price_above", threshold: "not-a-number" },
    }, ctx);
    assert.equal(badThresh.result.ok, false);
    assert.match(badThresh.result.error, /threshold must be a number/);
  });

  it("alert-cancel rejects an unknown id and a missing id", async () => {
    const noId = await lensRun("markets", "alert-cancel", { params: {} }, ctx);
    assert.equal(noId.result.ok, false);
    assert.match(noId.result.error, /id required/);
    const notFound = await lensRun("markets", "alert-cancel", { params: { id: "alert_nope" } }, ctx);
    assert.equal(notFound.result.ok, false);
    assert.match(notFound.result.error, /not found/);
  });
});

describe("markets — market-get / market-list / market-history (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("markets-readside"); });

  it("market-get returns a created market's summary; unknown id rejects", async () => {
    const created = await lensRun("markets", "market-create", {
      params: {
        question: "Get-by-id round-trip market question",
        resolutionCriteria: "Resolves on the official record.",
        category: "tech", seedSparks: 20,
      },
    }, ctx);
    const marketId = created.result.market.id;
    const got = await lensRun("markets", "market-get", { params: { marketId } }, ctx);
    assert.equal(got.ok, true);
    assert.equal(got.result.market.id, marketId);
    assert.equal(got.result.market.category, "tech");
    // seed 20 → symmetric 10/10 pool
    assert.equal(got.result.market.poolYes, 10);
    assert.equal(got.result.market.poolNo, 10);
    assert.equal(got.result.market.totalPool, 20);
    const missing = await lensRun("markets", "market-get", { params: { marketId: "mkt_nope" } }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /market not found/);
  });

  it("market-list filters by category + search and reports facet counts", async () => {
    // create a uniquely-categorised market with a unique search token
    await lensRun("markets", "market-create", {
      params: {
        question: "Zorptastic listing token market question",
        resolutionCriteria: "Resolves on evidence link.",
        category: "science",
      },
    }, ctx);
    const byCat = await lensRun("markets", "market-list", { params: { category: "science" } }, ctx);
    assert.equal(byCat.ok, true);
    assert.ok(byCat.result.markets.every((m) => m.category === "science"));
    assert.ok(byCat.result.facets.science >= 1);
    // categories list is exposed for the browse UI
    assert.ok(byCat.result.categories.includes("science"));
    // search narrows to the unique token
    const bySearch = await lensRun("markets", "market-list", { params: { search: "zorptastic" } }, ctx);
    assert.equal(bySearch.result.markets.length, 1);
    assert.match(bySearch.result.markets[0].question, /Zorptastic/);
  });

  it("market-list respects the limit clamp and the status filter", async () => {
    const limited = await lensRun("markets", "market-list", { params: { limit: 1 } }, ctx);
    assert.ok(limited.result.markets.length <= 1);
    const openOnly = await lensRun("markets", "market-list", { params: { status: "open" } }, ctx);
    assert.ok(openOnly.result.markets.every((m) => m.status === "open"));
  });

  it("market-history records one point per price-moving event", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Price history tracking market question", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const marketId = created.result.market.id;
    // create() records one point; each position-open records another.
    const h0 = await lensRun("markets", "market-history", { params: { marketId } }, ctx);
    assert.equal(h0.ok, true);
    assert.equal(h0.result.count, 1);
    assert.equal(h0.result.points[0].yesPercent, 50); // symmetric seed
    await lensRun("markets", "position-open", { params: { marketId, side: "yes", stakeSparks: 30 } }, ctx);
    const h1 = await lensRun("markets", "market-history", { params: { marketId } }, ctx);
    assert.equal(h1.result.count, 2);
    // after a 30-spark YES bet onto a 5/5 pool: poolYes 35, poolNo 5 → 87.5% → 88
    assert.equal(h1.result.points[1].yesPercent, 88);
    assert.equal(h1.result.points[1].poolYes, 35);
  });

  it("market-history rejects an unknown market", async () => {
    const bad = await lensRun("markets", "market-history", { params: { marketId: "mkt_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /market not found/);
  });
});

describe("markets — position-cashout + market-resolution + leaderboard (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("markets-cashout"); });

  it("position-cashout closes an open YES position at current odds minus a 2% exit fee", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Cashout exit fee market question check", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const marketId = created.result.market.id;
    // Bet 10 YES onto the 5/5 seed → poolYes 15, poolNo 5.
    const pos = await lensRun("markets", "position-open", { params: { marketId, side: "yes", stakeSparks: 10 } }, ctx);
    const positionId = pos.result.position.id;
    // current odds (post-bet): prob = 15/20 = 0.75 ; winPool 15 losePool 5
    // grossIfWin = 10 + (10/15)*5 = 13.3333... ; rawCashout = gross * 0.75 = 10.0
    // exitFee = 10.0 * 0.02 = 0.20 ; cashout = 9.80 ; pnl = -0.20
    const cash = await lensRun("markets", "position-cashout", { params: { positionId } }, ctx);
    assert.equal(cash.ok, true);
    assert.ok(Math.abs(cash.result.cashoutSparks - 9.80) < 0.01,
      `cashout ${cash.result.cashoutSparks} != ~9.80`);
    assert.ok(Math.abs(cash.result.exitFee - 0.20) < 0.01, `exitFee ${cash.result.exitFee} != ~0.20`);
    assert.ok(Math.abs(cash.result.realizedPnl - (-0.20)) < 0.01, `pnl ${cash.result.realizedPnl} != ~-0.20`);
    assert.equal(cash.result.position.status, "cashed_out");
  });

  it("position-cashout cannot be replayed and rejects another user", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Cashout replay guard market question", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const marketId = created.result.market.id;
    const pos = await lensRun("markets", "position-open", { params: { marketId, side: "no", stakeSparks: 8 } }, ctx);
    const positionId = pos.result.position.id;
    const other = await depthCtx("markets-cashout-other");
    const notYours = await lensRun("markets", "position-cashout", { params: { positionId } }, other);
    assert.equal(notYours.result.ok, false);
    assert.match(notYours.result.error, /not your position/);
    const first = await lensRun("markets", "position-cashout", { params: { positionId } }, ctx);
    assert.equal(first.ok, true);
    const replay = await lensRun("markets", "position-cashout", { params: { positionId } }, ctx);
    assert.equal(replay.result.ok, false);
    assert.match(replay.result.error, /position is cashed_out/);
  });

  it("market-resolution reports unresolved then resolved with settled-position counts", async () => {
    const created = await lensRun("markets", "market-create", {
      params: { question: "Resolution view reporting market question", resolutionCriteria: "Resolves on evidence." },
    }, ctx);
    const marketId = created.result.market.id;
    await lensRun("markets", "position-open", { params: { marketId, side: "yes", stakeSparks: 10 } }, ctx);
    await lensRun("markets", "position-open", { params: { marketId, side: "no", stakeSparks: 10 } }, ctx);
    const before = await lensRun("markets", "market-resolution", { params: { marketId } }, ctx);
    assert.equal(before.result.resolved, false);
    assert.equal(before.result.status, "open");
    await lensRun("markets", "market-resolve", {
      params: { marketId, outcome: "yes", evidence: "Observed YES per the record." },
    }, ctx);
    const after = await lensRun("markets", "market-resolution", { params: { marketId } }, ctx);
    assert.equal(after.result.resolved, true);
    assert.equal(after.result.resolution.outcome, "yes");
    assert.equal(after.result.settledPositions, 2);
    assert.equal(after.result.winners, 1);
    assert.equal(after.result.losers, 1);
  });

  it("leaderboard ranks the user by realized P&L with a derived win rate and ROI", async () => {
    const lb = await lensRun("markets", "leaderboard", {}, ctx);
    assert.equal(lb.ok, true);
    const me = lb.result.leaderboard.find((row) => row.userId === ctx.actor.userId);
    assert.ok(me, "expected this user on the leaderboard");
    assert.equal(me.rank >= 1, true);
    // From the resolution test above this ctx has at least one win and one loss.
    assert.ok(me.wins >= 1 && me.losses >= 1);
    // winRate = wins/(wins+losses); roi = realizedPnl/staked — both finite numbers
    assert.ok(me.winRate !== null && me.winRate >= 0 && me.winRate <= 1);
    assert.ok(me.roi !== null && Number.isFinite(me.roi));
  });
});

describe("markets — network macro pre-fetch validation branches (no egress)", () => {
  it("quote-history rejects a missing symbol, bad range, and bad interval before any fetch", async () => {
    const noSym = await lensRun("markets", "quote-history", { params: {} });
    assert.equal(noSym.result.ok, false);
    assert.match(noSym.result.error, /symbol required/);
    const badRange = await lensRun("markets", "quote-history", { params: { symbol: "SPY", range: "7mo" } });
    assert.equal(badRange.result.ok, false);
    assert.match(badRange.result.error, /invalid range/);
    const badInterval = await lensRun("markets", "quote-history", {
      params: { symbol: "SPY", range: "1mo", interval: "13m" },
    });
    assert.equal(badInterval.result.ok, false);
    assert.match(badInterval.result.error, /invalid interval/);
  });

  it("depth-of-book with a symbol falls through to the graceful fetch-failure branch (egress blocked)", async () => {
    // No pre-fetch validation rejects a non-empty symbol, so the no-egress
    // block trips the catch → a well-formed { ok:false } error shape.
    const r = await lensRun("markets", "depth-of-book", { params: { symbol: "SPY" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /depth quote fetch failed/);
  });
});
