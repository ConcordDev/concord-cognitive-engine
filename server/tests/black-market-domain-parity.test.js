// Tier-2 contract tests for the black-market lens feature-backlog macros:
// auctions/bidding, reputation-gated inventory, haggle, player resale,
// watchlist alerts, and the shadow-tier decryption mini-game.
// Pins per-user STATE scoping, reputation gates, and the auction lifecycle.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBlackMarketActions from "../domains/black-market.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`black-market.${name}`);
  if (!fn) throw new Error(`black-market.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

registerBlackMarketActions(register);

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c" }, userId: "user_c" };

// Helper: grant reputation by settling auctions until the score clears a gate.
function grantRep(ctx, target) {
  let guard = 0;
  while (call("rep-get", ctx).result.score < target && guard < 40) {
    const a = call("auction-create", ctxC, {
      title: `rep-pump-${guard}`,
      preview: "p",
      payload: "x",
      encryptionLevel: "none",
      minBid: 1,
      durationMin: 60,
    }).result.auction;
    call("auction-bid", ctx, { auctionId: a.id, amount: 2 });
    call("auction-settle", ctxC, { auctionId: a.id });
    guard += 1;
  }
}

describe("black-market — auctions / bidding", () => {
  it("creates an auction with validated fields", () => {
    const r = call("auction-create", ctxA, {
      title: "Cipher fragment",
      preview: "redacted preview",
      payload: "the real message",
      encryptionLevel: "basic",
      minBid: 25,
      durationMin: 30,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.auction.status, "open");
    assert.equal(r.result.auction.minBid, 25);
    assert.equal(r.result.auction.encryptionLevel, "basic");
  });

  it("rejects an auction missing required fields", () => {
    const r = call("auction-create", ctxA, { title: "no payload" });
    assert.equal(r.ok, false);
    assert.match(r.error, /required/);
  });

  it("bids must exceed the current top bid", () => {
    const a = call("auction-create", ctxA, {
      title: "X", preview: "p", payload: "y", minBid: 10,
    }).result.auction;
    const b1 = call("auction-bid", ctxB, { auctionId: a.id, amount: 15 });
    assert.equal(b1.ok, true);
    assert.equal(b1.result.topBid, 15);
    const b2 = call("auction-bid", ctxC, { auctionId: a.id, amount: 12 });
    assert.equal(b2.ok, false);
    assert.match(b2.error, /must exceed/);
  });

  it("seller cannot bid on their own auction", () => {
    const a = call("auction-create", ctxA, {
      title: "X", preview: "p", payload: "y", minBid: 5,
    }).result.auction;
    const r = call("auction-bid", ctxA, { auctionId: a.id, amount: 99 });
    assert.equal(r.ok, false);
    assert.match(r.error, /own auction/);
  });

  it("settle transfers the intercept to the high bidder and credits rep", () => {
    const a = call("auction-create", ctxA, {
      title: "Win me", preview: "p", payload: "secret", minBid: 5,
    }).result.auction;
    call("auction-bid", ctxB, { auctionId: a.id, amount: 20 });
    const s = call("auction-settle", ctxA, { auctionId: a.id });
    assert.equal(s.ok, true);
    assert.equal(s.result.sold, true);
    assert.equal(s.result.winnerId, "user_b");
    const ownedB = call("owned-list", ctxB);
    assert.equal(ownedB.result.owned.length, 1);
    assert.equal(ownedB.result.owned[0].payload, "secret");
    assert.ok(call("rep-get", ctxB).result.score > 0);
  });

  it("settle with no bids marks the auction unsold", () => {
    const a = call("auction-create", ctxA, {
      title: "lonely", preview: "p", payload: "y", minBid: 5,
    }).result.auction;
    const s = call("auction-settle", ctxA, { auctionId: a.id });
    assert.equal(s.result.sold, false);
  });
});

describe("black-market — reputation-gated inventory", () => {
  it("rep-get reports unlocked tiers for a fresh account", () => {
    const r = call("rep-get", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 0);
    assert.deepEqual(r.result.unlockedTiers, ["none", "basic"]);
    assert.equal(r.result.nextTier.tier, "high");
  });

  it("inventory hides high/shadow-tier auctions from a low-rep buyer", () => {
    call("auction-create", ctxC, {
      title: "shadow goods", preview: "p", payload: "y",
      encryptionLevel: "shadow", minBid: 5,
    });
    const inv = call("inventory", ctxA);
    assert.equal(inv.ok, true);
    assert.equal(inv.result.auctions.length, 0);
    assert.equal(inv.result.lockedCount, 1);
  });

  it("inventory reveals a higher tier once reputation clears the gate", () => {
    call("auction-create", ctxC, {
      title: "high goods", preview: "p", payload: "y",
      encryptionLevel: "high", minBid: 5,
    });
    grantRep(ctxA, 25);
    const inv = call("inventory", ctxA);
    assert.ok(inv.result.auctions.some((x) => x.encryptionLevel === "high"));
  });

  it("INVARIANT: reputation is scoped per-user", () => {
    grantRep(ctxA, 25);
    assert.ok(call("rep-get", ctxA).result.score >= 25);
    assert.equal(call("rep-get", ctxB).result.score, 0);
  });
});

describe("black-market — haggle", () => {
  it("a generous offer at/above list price is accepted", () => {
    const a = call("auction-create", ctxA, {
      title: "X", preview: "p", payload: "y", minBid: 50,
    }).result.auction;
    const h = call("haggle", ctxB, { auctionId: a.id, offer: 50 });
    assert.equal(h.ok, true);
    assert.equal(h.result.accepted, true);
    assert.equal(h.result.agreedPrice, 50);
  });

  it("a low offer returns a counter and decrements rounds", () => {
    const a = call("auction-create", ctxA, {
      title: "X", preview: "p", payload: "y", minBid: 100,
    }).result.auction;
    const h = call("haggle", ctxB, { auctionId: a.id, offer: 10 });
    assert.equal(h.result.accepted, false);
    assert.ok(h.result.counter > 10 && h.result.counter <= 100);
    assert.equal(h.result.round, 1);
    assert.equal(h.result.roundsLeft, 2);
  });

  it("the fence walks away after three rounds", () => {
    const a = call("auction-create", ctxA, {
      title: "X", preview: "p", payload: "y", minBid: 100,
    }).result.auction;
    call("haggle", ctxB, { auctionId: a.id, offer: 5 });
    call("haggle", ctxB, { auctionId: a.id, offer: 6 });
    call("haggle", ctxB, { auctionId: a.id, offer: 7 });
    const fourth = call("haggle", ctxB, { auctionId: a.id, offer: 8 });
    assert.equal(fourth.ok, false);
    assert.match(fourth.error, /walked away/);
  });

  it("haggle-accept transfers ownership at the agreed price", () => {
    const a = call("auction-create", ctxA, {
      title: "deal", preview: "p", payload: "the goods", minBid: 80,
    }).result.auction;
    call("haggle", ctxB, { auctionId: a.id, offer: 80 });
    const acc = call("haggle-accept", ctxB, { auctionId: a.id });
    assert.equal(acc.ok, true);
    assert.equal(acc.result.pricePaid, 80);
    assert.equal(call("owned-list", ctxB).result.owned[0].payload, "the goods");
  });
});

describe("black-market — player resale", () => {
  function ownAnIntercept(ctx) {
    const a = call("auction-create", ctxC, {
      title: "resaleable", preview: "p", payload: "payload", minBid: 5,
    }).result.auction;
    call("auction-bid", ctx, { auctionId: a.id, amount: 10 });
    call("auction-settle", ctxC, { auctionId: a.id });
    return call("owned-list", ctx).result.owned[0];
  }

  it("resale-create removes the item from owned inventory", () => {
    const o = ownAnIntercept(ctxA);
    const r = call("resale-create", ctxA, { ownedId: o.id, price: 40 });
    assert.equal(r.ok, true);
    assert.equal(call("owned-list", ctxA).result.owned.length, 0);
  });

  it("resale-market lists other players' listings, not your own", () => {
    const o = ownAnIntercept(ctxA);
    call("resale-create", ctxA, { ownedId: o.id, price: 40 });
    const seller = call("resale-market", ctxA);
    assert.equal(seller.result.market.length, 0);
    assert.equal(seller.result.mine.length, 1);
    const buyer = call("resale-market", ctxB);
    assert.equal(buyer.result.market.length, 1);
  });

  it("resale-buy transfers ownership and credits both parties", () => {
    const o = ownAnIntercept(ctxA);
    const res = call("resale-create", ctxA, { ownedId: o.id, price: 40 }).result.resale;
    const buy = call("resale-buy", ctxB, { resaleId: res.id });
    assert.equal(buy.ok, true);
    assert.equal(call("owned-list", ctxB).result.owned.length, 1);
    assert.ok(call("rep-get", ctxB).result.score > 0);
    assert.ok(call("rep-get", ctxA).result.score > 0);
  });

  it("cannot buy your own resale listing", () => {
    const o = ownAnIntercept(ctxA);
    const res = call("resale-create", ctxA, { ownedId: o.id, price: 40 }).result.resale;
    const r = call("resale-buy", ctxA, { resaleId: res.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /own resale/);
  });
});

describe("black-market — watchlist alerts", () => {
  it("watch-add rejects empty keyword and duplicates", () => {
    assert.equal(call("watch-add", ctxA, { keyword: "" }).ok, false);
    assert.equal(call("watch-add", ctxA, { keyword: "cipher" }).ok, true);
    assert.equal(call("watch-add", ctxA, { keyword: "cipher" }).ok, false);
  });

  it("watch-check surfaces a matching live auction as an alert", () => {
    call("watch-add", ctxA, { keyword: "ledger" });
    call("auction-create", ctxC, {
      title: "Stolen ledger page", preview: "p", payload: "y",
      encryptionLevel: "none", minBid: 5,
    });
    const w = call("watch-check", ctxA);
    assert.equal(w.ok, true);
    assert.equal(w.result.alerts.length, 1);
    assert.match(w.result.alerts[0].title, /ledger/i);
  });

  it("watch-check honours the maxPrice ceiling", () => {
    call("watch-add", ctxA, { keyword: "rare", maxPrice: 20 });
    call("auction-create", ctxC, {
      title: "rare expensive", preview: "p", payload: "y", minBid: 500,
    });
    assert.equal(call("watch-check", ctxA).result.alerts.length, 0);
    call("auction-create", ctxC, {
      title: "rare cheap", preview: "p", payload: "y", minBid: 5,
    });
    assert.equal(call("watch-check", ctxA).result.alerts.length, 1);
  });

  it("watch-remove deletes a saved search", () => {
    const w = call("watch-add", ctxA, { keyword: "gone" }).result.watch;
    assert.equal(call("watch-list", ctxA).result.count, 1);
    assert.equal(call("watch-remove", ctxA, { watchId: w.id }).ok, true);
    assert.equal(call("watch-list", ctxA).result.count, 0);
  });
});

describe("black-market — decryption mini-game", () => {
  function ownShadowIntercept(ctx) {
    grantRep(ctx, 75);
    const a = call("auction-create", ctxC, {
      title: "shadow file", preview: "p", payload: "HELLO AGENT",
      encryptionLevel: "shadow", minBid: 5,
    }).result.auction;
    call("auction-bid", ctx, { auctionId: a.id, amount: 10 });
    call("auction-settle", ctxC, { auctionId: a.id });
    return call("owned-list", ctx).result.owned.find((o) => o.encryptionLevel === "shadow");
  }

  it("decrypt-start only works on shadow-tier intercepts", () => {
    const a = call("auction-create", ctxC, {
      title: "basic file", preview: "p", payload: "plain",
      encryptionLevel: "none", minBid: 5,
    }).result.auction;
    call("auction-bid", ctxA, { auctionId: a.id, amount: 10 });
    call("auction-settle", ctxC, { auctionId: a.id });
    const o = call("owned-list", ctxA).result.owned[0];
    const r = call("decrypt-start", ctxA, { ownedId: o.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /shadow-tier/);
  });

  it("decrypt-start returns ciphertext + a frequency hint", () => {
    const o = ownShadowIntercept(ctxA);
    const r = call("decrypt-start", ctxA, { ownedId: o.id });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.ciphertext, "string");
    assert.notEqual(r.result.ciphertext, "HELLO AGENT");
    assert.ok(r.result.hint);
  });

  it("a wrong guess returns directional feedback, a correct one unlocks the payload", () => {
    const o = ownShadowIntercept(ctxA);
    const start = call("decrypt-start", ctxA, { ownedId: o.id });
    void start;
    // Brute-force the shift to verify the win path deterministically.
    let solved = null;
    for (let shift = 1; shift <= 25; shift += 1) {
      const g = call("decrypt-guess", ctxA, { ownedId: o.id, shift });
      assert.equal(g.ok, true);
      if (g.result.correct) {
        solved = g.result;
        break;
      }
      assert.match(g.result.hint, /higher|lower/);
    }
    assert.ok(solved, "decryption should be solvable");
    assert.equal(solved.plaintext, "HELLO AGENT");
    assert.ok(solved.repAwarded > 0);
  });
});

describe("black-market — base listings + STATE-missing path", () => {
  it("tiers macro returns the restricted categories", () => {
    const r = call("tiers", ctxA);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.tiers));
    assert.equal(r.result.tiers.length, 3);
  });

  it("listings returns an empty set when no db is present", () => {
    const r = call("listings", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.items, []);
  });

  it("returns an error shape when STATE is unavailable", () => {
    globalThis._concordSTATE = undefined;
    const r = call("rep-get", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
