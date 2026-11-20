// server/domains/podcast-studio.js
//
// The creator side of the Podcast lens and the listener's money:
//   - show profile (title, author, description, category, language, explicit,
//     cover image from the creator's own upload)
//   - a real public RSS feed per show (GET /api/podcast/shows/:id/feed.xml),
//     valid for Apple Podcasts / Spotify, published episodes only, audio
//     served from Concord; a WebVTT transcript route for the feed's
//     <podcast:transcript>
//   - tips in Concord Coin (the platform tipContent path: a TRANSFER on the
//     ledger, recorded in the tips table)
//   - a supporter pass per show, sold through the one marketplace money path
//     (purchaseWithRoyalties: 95% creator pool, 5% platform), unlocking the
//     show's supporters-only episodes. The audio of those episodes is gated by
//     the media stream route itself (a priced commercial tier → non-holders get
//     the preview window), so the lock is server-side, not a UI pretence.
//   - importing a feed's own timed transcript (Podcasting 2.0)
//
// State lives in the same STATE.podcastLens store as the listening engine.

import { tipContent } from "../economy/lens-economy-wiring.js";
import { getBalance } from "../economy/balances.js";
import { FEES } from "../economy/fees.js";

/** The ledger fee on a tip (a TRANSFER), so the UI can say what the creator gets. */
export const TIP_FEE_RATE = FEES.TRANSFER;
import { getMediaDTU, setMediaSaleTerms, grantMediaEntitlement } from "../lib/media-dtu.js";
import { fetchPublicUrl } from "../lib/public-fetch.js";
import { parseTranscript, toVtt } from "../lib/podcast-transcript.js";

export const PREVIEW_SEC = 90;              // what a non-supporter hears of a supporters-only episode
export const MAX_PASS_PRICE = 500;
export const MAX_TIP = 1000;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const ID_RE = /^[A-Za-z0-9_:-]{3,120}$/;
// Apple Podcasts top-level categories (the feed's itunes:category must be one).
export const APPLE_CATEGORIES = Object.freeze([
  "Arts", "Business", "Comedy", "Education", "Fiction", "Government", "History", "Health & Fitness",
  "Kids & Family", "Leisure", "Music", "News", "Religion & Spirituality", "Science", "Society & Culture",
  "Sports", "Technology", "True Crime", "TV & Film",
]);

const r2 = (n) => Math.round(n * 100) / 100;
const STATE = () => globalThis._concordSTATE;
const persistDtu = (dtu) => {
  try { if (typeof globalThis._concordUpsertDTU === "function") globalThis._concordUpsertDTU(dtu); } catch { /* in-memory copy still serves */ }
};
const mediaOf = (id) => (id ? getMediaDTU(STATE(), id)?.mediaDTU || null : null);

/** Supporters of a show (userIds who hold its pass). */
export function supportersOf(s, showId) {
  if (!(s.supporters instanceof Map)) s.supporters = new Map();
  return s.supporters.get(showId) || [];
}

/** May this listener hear the whole of this episode? */
export function mayHearFull(s, ep, userId, mayEdit) {
  if (!ep) return false;
  if ((ep.access || "everyone") !== "supporters") return true;
  if (userId && userId !== "anon" && mayEdit(s, ep, userId)) return true;
  return !!userId && supportersOf(s, ep.showId).includes(userId);
}

/** Access fields for any episode view. */
export function accessView(s, ep, userId, mayEdit) {
  const access = ep.access === "supporters" ? "supporters" : "everyone";
  const full = mayHearFull(s, ep, userId, mayEdit);
  return { access, locked: !full, previewSec: full ? null : PREVIEW_SEC };
}

/** Trim a transcript to what a locked listener may read. */
export function lockedTranscript(segments) {
  const timed = segments.some((x) => Number.isFinite(x.startSec));
  return timed ? segments.filter((x) => Number.isFinite(x.startSec) && x.startSec < PREVIEW_SEC) : segments.slice(0, 3);
}

const xmlEsc = (v) => String(v ?? "")
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const hms = (sec) => {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const rfc822 = (dateStr) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr)) ? `${dateStr}T12:00:00Z` : dateStr);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
};

