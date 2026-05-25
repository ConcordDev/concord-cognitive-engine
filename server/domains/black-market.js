// server/domains/black-market.js
// Black-market lens — Sael's stall. Surfaces intercepted Concord Link
// messages flagged for the underground bazaar. Sparks currency only;
// there is no real-money codepath.
//
// The base `listings` / `tiers` macros read the live `creative_artifacts`
// table. The feature-backlog macros below (auctions, reputation-gated
// inventory, haggle, resale, watchlist, decryption mini-game) maintain
// per-user state in `globalThis._concordSTATE.blackMarketLens` — every
// value is real user input or computed from real input. No seed/demo data.

export default function registerBlackMarketActions(registerLensAction) {
  /**
   * listings — return rare/legendary-quality artifacts, optionally
   * filtered by type.
   */
  registerLensAction("black-market", "listings", (ctx, _artifact, params = {}) => {
    if (!ctx?.db) return { ok: true, result: { items: [] } };
    try {
      const limit = Math.min(50, Math.max(1, Number(params.limit) || 30));
      const type = typeof params.type === "string" ? params.type : null;
      let sql = `
        SELECT id, type, title, description, price, creator_id, created_at
        FROM creative_artifacts
        WHERE marketplace_status = 'active'
          AND (rating >= 4.5 OR price >= 50)
      `;
      const args = [];
      if (type) { sql += " AND type = ?"; args.push(type); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      args.push(limit);
      const rows = ctx.db.prepare(sql).all(...args);
      return { ok: true, result: { items: rows } };
    } catch { return { ok: true, result: { items: [] } }; }
  });

  /**
   * tiers — describe the restricted-tier categories that show up here.
   */
  registerLensAction("black-market", "tiers", () => ({
    ok: true,
    result: {
      tiers: [
        { id: "rare", label: "Rare goods", filter: "rating >= 4.5" },
        { id: "premium", label: "Premium", filter: "price >= 50" },
        { id: "exclusive", label: "Exclusive license", filter: "license_type = 'exclusive'" },
      ],
    },
  }));

  // ──────────────────────────────────────────────────────────────────────
  // Feature-backlog substrate. Per-user STATE Maps; no DB, no seed data.
  // ──────────────────────────────────────────────────────────────────────

  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.blackMarketLens) {
      STATE.blackMarketLens = {
        auctions: new Map(),   // userId -> Array<auction>
        rep: new Map(),        // userId -> { score, purchases, lastTradeAt }
        owned: new Map(),      // userId -> Array<ownedIntercept>
        resales: new Map(),    // userId -> Array<resaleListing>
        watchlist: new Map(),  // userId -> Array<watch>
        decryptions: new Map(),// userId -> Map<resaleId|auctionId, session>
        seq: new Map(),        // userId -> { auc, own, res, wat }
      };
    }
    return STATE.blackMarketLens;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
    }
  }
  function actId(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function ensureSeq(s, uid) {
    if (!s.seq.has(uid)) s.seq.set(uid, { auc: 1, own: 1, res: 1, wat: 1 });
    return s.seq.get(uid);
  }
  function ensureList(map, uid) {
    if (!map.has(uid)) map.set(uid, []);
    return map.get(uid);
  }
  function getRep(s, uid) {
    if (!s.rep.has(uid)) s.rep.set(uid, { score: 0, purchases: 0, lastTradeAt: null });
    return s.rep.get(uid);
  }
  function num(v, dflt = 0) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  // Reputation thresholds gate which encryption tiers a buyer can see.
  const TIER_REP_GATE = { none: 0, basic: 0, high: 25, shadow: 75 };
  const TIER_ORDER = ["none", "basic", "high", "shadow"];

  /**
   * rep-get — the caller's current fence reputation + which tiers it
   * unlocks. Reputation accrues from auction wins, completed resales,
   * and decryption successes.
   */
  registerLensAction("black-market", "rep-get", (ctx) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const r = getRep(s, actId(ctx));
    const unlocked = TIER_ORDER.filter((t) => r.score >= TIER_REP_GATE[t]);
    const next = TIER_ORDER.find((t) => r.score < TIER_REP_GATE[t]);
    return {
      ok: true,
      result: {
        score: r.score,
        purchases: r.purchases,
        lastTradeAt: r.lastTradeAt,
        unlockedTiers: unlocked,
        nextTier: next ? { tier: next, repNeeded: TIER_REP_GATE[next] } : null,
        gates: TIER_REP_GATE,
      },
    };
  });

  // ── [M] Reputation-gated inventory ────────────────────────────────────

  /**
   * inventory — list active auctions visible to this caller. A listing's
   * encryption tier must be unlocked by the caller's reputation, so a
   * fresh account never sees shadow-tier intercepts.
   */
  registerLensAction("black-market", "inventory", (ctx) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const r = getRep(s, uid);
    const now = Date.now();
    // Auctions are visible across all callers (it is a shared market),
    // but only tiers the caller's reputation has unlocked.
    const all = [];
    for (const list of s.auctions.values()) {
      for (const a of list) all.push(a);
    }
    const visible = all
      .filter((a) => a.status === "open" && a.endsAt > now)
      .filter((a) => r.score >= (TIER_REP_GATE[a.encryptionLevel] ?? 0))
      .map((a) => ({
        ...a,
        topBid: a.bids.length ? a.bids[a.bids.length - 1].amount : a.minBid,
        bidCount: a.bids.length,
        isOwner: a.sellerId === uid,
      }))
      .sort((x, y) => y.createdAt - x.createdAt);
    const lockedCount = all.filter(
      (a) => a.status === "open" && a.endsAt > now &&
        r.score < (TIER_REP_GATE[a.encryptionLevel] ?? 0)
    ).length;
    return {
      ok: true,
      result: { auctions: visible, lockedCount, repScore: r.score },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Bidding / auction on rare intercepts ──────────────────────────

  /**
   * auction-create — list an intercepted message for auction. The seller
   * sets a minimum bid, encryption tier and run duration (minutes).
   */
  registerLensAction("black-market", "auction-create", (ctx, _artifact, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const title = str(params.title);
    if (!title) return { ok: false, error: "title required" };
    if (title.length > 120) return { ok: false, error: "title too long (max 120)" };
    const preview = str(params.preview);
    if (!preview) return { ok: false, error: "preview required" };
    const payload = str(params.payload);
    if (!payload) return { ok: false, error: "payload required" };
    const encryptionLevel = str(params.encryptionLevel) || "none";
    if (!TIER_ORDER.includes(encryptionLevel)) {
      return { ok: false, error: "encryptionLevel invalid" };
    }
    const minBid = Math.max(1, Math.round(num(params.minBid, 1)));
    const durationMin = Math.min(1440, Math.max(1, Math.round(num(params.durationMin, 60))));
    const seq = ensureSeq(s, uid);
    const list = ensureList(s.auctions, uid);
    const now = Date.now();
    const auction = {
      id: `auc_${uid}_${seq.auc++}`,
      sellerId: uid,
      title,
      preview,
      payload,
      encryptionLevel,
      minBid,
      bids: [],
      status: "open",
      createdAt: now,
      endsAt: now + durationMin * 60_000,
      winnerId: null,
      winningBid: null,
    };
    list.push(auction);
    save();
    return { ok: true, result: { auction } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * auction-bid — place a bid on an open auction. The bid must exceed the
   * current top bid (or the minimum if none yet). Reputation gates access
   * to the auction's encryption tier.
   */
  registerLensAction("black-market", "auction-bid", (ctx, _artifact, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const auctionId = str(params.auctionId);
    if (!auctionId) return { ok: false, error: "auctionId required" };
    const amount = Math.round(num(params.amount, 0));
    let auction = null;
    for (const list of s.auctions.values()) {
      const found = list.find((a) => a.id === auctionId);
      if (found) { auction = found; break; }
    }
    if (!auction) return { ok: false, error: "auction not found" };
    if (auction.status !== "open") return { ok: false, error: "auction closed" };
    if (Date.now() > auction.endsAt) return { ok: false, error: "auction expired" };
    if (auction.sellerId === uid) return { ok: false, error: "cannot bid on own auction" };
    const r = getRep(s, uid);
    if (r.score < (TIER_REP_GATE[auction.encryptionLevel] ?? 0)) {
      return { ok: false, error: "reputation too low for this tier" };
    }
    const top = auction.bids.length
      ? auction.bids[auction.bids.length - 1].amount
      : auction.minBid - 1;
    if (amount <= top) {
      return { ok: false, error: `bid must exceed ${top}` };
    }
    auction.bids.push({ bidderId: uid, amount, at: Date.now() });
    save();
    return {
      ok: true,
      result: {
        auctionId,
        topBid: amount,
        bidCount: auction.bids.length,
        isHighBidder: true,
      },
    };
  });

  /**
   * auction-settle — close an auction. Callable by the seller, or by
   * anyone once the auction has expired. The high bidder wins, takes
   * ownership of the intercept and gains fence reputation; the seller
   * also gains reputation for a completed trade.
   */
  registerLensAction("black-market", "auction-settle", (ctx, _artifact, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const auctionId = str(params.auctionId);
    if (!auctionId) return { ok: false, error: "auctionId required" };
    let auction = null;
    for (const list of s.auctions.values()) {
      const found = list.find((a) => a.id === auctionId);
      if (found) { auction = found; break; }
    }
    if (!auction) return { ok: false, error: "auction not found" };
    if (auction.status !== "open") return { ok: false, error: "already settled" };
    const expired = Date.now() > auction.endsAt;
    if (auction.sellerId !== uid && !expired) {
      return { ok: false, error: "only seller can settle before expiry" };
    }
    const now = Date.now();
    if (!auction.bids.length) {
      auction.status = "unsold";
      save();
      return { ok: true, result: { auction, sold: false } };
    }
    const winning = auction.bids[auction.bids.length - 1];
    auction.status = "settled";
    auction.winnerId = winning.bidderId;
    auction.winningBid = winning.amount;
    auction.settledAt = now;
    // Transfer intercept into the winner's owned inventory.
    const seq = ensureSeq(s, winning.bidderId);
    const ownedList = ensureList(s.owned, winning.bidderId);
    const owned = {
      id: `own_${winning.bidderId}_${seq.own++}`,
      title: auction.title,
      payload: auction.payload,
      encryptionLevel: auction.encryptionLevel,
      acquiredVia: "auction",
      acquiredFrom: auction.sellerId,
      pricePaid: winning.amount,
      acquiredAt: now,
    };
    ownedList.push(owned);
    // Reputation: winner +10, seller +5.
    const wRep = getRep(s, winning.bidderId);
    wRep.score += 10; wRep.purchases += 1; wRep.lastTradeAt = now;
    const sRep = getRep(s, auction.sellerId);
    sRep.score += 5; sRep.lastTradeAt = now;
    save();
    return {
      ok: true,
      result: { auction, sold: true, owned, winnerId: winning.bidderId },
    };
  });

  // ── [S] Haggle / negotiate dialogue with the fence ────────────────────

  /**
   * haggle — negotiate the price of an open auction with Sael. The fence
   * weighs the caller's offer against the listed price, scaled by the
   * caller's reputation (a trusted buyer gets a softer counter). Returns
   * a deterministic NPC counter-offer and a line of dialogue. Three
   * rounds per auction; the fence walks away after that.
   */
  registerLensAction("black-market", "haggle", (ctx, _artifact, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const auctionId = str(params.auctionId);
    if (!auctionId) return { ok: false, error: "auctionId required" };
    const offer = Math.round(num(params.offer, 0));
    if (offer <= 0) return { ok: false, error: "offer must be positive" };
    let auction = null;
    for (const list of s.auctions.values()) {
      const found = list.find((a) => a.id === auctionId);
      if (found) { auction = found; break; }
    }
    if (!auction) return { ok: false, error: "auction not found" };
    if (auction.status !== "open") return { ok: false, error: "auction closed" };
    if (auction.sellerId === uid) return { ok: false, error: "cannot haggle your own listing" };
    if (!auction.haggle) auction.haggle = {};
    const session = auction.haggle[uid] || { rounds: 0, settled: false };
    if (session.settled) return { ok: false, error: "haggle already concluded" };
    if (session.rounds >= 3) {
      return { ok: false, error: "the fence has walked away" };
    }
    const listPrice = auction.bids.length
      ? auction.bids[auction.bids.length - 1].amount
      : auction.minBid;
    const rep = getRep(s, uid);
    // Reputation softens the fence: discount room scales 5%..25%.
    const repFactor = Math.min(0.25, 0.05 + rep.score / 500);
    const floor = Math.round(listPrice * (1 - repFactor));
    session.rounds += 1;
    let accepted = false;
    let counter = listPrice;
    let line;
    if (offer >= listPrice) {
      accepted = true; counter = listPrice;
      line = "Generous. The intercept's yours at that.";
    } else if (offer >= floor) {
      accepted = true; counter = offer;
      line = "...Fine. You drive a hard bargain. Done.";
    } else {
      // Counter splits the gap between the offer and the list price.
      counter = Math.max(floor, Math.round((offer + listPrice) / 2));
      line = session.rounds >= 3
        ? `${counter} sparks. That's my last word — take it or leave it.`
        : `${counter} sparks. I've fences to feed, friend.`;
    }
    session.lastOffer = offer;
    session.lastCounter = counter;
    if (accepted) {
      session.settled = true;
      session.agreedPrice = counter;
    }
    auction.haggle[uid] = session;
    save();
    return {
      ok: true,
      result: {
        auctionId,
        round: session.rounds,
        roundsLeft: Math.max(0, 3 - session.rounds),
        offer,
        counter,
        accepted,
        agreedPrice: accepted ? counter : null,
        line,
      },
    };
  });

  /**
   * haggle-accept — accept the fence's standing counter-offer for an
   * auction the caller has haggled on. Transfers ownership at the
   * agreed price and credits reputation to both parties.
   */
  registerLensAction("black-market", "haggle-accept", (ctx, _artifact, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const auctionId = str(params.auctionId);
    if (!auctionId) return { ok: false, error: "auctionId required" };
    let auction = null;
    for (const list of s.auctions.values()) {
      const found = list.find((a) => a.id === auctionId);
      if (found) { auction = found; break; }
    }
    if (!auction) return { ok: false, error: "auction not found" };
    if (auction.status !== "open") return { ok: false, error: "auction closed" };
    const session = auction.haggle?.[uid];
    if (!session || session.lastCounter == null) {
      return { ok: false, error: "no standing counter-offer" };
    }
    const price = session.agreedPrice ?? session.lastCounter;
    const now = Date.now();
    auction.status = "settled";
    auction.winnerId = uid;
    auction.winningBid = price;
    auction.settledAt = now;
    auction.settledVia = "haggle";
    const seq = ensureSeq(s, uid);
    const ownedList = ensureList(s.owned, uid);
    const owned = {
      id: `own_${uid}_${seq.own++}`,
      title: auction.title,
      payload: auction.payload,
      encryptionLevel: auction.encryptionLevel,
      acquiredVia: "haggle",
      acquiredFrom: auction.sellerId,
      pricePaid: price,
      acquiredAt: now,
    };
    ownedList.push(owned);
    const bRep = getRep(s, uid);
    bRep.score += 8; bRep.purchases += 1; bRep.lastTradeAt = now;
    const sRep = getRep(s, auction.sellerId);
    sRep.score += 5; sRep.lastTradeAt = now;
    save();
    return { ok: true, result: { auction, owned, pricePaid: price } };
  });

  // ── [M] Player-to-player resale of purchased intercepts ───────────────

  /**
   * owned-list — intercepts the caller currently owns (won at auction,
   * haggled, or bought back). Resold items leave this list.
   */
  registerLensAction("black-market", "owned-list", (ctx) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.owned, actId(ctx))
      .slice()
      .sort((a, b) => b.acquiredAt - a.acquiredAt);
    return { ok: true, result: { owned: list, count: list.length } };
  });

  /**
   * resale-create — list an owned intercept for resale to other players.
   * Removes the item from the seller's owned inventory while listed.
   */
  registerLensAction("black-market", "resale-create", (ctx, _artifact, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const ownedId = str(params.ownedId);
    if (!ownedId) return { ok: false, error: "ownedId required" };
    const price = Math.round(num(params.price, 0));
    if (price <= 0) return { ok: false, error: "price must be positive" };
    const ownedList = ensureList(s.owned, uid);
    const idx = ownedList.findIndex((o) => o.id === ownedId);
    if (idx === -1) return { ok: false, error: "you do not own this intercept" };
    const item = ownedList.splice(idx, 1)[0];
    const seq = ensureSeq(s, uid);
    const resaleList = ensureList(s.resales, uid);
    const now = Date.now();
    const resale = {
      id: `res_${uid}_${seq.res++}`,
      sellerId: uid,
      sourceOwnedId: item.id,
      title: item.title,
      payload: item.payload,
      encryptionLevel: item.encryptionLevel,
      price,
      status: "listed",
      listedAt: now,
      originalPaid: item.pricePaid,
    };
    resaleList.push(resale);
    save();
    return { ok: true, result: { resale } };
  });

  /**
   * resale-market — all listed player-to-player resales the caller's
   * reputation has unlocked (excludes the caller's own listings from
   * the buy view).
   */
  registerLensAction("black-market", "resale-market", (ctx) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const r = getRep(s, uid);
    const mine = [];
    const market = [];
    for (const list of s.resales.values()) {
      for (const res of list) {
        if (res.status !== "listed") continue;
        if (res.sellerId === uid) { mine.push(res); continue; }
        if (r.score >= (TIER_REP_GATE[res.encryptionLevel] ?? 0)) {
          market.push(res);
        }
      }
    }
    market.sort((a, b) => b.listedAt - a.listedAt);
    mine.sort((a, b) => b.listedAt - a.listedAt);
    return { ok: true, result: { market, mine, repScore: r.score } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * resale-buy — buy another player's resale listing. Ownership transfers
   * to the buyer; both parties accrue reputation.
   */
  registerLensAction("black-market", "resale-buy", (ctx, _artifact, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const resaleId = str(params.resaleId);
    if (!resaleId) return { ok: false, error: "resaleId required" };
    let resale = null;
    for (const list of s.resales.values()) {
      const found = list.find((x) => x.id === resaleId);
      if (found) { resale = found; break; }
    }
    if (!resale) return { ok: false, error: "resale not found" };
    if (resale.status !== "listed") return { ok: false, error: "resale not available" };
    if (resale.sellerId === uid) return { ok: false, error: "cannot buy your own resale" };
    const r = getRep(s, uid);
    if (r.score < (TIER_REP_GATE[resale.encryptionLevel] ?? 0)) {
      return { ok: false, error: "reputation too low for this tier" };
    }
    const now = Date.now();
    resale.status = "sold";
    resale.buyerId = uid;
    resale.soldAt = now;
    const seq = ensureSeq(s, uid);
    const ownedList = ensureList(s.owned, uid);
    const owned = {
      id: `own_${uid}_${seq.own++}`,
      title: resale.title,
      payload: resale.payload,
      encryptionLevel: resale.encryptionLevel,
      acquiredVia: "resale",
      acquiredFrom: resale.sellerId,
      pricePaid: resale.price,
      acquiredAt: now,
    };
    ownedList.push(owned);
    const bRep = getRep(s, uid);
    bRep.score += 6; bRep.purchases += 1; bRep.lastTradeAt = now;
    const sRep = getRep(s, resale.sellerId);
    sRep.score += 4; sRep.lastTradeAt = now;
    save();
    return { ok: true, result: { resale, owned } };
  });

  // ── [S] Watchlist / alert when a matching intercept appears ───────────

  /**
   * watch-add — register a saved search. When an auction or resale whose
   * title/preview contains the keyword (and is within the price ceiling
   * and unlocked tier) appears, watch-check surfaces it as an alert.
   */
  registerLensAction("black-market", "watch-add", (ctx, _artifact, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const keyword = str(params.keyword).toLowerCase();
    if (!keyword) return { ok: false, error: "keyword required" };
    if (keyword.length > 60) return { ok: false, error: "keyword too long (max 60)" };
    const maxPrice = params.maxPrice != null
      ? Math.max(1, Math.round(num(params.maxPrice, 0)))
      : null;
    const tier = params.tier != null ? str(params.tier) : null;
    if (tier && !TIER_ORDER.includes(tier)) {
      return { ok: false, error: "tier invalid" };
    }
    const seq = ensureSeq(s, uid);
    const list = ensureList(s.watchlist, uid);
    if (list.some((w) => w.keyword === keyword && w.maxPrice === maxPrice && w.tier === tier)) {
      return { ok: false, error: "duplicate watch" };
    }
    const watch = {
      id: `wat_${uid}_${seq.wat++}`,
      keyword,
      maxPrice,
      tier,
      createdAt: Date.now(),
    };
    list.push(watch);
    save();
    return { ok: true, result: { watch } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * watch-list — the caller's saved searches.
   */
  registerLensAction("black-market", "watch-list", (ctx) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.watchlist, actId(ctx))
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, result: { watches: list, count: list.length } };
  });

  /**
   * watch-remove — delete a saved search.
   */
  registerLensAction("black-market", "watch-remove", (ctx, _artifact, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const watchId = str(params.watchId);
    if (!watchId) return { ok: false, error: "watchId required" };
    const list = ensureList(s.watchlist, uid);
    const idx = list.findIndex((w) => w.id === watchId);
    if (idx === -1) return { ok: false, error: "watch not found" };
    list.splice(idx, 1);
    save();
    return { ok: true, result: { removed: watchId } };
  });

  /**
   * watch-check — evaluate every saved search against the live market
   * (open auctions + listed resales) and return matching alerts. Only
   * tiers the caller's reputation has unlocked are considered.
   */
  registerLensAction("black-market", "watch-check", (ctx) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const watches = ensureList(s.watchlist, uid);
    const rep = getRep(s, uid);
    const now = Date.now();
    const candidates = [];
    for (const list of s.auctions.values()) {
      for (const a of list) {
        if (a.status !== "open" || a.endsAt <= now || a.sellerId === uid) continue;
        const top = a.bids.length ? a.bids[a.bids.length - 1].amount : a.minBid;
        candidates.push({
          kind: "auction", refId: a.id, title: a.title,
          text: `${a.title} ${a.preview}`.toLowerCase(),
          price: top, encryptionLevel: a.encryptionLevel,
        });
      }
    }
    for (const list of s.resales.values()) {
      for (const r of list) {
        if (r.status !== "listed" || r.sellerId === uid) continue;
        candidates.push({
          kind: "resale", refId: r.id, title: r.title,
          text: r.title.toLowerCase(),
          price: r.price, encryptionLevel: r.encryptionLevel,
        });
      }
    }
    const alerts = [];
    for (const w of watches) {
      for (const c of candidates) {
        if (!c.text.includes(w.keyword)) continue;
        if (w.maxPrice != null && c.price > w.maxPrice) continue;
        if (w.tier && c.encryptionLevel !== w.tier) continue;
        if (rep.score < (TIER_REP_GATE[c.encryptionLevel] ?? 0)) continue;
        alerts.push({
          watchId: w.id, keyword: w.keyword, kind: c.kind,
          refId: c.refId, title: c.title, price: c.price,
          encryptionLevel: c.encryptionLevel,
        });
      }
    }
    return { ok: true, result: { alerts, count: alerts.length, watchCount: watches.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Decryption mini-game for shadow-tier messages ─────────────────
  //
  // The payload of a shadow-tier intercept the caller owns is encrypted
  // with a deterministic per-character Caesar shift. The caller must
  // guess the shift to unlock the plaintext. Reputation accrues on a win.

  function caesar(text, shift) {
    let out = "";
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c >= 65 && c <= 90) out += String.fromCharCode(((c - 65 + shift) % 26) + 65);
      else if (c >= 97 && c <= 122) out += String.fromCharCode(((c - 97 + shift) % 26) + 97);
      else out += ch;
    }
    return out;
  }
  // Deterministic shift derived from the owned-item id so a session is
  // reproducible and not random/seeded sample data.
  function shiftFor(ownedId) {
    let h = 0;
    for (let i = 0; i < ownedId.length; i++) h = (h * 31 + ownedId.charCodeAt(i)) | 0;
    return (Math.abs(h) % 25) + 1; // 1..25, never 0 (which would be plaintext)
  }

  /**
   * decrypt-start — begin a decryption mini-game for a shadow-tier
   * intercept the caller owns. Returns the ciphertext and a frequency
   * hint (the most common letter in the ciphertext maps to the most
   * common letter in the plaintext).
   */
  registerLensAction("black-market", "decrypt-start", (ctx, _artifact, params = {}) => {
  try {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const ownedId = str(params.ownedId);
    if (!ownedId) return { ok: false, error: "ownedId required" };
    const item = ensureList(s.owned, uid).find((o) => o.id === ownedId);
    if (!item) return { ok: false, error: "you do not own this intercept" };
    if (item.encryptionLevel !== "shadow") {
      return { ok: false, error: "only shadow-tier intercepts need decryption" };
    }
    if (item.decrypted) return { ok: false, error: "already decrypted" };
    const shift = shiftFor(ownedId);
    const cipher = caesar(item.payload, shift);
    if (!s.decryptions.has(uid)) s.decryptions.set(uid, new Map());
    const sessions = s.decryptions.get(uid);
    sessions.set(ownedId, { shift, attempts: 0, solved: false, startedAt: Date.now() });
    // Frequency hint: most common alpha char in the cipher.
    const freq = {};
    for (const ch of cipher.toUpperCase()) {
      if (ch >= "A" && ch <= "Z") freq[ch] = (freq[ch] || 0) + 1;
    }
    const hintChar = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    save();
    return {
      ok: true,
      result: {
        ownedId,
        ciphertext: cipher,
        hint: hintChar
          ? `The most common letter '${hintChar}' likely decrypts to 'E'.`
          : "No frequency hint available.",
        shiftRange: [1, 25],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * decrypt-guess — submit a shift guess for an active decryption
   * session. A correct guess unlocks the plaintext and awards
   * reputation; a wrong guess is tracked (fewer attempts = more rep).
   */
  registerLensAction("black-market", "decrypt-guess", (ctx, _artifact, params = {}) => {
    const s = getState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const uid = actId(ctx);
    const ownedId = str(params.ownedId);
    if (!ownedId) return { ok: false, error: "ownedId required" };
    const guess = Math.round(num(params.shift, -1));
    if (guess < 1 || guess > 25) return { ok: false, error: "shift must be 1..25" };
    const sessions = s.decryptions.get(uid);
    const session = sessions?.get(ownedId);
    if (!session) return { ok: false, error: "no active decryption session" };
    if (session.solved) return { ok: false, error: "already solved" };
    session.attempts += 1;
    if (guess !== session.shift) {
      const direction = guess < session.shift ? "higher" : "lower";
      save();
      return {
        ok: true,
        result: {
          ownedId,
          correct: false,
          attempts: session.attempts,
          hint: `Wrong key. Try a ${direction} shift.`,
        },
      };
    }
    // Correct: unlock the plaintext.
    session.solved = true;
    session.solvedAt = Date.now();
    const item = ensureList(s.owned, uid).find((o) => o.id === ownedId);
    if (item) { item.decrypted = true; item.decryptedAt = session.solvedAt; }
    // Reward scales inversely with attempts: 1 try = +20, capped floor +5.
    const reward = Math.max(5, 21 - session.attempts);
    const rep = getRep(s, uid);
    rep.score += reward;
    rep.lastTradeAt = session.solvedAt;
    save();
    return {
      ok: true,
      result: {
        ownedId,
        correct: true,
        attempts: session.attempts,
        plaintext: item ? item.payload : null,
        repAwarded: reward,
        newRepScore: rep.score,
      },
    };
  });
}
