// server/domains/market-house.js
//
// The Auction House — the Market lens. People consign DTUs they own as lots,
// others buy them with Concord Coin. Nothing here is a second economy:
//
//   • a lot IS a row in marketplace_economy_listings (economy/marketplace-service.js);
//   • a sale IS purchaseListing(): a `purchases` row walked CREATED → FULFILLED,
//     the buyer debited and the seller credited on economy_ledger with the
//     marketplace fee (FEES.MARKETPLACE_PURCHASE + UNIVERSAL_FEE_RATE), and
//     ancestor royalties paid by distributeRoyalties() when the DTU has
//     registered citations;
//   • a cover IS an image DTU the seller uploaded through /api/artifact/upload,
//     served by /api/economy/marketplace/listings/:id/cover.
//
// Every number this returns (sales, trending, revenue) is counted from those
// tables. A buyer reads the full DTU only through `house-open`, which checks a
// FULFILLED purchase (or the seller, or the commissioner of an accepted
// commission) every time.

import { createHash } from "node:crypto";
import {
  createListing, getListing, purchaseListing, delistListing, updateListingPrice,
} from "../economy/marketplace-service.js";
import { getAncestorChain } from "../economy/royalty-cascade.js";
import { getBalance } from "../economy/balances.js";
import { calculateFee, FEES, UNIVERSAL_FEE_RATE } from "../economy/fees.js";

export const LICENSES = ["personal", "nonexclusive", "exclusive", "cc-by"];
const LICENSE_SET = new Set(LICENSES);
const MAX_PRICE = 1_000_000;
const SORTS = new Set(["newest", "price_asc", "price_desc", "bestselling", "trending"]);
const KIND_OF_TIER = { regular: "dtu", mega: "mega_dtu", hyper: "hyper_dtu" };
const HOUR = 3_600_000;

// ── shared helpers (also used by the showcase and the pay board) ─────────

export function actorOf(ctx) {
  const id = ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || null;
  return id && id !== "anon" && id !== "anonymous" ? String(id) : null;
}

/** A DTU by id: the live store first, then the persisted row. */
export function loadDtu(db, id) {
  if (!id) return null;
  const live = globalThis._concordSTATE?.dtus?.get?.(id);
  if (live) return live;
  try {
    const row = db.prepare("SELECT data, owner_user_id FROM dtu_store WHERE id = ?").get(id);
    if (!row?.data) return null;
    const d = JSON.parse(row.data);
    if (!d.ownerId && row.owner_user_id) d.ownerId = row.owner_user_id;
    return d;
  } catch { return null; }
}

export function ownerOf(d) {
  return d?.ownerId || d?.meta?.ownerId || d?.meta?.owner || d?.createdBy || d?.meta?.createdBy || d?.authorId || null;
}

/** Why a DTU cannot be sold or submitted by this user, or null. */
export function unsellableReason(d, userId) {
  if (!d) return "dtu_not_found";
  const owner = ownerOf(d);
  if (!owner || owner !== userId) return "not_owner";
  if (d.meta?.purchasedFrom) return "bought_copy";
  if (d.machine?.kind === "royalty_record" || d.meta?.type === "royalty_record") return "system_record";
  return null;
}

const arr = (v) => (Array.isArray(v) ? v : []);
const textOf = (x) => (typeof x === "string" ? x : x && typeof x === "object" ? String(x.text || x.claim || x.term || x.definition || x.title || "") : "");

/** What a DTU contains, counted from its own layers. */
export function dtuFacts(d) {
  const core = d?.core && !Array.isArray(d.core) ? d.core : {};
  const claims = arr(core.claims).map(textOf).filter(Boolean);
  const definitions = arr(core.definitions).map(textOf).filter(Boolean);
  const examples = arr(core.examples).map(textOf).filter(Boolean);
  const summary = String(d?.human?.summary || d?.summary || d?.content || "").trim();
  const words = [summary, ...claims, ...definitions, ...examples].join(" ").split(/\s+/).filter(Boolean).length;
  const lineage = Array.isArray(d?.lineage) ? d.lineage : arr(d?.lineage?.parents);
  const artifact = d?.artifact && typeof d.artifact === "object" ? d.artifact : null;
  return {
    title: String(d?.title || "").trim(),
    summary,
    claims, definitions, examples,
    words,
    tier: ["mega", "hyper"].includes(d?.tier) ? d.tier : "regular",
    domain: d?.domain ? String(d.domain) : null,
    tags: arr(d?.tags).map(String).filter(Boolean).slice(0, 24),
    parents: lineage.map((p) => (typeof p === "string" ? p : p?.id)).filter(Boolean),
    file: artifact ? { type: typeof artifact.type === "string" ? artifact.type : null, size: Number(artifact.size) || null } : null,
    createdAt: d?.createdAt || d?.meta?.createdAt || null,
  };
}