/** The episodes a public feed carries: published, for everyone, audio uploaded to Concord and public. */
export function feedEpisodes(s, show) {
  return (s.episodes.get(show.id) || [])
    .filter((ep) => ep.status === "published" && (ep.access || "everyone") === "everyone" && ep.mediaId)
    .filter((ep) => {
      const m = mediaOf(ep.mediaId);
      return m && (m.privacy || "public") === "public" && m.author === show.addedBy && m.mediaType === "audio";
    })
    .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** What a show still needs before Apple Podcasts will accept its feed. */
export function feedReadiness(s, show) {
  const eps = feedEpisodes(s, show);
  const cover = mediaOf(show.coverMediaId);
  return [
    { id: "title", ok: !!show.title, label: "A show title" },
    { id: "author", ok: !!show.author, label: "An author name" },
    { id: "description", ok: !!show.description && show.description.length >= 20, label: "A description of at least 20 characters" },
    { id: "category", ok: APPLE_CATEGORIES.includes(show.appleCategory), label: "An Apple Podcasts category" },
    { id: "cover", ok: !!cover && cover.mediaType === "image", label: "Cover art (Apple asks for a square 1400–3000 px JPEG or PNG)" },
    { id: "episode", ok: eps.length > 0, label: "At least one published episode for everyone, with audio uploaded here" },
  ];
}

/** RSS 2.0 + iTunes + Podcasting 2.0 namespaces. */
export function buildShowFeed(s, show, origin) {
  const eps = feedEpisodes(s, show);
  const self = `${origin}/api/podcast/shows/${encodeURIComponent(show.id)}/feed.xml`;
  const cover = mediaOf(show.coverMediaId);
  const coverUrl = cover ? `${origin}/api/media/${encodeURIComponent(cover.id)}/stream` : null;
  const transcripts = s.transcripts instanceof Map ? s.transcripts : new Map();
  const items = eps.map((ep) => {
    const m = mediaOf(ep.mediaId);
    const tr = transcripts.get(ep.id);
    const hasTimed = tr && tr.timing === "timed";
    return [
      "    <item>",
      `      <title>${xmlEsc(ep.title)}</title>`,
      `      <guid isPermaLink="false">${xmlEsc(`concord:${ep.id}`)}</guid>`,
      `      <pubDate>${rfc822(ep.publishDate)}</pubDate>`,
      ep.description ? `      <description>${xmlEsc(ep.description)}</description>` : null,
      `      <enclosure url="${xmlEsc(`${origin}/api/media/${encodeURIComponent(ep.mediaId)}/stream`)}" length="${Math.max(0, Number(m?.fileSize) || 0)}" type="${xmlEsc(m?.mimeType || "audio/mpeg")}"/>`,
      ep.durationSec > 0 ? `      <itunes:duration>${hms(ep.durationSec)}</itunes:duration>` : null,
      ep.episodeNumber ? `      <itunes:episode>${ep.episodeNumber}</itunes:episode>` : null,
      ep.seasonNumber ? `      <itunes:season>${ep.seasonNumber}</itunes:season>` : null,
      "      <itunes:episodeType>full</itunes:episodeType>",
      `      <itunes:explicit>${show.explicit ? "true" : "false"}</itunes:explicit>`,
      hasTimed ? `      <podcast:transcript url="${xmlEsc(`${origin}/api/podcast/episodes/${encodeURIComponent(ep.id)}/transcript.vtt`)}" type="text/vtt"/>` : null,
      "    </item>",
    ].filter(Boolean).join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlEsc(show.title)}</title>`,
    `    <link>${xmlEsc(`${origin}/lenses/podcast?show=${encodeURIComponent(show.id)}`)}</link>`,
    `    <atom:link href="${xmlEsc(self)}" rel="self" type="application/rss+xml"/>`,
    `    <description>${xmlEsc(show.description || show.title)}</description>`,
    `    <language>${xmlEsc(show.language || "en")}</language>`,
    show.author ? `    <itunes:author>${xmlEsc(show.author)}</itunes:author>` : null,
    coverUrl ? `    <itunes:image href="${xmlEsc(coverUrl)}"/>` : null,
    APPLE_CATEGORIES.includes(show.appleCategory) ? `    <itunes:category text="${xmlEsc(show.appleCategory)}"/>` : null,
    `    <itunes:explicit>${show.explicit ? "true" : "false"}</itunes:explicit>`,
    "    <itunes:type>episodic</itunes:type>",
    `    <podcast:guid>${xmlEsc(show.id)}</podcast:guid>`,
    "    <generator>Concord</generator>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].filter((l) => l !== null).join("\n");
}

/** Origin for absolute URLs in the feed: the configured public origin, else the request's. */
function originFor(req) {
  const env = String(process.env.CONCORD_PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^/\s]+$/.test(env)) return env;
  const host = String(req.get("host") || "").replace(/[^A-Za-z0-9.:[\]-]/g, "");
  return `${req.protocol === "https" ? "https" : "http"}://${host || "localhost"}`;
}

/** GET /api/podcast/shows/:id/feed.xml and GET /api/podcast/episodes/:id/transcript.vtt (public). */
export function mountPodcastPublicRoutes(app) {
  app.get("/api/podcast/shows/:id/feed.xml", (req, res) => {
    const s = STATE()?.podcastLens;
    const id = String(req.params.id || "");
    const show = ID_RE.test(id) && s?.shows instanceof Map ? s.shows.get(id) : null;
    if (!show || !show.isCreatorShow) return res.status(404).type("text/plain").send("No such show.");
    res.set("Cache-Control", "public, max-age=300");
    res.type("application/rss+xml; charset=utf-8").send(buildShowFeed(s, show, originFor(req)));
  });
  app.get("/api/podcast/episodes/:id/transcript.vtt", (req, res) => {
    const s = STATE()?.podcastLens;
    const id = String(req.params.id || "");
    if (!ID_RE.test(id) || !(s?.episodes instanceof Map)) return res.status(404).type("text/plain").send("No such transcript.");
    let ep = null;
    for (const list of s.episodes.values()) { ep = list.find((x) => x.id === id); if (ep) break; }
    const show = ep ? s.shows.get(ep.showId) : null;
    const tr = ep && s.transcripts instanceof Map ? s.transcripts.get(ep.id) : null;
    // Only what the public feed itself carries: published, for everyone, timed.
    if (!ep || !show?.isCreatorShow || ep.status !== "published" || (ep.access || "everyone") !== "everyone" || !tr || tr.timing !== "timed") {
      return res.status(404).type("text/plain").send("No such transcript.");
    }
    res.set("Cache-Control", "public, max-age=300");
    res.type("text/vtt; charset=utf-8").send(toVtt(tr.segments));
  });
}

export default function registerPodcastStudio(registerLensAction, h) {
  const { getPodState, savePodState, pcaid, pcclean, pcnum, pcnow, findEpisode, mayEditEpisode } = h;
  const me = (ctx) => { const id = pcaid(ctx); return id && id !== "anon" ? id : null; };
  const dbOf = (ctx) => ctx?.db || STATE()?.db || null;
  const passes = (s) => { if (!(s.passes instanceof Map)) s.passes = new Map(); return s.passes; };

  const ownShow = (s, ctx, showId) => {
    const show = s.shows.get(String(showId || ""));
    if (!show) return { error: "show not found" };
    if (!show.isCreatorShow || show.addedBy !== me(ctx)) return { error: "only the show's creator can do that" };
    return { show };
  };

  function passView(s, show, userId) {
    const pass = passes(s).get(show.id) || null;
    const sups = supportersOf(s, show.id);
    return {
      showId: show.id,
      hasPass: !!pass,
      priceCC: pass ? pass.priceCC : null,
      perks: pass ? pass.perks : null,
      supporter: !!userId && sups.includes(userId),
      isCreator: !!userId && show.addedBy === userId,
      // The count is the creator's to see; listeners see whether they support.
      supporterCount: userId && show.addedBy === userId ? sups.length : null,
      tipFeeRate: TIP_FEE_RATE,
      supportersOnlyEpisodes: (s.episodes.get(show.id) || []).filter((e) => e.access === "supporters" && e.status === "published").length,
    };
  }

  /** Make a supporters-only episode's audio gated, and let every current supporter in. */
  function gateEpisodeMedia(s, show, ep) {
    const pass = passes(s).get(show.id);
    if (!pass || !ep.mediaId) return;
    setMediaSaleTerms(STATE(), ep.mediaId, show.addedBy, { streaming: "preview", price: pass.priceCC, previewSec: PREVIEW_SEC });
    for (const uid of supportersOf(s, show.id)) grantMediaEntitlement(STATE(), ep.mediaId, uid);
  }

  // ── show profile ───────────────────────────────────────────────────
  registerLensAction("podcast", "show-update", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = ownShow(s, ctx, params.showId);
    if (got.error) return { ok: false, error: got.error };
    const show = got.show;
    const next = {};
    if (params.title !== undefined) { const t = pcclean(params.title, 160); if (!t) return { ok: false, error: "show title required" }; next.title = t; }
    if (params.author !== undefined) next.author = pcclean(params.author, 120) || null;
    if (params.description !== undefined) next.description = String(params.description ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 4000) || null;
    if (params.appleCategory !== undefined) {
      if (params.appleCategory !== null && !APPLE_CATEGORIES.includes(params.appleCategory)) return { ok: false, error: "appleCategory must be one of Apple Podcasts' categories" };
      next.appleCategory = params.appleCategory || null;
    }
    if (params.language !== undefined) {
      const l = String(params.language || "").trim();
      if (l && !LANG_RE.test(l)) return { ok: false, error: "language must be a code like en or en-GB" };
      next.language = l || "en";
    }
    if (params.explicit !== undefined) {
      if (typeof params.explicit !== "boolean") return { ok: false, error: "explicit must be true or false" };
      next.explicit = params.explicit;
    }
    if (params.coverMediaId !== undefined) {
      if (params.coverMediaId === null) next.coverMediaId = null;
      else {
        const m = mediaOf(pcclean(params.coverMediaId, 120));
        if (!m || m.author !== show.addedBy) return { ok: false, error: "cover image not found among your uploads" };
        if (m.mediaType !== "image") return { ok: false, error: "the cover must be an image" };
        next.coverMediaId = m.id;
      }
    }
    Object.assign(show, next, { updatedAt: pcnow() });
    // Episodes carry the show's title for listing.
    if (next.title) for (const ep of s.episodes.get(show.id) || []) ep.showTitle = next.title;
    savePodState();
    return { ok: true, result: { show, readiness: feedReadiness(s, show) } };
  });

  /** The show's public feed: its path and what it still needs. */
  registerLensAction("podcast", "show-feed-info", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = ownShow(s, ctx, params.showId);
    if (got.error) return { ok: false, error: got.error };
    const readiness = feedReadiness(s, got.show);
    return {
      ok: true,
      result: {
        feedPath: `/api/podcast/shows/${encodeURIComponent(got.show.id)}/feed.xml`,
        readiness,
        ready: readiness.every((x) => x.ok),
        episodesInFeed: feedEpisodes(s, got.show).length,
        categories: APPLE_CATEGORIES,
      },
    };
  });

  // ── tips ───────────────────────────────────────────────────────────
  registerLensAction("podcast", "show-tip", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tipper = me(ctx);
    if (!tipper) return { ok: false, error: "sign in to tip" };
    const db = dbOf(ctx);
    if (!db) return { ok: false, error: "the ledger is not available" };
    const show = s.shows.get(String(params.showId || ""));
    if (!show) return { ok: false, error: "show not found" };
    // Only a show made here has a creator to pay. A show added from someone's
    // RSS feed was added by a listener; tipping them would pay the wrong person.
    if (!show.isCreatorShow) return { ok: false, error: "this show comes from an outside feed; tips go to shows made on Concord" };
    if (show.addedBy === tipper) return { ok: false, error: "you can't tip your own show" };
    const amount = Number(params.amount);
    if (typeof params.amount !== "number" || !Number.isFinite(amount) || amount < 0.5 || amount > MAX_TIP || r2(amount) !== amount) {
      return { ok: false, error: `a tip is from 0.5 to ${MAX_TIP} CC, in cents` };
    }
    let contentId = show.id;
    if (params.episodeId) {
      const ep = findEpisode(s, String(params.episodeId));
      if (!ep || ep.showId !== show.id || ep.status !== "published") return { ok: false, error: "episode not found on this show" };
      contentId = ep.id;
    }
    const balance = getBalance(db, tipper).balance;
    if (balance < amount) return { ok: false, error: `not enough Concord Coin: this tip is ${amount} CC and you have ${r2(balance)} CC`, reason: "insufficient_balance", balance };
    const r = tipContent(db, { tipperId: tipper, creatorId: show.addedBy, contentId, contentType: params.episodeId ? "podcast_episode" : "podcast_show", lensId: "podcast", amount, requestId: ctx?.requestId });
    if (!r.ok) return { ok: false, error: r.error === "insufficient_balance" ? "not enough Concord Coin" : (r.error || "the tip did not go through") };
    return { ok: true, result: { amount, creatorGets: r2(amount * (1 - TIP_FEE_RATE)), feeRate: TIP_FEE_RATE, showId: show.id, episodeId: params.episodeId || null, balance: r2(getBalance(db, tipper).balance) } };
  });

  // ── supporter pass ─────────────────────────────────────────────────
  registerLensAction("podcast", "supporter-pass-set", async (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = ownShow(s, ctx, params.showId);
    if (got.error) return { ok: false, error: got.error };
    const show = got.show;
    const price = Number(params.priceCC);
    if (typeof params.priceCC !== "number" || !Number.isFinite(price) || price < 1 || price > MAX_PASS_PRICE || r2(price) !== price) {
      return { ok: false, error: `priceCC must be from 1 to ${MAX_PASS_PRICE} CC, in cents` };
    }
    const perks = String(params.perks ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 600);
    const existing = passes(s).get(show.id);
    if (existing) {
      // Re-pricing: the listing's price is the one the purchase path charges.
      const dtu = STATE()?.dtus?.get?.(existing.dtuId);
      if (dtu?.marketplace) { dtu.marketplace.price = price; persistDtu(dtu); }
      existing.priceCC = price;
      existing.perks = perks || existing.perks;
      existing.updatedAt = pcnow();
      for (const ep of s.episodes.get(show.id) || []) if (ep.access === "supporters") gateEpisodeMedia(s, show, ep);
      savePodState();
      return { ok: true, result: passView(s, show, me(ctx)) };
    }
    if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
    const created = await ctx.macro.run("dtu", "create", {
      title: `Supporter pass — ${show.title} · ${show.id.slice(-6)}`,
      domain: "podcast",
      source: "podcast-supporter-pass",
      tags: ["podcast-supporter-pass"],
      human: { summary: `Supporter pass for ${show.title}: every supporters-only episode, now and later.${perks ? ` ${perks}` : ""}` },
      core: { definitions: [], claims: [], examples: [], invariants: [], nextActions: [] },
      meta: { type: "podcast_supporter_pass", showId: show.id },
    });
    if (!created?.ok || !created.dtu) return { ok: false, error: created?.error || created?.reason || "could not make the pass" };
    const dtu = STATE()?.dtus?.get?.(created.dtu.id) || created.dtu;
    dtu.scope = "personal";
    dtu.license = { ...(dtu.license || {}), scopes: ["private", "marketplace_sale"] };
    const listed = await ctx.macro.run("marketplace", "list", {
      dtuId: dtu.id, price, currency: "CC", contentType: "podcast_supporter_pass",
      title: `Supporter pass — ${show.title}`, description: perks.slice(0, 500), tags: ["podcast", "supporter-pass"],
    });
    if (!listed?.ok) return { ok: false, error: listed?.error || "could not list the pass" };
    persistDtu(dtu);
    passes(s).set(show.id, { dtuId: dtu.id, priceCC: price, perks: perks || null, createdAt: pcnow() });
    savePodState();
    return { ok: true, result: passView(s, show, me(ctx)) };
  });

  registerLensAction("podcast", "supporter-status", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const show = s.shows.get(String(params.showId || ""));
    if (!show) return { ok: false, error: "show not found" };
    return { ok: true, result: passView(s, show, me(ctx)) };
  });

  registerLensAction("podcast", "supporter-pass-buy", async (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const buyer = me(ctx);
    if (!buyer) return { ok: false, error: "sign in to support this show" };
    const show = s.shows.get(String(params.showId || ""));
    if (!show) return { ok: false, error: "show not found" };
    const pass = passes(s).get(show.id);
    if (!pass) return { ok: false, error: "this show has no supporter pass" };
    if (show.addedBy === buyer) return { ok: false, error: "this is your own show" };
    if (supportersOf(s, show.id).includes(buyer)) return { ok: false, error: "you already support this show" };
    if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
    const paid = await ctx.macro.run("marketplace", "purchaseWithRoyalties", { dtuId: pass.dtuId });
    if (!paid?.ok) {
      if (paid?.error === "insufficient_balance") {
        return { ok: false, error: `not enough Concord Coin: the pass is ${pass.priceCC} CC and you have ${r2(Number(paid.balance) || 0)} CC`, reason: "insufficient_balance", balance: paid.balance, price: pass.priceCC };
      }
      return { ok: false, error: paid?.error || "the purchase did not go through" };
    }
    s.supporters.set(show.id, [...supportersOf(s, show.id), buyer]);
    for (const ep of s.episodes.get(show.id) || []) if (ep.access === "supporters" && ep.mediaId) grantMediaEntitlement(STATE(), ep.mediaId, buyer);
    savePodState();
    return { ok: true, result: { ...passView(s, show, buyer), price: pass.priceCC, breakdown: paid.breakdown || null } };
  });

  /** Who hears an episode: everyone, or supporters (with a preview for the rest). */
  registerLensAction("podcast", "episode-set-access", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ep = findEpisode(s, String(params.episodeId || ""));
    if (!ep) return { ok: false, error: "episode not found" };
    const got = ownShow(s, ctx, ep.showId);
    if (got.error || !mayEditEpisode(s, ep, me(ctx))) return { ok: false, error: "only the show's creator can do that" };
    const access = params.access;
    if (access !== "everyone" && access !== "supporters") return { ok: false, error: "access must be everyone or supporters" };
    if (access === "supporters") {
      if (!passes(s).get(ep.showId)) return { ok: false, error: "set up a supporter pass for the show first" };
      const m = mediaOf(ep.mediaId);
      // Only audio stored here can be locked; an outside URL can't be.
      if (!m || m.author !== got.show.addedBy) return { ok: false, error: "only an episode with audio uploaded to Concord can be supporters-only" };
      ep.access = "supporters";
      gateEpisodeMedia(s, got.show, ep);
    } else {
      ep.access = "everyone";
      if (ep.mediaId && mediaOf(ep.mediaId)) setMediaSaleTerms(STATE(), ep.mediaId, got.show.addedBy, { streaming: "full", price: 0 });
      h.syncEpisodeMediaPrivacy?.(ep);
    }
    savePodState();
    return { ok: true, result: { episodeId: ep.id, access: ep.access } };
  });

  /** The creator's takings: tips (from the tips table) and pass sales. */
  registerLensAction("podcast", "show-earnings", (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = ownShow(s, ctx, params.showId);
    if (got.error) return { ok: false, error: got.error };
    const show = got.show;
    const ids = [show.id, ...(s.episodes.get(show.id) || []).map((e) => e.id)];
    let tips = { count: 0, total: 0, recent: [] };
    const db = dbOf(ctx);
    if (db) {
      try {
        const ph = ids.map(() => "?").join(",");
        const agg = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM tips WHERE lens_id = 'podcast' AND creator_id = ? AND content_id IN (${ph})`).get(show.addedBy, ...ids);
        const recent = db.prepare(`SELECT content_id, amount, created_at FROM tips WHERE lens_id = 'podcast' AND creator_id = ? AND content_id IN (${ph}) ORDER BY created_at DESC LIMIT 10`).all(show.addedBy, ...ids);
        tips = { count: agg.n, total: r2(agg.total), recent: recent.map((r) => ({ contentId: r.content_id, amount: r.amount, at: r.created_at })) };
      } catch { /* tips table absent: report zero, not an error */ }
    }
    const pass = passes(s).get(show.id);
    return {
      ok: true,
      result: {
        tips,
        supporters: supportersOf(s, show.id).length,
        passPriceCC: pass ? pass.priceCC : null,
        note: "Tips arrive as spendable CC. Pass sales are marketplace sales: 95% to you, 5% platform fee, withdrawable after the 48-hour hold.",
      },
    };
  });

  // ── a feed's own transcript ────────────────────────────────────────
  registerLensAction("podcast", "transcript-import", async (ctx, _a, params = {}) => {
    const s = getPodState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!me(ctx)) return { ok: false, error: "sign in to fetch a transcript" };
    const ep = findEpisode(s, String(params.episodeId || ""));
    if (!ep) return { ok: false, error: "episode not found" };
    const src = ep.transcriptSource;
    if (!src?.url) return { ok: false, error: "this episode's feed publishes no transcript" };
    let body;
    try {
      const r = await fetchPublicUrl(src.url, { timeoutMs: 9000, maxBytes: 4 * 1024 * 1024 });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      body = await r.text();
    } catch (e) {
      if (e?.code === "SSRF_BLOCKED") return { ok: false, error: "transcript unreachable: that address is not a public web address" };
      return { ok: false, error: `transcript unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    const parsed = parseTranscript(body, src.type);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (!(s.transcripts instanceof Map)) s.transcripts = new Map();
    const transcript = {
      episodeId: ep.id,
      segments: parsed.segments,
      timing: parsed.timing,
      source: "feed",
      sourceUrl: src.url,
      wordCount: parsed.segments.reduce((a, x) => a + x.text.split(/\s+/).length, 0),
      updatedAt: pcnow(),
      updatedBy: me(ctx),
    };
    s.transcripts.set(ep.id, transcript);
    savePodState();
    return { ok: true, result: { episodeId: ep.id, segmentCount: parsed.segments.length, timing: parsed.timing, source: "feed" } };
  });

  void pcnum;
}
