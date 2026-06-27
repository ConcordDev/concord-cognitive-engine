// server/domains/auctions.js
//
// Macro surface for the auction house (`/lenses/auction`).
//
// The lens itself drives the REST routes in server.js (`/api/auctions/*`),
// but those routes are thin wrappers over server/lib/auctions.js. This file
// exposes the SAME lib functions as registered macros so:
//   - the Orchestrated Invariant Engine (macro-assassin) can drive the
//     auction read/compute paths adversarially against a real DB, and
//   - the generic lens shell / ⌘K / mobile MacroClient can reach auctions
//     through the uniform `POST /api/lens/run { domain:"auctions", name, input }`
//     path without bespoke endpoints.
//
// Every macro delegates to the real lib — no logic is duplicated here. Read
// macros (active / buy_orders / price_history / market_depth / get) are pure
// reads and headless-safe; write macros (create / bid / place_buy_order /
// fill_buy_order / cancel_buy_order / cancel) validate inputs and return a
// clean { ok:false, reason } envelope rather than throwing.

import {
  createAuction,
  placeBid,
  cancelAuction,
  getAuction,
  listActiveAuctions,
  placeBuyOrder,
  fillBuyOrder,
  cancelBuyOrder,
  listOpenBuyOrders,
  getPriceHistory,
  getMarketDepth,
} from "../lib/auctions.js";

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.user?.id || ctx?.user?.userId || null;
}

export default function registerAuctionMacros(register) {
  // ── reads (headless-safe) ──────────────────────────────────────────────

  /** auctions.active — list live auctions ending soonest. input: { limit? } */
  register("auctions", "active", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    return { ok: true, auctions: listActiveAuctions(db, { limit }) };
  }, { note: "list active auctions (ends-soonest first)" });

  /** auctions.get — one auction + recent bids. input: { auctionId } */
  register("auctions", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.auctionId) return { ok: false, reason: "no_auction_id" };
    const auction = getAuction(db, String(input.auctionId));
    if (!auction) return { ok: false, reason: "no_auction" };
    return { ok: true, auction };
  }, { note: "get auction detail + recent bids" });

  /** auctions.buy_orders — open EVE-style buy orders. input: { worldId?, itemDescriptor?, limit? } */
  register("auctions", "buy_orders", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 500);
    return {
      ok: true,
      buyOrders: listOpenBuyOrders(db, {
        worldId: input.worldId,
        itemDescriptor: input.itemDescriptor,
        limit,
      }),
    };
  }, { note: "list open buy orders (price-desc)" });

  /** auctions.price_history — per-item sale time series + stats. input: { itemId, limit? } */
  register("auctions", "price_history", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.itemId) return { ok: false, reason: "no_item_id" };
    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
    return { ok: true, ...getPriceHistory(db, String(input.itemId), { limit }) };
  }, { note: "per-item sale price-history + stats" });

  /** auctions.market_depth — order-book asks/bids/spread for an item. input: { itemId } */
  register("auctions", "market_depth", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.itemId) return { ok: false, reason: "no_item_id" };
    return { ok: true, ...getMarketDepth(db, String(input.itemId)) };
  }, { note: "order-book depth (asks/bids/spread)" });

  // ── writes (validate-and-delegate) ─────────────────────────────────────

  /** auctions.create — list an item for auction. input: { itemKind, itemId, startCc?, buyoutCc?, durationS?, title?, worldId? } */
  register("auctions", "create", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const r = createAuction(db, userId, input);
    return r.ok ? r : { ok: false, reason: r.error || "create_failed" };
  }, { note: "create an auction listing" });

  /** auctions.bid — place a bid (buyout instant-settles). input: { auctionId, amountCc } */
  register("auctions", "bid", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.auctionId) return { ok: false, reason: "no_auction_id" };
    const r = placeBid(db, String(input.auctionId), userId, input.amountCc);
    return r.ok ? r : { ok: false, reason: r.error || "bid_failed" };
  }, { note: "place a bid (buyout instant-settles)" });

  /** auctions.cancel — seller cancels a no-bid auction. input: { auctionId } */
  register("auctions", "cancel", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.auctionId) return { ok: false, reason: "no_auction_id" };
    const r = cancelAuction(db, String(input.auctionId), userId);
    return r.ok ? r : { ok: false, reason: r.error || "cancel_failed" };
  }, { note: "seller cancels a no-bid auction" });

  /** auctions.place_buy_order — escrow CC for a buy order. input: { itemDescriptor, unitPriceCc, quantity, itemKind?, worldId?, ttlSeconds? } */
  register("auctions", "place_buy_order", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const r = placeBuyOrder(db, userId, {
      ...input,
      unitPriceCc: Number(input.unitPriceCc),
      quantity: Number(input.quantity),
    });
    return r.ok ? r : { ok: false, reason: r.error || "place_buy_order_failed" };
  }, { note: "escrow CC and post a buy order" });

  /** auctions.fill_buy_order — seller fills a buy order. input: { buyOrderId, quantity } */
  register("auctions", "fill_buy_order", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.buyOrderId) return { ok: false, reason: "no_buy_order_id" };
    const r = fillBuyOrder(db, String(input.buyOrderId), userId, Number(input.quantity) || 1);
    return r.ok ? r : { ok: false, reason: r.error || "fill_failed" };
  }, { note: "seller fills a buy order from inventory" });

  /** auctions.cancel_buy_order — buyer cancels + refunds unfilled. input: { buyOrderId } */
  register("auctions", "cancel_buy_order", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.buyOrderId) return { ok: false, reason: "no_buy_order_id" };
    const r = cancelBuyOrder(db, String(input.buyOrderId), userId);
    return r.ok ? r : { ok: false, reason: r.error || "cancel_failed" };
  }, { note: "buyer cancels a buy order (refund unfilled)" });
}