export function userNames(db, ids) {
  const out = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return out;
  try {
    const rows = db.prepare("SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(list));
    for (const r of rows) out.set(r.id, r.username);
  } catch { /* users table absent on minimal builds */ }
  return out;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const iso = (t) => new Date(t).toISOString().replace("T", " ").slice(0, 19);

function hasPurchase(db, listingId, userId) {
  if (!userId) return false;
  try {
    return !!db.prepare("SELECT 1 FROM purchases WHERE listing_id = ? AND buyer_id = ? AND status = 'FULFILLED' LIMIT 1").get(listingId, userId);
  } catch { return false; }
}

/** Sales per listing in a window, counted from FULFILLED purchases. */
function salesSince(db, sinceMs) {
  const out = new Map();
  try {
    const rows = db.prepare(`
      SELECT listing_id, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS revenue, MAX(created_at) AS last
      FROM purchases WHERE status = 'FULFILLED' AND created_at >= ? GROUP BY listing_id
    `).all(iso(sinceMs));
    for (const r of rows) out.set(r.listing_id, { n: r.n, revenue: round2(r.revenue), last: r.last });
  } catch { /* no purchases table */ }
  return out;
}

/** A lot as the catalogue shows it. Never includes the DTU's full content. */
function lotCard(l, names, s24, s7) {
  const p = l.preview && typeof l.preview === "object" ? l.preview : {};
  return {
    id: l.id,
    title: l.title,
    kind: l.contentType,
    price: l.price,
    free: Number(l.price) === 0,
    license: l.licenseType,
    status: l.status,
    seller: { id: l.sellerId, name: names.get(l.sellerId) || null },
    cover: p.coverArtifactId ? `/api/economy/marketplace/listings/${l.id}/cover` : null,
    domain: p.domain || (l.contentType === "music" ? "music" : null),
    tags: arr(p.tags),
    excerpt: p.excerpt || l.description || "",
    counts: p.counts || null,
    tier: p.tier || null,
    hasFile: !!p.hasFile,
    artist: p.artist || null,
    sold: l.purchaseCount || 0,
    sold24h: s24?.get(l.id)?.n || 0,
    sold7d: s7?.get(l.id)?.n || 0,
    listedAt: l.createdAt,
  };
}

function activeListings(db, { limit = 3000 } = {}) {
  try {
    return db.prepare("SELECT id FROM marketplace_economy_listings WHERE status = 'active' ORDER BY created_at DESC LIMIT ?").all(limit)
      .map((r) => getListing(db, r.id)).filter(Boolean);
  } catch { return []; }
}

export function activeLotsBySeller(db, sellerId, limit = 3) {
  try {
    return db.prepare("SELECT id FROM marketplace_economy_listings WHERE status = 'active' AND seller_id = ? ORDER BY created_at DESC LIMIT ?").all(sellerId, limit)
      .map((r) => getListing(db, r.id)).filter(Boolean);
  } catch { return []; }
}

export function cardsFor(db, listings) {
  const names = userNames(db, listings.map((l) => l.sellerId));
  const now = Date.now();
  const s24 = salesSince(db, now - 24 * HOUR);
  const s7 = salesSince(db, now - 7 * 24 * HOUR);
  return listings.map((l) => lotCard(l, names, s24, s7));
}

function terms(db, userId) {
  const sample = calculateFee("MARKETPLACE_PURCHASE", 100);
  return {
    currency: "CC",
    marketplaceFeeRate: FEES.MARKETPLACE_PURCHASE,
    universalFeeRate: UNIVERSAL_FEE_RATE,
    combinedRate: sample.rate,
    example: { price: 100, fee: sample.fee, sellerNet: sample.net },
    licenses: LICENSES,
    maxPrice: MAX_PRICE,
    balance: userId ? getBalance(db, userId).balance : null,
  };
}

function contentHash(d, f) {
  return createHash("sha256").update(JSON.stringify({
    t: f.title, s: f.summary, c: f.claims, d: f.definitions, e: f.examples,
    a: d?.artifact?.hash || d?.machine?.verifier?.hash || null,
  })).digest("hex");
}

// ── public reads ─────────────────────────────────────────────────────────
// The read-only handlers a signed-out visitor may run, by name. Filled as the
// macros register; served by mountMarketHousePublicRoutes as GET only, with
// no actor, so nothing that needs a user can be reached through it.
export const PUBLIC_READS = new Map();
export function publicRead(register, domain, name, handler) {
  PUBLIC_READS.set(name, handler);
  return register(domain, name, handler);
}

/** GET /api/market/house/public/:name — query string as params, anonymous ctx. */
export function mountMarketHousePublicRoutes(app, db) {
  app.get("/api/market/house/public/:name", async (req, res) => {
    const fn = PUBLIC_READS.get(String(req.params.name));
    if (!fn) return res.status(404).json({ ok: false, error: "not_public" });
    try {
      const params = {};
      for (const [k, v] of Object.entries(req.query || {})) if (typeof v === "string") params[k] = v.slice(0, 200);
      const out = await fn({ db, actor: null, public: true }, {}, params);
      res.status(out?.ok === false ? 400 : 200).json(out);
    } catch (e) {
      res.status(500).json({ ok: false, error: "market_read_failed", detail: String(e?.message || e) });
    }
  });
}

// ── macros ───────────────────────────────────────────────────────────────

export function registerMarketHouse(registerLensAction) {
  const need = (ctx) => (ctx?.db ? null : { ok: false, error: "no_db", message: "The market database is not available." });

  /** House rules and the caller's balance. */
  publicRead(registerLensAction, "market", "house-terms", (ctx) => {
    const n = need(ctx); if (n) return n;
    return { ok: true, result: terms(ctx.db, actorOf(ctx)) };
  });

  /**
   * The catalogue. params: { q, kind, domain, tag, priceMin, priceMax, free,
   * license, seller, sort (newest|price_asc|price_desc|bestselling|trending),
   * page, pageSize }. Facets are counted over the lots that match everything
   * except the facet's own filter.
   */
  publicRead(registerLensAction, "market", "house-catalogue", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const sort = SORTS.has(params.sort) ? params.sort : "newest";
    const pageSize = Math.min(60, Math.max(6, Number(params.pageSize) || 24));
    const page = Math.max(1, Math.floor(Number(params.page) || 1));
    const q = String(params.q || "").trim().toLowerCase().slice(0, 120);
    const min = params.priceMin === "" || params.priceMin == null ? null : Number(params.priceMin);
    const max = params.priceMax === "" || params.priceMax == null ? null : Number(params.priceMax);
    if ((min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max))) return { ok: false, error: "invalid_price_range" };

    const all = cardsFor(db, activeListings(db));
    const test = {
      q: (c) => !q || [c.title, c.excerpt, c.seller.name || "", c.artist || "", ...c.tags].join(" ").toLowerCase().includes(q),
      kind: (c) => !params.kind || c.kind === params.kind,
      domain: (c) => !params.domain || (c.domain || "").toLowerCase() === String(params.domain).toLowerCase(),
      tag: (c) => !params.tag || c.tags.some((t) => t.toLowerCase() === String(params.tag).toLowerCase()),
      price: (c) => (min == null || c.price >= min) && (max == null || c.price <= max) && (!params.free || c.free),
      license: (c) => !params.license || c.license === params.license,
      seller: (c) => !params.seller || c.seller.id === params.seller,
    };
    const keys = Object.keys(test);
    const passExcept = (c, skip) => keys.every((k) => k === skip || test[k](c));
    const matched = all.filter((c) => passExcept(c, null));

    const tally = (skip, pick) => {
      const m = new Map();
      for (const c of all) if (passExcept(c, skip)) for (const v of pick(c)) if (v) m.set(v, (m.get(v) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([value, count]) => ({ value, count }));
    };
    const facets = {
      kind: tally("kind", (c) => [c.kind]),
      domain: tally("domain", (c) => [c.domain]).slice(0, 24),
      tag: tally("tag", (c) => c.tags).slice(0, 30),
      license: tally("license", (c) => [c.license]),
      price: matched.length ? { min: Math.min(...matched.map((c) => c.price)), max: Math.max(...matched.map((c) => c.price)), free: matched.filter((c) => c.free).length } : null,
    };

    const by = {
      newest: (a, b) => String(b.listedAt).localeCompare(String(a.listedAt)),
      price_asc: (a, b) => a.price - b.price || String(b.listedAt).localeCompare(String(a.listedAt)),
      price_desc: (a, b) => b.price - a.price || String(b.listedAt).localeCompare(String(a.listedAt)),
      bestselling: (a, b) => b.sold - a.sold || String(b.listedAt).localeCompare(String(a.listedAt)),
      trending: (a, b) => b.sold24h - a.sold24h || b.sold7d - a.sold7d || String(b.listedAt).localeCompare(String(a.listedAt)),
    }[sort];
    matched.sort(by);
    const start = (page - 1) * pageSize;
    return { ok: true, result: { lots: matched.slice(start, start + pageSize), total: matched.length, page, pageSize, sort, facets, inHouse: all.length } };
  });

  /** One lot: the card, the seller, its sales record, royalty lineage, and the content when the caller owns it. */
  publicRead(registerLensAction, "market", "house-lot", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const l = getListing(db, String(params.id || ""));
    if (!l) return { ok: false, error: "lot_not_found" };
    const me = actorOf(ctx);
    const isSeller = !!me && me === l.sellerId;
    if (l.status !== "active" && !isSeller && !hasPurchase(db, l.id, me)) return { ok: false, error: "lot_not_found" };
    const [card] = cardsFor(db, [l]);
    const owned = isSeller || hasPurchase(db, l.id, me);
    let ancestors = [];
    try { ancestors = getAncestorChain(db, l.contentId).slice(0, 12); } catch { /* no lineage table */ }
    const names = userNames(db, ancestors.map((a) => a.creatorId));
    const more = activeLotsBySeller(db, l.sellerId, 5).filter((x) => x.id !== l.id).slice(0, 4);
    return {
      ok: true,
      result: {
        lot: card,
        description: l.description || "",
        owned, isSeller,
        royalties: ancestors.map((a) => ({ contentId: a.contentId, creator: names.get(a.creatorId) || a.creatorId, generation: a.generation, rate: a.rate ?? null })),
        moreFromSeller: cardsFor(db, more),
        terms: terms(db, me),
        revenue: isSeller ? round2(l.totalRevenue || 0) : undefined,
      },
    };
  });

  /** The full DTU, for its seller, a buyer with a fulfilled purchase, or the commissioner who accepted it. */
  registerLensAction("market", "house-open", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    let dtuId = null; let via = null;
    if (params.lotId) {
      const l = getListing(db, String(params.lotId));
      if (!l) return { ok: false, error: "lot_not_found" };
      if (me !== l.sellerId && !hasPurchase(db, l.id, me)) return { ok: false, error: "not_purchased", message: "Buy this lot to read it in full." };
      dtuId = l.contentId; via = { lotId: l.id };
    } else if (params.submissionId) {
      const s = db.prepare(`SELECT s.*, c.poster_id FROM house_commission_submissions s JOIN house_commissions c ON c.id = s.commission_id WHERE s.id = ?`).get(String(params.submissionId));
      if (!s) return { ok: false, error: "submission_not_found" };
      const allowed = me === s.creator_id || (me === s.poster_id && s.status === "accepted");
      if (!allowed) return { ok: false, error: "not_delivered", message: "A submission is delivered when you accept it." };
      dtuId = s.dtu_id; via = { submissionId: s.id, commissionId: s.commission_id };
    } else return { ok: false, error: "missing_lot" };
    const d = loadDtu(db, dtuId);
    if (!d) return { ok: false, error: "dtu_missing", message: "The DTU behind this lot can no longer be found." };
    const f = dtuFacts(d);
    return { ok: true, result: { via, dtu: { id: dtuId, title: f.title, summary: f.summary, claims: f.claims, definitions: f.definitions, examples: f.examples, tags: f.tags, domain: f.domain, tier: f.tier, words: f.words, file: f.file, parents: f.parents, createdAt: f.createdAt } } };
  });

  /** DTUs the caller owns and could consign, marking which are already on sale. */
  registerLensAction("market", "house-my-dtus", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const ids = new Set();
    try { for (const r of db.prepare("SELECT id FROM dtu_store WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 300").all(me)) ids.add(r.id); } catch { /* */ }
    const live = globalThis._concordSTATE?.dtus;
    if (live?.values) for (const d of live.values()) if (ownerOf(d) === me && d.id) ids.add(d.id);
    const listed = new Map();
    try { for (const r of db.prepare("SELECT id, content_id FROM marketplace_economy_listings WHERE seller_id = ? AND status = 'active'").all(me)) listed.set(r.content_id, r.id); } catch { /* */ }
    const q = String(params.q || "").toLowerCase();
    const out = [];
    for (const id of ids) {
      const d = loadDtu(db, id);
      if (unsellableReason(d, me)) continue;
      const f = dtuFacts(d);
      if (q && !`${f.title} ${f.summary} ${f.tags.join(" ")}`.toLowerCase().includes(q)) continue;
      const isImage = !!f.file?.type?.startsWith("image/");
      out.push({ id, title: f.title || "(untitled)", excerpt: f.summary.slice(0, 160), tier: f.tier, domain: f.domain, tags: f.tags, claims: f.claims.length, words: f.words, file: f.file, isImage, listedAs: listed.get(id) || null, createdAt: f.createdAt });
    }
    out.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return { ok: true, result: { dtus: out.slice(0, 200), total: out.length } };
  });

  /**
   * Consign a DTU you own as a lot. params: { dtuId, price, license,
   * coverArtifactId?, title?, description?, excerpt? }.
   */
  registerLensAction("market", "house-consign", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const d = loadDtu(db, String(params.dtuId || ""));
    const why = unsellableReason(d, me);
    if (why) return { ok: false, error: why, message: { dtu_not_found: "That DTU could not be found.", not_owner: "You can only consign DTUs you made.", bought_copy: "This is a copy you bought; it is not yours to resell.", system_record: "System records cannot be sold." }[why] };
    const price = Number(params.price);
    if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) return { ok: false, error: "invalid_price" };
    const rounded = round2(price);
    if (price > 0 && rounded < 0.01) return { ok: false, error: "invalid_price" };
    const license = String(params.license || "nonexclusive");
    if (!LICENSE_SET.has(license)) return { ok: false, error: "invalid_license" };
    if (license === "exclusive" && rounded === 0) return { ok: false, error: "exclusive_needs_price", message: "An exclusive lot sells once, so it needs a price." };
    const f = dtuFacts(d);
    const title = String(params.title || f.title || "").trim().slice(0, 120);
    if (!title) return { ok: false, error: "missing_title" };
    const description = String(params.description || "").trim().slice(0, 2000);
    const excerpt = String(params.excerpt || f.summary).trim().slice(0, 280);

    let coverArtifactId = null;
    if (params.coverArtifactId) {
      const cover = loadDtu(db, String(params.coverArtifactId));
      if (!cover || ownerOf(cover) !== me) return { ok: false, error: "cover_not_found", message: "Upload the cover as yourself first." };
      const type = cover.artifact?.type;
      if (!(typeof type === "string" && type.startsWith("image/")) || !cover.artifact?.diskPath) return { ok: false, error: "cover_not_image", message: "A cover must be an uploaded PNG, JPEG or WebP image." };
      coverArtifactId = cover.id;
    } else if (f.file?.type?.startsWith("image/") && d.artifact?.diskPath) {
      coverArtifactId = d.id; // an image DTU is its own cover
    }

    let ancestors = [];
    try { ancestors = getAncestorChain(db, d.id); } catch { /* no lineage */ }
    const kind = f.file && !f.file.type?.startsWith("image/") && f.tier === "regular" ? "artifact" : f.file?.type?.startsWith("image/") ? "art" : KIND_OF_TIER[f.tier];

    const listed = createListing(db, {
      sellerId: me,
      contentId: d.id,
      contentType: kind,
      title,
      description,
      price: rounded,
      contentData: contentHash(d, f),
      licenseType: license,
      previewData: {
        house: true,
        coverArtifactId,
        domain: f.domain,
        tags: f.tags,
        tier: f.tier,
        excerpt,
        counts: { claims: f.claims.length, definitions: f.definitions.length, examples: f.examples.length, words: f.words },
        hasFile: !!f.file,
        fileType: f.file?.type || null,
        license,
        // The Art lens piece this lot was painted in, when consigned from Art.
        sourceArtworkId: typeof params.sourceArtworkId === "string" && /^[\w:-]{1,80}$/.test(params.sourceArtworkId) ? params.sourceArtworkId : null,
      },
      royaltyChain: ancestors.map((a) => a.contentId),
    });
    if (!listed.ok) {
      const msg = { duplicate_content: "This DTU is already on sale." }[listed.error];
      return { ok: false, error: listed.error, message: msg };
    }
    const [card] = cardsFor(db, [getListing(db, listed.listing.id)]);
    return { ok: true, result: { lot: card } };
  });

  registerLensAction("market", "house-withdraw", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const r = delistListing(ctx.db, { listingId: String(params.id || ""), sellerId: me });
    return r.ok ? { ok: true, result: { id: params.id, status: "delisted" } } : r;
  });

  registerLensAction("market", "house-reprice", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const price = round2(Number(params.price));
    if (!Number.isFinite(price) || price < 0.01 || price > MAX_PRICE) return { ok: false, error: "invalid_price" };
    const r = updateListingPrice(ctx.db, { listingId: String(params.id || ""), sellerId: me, newPrice: price });
    if (!r.ok) return r;
    const [card] = cardsFor(ctx.db, [getListing(ctx.db, String(params.id))]);
    return { ok: true, result: { lot: card } };
  });

  /** Buy a lot with Concord Coin. One purchase per buyer per lot. */
  registerLensAction("market", "house-buy", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required", message: "Sign in to buy." };
    const l = getListing(db, String(params.id || ""));
    if (!l || l.status !== "active") return { ok: false, error: "lot_not_found", message: "This lot is no longer for sale." };
    if (l.sellerId === me) return { ok: false, error: "cannot_buy_own_listing", message: "This is your own lot." };
    if (hasPurchase(db, l.id, me)) return { ok: false, error: "already_owned", message: "You already own this lot." };
    if (params.expectPrice != null && round2(params.expectPrice) !== round2(l.price)) {
      return { ok: false, error: "price_changed", message: `The price changed to ${l.price} CC. Check it and buy again.`, price: l.price };
    }
    const r = purchaseListing(db, { buyerId: me, listingId: l.id, refId: `house:${l.id}:${me}` });
    if (!r.ok) {
      const msg = { insufficient_balance: `You need ${l.price} CC; your balance is ${getBalance(db, me).balance} CC.`, wash_trade_detected: "Repeated trades between the same two accounts are held for review." }[r.error];
      return { ok: false, error: r.error, message: msg };
    }
    const after = getListing(db, l.id);
    return {
      ok: true,
      result: {
        lotId: l.id,
        purchaseId: r.purchaseId || r.purchase?.id || null,
        price: l.price,
        fee: r.fee ?? r.marketplaceFee ?? null,
        balance: getBalance(db, me).balance,
        lotStatus: after?.status || null,
      },
    };
  });

  /** What sold, counted from fulfilled purchases in the last 24 hours and 7 days. */
  publicRead(registerLensAction, "market", "house-trending", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const window = params.window === "7d" ? "7d" : "24h";
    const since = Date.now() - (window === "7d" ? 7 * 24 : 24) * HOUR;
    const sales = salesSince(db, since);
    const ids = [...sales.keys()];
    const listings = ids.map((id) => getListing(db, id)).filter((l) => l && (l.status === "active" || l.status === "sold"));
    const cards = cardsFor(db, listings).map((c) => ({ ...c, windowSales: sales.get(c.id)?.n || 0, windowRevenue: sales.get(c.id)?.revenue || 0, lastSaleAt: sales.get(c.id)?.last || null }));
    cards.sort((a, b) => b.windowSales - a.windowSales || b.windowRevenue - a.windowRevenue || String(b.lastSaleAt).localeCompare(String(a.lastSaleAt)));
    const total = cards.reduce((s, c) => ({ sales: s.sales + c.windowSales, revenue: round2(s.revenue + c.windowRevenue) }), { sales: 0, revenue: 0 });
    return { ok: true, result: { window, lots: cards.slice(0, Math.min(50, Number(params.limit) || 20)), total } };
  });

  /** The seller's consignments with their sales. */
  registerLensAction("market", "house-mine", (ctx) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    let rows = [];
    try { rows = db.prepare("SELECT id FROM marketplace_economy_listings WHERE seller_id = ? ORDER BY created_at DESC LIMIT 300").all(me); } catch { /* */ }
    const listings = rows.map((r) => getListing(db, r.id)).filter(Boolean);
    const cards = cardsFor(db, listings).map((c, i) => ({ ...c, revenue: round2(listings[i].totalRevenue || 0) }));
    let earned = { gross: 0, sales: 0 };
    try {
      const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS g FROM purchases WHERE seller_id = ? AND status = 'FULFILLED' AND source = 'marketplace'").get(me);
      earned = { gross: round2(r.g), sales: r.n };
    } catch { /* */ }
    let royalties = 0;
    try {
      royalties = round2(db.prepare("SELECT COALESCE(SUM(net), 0) AS r FROM economy_ledger WHERE to_user_id = ? AND type = 'ROYALTY_PAYOUT' AND status = 'complete'").get(me).r);
    } catch { /* */ }
    return { ok: true, result: { lots: cards, sales: earned.sales, gross: earned.gross, sellerNet: round2(earned.gross - calculateFee("MARKETPLACE_PURCHASE", earned.gross).fee), royalties, balance: getBalance(db, me).balance } };
  });

  /** The caller's lots consigned from one Art piece, with their sales. */
  registerLensAction("market", "house-lots-for-piece", (ctx, _a, params = {}) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    const piece = String(params.sourceArtworkId || "");
    if (!piece) return { ok: false, error: "missing_piece" };
    let rows = [];
    try {
      rows = db.prepare("SELECT id FROM marketplace_economy_listings WHERE seller_id = ? AND json_extract(preview_data, '$.sourceArtworkId') = ? ORDER BY created_at DESC LIMIT 20").all(me, piece);
    } catch { /* */ }
    const listings = rows.map((r) => getListing(db, r.id)).filter(Boolean);
    const cards = cardsFor(db, listings).map((c, i) => ({ ...c, revenue: round2(listings[i].totalRevenue || 0) }));
    return { ok: true, result: { lots: cards } };
  });

  /** What the caller bought, and commissions delivered to them. */
  registerLensAction("market", "house-library", (ctx) => {
    const n = need(ctx); if (n) return n;
    const db = ctx.db;
    const me = actorOf(ctx);
    if (!me) return { ok: false, error: "auth_required" };
    let rows = [];
    try { rows = db.prepare("SELECT listing_id, amount, created_at FROM purchases WHERE buyer_id = ? AND status = 'FULFILLED' ORDER BY created_at DESC LIMIT 300").all(me); } catch { /* */ }
    const seen = new Set();
    const bought = [];
    for (const r of rows) {
      if (seen.has(r.listing_id)) continue;
      seen.add(r.listing_id);
      const l = getListing(db, r.listing_id);
      if (!l) continue;
      const [card] = cardsFor(db, [l]);
      bought.push({ ...card, paid: r.amount, boughtAt: r.created_at });
    }
    let delivered = [];
    try {
      delivered = db.prepare(`
        SELECT s.id AS submissionId, s.dtu_id, s.creator_id, c.id AS commissionId, c.title, c.released_net, c.reward, c.updated_at
        FROM house_commission_submissions s JOIN house_commissions c ON c.id = s.commission_id
        WHERE c.poster_id = ? AND s.status = 'accepted' ORDER BY c.updated_at DESC
      `).all(me);
    } catch { /* */ }
    const names = userNames(db, delivered.map((d) => d.creator_id));
    return {
      ok: true,
      result: {
        bought,
        commissioned: delivered.map((d) => ({ submissionId: d.submissionId, commissionId: d.commissionId, title: loadDtu(db, d.dtu_id)?.title || d.title, commission: d.title, creator: names.get(d.creator_id) || d.creator_id, reward: d.reward, deliveredAt: d.updated_at })),
      },
    };
  });
}
