// server/domains/marketplace.js
export default function registerMarketplaceActions(registerLensAction) {
  registerLensAction("marketplace", "listingScore", (ctx, artifact, _params) => {
    const listing = artifact.data || {};
    const title = listing.title || "";
    const description = listing.description || "";
    const images = listing.images || listing.imageCount || 0;
    const imgCount = Array.isArray(images) ? images.length : parseInt(images) || 0;
    const price = parseFloat(listing.price) || 0;
    const titleScore = Math.min(30, Math.round((Math.min(title.length, 80) / 80) * 30));
    const descScore = Math.min(25, Math.round((Math.min(description.length, 500) / 500) * 25));
    const imgScore = Math.min(25, imgCount * 5);
    const priceScore = price > 0 ? 20 : 0;
    const total = titleScore + descScore + imgScore + priceScore;
    const tips = [];
    if (titleScore < 20) tips.push("Lengthen title to 40-80 characters with keywords");
    if (descScore < 15) tips.push("Add more detail to description (300+ chars recommended)");
    if (imgScore < 15) tips.push("Add more images (5+ recommended)");
    if (priceScore === 0) tips.push("Set a price to improve visibility");
    return { ok: true, result: { score: total, maxScore: 100, rating: total >= 80 ? "Excellent" : total >= 60 ? "Good" : total >= 40 ? "Fair" : "Poor", breakdown: { title: titleScore, description: descScore, images: imgScore, price: priceScore }, tips } };
  });

  registerLensAction("marketplace", "priceOptimize", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const currentPrice = parseFloat(data.price) || 0;
    const competitors = data.competitors || data.comparables || [];
    const cost = parseFloat(data.cost) || 0;
    if (competitors.length === 0) return { ok: true, result: { message: "Add competitor prices to optimize against.", currentPrice, margin: cost > 0 ? Math.round(((currentPrice - cost) / currentPrice) * 100) : null } };
    const prices = competitors.map(c => parseFloat(c.price || c) || 0).filter(p => p > 0);
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const median = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
    const suggestedPrice = Math.round(median * 0.95 * 100) / 100;
    const margin = cost > 0 ? Math.round(((suggestedPrice - cost) / suggestedPrice) * 100) : null;
    return { ok: true, result: { currentPrice, suggestedPrice, competitorStats: { count: prices.length, avg: Math.round(avg * 100) / 100, min, max, median }, positioning: currentPrice > avg ? "above-market" : currentPrice < avg * 0.8 ? "budget" : "competitive", margin, priceRange: { aggressive: Math.round(min * 0.95 * 100) / 100, competitive: suggestedPrice, premium: Math.round(avg * 1.15 * 100) / 100 } } };
  });

  registerLensAction("marketplace", "sellerMetrics", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const orders = data.orders || data.sales || [];
    const reviews = data.reviews || [];
    if (orders.length === 0) return { ok: true, result: { message: "Add order/sales data to compute seller metrics." } };
    const totalRevenue = orders.reduce((s, o) => s + (parseFloat(o.amount || o.total || o.price) || 0), 0);
    const avgOrderValue = totalRevenue / orders.length;
    const returned = orders.filter(o => o.returned || o.refunded).length;
    const fulfilled = orders.filter(o => o.shipped || o.fulfilled || o.delivered).length;
    const avgRating = reviews.length > 0 ? Math.round((reviews.reduce((s, r) => s + (parseFloat(r.rating) || 0), 0) / reviews.length) * 10) / 10 : null;
    const responseTimes = orders.map(o => parseFloat(o.responseHours || o.responseTime) || 0).filter(t => t > 0);
    const avgResponse = responseTimes.length > 0 ? Math.round((responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length) * 10) / 10 : null;
    return { ok: true, result: { totalOrders: orders.length, totalRevenue: Math.round(totalRevenue * 100) / 100, avgOrderValue: Math.round(avgOrderValue * 100) / 100, fulfillmentRate: Math.round((fulfilled / orders.length) * 100), returnRate: Math.round((returned / orders.length) * 100), avgRating, avgResponseHours: avgResponse, sellerLevel: avgRating >= 4.5 && (returned / orders.length) < 0.05 ? "Top Seller" : avgRating >= 4.0 ? "Trusted" : "Standard" } };
  });

  registerLensAction("marketplace", "marketTrend", (ctx, artifact, _params) => {
    const listings = artifact.data?.listings || artifact.data?.history || [];
    if (listings.length < 3) return { ok: true, result: { message: "Need 3+ listing records to analyze trends." } };
    const byCategory = {};
    listings.forEach(l => {
      const cat = l.category || "General";
      if (!byCategory[cat]) byCategory[cat] = { prices: [], count: 0, dates: [] };
      byCategory[cat].prices.push(parseFloat(l.price) || 0);
      byCategory[cat].count++;
      if (l.date) byCategory[cat].dates.push(new Date(l.date).getTime());
    });
    const trends = Object.entries(byCategory).map(([category, data]) => {
      const avgPrice = data.prices.reduce((s, p) => s + p, 0) / data.prices.length;
      const firstHalf = data.prices.slice(0, Math.floor(data.prices.length / 2));
      const secondHalf = data.prices.slice(Math.floor(data.prices.length / 2));
      const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, p) => s + p, 0) / firstHalf.length : 0;
      const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, p) => s + p, 0) / secondHalf.length : 0;
      const priceChange = firstAvg > 0 ? Math.round(((secondAvg - firstAvg) / firstAvg) * 100) : 0;
      return { category, listingCount: data.count, avgPrice: Math.round(avgPrice * 100) / 100, priceChange, trend: priceChange > 5 ? "rising" : priceChange < -5 ? "falling" : "stable" };
    }).sort((a, b) => b.listingCount - a.listingCount);
    return { ok: true, result: { totalListings: listings.length, categories: trends.length, trends, hottest: trends.filter(t => t.trend === "rising").map(t => t.category), declining: trends.filter(t => t.trend === "falling").map(t => t.category) } };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Etsy + Bandcamp 2026 parity — shop, listings, orders, stats,
  //  search visibility, marketplace insights, promotions, AI.
  // ═══════════════════════════════════════════════════════════════

  function getStoreState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.marketplaceLens) {
      STATE.marketplaceLens = {
        shops: new Map(),           // userId -> Shop (one per user)
        listings: new Map(),        // userId -> Array<Listing>
        orders: new Map(),          // userId -> Array<Order> (as seller)
        views: new Map(),           // userId -> Map<listingId, ViewLog>
        impressions: new Map(),     // userId -> Map<listingId, Map<keyword, { impressions, clicks }>>
        promotions: new Map(),      // userId -> Array<Promotion>
        savedSearches: new Map(),   // userId -> Array<SavedSearch>
        seq: new Map(),             // userId -> { lst, ord, prom, srch }
      };
    }
    return STATE.marketplaceLens;
  }
  function saveStore() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) {} } }
  function aidS(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uidS(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoS() { return new Date().toISOString(); }
  function dayS() { return new Date().toISOString().slice(0, 10); }
  function arrayB(map, k) { if (!map.has(k)) map.set(k, []); return map.get(k); }
  function mapBS(map, k) { if (!map.has(k)) map.set(k, new Map()); return map.get(k); }
  function ensureSeqS(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { lst: 1, ord: 1, prom: 1, srch: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['lst','ord','prom','srch']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  // ── Shop (one storefront per user) ────────────────────────────

  registerLensAction("marketplace", "shop-get", (ctx, _a, _p = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    let shop = s.shops.get(userId);
    if (!shop) {
      shop = {
        id: uidS("shop"),
        ownerId: userId,
        name: `${(ctx?.actor?.displayName || userId).split('@')[0]}'s shop`,
        slug: String(userId).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20),
        tagline: "",
        bio: "",
        currency: "USD",
        country: "",
        bannerUrl: "",
        avatarUrl: "",
        socials: { web: "", instagram: "", twitter: "" },
        policies: { shipping: "", returns: "", custom: "" },
        active: true,
        createdAt: isoS(),
      };
      s.shops.set(userId, shop);
      saveStore();
    }
    return { ok: true, result: { shop } };
  });

  registerLensAction("marketplace", "shop-update", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    if (!s.shops.has(userId)) {
      // auto-bootstrap via shop-get path
      s.shops.set(userId, { id: uidS("shop"), ownerId: userId, name: 'New shop', slug: userId, tagline: '', bio: '', currency: 'USD', country: '', bannerUrl: '', avatarUrl: '', socials: { web: '', instagram: '', twitter: '' }, policies: { shipping: '', returns: '', custom: '' }, active: true, createdAt: isoS() });
    }
    const shop = s.shops.get(userId);
    for (const k of ['name','tagline','bio','currency','country','bannerUrl','avatarUrl','slug']) {
      if (typeof params[k] === 'string') shop[k] = params[k];
    }
    if (params.socials && typeof params.socials === 'object') {
      for (const k of ['web','instagram','twitter']) if (typeof params.socials[k] === 'string') shop.socials[k] = params.socials[k];
    }
    if (params.policies && typeof params.policies === 'object') {
      for (const k of ['shipping','returns','custom']) if (typeof params.policies[k] === 'string') shop.policies[k] = params.policies[k];
    }
    if (typeof params.active === 'boolean') shop.active = params.active;
    saveStore();
    return { ok: true, result: { shop } };
  });

  // ── Listings ──────────────────────────────────────────────────

  const LISTING_KINDS = ['digital_download', 'physical_good', 'service', 'subscription', 'music_track', 'music_album', 'merch_apparel', 'merch_print', 'merch_vinyl', 'merch_other'];

  registerLensAction("marketplace", "listings-list", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const status = ['published','draft','archived','all'].includes(params.status) ? params.status : 'all';
    let list = arrayB(s.listings, userId);
    if (status !== 'all') list = list.filter(l => l.status === status);
    return { ok: true, result: { listings: list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) } };
  });

  registerLensAction("marketplace", "listings-create", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const title = String(params.title || "").trim();
    const priceUsd = Number(params.priceUsd);
    if (!title || !Number.isFinite(priceUsd) || priceUsd < 0) return { ok: false, error: "title + non-negative priceUsd required" };
    const seq = ensureSeqS(s, userId);
    const listing = {
      id: uidS("lst"),
      number: `L-${String(seq.lst).padStart(5, '0')}`,
      ownerId: userId,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60),
      kind: LISTING_KINDS.includes(params.kind) ? params.kind : 'digital_download',
      priceUsd,
      currency: String(params.currency || 'USD'),
      description: String(params.description || ""),
      tags: Array.isArray(params.tags) ? params.tags.map(String).slice(0, 13) : [],
      images: Array.isArray(params.images) ? params.images.map(String).slice(0, 10) : [],
      stockQty: Number.isFinite(Number(params.stockQty)) ? Number(params.stockQty) : null, // null = unlimited (digital)
      shippingCostUsd: Number(params.shippingCostUsd) || 0,
      status: 'draft',
      createdAt: isoS(),
      publishedAt: null,
    };
    seq.lst++;
    arrayB(s.listings, userId).push(listing);
    saveStore();
    return { ok: true, result: { listing } };
  });

  registerLensAction("marketplace", "listings-update", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const l = arrayB(s.listings, userId).find(x => x.id === String(params.id || ""));
    if (!l) return { ok: false, error: "listing not found" };
    for (const k of ['title','description','currency']) if (typeof params[k] === 'string') l[k] = params[k];
    if (Number.isFinite(Number(params.priceUsd))) l.priceUsd = Number(params.priceUsd);
    if (Number.isFinite(Number(params.shippingCostUsd))) l.shippingCostUsd = Number(params.shippingCostUsd);
    if (params.stockQty === null || Number.isFinite(Number(params.stockQty))) l.stockQty = params.stockQty === null ? null : Number(params.stockQty);
    if (Array.isArray(params.tags)) l.tags = params.tags.map(String).slice(0, 13);
    if (Array.isArray(params.images)) l.images = params.images.map(String).slice(0, 10);
    if (LISTING_KINDS.includes(params.kind)) l.kind = params.kind;
    saveStore();
    return { ok: true, result: { listing: l } };
  });

  registerLensAction("marketplace", "listings-publish", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const l = arrayB(s.listings, aidS(ctx)).find(x => x.id === String(params.id || ""));
    if (!l) return { ok: false, error: "listing not found" };
    if (!l.title || l.priceUsd < 0) return { ok: false, error: "listing missing title or price" };
    l.status = 'published';
    l.publishedAt = l.publishedAt || isoS();
    saveStore();
    return { ok: true, result: { listing: l } };
  });

  registerLensAction("marketplace", "listings-unpublish", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const l = arrayB(s.listings, aidS(ctx)).find(x => x.id === String(params.id || ""));
    if (!l) return { ok: false, error: "listing not found" };
    l.status = 'draft';
    saveStore();
    return { ok: true, result: { listing: l } };
  });

  registerLensAction("marketplace", "listings-delete", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = arrayB(s.listings, aidS(ctx));
    const i = list.findIndex(x => x.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "listing not found" };
    list.splice(i, 1);
    saveStore();
    return { ok: true, result: { deleted: true } };
  });

  // ── Orders ────────────────────────────────────────────────────

  registerLensAction("marketplace", "orders-list", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ['pending','paid','shipped','delivered','refunded','all'].includes(params.status) ? params.status : 'all';
    let list = arrayB(s.orders, aidS(ctx));
    if (status !== 'all') list = list.filter(o => o.status === status);
    return { ok: true, result: { orders: list.slice().sort((a, b) => (b.placedAt || '').localeCompare(a.placedAt || '')) } };
  });

  registerLensAction("marketplace", "orders-create", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const listingId = String(params.listingId || "");
    const listing = arrayB(s.listings, userId).find(l => l.id === listingId);
    if (!listing) return { ok: false, error: "listing not found" };
    if (listing.status !== 'published') return { ok: false, error: "listing not published" };
    const qty = Math.max(1, Number(params.qty) || 1);
    if (listing.stockQty !== null && qty > listing.stockQty) return { ok: false, error: `only ${listing.stockQty} in stock` };
    const buyerName = String(params.buyerName || "Guest");
    const buyerEmail = String(params.buyerEmail || "");
    const subtotal = listing.priceUsd * qty;
    const shipping = listing.shippingCostUsd * (listing.kind.startsWith('merch_') || listing.kind === 'physical_good' ? 1 : 0);
    const total = subtotal + shipping;
    const seq = ensureSeqS(s, userId);
    const order = {
      id: uidS("ord"),
      number: `O-${String(seq.ord).padStart(5, '0')}`,
      sellerId: userId,
      listingId, listingTitle: listing.title, listingKind: listing.kind,
      qty,
      unitPriceUsd: listing.priceUsd,
      subtotalUsd: Math.round(subtotal * 100) / 100,
      shippingUsd: Math.round(shipping * 100) / 100,
      totalUsd: Math.round(total * 100) / 100,
      buyerName, buyerEmail,
      buyerAddress: String(params.buyerAddress || ""),
      status: 'paid',
      placedAt: isoS(),
      shippedAt: null,
      deliveredAt: null,
      trackingNumber: '',
      notes: String(params.notes || ""),
    };
    seq.ord++;
    arrayB(s.orders, userId).push(order);
    if (listing.stockQty !== null) listing.stockQty -= qty;
    saveStore();
    return { ok: true, result: { order } };
  });

  registerLensAction("marketplace", "orders-mark-shipped", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const o = arrayB(s.orders, aidS(ctx)).find(x => x.id === String(params.id || ""));
    if (!o) return { ok: false, error: "order not found" };
    if (o.status === 'delivered' || o.status === 'refunded') return { ok: false, error: "order already closed" };
    o.status = 'shipped';
    o.shippedAt = isoS();
    o.trackingNumber = String(params.trackingNumber || "");
    o.carrier = String(params.carrier || "");
    saveStore();
    return { ok: true, result: { order: o } };
  });

  registerLensAction("marketplace", "orders-mark-delivered", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const o = arrayB(s.orders, aidS(ctx)).find(x => x.id === String(params.id || ""));
    if (!o) return { ok: false, error: "order not found" };
    o.status = 'delivered';
    o.deliveredAt = isoS();
    saveStore();
    return { ok: true, result: { order: o } };
  });

  registerLensAction("marketplace", "orders-refund", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const o = arrayB(s.orders, aidS(ctx)).find(x => x.id === String(params.id || ""));
    if (!o) return { ok: false, error: "order not found" };
    if (o.status === 'refunded') return { ok: false, error: "already refunded" };
    o.status = 'refunded';
    o.refundedAt = isoS();
    o.refundReason = String(params.reason || "");
    // restock
    const listing = arrayB(s.listings, aidS(ctx)).find(l => l.id === o.listingId);
    if (listing && listing.stockQty !== null) listing.stockQty += o.qty;
    saveStore();
    return { ok: true, result: { order: o } };
  });

  // ── Analytics (Etsy Stats — Visits / Views / Orders / Revenue) ─

  registerLensAction("marketplace", "analytics-track-view", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const listingId = String(params.listingId || "");
    if (!listingId) return { ok: false, error: "listingId required" };
    const map = mapBS(s.views, userId);
    if (!map.has(listingId)) map.set(listingId, { views: 0, visits: 0, ts: [] });
    const v = map.get(listingId);
    v.views++;
    if (params.uniqueVisit) v.visits++;
    v.ts.push(Date.now());
    if (v.ts.length > 1000) v.ts = v.ts.slice(-1000);
    saveStore();
    return { ok: true, result: { listingId, views: v.views, visits: v.visits } };
  });

  registerLensAction("marketplace", "analytics-summary", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const days = Math.max(1, Math.min(365, Number(params.days) || 30));
    const cutoff = Date.now() - days * 86_400_000;
    const orders = arrayB(s.orders, userId).filter(o => new Date(o.placedAt).getTime() >= cutoff && o.status !== 'refunded');
    const revenue = orders.reduce((sum, o) => sum + o.totalUsd, 0);
    const viewsMap = mapBS(s.views, userId);
    let views = 0, visits = 0;
    for (const v of viewsMap.values()) {
      views += v.ts.filter(t => t >= cutoff).length;
      // approximate visits = views * 0.7 if not tracked separately
      visits += v.visits || 0;
    }
    if (visits === 0) visits = Math.round(views * 0.7);
    const conversionRate = visits > 0 ? Math.round((orders.length / visits) * 10000) / 100 : 0;
    const aov = orders.length > 0 ? Math.round((revenue / orders.length) * 100) / 100 : 0;

    // 28-day series for sparkline
    const byDay = new Array(days).fill(0).map((_, i) => {
      const dStart = Date.now() - (days - 1 - i) * 86_400_000;
      const dEnd = dStart + 86_400_000;
      const dayOrders = orders.filter(o => { const t = new Date(o.placedAt).getTime(); return t >= dStart && t < dEnd; });
      return {
        date: new Date(dStart).toISOString().slice(0, 10),
        orders: dayOrders.length,
        revenue: Math.round(dayOrders.reduce((s, o) => s + o.totalUsd, 0) * 100) / 100,
      };
    });

    return {
      ok: true,
      result: {
        days,
        visits,
        views,
        orderCount: orders.length,
        revenueUsd: Math.round(revenue * 100) / 100,
        avgOrderValueUsd: aov,
        conversionRatePct: conversionRate,
        series: byDay,
      },
    };
  });

  registerLensAction("marketplace", "analytics-by-listing", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const days = Math.max(1, Math.min(365, Number(params.days) || 30));
    const cutoff = Date.now() - days * 86_400_000;
    const listings = arrayB(s.listings, userId);
    const orders = arrayB(s.orders, userId).filter(o => new Date(o.placedAt).getTime() >= cutoff && o.status !== 'refunded');
    const viewsMap = mapBS(s.views, userId);
    const rows = listings.map(l => {
      const v = viewsMap.get(l.id);
      const views = v ? v.ts.filter(t => t >= cutoff).length : 0;
      const lOrders = orders.filter(o => o.listingId === l.id);
      const revenue = lOrders.reduce((sum, o) => sum + o.totalUsd, 0);
      const cvr = views > 0 ? Math.round((lOrders.length / views) * 10000) / 100 : 0;
      return {
        listingId: l.id, title: l.title,
        status: l.status,
        views,
        orders: lOrders.length,
        revenueUsd: Math.round(revenue * 100) / 100,
        conversionRatePct: cvr,
      };
    }).sort((a, b) => b.revenueUsd - a.revenueUsd);
    return { ok: true, result: { listings: rows } };
  });

  // ── Search visibility (Etsy 2026: impressions + CTR per keyword) ─

  registerLensAction("marketplace", "search-impression", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const listingId = String(params.listingId || "");
    const keyword = String(params.keyword || "").toLowerCase().trim();
    if (!listingId || !keyword) return { ok: false, error: "listingId + keyword required" };
    const impMap = mapBS(s.impressions, userId);
    const lMap = impMap.has(listingId) ? impMap.get(listingId) : new Map();
    if (!impMap.has(listingId)) impMap.set(listingId, lMap);
    const cur = lMap.get(keyword) || { impressions: 0, clicks: 0 };
    cur.impressions++;
    if (params.click) cur.clicks++;
    lMap.set(keyword, cur);
    saveStore();
    return { ok: true, result: { listingId, keyword, ...cur, ctrPct: cur.impressions > 0 ? Math.round((cur.clicks / cur.impressions) * 10000) / 100 : 0 } };
  });

  registerLensAction("marketplace", "search-visibility", (ctx, _a, _p = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const impMap = mapBS(s.impressions, userId);
    const listings = arrayB(s.listings, userId);
    const out = [];
    for (const [listingId, kwMap] of impMap) {
      const listing = listings.find(l => l.id === listingId);
      if (!listing) continue;
      const keywords = Array.from(kwMap.entries()).map(([kw, v]) => ({
        keyword: kw,
        impressions: v.impressions,
        clicks: v.clicks,
        ctrPct: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0,
      })).sort((a, b) => b.impressions - a.impressions);
      const totalImpr = keywords.reduce((sum, k) => sum + k.impressions, 0);
      const totalClicks = keywords.reduce((sum, k) => sum + k.clicks, 0);
      out.push({
        listingId, title: listing.title,
        totalImpressions: totalImpr, totalClicks,
        overallCtrPct: totalImpr > 0 ? Math.round((totalClicks / totalImpr) * 10000) / 100 : 0,
        keywords,
      });
    }
    return { ok: true, result: { listings: out.sort((a, b) => b.totalImpressions - a.totalImpressions) } };
  });

  // ── Marketplace Insights (Etsy 2026: keyword search w/ saved-searches) ─

  registerLensAction("marketplace", "insights-keyword-search", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const keyword = String(params.keyword || "").toLowerCase().trim();
    if (!keyword) return { ok: false, error: "keyword required" };
    // Compute real metrics from this user's own listings + impression history.
    const listings = arrayB(s.listings, userId).filter(l => `${l.title} ${l.description} ${(l.tags || []).join(' ')}`.toLowerCase().includes(keyword));
    const impMap = mapBS(s.impressions, userId);
    let impressions = 0, clicks = 0;
    for (const [, kwMap] of impMap) {
      const v = kwMap.get(keyword);
      if (v) { impressions += v.impressions; clicks += v.clicks; }
    }
    return {
      ok: true,
      result: {
        keyword,
        ownListingCount: listings.length,
        impressions, clicks,
        ctrPct: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        ownTopMatches: listings.slice(0, 5).map(l => ({ id: l.id, title: l.title })),
      },
    };
  });

  registerLensAction("marketplace", "saved-searches-list", (ctx, _a, _p = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { savedSearches: arrayB(s.savedSearches, aidS(ctx)) } };
  });

  registerLensAction("marketplace", "saved-searches-save", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const keyword = String(params.keyword || "").trim();
    if (!keyword) return { ok: false, error: "keyword required" };
    const list = arrayB(s.savedSearches, userId);
    if (list.length >= 50) return { ok: false, error: "saved-search limit reached (50)" };
    if (list.some(x => x.keyword.toLowerCase() === keyword.toLowerCase())) return { ok: false, error: "already saved" };
    const seq = ensureSeqS(s, userId);
    const item = { id: uidS("srch"), number: `SS-${String(seq.srch).padStart(3, '0')}`, keyword, savedAt: isoS() };
    seq.srch++;
    list.push(item);
    saveStore();
    return { ok: true, result: { savedSearch: item } };
  });

  registerLensAction("marketplace", "saved-searches-delete", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = arrayB(s.savedSearches, aidS(ctx));
    const i = list.findIndex(x => x.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "saved search not found" };
    list.splice(i, 1);
    saveStore();
    return { ok: true, result: { deleted: true } };
  });

  // ── Promotions / coupons ──────────────────────────────────────

  registerLensAction("marketplace", "promotions-list", (ctx, _a, _p = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { promotions: arrayB(s.promotions, aidS(ctx)) } };
  });

  registerLensAction("marketplace", "promotions-create", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const code = String(params.code || "").trim().toUpperCase();
    if (!code) return { ok: false, error: "code required" };
    const kind = ['percent','fixed','free_shipping'].includes(params.kind) ? params.kind : 'percent';
    const amount = Number(params.amount);
    if ((kind === 'percent' && (!(amount > 0) || amount > 100)) || (kind === 'fixed' && !(amount > 0))) return { ok: false, error: "invalid amount" };
    const list = arrayB(s.promotions, userId);
    if (list.some(p => p.code === code)) return { ok: false, error: "code already exists" };
    const seq = ensureSeqS(s, userId);
    const promo = {
      id: uidS("prom"),
      number: `P-${String(seq.prom).padStart(4, '0')}`,
      code,
      kind, amount,
      validFrom: String(params.validFrom || dayS()),
      validUntil: String(params.validUntil || ""),
      minOrderUsd: Number(params.minOrderUsd) || 0,
      applicableListingIds: Array.isArray(params.applicableListingIds) ? params.applicableListingIds.map(String) : [],
      active: true,
      usageCount: 0,
      createdAt: isoS(),
    };
    seq.prom++;
    list.push(promo);
    saveStore();
    return { ok: true, result: { promotion: promo } };
  });

  registerLensAction("marketplace", "promotions-toggle", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = arrayB(s.promotions, aidS(ctx)).find(x => x.id === String(params.id || ""));
    if (!p) return { ok: false, error: "promotion not found" };
    p.active = !p.active;
    saveStore();
    return { ok: true, result: { promotion: p } };
  });

  // ── AI 2026: optimize-listing + price-suggest ────────────────

  registerLensAction("marketplace", "ai-optimize-listing", async (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const id = String(params.id || "");
    const listing = arrayB(s.listings, userId).find(l => l.id === id);
    if (!listing) return { ok: false, error: "listing not found" };

    function deterministic() {
      const issues = [];
      const recs = [];
      const titleLen = listing.title.length;
      if (titleLen < 40) issues.push(`Title is ${titleLen} chars — Etsy recommends 40-80 chars with keywords.`);
      if (titleLen > 140) issues.push(`Title is ${titleLen} chars — too long, will be truncated.`);
      if ((listing.tags || []).length < 8) issues.push(`Only ${(listing.tags || []).length} tags — Etsy allows up to 13. Fill them.`);
      if ((listing.description || '').length < 160) issues.push("Description is too short — aim for 300-1000 chars with what / why / how.");
      if ((listing.images || []).length < 5) issues.push(`${(listing.images || []).length} images — Etsy recommends 5-10 with multiple angles.`);
      if (listing.priceUsd < 1) issues.push("Price is suspiciously low — verify it's intentional.");
      // Title suggestions: keyword-stuff from existing tags
      const tagWords = (listing.tags || []).slice(0, 5).join(' ');
      if (tagWords) recs.push(`Try this title structure: "${listing.title} — ${tagWords}"`);
      recs.push("Use sensory + specific words (handmade, vintage, organic, soft, custom).");
      recs.push("Front-load the most-searched keyword (Etsy search weights early words higher).");
      return { issues, recommendations: recs };
    }

    const brain = ctx?.llm?.chat;
    const baseline = deterministic();
    if (typeof brain !== 'function') {
      return { ok: true, result: { ...baseline, source: 'deterministic' } };
    }
    try {
      const r = await brain({
        messages: [
          { role: 'system', content: "You are an Etsy/Bandcamp SEO advisor. Output ONLY JSON: {\"suggestedTitle\":\"...\",\"suggestedTags\":[\"...\"],\"suggestedDescription\":\"...\",\"keyImprovements\":[\"...\"]}. Use only the listing fields provided." },
          { role: 'user', content: `Listing:\nTitle: ${listing.title}\nKind: ${listing.kind}\nPrice: $${listing.priceUsd}\nTags: ${(listing.tags || []).join(', ')}\nDescription: ${(listing.description || '').slice(0, 1000)}\n\nReturn JSON.` },
        ],
        temperature: 0.3, maxTokens: 1500,
      });
      const text = String(r?.content || r?.text || '').trim();
      const json = (text.match(/\{[\s\S]*\}/) || ['{}'])[0];
      const parsed = JSON.parse(json);
      return {
        ok: true,
        result: {
          ...baseline,
          suggestedTitle: String(parsed.suggestedTitle || '').slice(0, 140),
          suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags.slice(0, 13).map(String) : [],
          suggestedDescription: String(parsed.suggestedDescription || '').slice(0, 5000),
          keyImprovements: Array.isArray(parsed.keyImprovements) ? parsed.keyImprovements.slice(0, 8).map(String) : [],
          source: 'brain',
        },
      };
    } catch (_e) {
      return { ok: true, result: { ...baseline, source: 'deterministic_after_brain_error' } };
    }
  });

  registerLensAction("marketplace", "ai-price-suggest", (ctx, _a, params = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const id = String(params.id || "");
    const listing = arrayB(s.listings, userId).find(l => l.id === id);
    if (!listing) return { ok: false, error: "listing not found" };
    // Compare against own published listings of same kind.
    const peers = arrayB(s.listings, userId).filter(l => l.id !== id && l.status === 'published' && l.kind === listing.kind && l.priceUsd > 0);
    if (peers.length < 2) {
      return {
        ok: true,
        result: {
          message: `Only ${peers.length} comparable listing(s) of kind "${listing.kind}" — need at least 2 to suggest a competitive price.`,
          currentPriceUsd: listing.priceUsd,
        },
      };
    }
    const prices = peers.map(p => p.priceUsd).sort((a, b) => a - b);
    const min = prices[0];
    const max = prices[prices.length - 1];
    const median = prices[Math.floor(prices.length / 2)];
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    return {
      ok: true,
      result: {
        currentPriceUsd: listing.priceUsd,
        comparableCount: peers.length,
        peerStats: { min, max, median, avg: Math.round(avg * 100) / 100 },
        suggestion: {
          aggressive: Math.round(min * 0.95 * 100) / 100,
          competitive: Math.round(median * 0.95 * 100) / 100,
          premium: Math.round(avg * 1.15 * 100) / 100,
        },
        positioning: listing.priceUsd > avg ? "above-market" : listing.priceUsd < avg * 0.8 ? "budget" : "competitive",
      },
    };
  });

  // ── Dashboard summary ─────────────────────────────────────────

  registerLensAction("marketplace", "dashboard-summary", (ctx, _a, _p = {}) => {
    const s = getStoreState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidS(ctx);
    const listings = arrayB(s.listings, userId);
    const orders = arrayB(s.orders, userId);
    const promos = arrayB(s.promotions, userId);
    const publishedCount = listings.filter(l => l.status === 'published').length;
    const draftCount = listings.filter(l => l.status === 'draft').length;
    const pendingOrders = orders.filter(o => o.status === 'paid').length; // paid but not shipped
    const shippedOrders = orders.filter(o => o.status === 'shipped').length;
    const lifetimeRevenue = orders.filter(o => o.status !== 'refunded').reduce((sum, o) => sum + o.totalUsd, 0);
    return {
      ok: true,
      result: {
        listingCount: listings.length,
        publishedCount,
        draftCount,
        orderCount: orders.length,
        pendingOrders,
        shippedOrders,
        lifetimeRevenueUsd: Math.round(lifetimeRevenue * 100) / 100,
        activePromos: promos.filter(p => p.active).length,
      },
    };
  });
}
