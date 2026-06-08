// domains/service-market.js
//
// Service Marketplace — a peer-to-peer marketplace of SERVICE LISTINGS and
// ORDERS placed against them. This is NOT the salon/booking-shaped `services`
// domain (which models appointment grids, shifts, POS payments). A provider
// posts a listing (title / price / category); a buyer places an order against a
// listing; orders move pending → accepted → completed.
//
// Backs the de-demo'd `ServiceMarketplace.tsx` world-lens panel: the panel
// renders ONLY what real users have created here — it starts empty (no
// fabricated rows) and fills as listings/orders are made.
//
// Storage: in-memory STATE Maps (NO migrations). Per-user scope via
// ctx.actor.userId, but listings are a SHARED catalog (a buyer must be able to
// order another provider's listing) so the listing/order stores key by the
// entity id, not by user; each row carries its provider/buyer userId and the
// handlers gate on those.
//
// Invocation shapes (both supported by the same handler signature):
//   • test harness  lensRun("service-market", "listing-create", { params })
//       → handler(ctx, { data: params }, params)
//   • HTTP /api/lens/run { domain, action, input }
//       → handler(ctx, { domain, data: input }, input)
// Either way `params` carries the call input, so handlers read from `params`.

export default function registerServiceMarketActions(registerLensAction) {
  /* ---- STATE-backed stores (no migrations) ------------------------------ */
  function smStore() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    STATE.serviceListings ??= new Map(); // listingId -> Listing
    STATE.serviceOrders ??= new Map();   // orderId   -> Order
    return STATE;
  }
  const actorId = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const smId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Order status state machine. A status may only advance to a declared next
  // status (or be cancelled from any non-terminal status).
  const ORDER_TRANSITIONS = {
    pending: ["accepted", "cancelled"],
    accepted: ["in_progress", "completed", "cancelled"],
    in_progress: ["delivered", "completed", "cancelled"],
    delivered: ["completed"],
    completed: [],
    cancelled: [],
  };
  const ORDER_STATUSES = Object.keys(ORDER_TRANSITIONS);

  /* ====================================================================== */
  /*  LISTINGS                                                               */
  /* ====================================================================== */

  registerLensAction("service-market", "listing-create", (ctx, _artifact, params) => {
    try {
      const STATE = smStore();
      const provider = actorId(ctx);
      const p = params || {};
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const price = Number(p.price);
      if (!Number.isFinite(price) || price < 0) return { ok: false, error: "price required (>= 0)" };
      const category = String(p.category || "").trim();
      if (!category) return { ok: false, error: "category required" };
      const listing = {
        id: smId("sl"),
        provider,
        title,
        price: Math.round(price * 100) / 100,
        priceUnit: String(p.priceUnit || "per project"),
        category,
        description: String(p.description || ""),
        fullDescription: String(p.fullDescription || p.description || ""),
        deliveryHours: Math.max(0, Number(p.deliveryHours) || 0),
        portfolio: Array.isArray(p.portfolio) ? p.portfolio.map(String) : [],
        status: "active",
        createdAt: new Date().toISOString(),
      };
      STATE.serviceListings.set(listing.id, listing);
      return { ok: true, result: { listing } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("service-market", "listing-list", (ctx, _artifact, params) => {
    try {
      const STATE = smStore();
      const p = params || {};
      let list = [...STATE.serviceListings.values()];
      if (p.category && p.category !== "All") {
        list = list.filter((l) => l.category === String(p.category));
      }
      if (p.provider) {
        list = list.filter((l) => l.provider === String(p.provider));
      }
      if (p.mine) {
        const me = actorId(ctx);
        list = list.filter((l) => l.provider === me);
      }
      const q = String(p.query || "").trim().toLowerCase();
      if (q) {
        list = list.filter((l) =>
          l.title.toLowerCase().includes(q) ||
          l.provider.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q) ||
          l.category.toLowerCase().includes(q));
      }
      const sort = String(p.sort || "recent");
      if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
      else if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
      else if (sort === "delivery") list.sort((a, b) => a.deliveryHours - b.deliveryHours);
      else if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
      else list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")); // recent
      const categories = [...new Set([...STATE.serviceListings.values()].map((l) => l.category))].sort();
      return { ok: true, result: { listings: list, count: list.length, categories } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("service-market", "listing-get", (ctx, _artifact, params) => {
    try {
      const STATE = smStore();
      const listing = STATE.serviceListings.get((params || {}).id);
      if (!listing) return { ok: false, error: "listing not found" };
      return { ok: true, result: { listing } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("service-market", "listing-delete", (ctx, _artifact, params) => {
    try {
      const STATE = smStore();
      const me = actorId(ctx);
      const id = (params || {}).id;
      const listing = STATE.serviceListings.get(id);
      if (!listing) return { ok: false, error: "listing not found" };
      if (listing.provider !== me) return { ok: false, error: "forbidden: not listing owner" };
      STATE.serviceListings.delete(id);
      return { ok: true, result: { deleted: true, id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ====================================================================== */
  /*  ORDERS                                                                 */
  /* ====================================================================== */

  registerLensAction("service-market", "order-create", (ctx, _artifact, params) => {
    try {
      const STATE = smStore();
      const buyer = actorId(ctx);
      const p = params || {};
      const listing = STATE.serviceListings.get(p.listingId);
      if (!listing) return { ok: false, error: "listing not found" };
      if (listing.provider === buyer) return { ok: false, error: "cannot order your own listing" };
      const quantity = Math.max(1, Math.floor(Number(p.quantity) || 1));
      const total = Math.round(listing.price * quantity * 100) / 100;
      const order = {
        id: smId("so"),
        listingId: listing.id,
        listingTitle: listing.title,
        provider: listing.provider,
        buyer,
        unitPrice: listing.price,
        quantity,
        total,
        requirements: String(p.requirements || ""),
        status: "pending",
        review: null,
        createdAt: new Date().toISOString(),
      };
      STATE.serviceOrders.set(order.id, order);
      return { ok: true, result: { order } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("service-market", "order-list", (ctx, _artifact, params) => {
    try {
      const STATE = smStore();
      const me = actorId(ctx);
      const p = params || {};
      const role = String(p.role || "buyer"); // "buyer" | "seller" | "all"
      let list = [...STATE.serviceOrders.values()];
      if (role === "buyer") list = list.filter((o) => o.buyer === me);
      else if (role === "seller") list = list.filter((o) => o.provider === me);
      // role === "all" → leave unfiltered (admin/debug view)
      if (p.status) list = list.filter((o) => o.status === String(p.status));
      list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return { ok: true, result: { orders: list, count: list.length, role } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("service-market", "order-update-status", (ctx, _artifact, params) => {
    try {
      const STATE = smStore();
      const me = actorId(ctx);
      const p = params || {};
      const order = STATE.serviceOrders.get(p.id);
      if (!order) return { ok: false, error: "order not found" };
      if (order.buyer !== me && order.provider !== me) {
        return { ok: false, error: "forbidden: not a party to this order" };
      }
      const next = String(p.status || "");
      if (!ORDER_STATUSES.includes(next)) return { ok: false, error: "invalid status" };
      const allowed = ORDER_TRANSITIONS[order.status] || [];
      if (!allowed.includes(next)) {
        return { ok: false, error: `invalid transition ${order.status} -> ${next}` };
      }
      order.status = next;
      order.updatedAt = new Date().toISOString();
      return { ok: true, result: { order } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ====================================================================== */
  /*  SUMMARY                                                                */
  /* ====================================================================== */

  registerLensAction("service-market", "market-summary", (ctx, _artifact, _params) => {
    try {
      const STATE = smStore();
      const listings = [...STATE.serviceListings.values()];
      const orders = [...STATE.serviceOrders.values()];
      const grossByStatus = {};
      for (const s of ORDER_STATUSES) grossByStatus[s] = 0;
      for (const o of orders) {
        grossByStatus[o.status] = Math.round(((grossByStatus[o.status] || 0) + o.total) * 100) / 100;
      }
      const grossTotal = Math.round(orders.reduce((sum, o) => sum + o.total, 0) * 100) / 100;
      const byCategory = {};
      for (const l of listings) byCategory[l.category] = (byCategory[l.category] || 0) + 1;
      return {
        ok: true,
        result: {
          listingCount: listings.length,
          orderCount: orders.length,
          grossByStatus,
          grossTotal,
          listingsByCategory: byCategory,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
