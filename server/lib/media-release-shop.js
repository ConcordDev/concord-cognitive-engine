// server/lib/media-release-shop.js
//
// One way to put finished work out into the world, shared by the lenses that
// release rendered video (Film Studios' films, Animation's shorts). A maker
// releases an uploaded video of theirs, free or priced in Concord Coin:
//   - free: the video goes public and anyone can watch it in full
//   - priced: it is minted as a DTU and listed through the one marketplace
//     money path (purchaseWithRoyalties: 95% creator pool, 5% platform), and
//     the video's own stream serves non-buyers only the preview window
//     (setMediaSaleTerms) — the lock is at the media route, not in the page
// Buyers keep the full stream for good, even after a withdraw (the stream
// access rule honours licences). The lens supplies where releases live and
// how a release request names its source; everything about money, preview
// gating, visibility and listing is here, once.

import { getMediaDTU, setMediaSaleTerms, grantMediaEntitlement, setMediaPrivacy } from "./media-dtu.js";

const STATE = () => globalThis._concordSTATE;
const persistDtu = (d) => { try { globalThis._concordUpsertDTU?.(d); } catch { /* in-memory copy still serves */ } };
export const RELEASE_MAX_PRICE = 1000;
const ID_RE = /^[A-Za-z0-9_:-]{3,120}$/;
const r2 = (n) => Math.round(n * 100) / 100;
// eslint-disable-next-line no-control-regex -- strips control characters from user text on purpose
const cleanText = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, n);

/** A person's public name: their username, never an email. */
export function displayName(userId) {
  try {
    const row = STATE()?.db?.prepare?.("SELECT username FROM users WHERE id = ?").get(String(userId));
    return row?.username ? String(row.username).slice(0, 40) : null;
  } catch { return null; }
}
if (typeof globalThis._concordDisplayName !== "function") globalThis._concordDisplayName = displayName;

/**
 * @param {Function} registerLensAction
 * @param {object} cfg
 *   domain, prefix ("film-release"), noun ("film"), ownerField ("filmmakerId"),
 *   ownerView ("filmmaker"), dtuType, dtuDomain, tag,
 *   home(): the object holding this lens's releases (persisted lens state),
 *   save(), aid(ctx), makeId(prefix), now(),
 *   resolve(home, userId, params): { ok:false, error } | { ok:true, platformMediaId, title, fields }
 *     — validate that params name a video of this user's own work, and give
 *     the fields to keep on the release (projectId, animId, …),
 *   extraView(home, release, userId): extra fields for the public view,
 *   filter(release, params): extra list filter (e.g. projectId).
 */
