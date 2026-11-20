// server/domains/film-releases.js
//
// Finished films. A filmmaker releases a film (an uploaded video of theirs)
// from a production, free or priced in Concord Coin:
//   - free: the video goes public and anyone can watch it in full
//   - priced: it is minted as a DTU and listed through the one marketplace
//     money path (purchaseWithRoyalties: 95% creator pool, 5% platform), and
//     the video's own stream serves non-buyers only the preview window
//     (setMediaSaleTerms) — the lock is at the media route, not in the page
// Buyers are entitled to the full stream for good, even if sales stop.
// A watch party can screen a released film for everyone who may watch it.

import { getMediaDTU, setMediaSaleTerms, grantMediaEntitlement, setMediaPrivacy } from "../lib/media-dtu.js";

const STATE = () => globalThis._concordSTATE;
const persistDtu = (d) => { try { globalThis._concordUpsertDTU?.(d); } catch { /* in-memory copy still serves */ } };
const MAX_PRICE = 1000;
const ID_RE = /^[A-Za-z0-9_:-]{3,120}$/;
const r2 = (n) => Math.round(n * 100) / 100;

/** A person's public name: their username, never an email. */
function displayName(userId) {
  try {
    const row = STATE()?.db?.prepare?.("SELECT username FROM users WHERE id = ?").get(String(userId));
    return row?.username ? String(row.username).slice(0, 40) : null;
  } catch { return null; }
}
if (typeof globalThis._concordDisplayName !== "function") globalThis._concordDisplayName = displayName;

