// server/domains/music-releases.js
//
// Music as a real indie platform: an artist uploads tracks (media DTUs via
// POST /api/media/upload-raw), gathers them into a release (single / EP /
// album) with liner notes and credits, prices it in Concord Coin and
// publishes. Publishing mints a release DTU and lists it through the real
// marketplace (marketplace.list), so a purchase runs the constitutional
// money path untouched: marketplace.purchaseWithRoyalties (95% creator pool,
// 5% platform, royalty cascade up the release's remix lineage). A purchase
// then entitles the buyer to every track's full stream through the existing
// stream paywall (lib/media-preview-window.js, licensedUserIds).
//
// Artists are public by HANDLE (their username), never by raw account id
// (lib/public-actor.js rule). An account with no username gets a stable
// opaque key (sha256 prefix) instead.
//
// Registered from domains/music.js so the same anonymous-write guard applies.

import crypto from "node:crypto";
import { getMediaDTU, setMediaSaleTerms, grantMediaEntitlement } from "../lib/media-dtu.js";

const mediaRecord = (STATE, id) => getMediaDTU(STATE, id)?.mediaDTU || null;

const TYPES = new Set(["single", "ep", "album"]);
const STREAMING = new Set(["full", "preview"]);
const MAX_PRICE_CC = 1000;
const MAX_TRACKS = 40;
const MAX_RELEASES_PER_ARTIST = 200;
const MAX_CREDITS = 30;
const KEY_RE = /^[A-G](#|b)? (major|minor)$/;
const ID_RE = /^[A-Za-z0-9_-]{4,100}$/;
const HANDLE_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const PLAY_DEDUPE_MS = 30_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// eslint-disable-next-line no-control-regex
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// Multi-line text (liner notes): keep newlines, drop other control characters.
// eslint-disable-next-line no-control-regex
const cleanNote = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, max);
const finite = (v) => {
  if (typeof v === "boolean" || v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n) => Math.round(n * 100) / 100;
const nowIso = () => new Date().toISOString();

export function artistKeyFor(userId) {
  return "a_" + crypto.createHash("sha256").update(`concord-artist:${userId}`).digest("hex").slice(0, 16);
}

export default function registerMusicReleases(registerLensAction, { getMusicState, saveMusicState, actorOf, newId }) {
  const STATE = () => globalThis._concordSTATE;
  const dbOf = (ctx) => ctx?.db || globalThis._concordSTATE?.db || globalThis._concordDB || null;

  function store() {
    const s = getMusicState();
    if (!s) return null;
    if (!(s.releases instanceof Map)) s.releases = new Map();
    if (!(s.releaseOwners instanceof Map)) s.releaseOwners = new Map(); // releaseId → userId[]
    if (!(s.artistFollowers instanceof Map)) s.artistFollowers = new Map(); // artistId → userId[]
    if (!(s.trackPlays instanceof Map)) s.trackPlays = new Map(); // mediaId → { count, last: {userId: ms} }
    return s;
  }

  function viewer(ctx) {
    const id = actorOf(ctx);
    return id && id !== "anon" ? id : null;
  }

  // ── identity ──────────────────────────────────────────────────────────
  function userRow(ctx, { id, handle }) {
    const db = dbOf(ctx);
    if (!db) return null;
    try {
      if (id) return db.prepare("SELECT id, username FROM users WHERE id = ?").get(id) || null;
      if (handle) return db.prepare("SELECT id, username FROM users WHERE lower(username) = lower(?)").get(handle) || null;
    } catch { /* users table optional in minimal builds */ }
    return null;
  }

  function artistCard(ctx, artistId) {
    const row = userRow(ctx, { id: artistId });
    const handle = row?.username && HANDLE_RE.test(row.username) ? row.username : null;
    return {
      handle,
      key: artistKeyFor(artistId),
      name: handle || "Artist",
      isMe: viewer(ctx) === artistId,
    };
  }

  function resolveArtist(ctx, s, params) {
    const handle = clean(params.handle, 40).replace(/^@/, "");
    if (handle) {
      if (!HANDLE_RE.test(handle)) return null;
      const row = userRow(ctx, { handle });
      if (row) return row.id;
    }
    const key = clean(params.artistKey || params.key, 40);
    if (key) {
      for (const r of s.releases.values()) if (artistKeyFor(r.artistId) === key) return r.artistId;
      const me = viewer(ctx);
      if (me && artistKeyFor(me) === key) return me;
    }
    if (params.me === true) return viewer(ctx);
    return null;
  }

  // ── views ─────────────────────────────────────────────────────────────
  const owners = (s, releaseId) => s.releaseOwners.get(releaseId) || [];
  const owns = (s, release, userId) => !!userId && (release.artistId === userId || owners(s, release.id).includes(userId));

  function trackView(s, release, t, viewerId) {
    const plays = s.trackPlays.get(t.mediaId)?.count || 0;
    const gated = release.status === "published" && release.streaming === "preview" && release.priceCC > 0;
    return {
      mediaId: t.mediaId,
      title: t.title,
      durationSec: t.durationSec,
      explicit: t.explicit,
      bpm: t.bpm,
      key: t.key,
      lufs: t.lufs,
      plays,
      streamUrl: `/api/media/${encodeURIComponent(t.mediaId)}/stream`,
      fullStream: !gated || owns(s, release, viewerId),
    };
  }

  function releaseView(ctx, s, r) {
    const me = viewer(ctx);
    const mine = r.artistId === me;
    return {
      id: r.id,
      title: r.title,
      type: r.type,
      genre: r.genre,
      note: r.note,
      credits: r.credits,
      coverDtuId: r.coverDtuId,
      coverUrl: r.coverDtuId ? `/api/artifact/${encodeURIComponent(r.coverDtuId)}/stream` : null,
      priceCC: r.priceCC,
      streaming: r.streaming,
      previewSec: r.previewSec,
      status: r.status,
      releaseDate: r.releaseDate,
      publishedAt: r.publishedAt,
      dtuId: r.status === "published" ? r.dtuId : undefined,
      sales: mine ? owners(s, r.id).length : undefined,
      owned: owns(s, r, me),
      remixOf: (r.parents || []).map((pid) => {
        const p = s.releases.get(pid);
        return p && p.status === "published" ? { id: p.id, title: p.title, artist: artistCard(ctx, p.artistId) } : null;
      }).filter(Boolean),
      artist: artistCard(ctx, r.artistId),
      tracks: r.tracks.map((t) => trackView(s, r, t, me)),
      durationSec: r.tracks.reduce((a, t) => a + (t.durationSec || 0), 0),
    };
  }

  function getOwned(s, ctx, id, { allowPublished = false } = {}) {
    const r = s.releases.get(clean(id, 100));
    const me = viewer(ctx);
    if (!r) return { error: "release not found" };
    if (r.artistId !== me) {
      if (allowPublished && r.status === "published") return { release: r, readOnly: true };
      return { error: "release not found" };
    }
    return { release: r };
  }

  // ── validation ────────────────────────────────────────────────────────
  function readPrice(v) {
    const n = finite(v);
    if (n === null || n < 0 || n > MAX_PRICE_CC) return null;
    return r2(n);
  }

  function readCredits(list) {
    if (!Array.isArray(list)) return null;
    return list.slice(0, MAX_CREDITS)
      .map((c) => ({ role: clean(c?.role, 40), name: clean(c?.name, 80) }))
      .filter((c) => c.role && c.name);
  }

  function readAnalysis(params) {
    const bpm = finite(params.bpm);
    const lufs = finite(params.lufs);
    const key = clean(params.key, 12);
    return {
      bpm: bpm !== null && bpm >= 40 && bpm <= 250 ? Math.round(bpm * 10) / 10 : null,
      key: KEY_RE.test(key) ? key : null,
      lufs: lufs !== null && lufs >= -70 && lufs <= 0 ? Math.round(lufs * 10) / 10 : null,
    };
  }

  // Apply editable fields; returns an error string or null. Validates all before writing.
  function applyFields(s, r, params, me) {
    const next = {};
    if (params.title != null) {
      const t = clean(params.title, 120);
      if (!t) return "title cannot be empty";
      next.title = t;
    }
    if (params.type != null) {
      if (!TYPES.has(params.type)) return "type must be single, ep or album";
      next.type = params.type;
    }
    if (params.genre != null) next.genre = clean(params.genre, 40) || null;
    if (params.note != null) next.note = cleanNote(params.note, 4000);
    if (params.credits != null) {
      const c = readCredits(params.credits);
      if (c === null) return "credits must be a list of { role, name }";
      next.credits = c;
    }
    if (params.priceCC != null) {
      const p = readPrice(params.priceCC);
      if (p === null) return `priceCC must be a number from 0 to ${MAX_PRICE_CC}`;
      next.priceCC = p;
    }
    if (params.streaming != null) {
      if (!STREAMING.has(params.streaming)) return "streaming must be full or preview";
      next.streaming = params.streaming;
    }
    if (params.previewSec != null) {
      const p = finite(params.previewSec);
      if (p === null || p < 15 || p > 90) return "previewSec must be from 15 to 90";
      next.previewSec = Math.round(p);
    }
    if (params.releaseDate != null) {
      const d = clean(params.releaseDate, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return "releaseDate must be YYYY-MM-DD";
      next.releaseDate = d;
    }
    if (params.coverDtuId !== undefined) {
      if (params.coverDtuId === null || params.coverDtuId === "") next.coverDtuId = null;
      else {
        const id = clean(params.coverDtuId, 100);
        const dtu = STATE()?.dtus?.get?.(id);
        if (!ID_RE.test(id) || !dtu) return "cover image not found";
        const owner = dtu.ownerId || dtu.meta?.ownerId || dtu.createdBy;
        if (owner !== me) return "you can only use your own images as a cover";
        if (!IMAGE_TYPES.has(dtu.artifact?.type)) return "covers must be PNG, JPEG or WebP";
        if (!(Number(dtu.artifact?.sizeBytes) > 0) || dtu.artifact.sizeBytes > 10 * 1024 * 1024) return "covers must be under 10 MB";
        next.coverDtuId = id;
      }
    }
    if (params.remixOf != null) {
      if (!Array.isArray(params.remixOf)) return "remixOf must be a list of release ids";
      const ids = [];
      for (const raw of params.remixOf.slice(0, 5)) {
        const p = s.releases.get(clean(raw, 100));
        if (!p || p.status !== "published") return "a remix source must be a published release";
        if (p.id === r.id) return "a release cannot remix itself";
        ids.push(p.id);
      }
      next.parents = [...new Set(ids)];
    }
    Object.assign(r, next);
    return null;
  }

  // ── artist macros ─────────────────────────────────────────────────────

  registerLensAction("music", "release-create", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = viewer(ctx);
    if (!me) return { ok: false, error: "sign in to make a release" };
    const mine = [...s.releases.values()].filter((r) => r.artistId === me);
    if (mine.length >= MAX_RELEASES_PER_ARTIST) return { ok: false, error: `an artist can keep at most ${MAX_RELEASES_PER_ARTIST} releases` };
    const r = {
      id: newId("rel"), artistId: me, title: "", type: "single", genre: null, note: "", credits: [],
      coverDtuId: null, priceCC: 0, streaming: "full", previewSec: 30, status: "draft",
      releaseDate: nowIso().slice(0, 10), parents: [], tracks: [], dtuId: null,
      createdAt: nowIso(), updatedAt: nowIso(), publishedAt: null,
    };
    const err = applyFields(s, r, { type: "single", ...params, title: params.title ?? "" }, me);
    if (err) return { ok: false, error: err };
    if (!r.title) return { ok: false, error: "title required" };
    s.releases.set(r.id, r);
    saveMusicState();
    return { ok: true, result: { release: releaseView(ctx, s, r) } };
  });

  registerLensAction("music", "release-update", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = getOwned(s, ctx, params.id);
    if (got.error) return { ok: false, error: got.error };
    const r = got.release;
    if (r.status === "published") {
      // What a buyer paid for (the tracks) and its lineage stay fixed once released.
      for (const k of ["remixOf", "type"]) if (params[k] != null) return { ok: false, error: `${k} cannot change after release` };
    }
    const draft = { ...r };
    const err = applyFields(s, draft, params, r.artistId);
    if (err) return { ok: false, error: err };
    if (r.status === "published" && params.priceCC != null && draft.priceCC !== r.priceCC) {
      const dtu = STATE()?.dtus?.get?.(r.dtuId);
      if (dtu?.marketplace) dtu.marketplace.price = draft.priceCC;
    }
    Object.assign(r, draft, { updatedAt: nowIso() });
    if (r.status === "published" && (params.priceCC != null || params.streaming != null || params.previewSec != null)) {
      for (const t of r.tracks) setMediaSaleTerms(STATE(), t.mediaId, r.artistId, { streaming: r.streaming, price: r.priceCC, previewSec: r.previewSec });
    }
    saveMusicState();
    return { ok: true, result: { release: releaseView(ctx, s, r) } };
  });

  registerLensAction("music", "release-add-track", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = getOwned(s, ctx, params.id);
    if (got.error) return { ok: false, error: got.error };
    const r = got.release;
    if (r.status !== "draft") return { ok: false, error: "tracks are fixed once a release is out" };
    if (r.tracks.length >= MAX_TRACKS) return { ok: false, error: `a release holds at most ${MAX_TRACKS} tracks` };
    const mediaId = clean(params.mediaId, 100);
    if (!ID_RE.test(mediaId)) return { ok: false, error: "mediaId required" };
    const media = mediaRecord(STATE(), mediaId);
    if (!media || media.author !== r.artistId) return { ok: false, error: "upload not found" };
    if (media.mediaType !== "audio") return { ok: false, error: "only audio uploads can be tracks" };
    if (r.tracks.some((t) => t.mediaId === mediaId)) return { ok: false, error: "that track is already on this release" };
    const dur = finite(media.duration);
    r.tracks.push({
      mediaId,
      title: clean(params.title, 120) || clean(media.title, 120) || "Untitled",
      durationSec: dur !== null && dur > 0 ? Math.round(dur) : null,
      explicit: params.explicit === true,
      ...readAnalysis(params),
    });
    r.updatedAt = nowIso();
    saveMusicState();
    return { ok: true, result: { release: releaseView(ctx, s, r) } };
  });

  registerLensAction("music", "release-remove-track", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = getOwned(s, ctx, params.id);
    if (got.error) return { ok: false, error: got.error };
    const r = got.release;
    if (r.status !== "draft") return { ok: false, error: "tracks are fixed once a release is out" };
    const i = r.tracks.findIndex((t) => t.mediaId === clean(params.mediaId, 100));
    if (i < 0) return { ok: false, error: "track not on this release" };
    r.tracks.splice(i, 1);
    r.updatedAt = nowIso();
    saveMusicState();
    return { ok: true, result: { release: releaseView(ctx, s, r) } };
  });

  registerLensAction("music", "release-reorder", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = getOwned(s, ctx, params.id);
    if (got.error) return { ok: false, error: got.error };
    const r = got.release;
    if (r.status !== "draft") return { ok: false, error: "tracks are fixed once a release is out" };
    const order = Array.isArray(params.order) ? params.order.map((x) => clean(x, 100)) : null;
    const have = r.tracks.map((t) => t.mediaId);
    if (!order || order.length !== have.length || new Set(order).size !== order.length || !order.every((x) => have.includes(x))) {
      return { ok: false, error: "order must list every track on the release exactly once" };
    }
    r.tracks = order.map((id) => r.tracks.find((t) => t.mediaId === id));
    r.updatedAt = nowIso();
    saveMusicState();
    return { ok: true, result: { release: releaseView(ctx, s, r) } };
  });

  registerLensAction("music", "release-publish", async (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = getOwned(s, ctx, params.id);
    if (got.error) return { ok: false, error: got.error };
    const r = got.release;
    if (r.status === "published") return { ok: false, error: "already released" };
    if (!r.title) return { ok: false, error: "title required" };
    if (!r.tracks.length) return { ok: false, error: "add at least one track first" };
    if (r.type === "single" && r.tracks.length > 3) return { ok: false, error: "a single holds up to 3 tracks; make it an EP" };
    if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
    // Every track must still be the artist's own audio upload.
    for (const t of r.tracks) {
      const m = mediaRecord(STATE(), t.mediaId);
      if (!m || m.author !== r.artistId) return { ok: false, error: `“${t.title}” is no longer available` };
    }
    const artist = artistCard(ctx, r.artistId);
    const parents = (r.parents || []).map((pid) => s.releases.get(pid)?.dtuId).filter(Boolean);
    const created = await ctx.macro.run("dtu", "create", {
      title: `${r.title} — ${artist.name} (${r.type}) · ${r.id.slice(-6)}`,
      domain: "music",
      source: "music-release",
      tags: ["music-release", r.type, ...(r.genre ? [r.genre] : [])],
      human: { summary: `${r.title} by ${artist.name}: ${r.tracks.length} track${r.tracks.length > 1 ? "s" : ""}.` },
      core: {
        definitions: [],
        claims: r.tracks.map((t, i) => `${i + 1}. ${t.title}`),
        examples: [],
        invariants: [],
        nextActions: [],
      },
      meta: { type: "music_release", releaseId: r.id, tracks: r.tracks.map((t) => t.mediaId), coverDtuId: r.coverDtuId },
      lineage: { parents, citationType: parents.length ? "remix" : undefined },
    });
    if (!created?.ok || !created.dtu) return { ok: false, error: created?.error || created?.reason || "could not mint the release DTU" };
    const dtu = created.dtu;
    dtu.scope = "personal";
    if (parents.length) dtu.lineage = { ...(dtu.lineage || {}), parents, citationType: "remix" };
    if (!(dtu.license?.scopes || []).includes("marketplace_sale")) {
      dtu.license = { ...(dtu.license || {}), scopes: ["private", "marketplace_sale"] };
    }
    const listed = await ctx.macro.run("marketplace", "list", {
      dtuId: dtu.id,
      price: r.priceCC,
      currency: "CC",
      contentType: "music_release",
      title: `${r.title} — ${artist.name}`,
      description: r.note.slice(0, 500),
      tags: ["music", r.type, ...(r.genre ? [r.genre] : [])],
    });
    if (!listed?.ok) return { ok: false, error: listed?.error || "could not list the release" };
    for (const t of r.tracks) {
      setMediaSaleTerms(STATE(), t.mediaId, r.artistId, { streaming: r.streaming, price: r.priceCC, previewSec: r.previewSec });
    }
    if (r.coverDtuId) {
      const cover = STATE()?.dtus?.get?.(r.coverDtuId);
      if (cover) { cover.visibility = "public"; if (cover.scope === "user") cover.scope = "global"; if (cover.privacy === "private") cover.privacy = "public"; }
    }
    r.status = "published";
    r.dtuId = dtu.id;
    r.publishedAt = nowIso();
    r.updatedAt = r.publishedAt;
    saveMusicState();
    return { ok: true, result: { release: releaseView(ctx, s, r) } };
  });

  registerLensAction("music", "release-delete", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = getOwned(s, ctx, params.id);
    if (got.error) return { ok: false, error: got.error };
    if (got.release.status !== "draft") return { ok: false, error: "a released record stays up for the people who bought it" };
    s.releases.delete(got.release.id);
    saveMusicState();
    return { ok: true, result: { id: got.release.id, deleted: true } };
  });

  registerLensAction("music", "release-list-mine", (ctx) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = viewer(ctx);
    if (!me) return { ok: true, result: { releases: [], artist: null } };
    const list = [...s.releases.values()].filter((r) => r.artistId === me)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const earnedCC = r2(list.reduce((a, r) => a + owners(s, r.id).length * r.priceCC * 0.95, 0));
    return { ok: true, result: { releases: list.map((r) => releaseView(ctx, s, r)), artist: artistCard(ctx, me), salesGrossCC: r2(list.reduce((a, r) => a + owners(s, r.id).length * r.priceCC, 0)), creatorPoolCC: earnedCC } };
  });

  // ── listener macros (public reads) ────────────────────────────────────

  registerLensAction("music", "release-get", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const got = getOwned(s, ctx, params.id, { allowPublished: true });
    if (got.error) return { ok: false, error: got.error };
    return { ok: true, result: { release: releaseView(ctx, s, got.release) } };
  });

  registerLensAction("music", "artist-page", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const artistId = resolveArtist(ctx, s, params);
    if (!artistId) return { ok: false, error: "artist not found" };
    const me = viewer(ctx);
    const published = [...s.releases.values()].filter((r) => r.artistId === artistId && r.status === "published")
      .sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || "") || (b.publishedAt || "").localeCompare(a.publishedAt || ""));
    if (!published.length && artistId !== me) return { ok: false, error: "artist not found" };
    const views = published.map((r) => releaseView(ctx, s, r));
    const top = views.flatMap((v) => v.tracks.map((t) => ({ ...t, releaseId: v.id, releaseTitle: v.title, coverUrl: v.coverUrl })))
      .sort((a, b) => b.plays - a.plays).slice(0, 5);
    const profile = s.artistProfiles instanceof Map ? s.artistProfiles.get(artistId) : null;
    const followers = s.artistFollowers.get(artistId) || [];
    return {
      ok: true,
      result: {
        artist: artistCard(ctx, artistId),
        bio: profile?.bio || "",
        links: profile?.links || [],
        followers: followers.length,
        following: !!me && followers.includes(me),
        releases: views,
        topTracks: top,
        totalPlays: views.reduce((a, v) => a + v.tracks.reduce((b, t) => b + t.plays, 0), 0),
      },
    };
  });

  registerLensAction("music", "artist-follow-toggle", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = viewer(ctx);
    if (!me) return { ok: false, error: "sign in to follow" };
    const artistId = resolveArtist(ctx, s, params);
    if (!artistId) return { ok: false, error: "artist not found" };
    if (artistId === me) return { ok: false, error: "you cannot follow yourself" };
    const list = s.artistFollowers.get(artistId) || [];
    const want = typeof params.follow === "boolean" ? params.follow : !list.includes(me);
    const next = want ? [...new Set([...list, me])] : list.filter((u) => u !== me);
    s.artistFollowers.set(artistId, next);
    saveMusicState();
    return { ok: true, result: { following: want, followers: next.length } };
  });

  registerLensAction("music", "releases-new", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const limit = Math.max(1, Math.min(60, Math.round(finite(params.limit) ?? 24)));
    const genre = clean(params.genre, 40).toLowerCase();
    const me = viewer(ctx);
    const followed = new Set(me ? [...s.artistFollowers.entries()].filter(([, us]) => us.includes(me)).map(([a]) => a) : []);
    const list = [...s.releases.values()].filter((r) => r.status === "published" && (!genre || (r.genre || "").toLowerCase() === genre))
      .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
    return {
      ok: true,
      result: {
        releases: list.slice(0, limit).map((r) => releaseView(ctx, s, r)),
        fromFollowed: list.filter((r) => followed.has(r.artistId)).slice(0, 12).map((r) => releaseView(ctx, s, r)),
        genres: [...new Set(list.map((r) => r.genre).filter(Boolean))].sort(),
      },
    };
  });

  registerLensAction("music", "catalog-search", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = clean(params.q, 80).toLowerCase();
    if (q.length < 1) return { ok: true, result: { releases: [], tracks: [], artists: [] } };
    const pub = [...s.releases.values()].filter((r) => r.status === "published");
    const views = pub.map((r) => releaseView(ctx, s, r));
    const releases = views.filter((v) => v.title.toLowerCase().includes(q) || v.artist.name.toLowerCase().includes(q) || (v.genre || "").toLowerCase().includes(q)).slice(0, 20);
    const tracks = views.flatMap((v) => v.tracks.filter((t) => t.title.toLowerCase().includes(q)).map((t) => ({ ...t, releaseId: v.id, releaseTitle: v.title, coverUrl: v.coverUrl, artist: v.artist }))).slice(0, 20);
    const seen = new Set();
    const artists = views.map((v) => v.artist).filter((a) => a.name.toLowerCase().includes(q) && !seen.has(a.key) && seen.add(a.key)).slice(0, 10);
    return { ok: true, result: { releases, tracks, artists } };
  });

  registerLensAction("music", "release-buy", async (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = viewer(ctx);
    if (!me) return { ok: false, error: "sign in to buy" };
    const r = s.releases.get(clean(params.id, 100));
    if (!r || r.status !== "published") return { ok: false, error: "release not found" };
    if (r.artistId === me) return { ok: false, error: "this is your own release" };
    if (owners(s, r.id).includes(me)) return { ok: false, error: "already in your library" };
    if (!(r.priceCC > 0)) return { ok: false, error: "this release is free: just play it" };
    if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
    // The one money path: 95% creator pool (royalties up the remix lineage, seller the rest), 5% platform.
    const paid = await ctx.macro.run("marketplace", "purchaseWithRoyalties", { dtuId: r.dtuId });
    if (!paid?.ok) {
      if (paid?.error === "insufficient_balance") {
        return { ok: false, error: `not enough Concord Coin: this costs ${r.priceCC} CC and you have ${r2(Number(paid.balance) || 0)} CC`, reason: "insufficient_balance", balance: paid.balance, price: r.priceCC };
      }
      return { ok: false, error: paid?.error || "the purchase did not go through" };
    }
    s.releaseOwners.set(r.id, [...owners(s, r.id), me]);
    for (const t of r.tracks) grantMediaEntitlement(STATE(), t.mediaId, me);
    saveMusicState();
    return {
      ok: true,
      result: {
        release: releaseView(ctx, s, r),
        price: r.priceCC,
        purchasedDtuId: paid.purchasedDtuId || null,
        breakdown: paid.breakdown || null,
      },
    };
  });

  registerLensAction("music", "library-purchases", (ctx) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = viewer(ctx);
    if (!me) return { ok: true, result: { releases: [] } };
    const list = [...s.releases.values()].filter((r) => r.status === "published" && owners(s, r.id).includes(me));
    return { ok: true, result: { releases: list.map((r) => releaseView(ctx, s, r)) } };
  });

  registerLensAction("music", "release-play", (ctx, _a, params = {}) => {
    const s = store(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = viewer(ctx);
    const r = s.releases.get(clean(params.id, 100));
    if (!r || r.status !== "published") return { ok: false, error: "release not found" };
    const mediaId = clean(params.mediaId, 100);
    if (!r.tracks.some((t) => t.mediaId === mediaId)) return { ok: false, error: "track not on this release" };
    // Count a listener once per 30 s per track; signed-out listens are not counted.
    if (!me) return { ok: true, result: { counted: false, plays: s.trackPlays.get(mediaId)?.count || 0 } };
    const rec = s.trackPlays.get(mediaId) || { count: 0, last: {} };
    const now = Date.now();
    const counted = !rec.last[me] || now - rec.last[me] >= PLAY_DEDUPE_MS;
    if (counted) { rec.count += 1; rec.last[me] = now; s.trackPlays.set(mediaId, rec); saveMusicState(); }
    return { ok: true, result: { counted, plays: rec.count } };
  });
}