export function createReleaseShop(registerLensAction, cfg) {
  const { domain, prefix, noun, ownerField, ownerView } = cfg;
  const me = (ctx) => { const id = cfg.aid(ctx); return id && id !== "anon" ? id : null; };
  const Noun = noun[0].toUpperCase() + noun.slice(1);

  function store() {
    const h = cfg.home(); if (!h) return null;
    if (!(h.releases instanceof Map)) h.releases = new Map();             // releaseId → release
    if (!(h.releaseOwners instanceof Map)) h.releaseOwners = new Map();   // releaseId → userId[]
    return h;
  }
  const owners = (s, id) => s.releaseOwners.get(id) || [];
  const mediaRow = (id) => getMediaDTU(STATE(), id)?.mediaDTU || null;

  function canWatchFull(s, r, userId) {
    if (!r) return false;
    const mine = !!userId && (r[ownerField] === userId || owners(s, r.id).includes(userId));
    if (r.status !== "published") return mine;
    if (!(r.priceCC > 0)) return true;
    return mine;
  }
  const streamOf = (r) => `/api/media/${encodeURIComponent(r.platformMediaId)}/stream`;

  function view(s, r, userId) {
    return {
      id: r.id, title: r.title, logline: r.logline, runtimeSec: r.runtimeSec,
      priceCC: r.priceCC, previewSec: r.priceCC > 0 ? r.previewSec : null,
      poster: r.posterMediaId ? `/api/media/${encodeURIComponent(r.posterMediaId)}/stream` : null,
      [ownerView]: { name: displayName(r[ownerField]) || `A ${cfg.makerNoun || "maker"}`, isMe: r[ownerField] === userId },
      status: r.status, publishedAt: r.publishedAt,
      owned: !!userId && owners(s, r.id).includes(userId),
      canWatchFull: canWatchFull(s, r, userId),
      streamUrl: streamOf(r),
      buyers: r[ownerField] === userId ? owners(s, r.id).length : null,
      ...(cfg.extraView ? cfg.extraView(s, r, userId) : {}),
    };
  }

  registerLensAction(domain, `${prefix}-create`, async (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx); if (!userId) return { ok: false, error: `sign in to release a ${noun}` };
    const src = cfg.resolve(s, userId, params);
    if (!src?.ok) return { ok: false, error: src?.error || `choose the ${noun} to release` };
    const md = mediaRow(src.platformMediaId);
    if (!md || md.author !== userId || md.mediaType !== "video") return { ok: false, error: `the ${noun} must be a video you uploaded` };
    const title = cleanText(params.title, 160) || cleanText(src.title, 160);
    if (!title) return { ok: false, error: "title required" };
    const logline = cleanText(params.logline, 600);
    const price = params.priceCC == null ? 0 : Number(params.priceCC);
    if ((params.priceCC != null && typeof params.priceCC !== "number") || !Number.isFinite(price) || price < 0 || price > RELEASE_MAX_PRICE || r2(price) !== price || (price > 0 && price < 0.5)) {
      return { ok: false, error: `priceCC must be 0 (free) or from 0.5 to ${RELEASE_MAX_PRICE} CC, in cents` };
    }
    const previewSec = params.previewSec == null ? 90 : Math.round(Number(params.previewSec));
    // 0 = no preview (a priced piece only buyers can watch) — allowed where the lens says so.
    const noPreview = previewSec === 0 && price > 0 && cfg.allowNoPreview;
    if (!noPreview && (!Number.isFinite(previewSec) || previewSec < (cfg.minPreviewSec ?? 15) || previewSec > 90)) return { ok: false, error: `previewSec must be from ${cfg.minPreviewSec ?? 15} to 90${cfg.allowNoPreview ? ", or 0 for no preview" : ""}` };
    let posterMediaId = null;
    if (params.posterMediaId) {
      const img = mediaRow(String(params.posterMediaId));
      if (!img || img.author !== userId || img.mediaType !== "image") return { ok: false, error: "the poster must be an image you uploaded" };
      posterMediaId = img.id;
    }
    const runtime = Number(md.duration) || 0;
    // A preview as long as the piece would give it away.
    if (price > 0 && !noPreview && runtime > 0 && previewSec >= runtime) return { ok: false, error: `the preview must be shorter than the ${noun} (${Math.round(runtime * 10) / 10} s)` };
    if ([...s.releases.values()].some((r) => r.platformMediaId === md.id && r.status === "published")) return { ok: false, error: "this video is already released" };
    const r = {
      id: cfg.makeId("rel"), ...(src.fields || {}), [ownerField]: userId, title, logline,
      platformMediaId: md.id, runtimeSec: Math.round((Number(md.duration) || 0) * 10) / 10,
      priceCC: price, previewSec, posterMediaId, status: "published", dtuId: null,
      publishedAt: cfg.now(), createdAt: cfg.now(),
    };
    if (price > 0) {
      if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
      const created = await ctx.macro.run("dtu", "create", {
        title: `${title} — ${noun} · ${r.id.slice(-6)}`, domain: cfg.dtuDomain, source: prefix,
        tags: [prefix],
        human: { summary: logline || `${title}, a ${noun}.` },
        core: { definitions: [], claims: [], examples: [], invariants: [], nextActions: [] },
        meta: { type: cfg.dtuType, releaseId: r.id, mediaId: md.id, ...(posterMediaId ? { posterMediaId } : {}) },
      });
      if (!created?.ok || !created.dtu) return { ok: false, error: created?.error || `could not mint the ${noun}'s DTU` };
      const dtu = STATE()?.dtus?.get?.(created.dtu.id) || created.dtu;
      dtu.scope = "personal";
      dtu.license = { ...(dtu.license || {}), scopes: ["private", "marketplace_sale"] };
      const listed = await ctx.macro.run("marketplace", "list", { dtuId: dtu.id, price, currency: "CC", contentType: cfg.dtuType, title, description: logline.slice(0, 500), tags: [cfg.tag] });
      if (!listed?.ok) return { ok: false, error: listed?.error || `could not list the ${noun}` };
      persistDtu(dtu);
      r.dtuId = dtu.id;
      setMediaSaleTerms(STATE(), md.id, userId, { streaming: "preview", price, previewSec });
    } else {
      setMediaSaleTerms(STATE(), md.id, userId, { streaming: "full", price: 0 });
    }
    // Public: anyone may watch a free one in full, or a priced one's preview.
    setMediaPrivacy(STATE(), md.id, "public");
    if (posterMediaId) setMediaPrivacy(STATE(), posterMediaId, "public");
    s.releases.set(r.id, r);
    cfg.save();
    return { ok: true, result: { release: view(s, r, userId) } };
  });

  registerLensAction(domain, `${prefix}-list`, (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx);
    let list = [...s.releases.values()];
    if (params.mine) list = list.filter((r) => r[ownerField] === userId);
    else if (params.owned) list = list.filter((r) => userId && owners(s, r.id).includes(userId));
    else list = list.filter((r) => r.status === "published");
    if (cfg.filter) list = list.filter((r) => cfg.filter(r, params));
    list.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return { ok: true, result: { releases: list.slice(0, 120).map((r) => view(s, r, userId)), count: list.length } };
  });

  registerLensAction(domain, `${prefix}-get`, (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = ID_RE.test(String(params.id || "")) ? s.releases.get(String(params.id)) : null;
    const userId = me(ctx);
    if (!r || (r.status !== "published" && r[ownerField] !== userId && !owners(s, r.id).includes(userId))) return { ok: false, error: `${noun} not found` };
    return { ok: true, result: { release: view(s, r, userId) } };
  });

  registerLensAction(domain, `${prefix}-buy`, async (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx); if (!userId) return { ok: false, error: "sign in to buy" };
    const r = s.releases.get(String(params.id || ""));
    if (!r || r.status !== "published") return { ok: false, error: `${noun} not found` };
    if (r[ownerField] === userId) return { ok: false, error: `this is your own ${noun}` };
    if (owners(s, r.id).includes(userId)) return { ok: false, error: "already in your library" };
    if (!(r.priceCC > 0)) return { ok: false, error: `this ${noun} is free: just watch it` };
    if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
    const paid = await ctx.macro.run("marketplace", "purchaseWithRoyalties", { dtuId: r.dtuId });
    if (!paid?.ok) {
      if (paid?.error === "insufficient_balance") return { ok: false, error: `not enough Concord Coin: this ${noun} is ${r.priceCC} CC and you have ${r2(Number(paid.balance) || 0)} CC`, reason: "insufficient_balance" };
      return { ok: false, error: paid?.error || "the purchase did not go through" };
    }
    s.releaseOwners.set(r.id, [...owners(s, r.id), userId]);
    grantMediaEntitlement(STATE(), r.platformMediaId, userId);
    cfg.save();
    return { ok: true, result: { release: view(s, r, userId), price: r.priceCC } };
  });

  registerLensAction(domain, `${prefix}-update`, (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx);
    const r = s.releases.get(String(params.id || ""));
    if (!r || r[ownerField] !== userId) return { ok: false, error: `${noun} not found` };
    if (params.logline !== undefined) r.logline = cleanText(params.logline, 600);
    if (params.title !== undefined) { const t = cleanText(params.title, 160); if (!t) return { ok: false, error: "title required" }; r.title = t; }
    if (params.priceCC !== undefined) {
      const p = Number(params.priceCC);
      if (typeof params.priceCC !== "number" || !Number.isFinite(p) || p < 0.5 || p > RELEASE_MAX_PRICE || r2(p) !== p) return { ok: false, error: `priceCC must be from 0.5 to ${RELEASE_MAX_PRICE} CC, in cents` };
      if (!(r.priceCC > 0)) return { ok: false, error: `a free ${noun} stays free; release a new cut to sell one` };
      const dtu = STATE()?.dtus?.get?.(r.dtuId);
      if (dtu?.marketplace) { dtu.marketplace.price = p; persistDtu(dtu); }
      r.priceCC = p;
      setMediaSaleTerms(STATE(), r.platformMediaId, userId, { streaming: "preview", price: p, previewSec: r.previewSec });
    }
    cfg.save();
    return { ok: true, result: { release: view(s, r, userId) } };
  });

  /** Stop releasing it. Buyers keep theirs. */
  registerLensAction(domain, `${prefix}-withdraw`, (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx);
    const r = s.releases.get(String(params.id || ""));
    if (!r || r[ownerField] !== userId) return { ok: false, error: `${noun} not found` };
    if (r.status !== "published") return { ok: false, error: "already withdrawn" };
    r.status = "withdrawn";
    if (r.priceCC > 0) {
      const dtu = STATE()?.dtus?.get?.(r.dtuId);
      if (dtu?.marketplace) { dtu.marketplace.listed = false; persistDtu(dtu); }
    }
    // Off the shelf: private again. Buyers keep it through their licence.
    setMediaPrivacy(STATE(), r.platformMediaId, "private");
    cfg.save();
    return { ok: true, result: { release: view(s, r, userId) } };
  });

  return { store, canWatchFull, view, streamOf, owners, me, Noun };
}