export default function registerFilmReleases(registerLensAction, h) {
  const { getFmState, getFmExtra, saveFmState, fmAid, fmClean, fmNum, fmId, fmNow, fmProject } = h;
  const me = (ctx) => { const id = fmAid(ctx); return id && id !== "anon" ? id : null; };

  function store() {
    const s = getFmState(); if (!s) return null;
    if (!(s.releases instanceof Map)) s.releases = new Map();        // releaseId → release
    if (!(s.releaseOwners instanceof Map)) s.releaseOwners = new Map(); // releaseId → userId[]
    return s;
  }
  const owners = (s, id) => s.releaseOwners.get(id) || [];
  const mediaRow = (id) => getMediaDTU(STATE(), id)?.mediaDTU || null;

  /** May this person watch the whole film? */
  function canWatchFull(s, r, userId) {
    if (!r) return false;
    const mine = !!userId && (r.filmmakerId === userId || owners(s, r.id).includes(userId));
    // Withdrawn: no longer offered, but whoever bought it keeps it.
    if (r.status !== "published") return mine;
    if (!(r.priceCC > 0)) return true;
    return mine;
  }
  const streamOf = (r) => `/api/media/${encodeURIComponent(r.platformMediaId)}/stream`;
  globalThis._concordFilmReleaseStream = (releaseId, userId) => {
    const s = store(); const r = s?.releases.get(releaseId);
    return r && canWatchFull(s, r, userId) ? streamOf(r) : null;
  };

  function credits(s, r) {
    const pick = (map) => (map.get(r.filmmakerId) || []).filter((x) => x.projectId === r.projectId);
    return {
      cast: pick(s.cast).slice(0, 40).map((c) => ({ name: c.name, role: c.characterName || c.role || null })),
      crew: pick(s.crew).slice(0, 40).map((c) => ({ name: c.name, role: c.position || c.department || null })),
    };
  }
  function view(s, r, userId) {
    const full = canWatchFull(s, r, userId);
    return {
      id: r.id, title: r.title, logline: r.logline, runtimeSec: r.runtimeSec,
      priceCC: r.priceCC, previewSec: r.priceCC > 0 ? r.previewSec : null,
      poster: r.posterMediaId ? `/api/media/${encodeURIComponent(r.posterMediaId)}/stream` : null,
      filmmaker: { name: displayName(r.filmmakerId) || "A filmmaker", isMe: r.filmmakerId === userId },
      status: r.status, publishedAt: r.publishedAt,
      owned: !!userId && owners(s, r.id).includes(userId),
      canWatchFull: full,
      streamUrl: streamOf(r),
      buyers: r.filmmakerId === userId ? owners(s, r.id).length : null,
      credits: credits(s, r),
    };
  }

  registerLensAction("film-studios", "film-release-create", async (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx); if (!userId) return { ok: false, error: "sign in to release a film" };
    if (!fmProject(s, userId, params.projectId)) return { ok: false, error: "project not found" };
    const x = getFmExtra();
    const media = (x.media.get(userId) || []).find((m) => m.id === params.mediaId && m.projectId === String(params.projectId));
    if (!media || !media.platformMediaId) return { ok: false, error: "choose an uploaded video from this production" };
    const md = mediaRow(media.platformMediaId);
    if (!md || md.author !== userId || md.mediaType !== "video") return { ok: false, error: "the film must be a video you uploaded" };
    const title = fmClean(params.title, 160) || fmClean(media.name, 160);
    if (!title) return { ok: false, error: "title required" };
    const logline = String(params.logline ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 600);
    const price = params.priceCC == null ? 0 : Number(params.priceCC);
    if ((params.priceCC != null && typeof params.priceCC !== "number") || !Number.isFinite(price) || price < 0 || price > MAX_PRICE || r2(price) !== price || (price > 0 && price < 0.5)) {
      return { ok: false, error: `priceCC must be 0 (free) or from 0.5 to ${MAX_PRICE} CC, in cents` };
    }
    const previewSec = params.previewSec == null ? 90 : Math.round(fmNum(params.previewSec));
    if (previewSec < 15 || previewSec > 90) return { ok: false, error: "previewSec must be from 15 to 90" };
    let posterMediaId = null;
    if (params.posterMediaId) {
      const img = mediaRow(String(params.posterMediaId));
      if (!img || img.author !== userId || img.mediaType !== "image") return { ok: false, error: "the poster must be an image you uploaded" };
      posterMediaId = img.id;
    }
    if ([...s.releases.values()].some((r) => r.platformMediaId === md.id && r.status === "published")) return { ok: false, error: "this video is already released" };
    const r = {
      id: fmId("rel"), projectId: String(params.projectId), filmmakerId: userId, title, logline,
      mediaId: media.id, platformMediaId: md.id,
      runtimeSec: Math.round(Number(md.duration) || media.durationSec || 0),
      priceCC: price, previewSec, posterMediaId, status: "published", dtuId: null,
      publishedAt: fmNow(), createdAt: fmNow(),
    };
    if (price > 0) {
      if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
      const created = await ctx.macro.run("dtu", "create", {
        title: `${title} — film · ${r.id.slice(-6)}`, domain: "film", source: "film-release",
        tags: ["film-release"],
        human: { summary: logline || `${title}, a film.` },
        core: { definitions: [], claims: [], examples: [], invariants: [], nextActions: [] },
        meta: { type: "film_release", releaseId: r.id, mediaId: md.id, ...(posterMediaId ? { posterMediaId } : {}) },
      });
      if (!created?.ok || !created.dtu) return { ok: false, error: created?.error || "could not mint the film's DTU" };
      const dtu = STATE()?.dtus?.get?.(created.dtu.id) || created.dtu;
      dtu.scope = "personal";
      dtu.license = { ...(dtu.license || {}), scopes: ["private", "marketplace_sale"] };
      const listed = await ctx.macro.run("marketplace", "list", { dtuId: dtu.id, price, currency: "CC", contentType: "film_release", title, description: logline.slice(0, 500), tags: ["film"] });
      if (!listed?.ok) return { ok: false, error: listed?.error || "could not list the film" };
      persistDtu(dtu);
      r.dtuId = dtu.id;
      setMediaSaleTerms(STATE(), md.id, userId, { streaming: "preview", price, previewSec });
      // Public so anyone can watch the preview; the full film stays gated by purchase.
      setMediaPrivacy(STATE(), md.id, "public");
    } else {
      setMediaSaleTerms(STATE(), md.id, userId, { streaming: "full", price: 0 });
      setMediaPrivacy(STATE(), md.id, "public");
    }
    if (posterMediaId) setMediaPrivacy(STATE(), posterMediaId, "public");
    s.releases.set(r.id, r);
    saveFmState();
    return { ok: true, result: { release: view(s, r, userId) } };
  });

  registerLensAction("film-studios", "film-release-list", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx);
    let list = [...s.releases.values()];
    if (params.mine) list = list.filter((r) => r.filmmakerId === userId);
    else if (params.owned) list = list.filter((r) => userId && owners(s, r.id).includes(userId));
    else list = list.filter((r) => r.status === "published");
    if (params.projectId) list = list.filter((r) => r.projectId === String(params.projectId));
    list.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return { ok: true, result: { releases: list.slice(0, 120).map((r) => view(s, r, userId)), count: list.length } };
  });

  registerLensAction("film-studios", "film-release-get", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = ID_RE.test(String(params.id || "")) ? s.releases.get(String(params.id)) : null;
    const userId = me(ctx);
    if (!r || (r.status !== "published" && r.filmmakerId !== userId && !owners(s, r.id).includes(userId))) return { ok: false, error: "film not found" };
    return { ok: true, result: { release: view(s, r, userId) } };
  });

  registerLensAction("film-studios", "film-release-buy", async (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx); if (!userId) return { ok: false, error: "sign in to buy" };
    const r = s.releases.get(String(params.id || ""));
    if (!r || r.status !== "published") return { ok: false, error: "film not found" };
    if (r.filmmakerId === userId) return { ok: false, error: "this is your own film" };
    if (owners(s, r.id).includes(userId)) return { ok: false, error: "already in your library" };
    if (!(r.priceCC > 0)) return { ok: false, error: "this film is free: just watch it" };
    if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
    const paid = await ctx.macro.run("marketplace", "purchaseWithRoyalties", { dtuId: r.dtuId });
    if (!paid?.ok) {
      if (paid?.error === "insufficient_balance") return { ok: false, error: `not enough Concord Coin: this film is ${r.priceCC} CC and you have ${r2(Number(paid.balance) || 0)} CC`, reason: "insufficient_balance" };
      return { ok: false, error: paid?.error || "the purchase did not go through" };
    }
    s.releaseOwners.set(r.id, [...owners(s, r.id), userId]);
    grantMediaEntitlement(STATE(), r.platformMediaId, userId);
    saveFmState();
    return { ok: true, result: { release: view(s, r, userId), price: r.priceCC } };
  });

  registerLensAction("film-studios", "film-release-update", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx);
    const r = s.releases.get(String(params.id || ""));
    if (!r || r.filmmakerId !== userId) return { ok: false, error: "film not found" };
    if (params.logline !== undefined) r.logline = String(params.logline ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 600);
    if (params.title !== undefined) { const t = fmClean(params.title, 160); if (!t) return { ok: false, error: "title required" }; r.title = t; }
    if (params.priceCC !== undefined) {
      const p = Number(params.priceCC);
      if (typeof params.priceCC !== "number" || !Number.isFinite(p) || p < 0.5 || p > MAX_PRICE || r2(p) !== p) return { ok: false, error: `priceCC must be from 0.5 to ${MAX_PRICE} CC, in cents` };
      if (!(r.priceCC > 0)) return { ok: false, error: "a free film stays free; release a new cut to sell one" };
      const dtu = STATE()?.dtus?.get?.(r.dtuId);
      if (dtu?.marketplace) { dtu.marketplace.price = p; persistDtu(dtu); }
      r.priceCC = p;
      setMediaSaleTerms(STATE(), r.platformMediaId, userId, { streaming: "preview", price: p, previewSec: r.previewSec });
    }
    saveFmState();
    return { ok: true, result: { release: view(s, r, userId) } };
  });

  /** Stop releasing it. Buyers keep their film; a free film goes private. */
  registerLensAction("film-studios", "film-release-withdraw", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx);
    const r = s.releases.get(String(params.id || ""));
    if (!r || r.filmmakerId !== userId) return { ok: false, error: "film not found" };
    if (r.status !== "published") return { ok: false, error: "already withdrawn" };
    r.status = "withdrawn";
    if (r.priceCC > 0) {
      const dtu = STATE()?.dtus?.get?.(r.dtuId);
      if (dtu?.marketplace) { dtu.marketplace.listed = false; persistDtu(dtu); }
    }
    // Off the shelf: private again. Buyers keep it through their licence.
    setMediaPrivacy(STATE(), r.platformMediaId, "private");
    saveFmState();
    return { ok: true, result: { release: view(s, r, userId) } };
  });

  /** Screen a released film for everyone you invite who may watch it. */
  registerLensAction("film-studios", "film-release-party", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = me(ctx); if (!userId) return { ok: false, error: "sign in to host a screening" };
    const r = s.releases.get(String(params.id || ""));
    if (!r || r.status !== "published") return { ok: false, error: "film not found" };
    if (!canWatchFull(s, r, userId)) return { ok: false, error: "get the film before hosting a screening" };
    const x = getFmExtra();
    const code = `FILM-${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const party = {
      id: fmId("pty"), projectId: null, releaseId: r.id, title: fmClean(params.title, 120) || `Screening: ${r.title}`,
      code, versionId: null, host: userId, playing: false, positionSec: 0, updatedAt: fmNow(),
      participants: [userId], createdAt: fmNow(),
    };
    if (!(x.parties.get(userId) instanceof Array)) x.parties.set(userId, []);
    x.parties.get(userId).push(party);
    x.partyChat.set(party.id, []);
    saveFmState();
    return { ok: true, result: { party } };
  });
}
