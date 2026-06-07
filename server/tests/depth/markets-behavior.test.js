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
});
