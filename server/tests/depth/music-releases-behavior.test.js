// tests/depth/music-releases-behavior.test.js — Liner Notes backend: an artist
// uploads tracks, makes a release, prices it in CC and publishes; a fan finds
// the artist page, streams, buys through the real royalty path and then owns
// the full stream. Behavioural (exact values, hand-worked) and adversarial
// (other people's uploads, garbage numbers, double actions, drafts hidden,
// refused calls write nothing).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";
import { createMediaDTU, getMediaDTU } from "../../lib/media-dtu.js";
const media = (id) => getMediaDTU(STATE, id).mediaDTU;
import { viewerMayStreamFull, pricedCreateOrCommercial } from "../../lib/media-preview-window.js";
import { artistKeyFor } from "../../domains/music-releases.js";

let STATE;
function upload(authorId, title, { mediaType = "audio", duration = 180 } = {}) {
  const r = createMediaDTU(STATE, { authorId, title, mediaType, mimeType: mediaType === "audio" ? "audio/wav" : "video/mp4", duration, privacy: "private" });
  assert.equal(r.ok, true, r.error);
  return r.mediaDTU.id;
}
const wallet = (id) => STATE.economic?.wallets?.get(id)?.balance ?? 0;
function fund(id, balance) {
  // Keep the real economic state shape (wallets + transactions log) so credit/debit run their ledger bridge.
  STATE.economic = STATE.economic || {};
  if (!(STATE.economic.wallets instanceof Map)) STATE.economic.wallets = new Map();
  if (!Array.isArray(STATE.economic.transactions)) STATE.economic.transactions = [];
  const w = STATE.economic.wallets.get(id);
  if (w) w.balance = balance;
  else STATE.economic.wallets.set(id, { odId: id, balance, tier: "free", tokensEarned: 0, tokensSpent: 0, createdAt: Date.now(), updatedAt: Date.now() });
}

describe("music releases — artist side", () => {
  let artist, other;
  before(async () => {
    ({ STATE } = await load());
    artist = await depthCtx("ln-artist-a");
    other = await depthCtx("ln-artist-b");
  });

  it("creates a draft, adds the artist's own audio, and validates every field before writing", async () => {
    const t1 = upload("ln-artist-a", "Night Bus", { duration: 201.4 });
    const r = await lensRun("music", "release-create", { params: { title: "  Night\u0000 Bus  ", type: "ep", genre: "lo-fi", note: "Recorded in one night.\nFor the 3am crowd.", priceCC: 4.999 } }, artist);
    assert.equal(r.ok, true);
    const rel = r.result.release;
    assert.deepEqual([rel.title, rel.type, rel.genre, rel.priceCC, rel.status, rel.streaming], ["Night Bus", "ep", "lo-fi", 5, "draft", "full"]);
    assert.equal(rel.note, "Recorded in one night.\nFor the 3am crowd.");
    assert.equal(rel.artist.isMe, true);
    assert.equal(rel.artist.key, artistKeyFor("ln-artist-a"));
    const added = await lensRun("music", "release-add-track", { params: { id: rel.id, mediaId: t1, bpm: 87.26, key: "A minor", lufs: -13.94 } }, artist);
    assert.equal(added.ok, true);
    assert.deepEqual(
      [added.result.release.tracks[0].title, added.result.release.tracks[0].durationSec, added.result.release.tracks[0].bpm, added.result.release.tracks[0].key, added.result.release.tracks[0].lufs],
      ["Night Bus", 201, 87.3, "A minor", -13.9],
    );
  });

  it("stores unknown analysis as null, never a made-up number", async () => {
    const t = upload("ln-artist-a", "Unanalysed");
    const r = await lensRun("music", "release-create", { params: { title: "Raw" } }, artist);
    const a = await lensRun("music", "release-add-track", { params: { id: r.result.release.id, mediaId: t, bpm: 999, key: "Am", lufs: 3 } }, artist);
    const track = a.result.release.tracks[0];
    assert.deepEqual([track.bpm, track.key, track.lufs], [null, null, null]);
  });

  it("refuses someone else's upload, video, duplicates, and bad fields — and writes nothing", async () => {
    const r = await lensRun("music", "release-create", { params: { title: "Guarded" } }, artist);
    const id = r.result.release.id;
    const theirs = upload("ln-artist-b", "Not yours");
    const video = upload("ln-artist-a", "Clip", { mediaType: "video" });
    const mine = upload("ln-artist-a", "Mine");
    assert.match((await lensRun("music", "release-add-track", { params: { id, mediaId: theirs } }, artist)).result.error, /upload not found/);
    assert.match((await lensRun("music", "release-add-track", { params: { id, mediaId: video } }, artist)).result.error, /only audio/);
    await lensRun("music", "release-add-track", { params: { id, mediaId: mine } }, artist);
    assert.match((await lensRun("music", "release-add-track", { params: { id, mediaId: mine } }, artist)).result.error, /already on this release/);
    for (const [k, v, re] of [["priceCC", -1, /priceCC/], ["priceCC", 1001, /priceCC/], ["priceCC", true, /priceCC/], ["type", "mixtape", /type/], ["streaming", "half", /streaming/], ["previewSec", 5, /previewSec/], ["releaseDate", "tomorrow", /releaseDate/], ["title", "\u0000  ", /title/], ["coverDtuId", "nope_dtu_1", /cover image not found/]]) {
      const bad = await lensRun("music", "release-update", { params: { id, [k]: v, genre: "should-not-stick" } }, artist);
      assert.equal(bad.result.ok, false, `${k}=${String(v)}`);
      assert.match(bad.result.error, re);
    }
    const after = await lensRun("music", "release-get", { params: { id } }, artist);
    assert.equal(after.result.release.genre, null);
    assert.equal(after.result.release.tracks.length, 1);
    // Another artist cannot see or touch the draft.
    assert.match((await lensRun("music", "release-get", { params: { id } }, other)).result.error, /release not found/);
    assert.match((await lensRun("music", "release-update", { params: { id, title: "Hijack" } }, other)).result.error, /release not found/);
    assert.match((await lensRun("music", "release-publish", { params: { id } }, other)).result.error, /release not found/);
  });

  it("reorders only with an exact permutation", async () => {
    const r = await lensRun("music", "release-create", { params: { title: "Order", type: "album" } }, artist);
    const id = r.result.release.id;
    const a = upload("ln-artist-a", "A"); const b = upload("ln-artist-a", "B"); const c = upload("ln-artist-a", "C");
    for (const m of [a, b, c]) await lensRun("music", "release-add-track", { params: { id, mediaId: m } }, artist);
    assert.match((await lensRun("music", "release-reorder", { params: { id, order: [c, a] } }, artist)).result.error, /exactly once/);
    assert.match((await lensRun("music", "release-reorder", { params: { id, order: [c, a, a] } }, artist)).result.error, /exactly once/);
    const ok = await lensRun("music", "release-reorder", { params: { id, order: [c, a, b] } }, artist);
    assert.deepEqual(ok.result.release.tracks.map((t) => t.title), ["C", "A", "B"]);
  });

  it("publishing needs tracks; a single caps at 3 tracks", async () => {
    const empty = await lensRun("music", "release-create", { params: { title: "Empty" } }, artist);
    assert.match((await lensRun("music", "release-publish", { params: { id: empty.result.release.id } }, artist)).result.error, /at least one track/);
    const big = await lensRun("music", "release-create", { params: { title: "Big single", type: "single" } }, artist);
    for (let i = 0; i < 4; i++) await lensRun("music", "release-add-track", { params: { id: big.result.release.id, mediaId: upload("ln-artist-a", `S${i}`) } }, artist);
    assert.match((await lensRun("music", "release-publish", { params: { id: big.result.release.id } }, artist)).result.error, /up to 3 tracks/);
  });
});

describe("music releases — publish, storefront, buy, own", () => {
  let artist, fan, broke, releaseId, dtuId, tracks;
  before(async () => {
    ({ STATE } = await load());
    artist = await depthCtx("ln-seller");
    fan = await depthCtx("ln-fan");
    broke = await depthCtx("ln-broke");
    tracks = [upload("ln-seller", "Side A", { duration: 120 }), upload("ln-seller", "Side B", { duration: 95 })];
    const r = await lensRun("music", "release-create", { params: { title: "Paper Moons", type: "ep", genre: "indie", priceCC: 10, streaming: "preview", previewSec: 30, note: "Thanks for listening.", credits: [{ role: "Producer", name: "June" }, { role: "", name: "dropped" }] } }, artist);
    releaseId = r.result.release.id;
    for (const m of tracks) await lensRun("music", "release-add-track", { params: { id: releaseId, mediaId: m } }, artist);
  });

  it("publish mints and lists a release DTU at the CC price and gates the tracks to a preview", async () => {
    const p = await lensRun("music", "release-publish", { params: { id: releaseId } }, artist);
    assert.equal(p.ok, true, JSON.stringify(p.result));
    const rel = p.result.release;
    assert.equal(rel.status, "published");
    assert.deepEqual(rel.credits, [{ role: "Producer", name: "June" }]);
    dtuId = rel.dtuId;
    const dtu = STATE.dtus.get(dtuId);
    assert.equal(dtu.marketplace.listed, true);
    assert.equal(dtu.marketplace.price, 10);
    assert.equal(dtu.marketplace.contentType, "music_release");
    for (const m of tracks) {
      const md = media(m);
      assert.equal(md.privacy, "public");
      assert.equal(pricedCreateOrCommercial(md), true);
      assert.equal(md.previewDuration, 30);
      assert.equal(viewerMayStreamFull(STATE, md, "ln-fan"), false);
      assert.equal(viewerMayStreamFull(STATE, md, "ln-seller"), true);
    }
    assert.match((await lensRun("music", "release-publish", { params: { id: releaseId } }, artist)).result.error, /already released/);
    assert.match((await lensRun("music", "release-add-track", { params: { id: releaseId, mediaId: upload("ln-seller", "Late") } }, artist)).result.error, /fixed once/);
    assert.match((await lensRun("music", "release-delete", { params: { id: releaseId } }, artist)).result.error, /stays up/);
  });

  it("the artist page is public by key, lists the release, and hides the raw account id", async () => {
    const page = await lensRun("music", "artist-page", { params: { artistKey: artistKeyFor("ln-seller") } }, fan);
    assert.equal(page.ok, true);
    assert.deepEqual(page.result.releases.map((r) => r.title), ["Paper Moons"]);
    assert.equal(page.result.artist.isMe, false);
    assert.ok(!JSON.stringify(page.result).includes("ln-seller"), "raw artist id leaked");
    assert.deepEqual(page.result.releases[0].tracks.map((t) => t.fullStream), [false, false]);
    assert.equal(page.result.releases[0].sales, undefined);
    assert.match((await lensRun("music", "artist-page", { params: { artistKey: "a_0000000000000000" } }, fan)).result.error, /artist not found/);
    assert.match((await lensRun("music", "artist-page", { params: { handle: "../../etc" } }, fan)).result.error, /artist not found/);
  });

  it("new releases and search find it; drafts never appear", async () => {
    const nw = await lensRun("music", "releases-new", { params: { limit: 50 } }, fan);
    const titles = nw.result.releases.map((r) => r.title);
    assert.ok(titles.includes("Paper Moons"));
    assert.ok(!titles.includes("Guarded") && !titles.includes("Order"));
    assert.ok(nw.result.genres.includes("indie"));
    const found = await lensRun("music", "catalog-search", { params: { q: "side b" } }, fan);
    assert.deepEqual(found.result.tracks.map((t) => t.title), ["Side B"]);
    assert.equal((await lensRun("music", "catalog-search", { params: { q: "order" } }, fan)).result.releases.length, 0);
  });

  it("follow toggles and counts; you cannot follow yourself", async () => {
    const key = artistKeyFor("ln-seller");
    const f = await lensRun("music", "artist-follow-toggle", { params: { artistKey: key } }, fan);
    assert.deepEqual([f.result.following, f.result.followers], [true, 1]);
    const again = await lensRun("music", "artist-follow-toggle", { params: { artistKey: key, follow: true } }, fan);
    assert.equal(again.result.followers, 1);
    assert.match((await lensRun("music", "artist-follow-toggle", { params: { artistKey: key } }, artist)).result.error, /yourself/);
    const nw = await lensRun("music", "releases-new", {}, fan);
    assert.deepEqual(nw.result.fromFollowed.map((r) => r.title), ["Paper Moons"]);
  });

  it("a fan without enough CC is refused with the real balance, and nothing moves", async () => {
    fund("ln-broke", 3);
    const sellerBefore = wallet("ln-seller");
    const r = await lensRun("music", "release-buy", { params: { id: releaseId } }, broke);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.reason, "insufficient_balance");
    assert.match(r.result.error, /costs 10 CC and you have 3 CC/);
    assert.equal(wallet("ln-broke"), 3);
    assert.equal(wallet("ln-seller"), sellerBefore);
    assert.equal(viewerMayStreamFull(STATE, media(tracks[0]), "ln-broke"), false);
  });

  it("buying pays 9.50 to the artist and 0.50 platform, and unlocks every track's full stream", async () => {
    fund("ln-fan", 25);
    const sellerBefore = wallet("ln-seller");
    const r = await lensRun("music", "release-buy", { params: { id: releaseId } }, fan);
    assert.equal(r.ok, true, JSON.stringify(r.result));
    // 10 CC: platform 5% = 0.50; creator pool 95% = 9.50; no remix parents → all to the artist.
    assert.equal(r.result.price, 10);
    assert.equal(r.result.breakdown.platformFee, 0.5);
    assert.equal(r.result.breakdown.sellerReceived, 9.5);
    assert.equal(wallet("ln-fan"), 15);
    assert.equal(wallet("ln-seller") - sellerBefore, 9.5);
    assert.deepEqual(r.result.release.tracks.map((t) => t.fullStream), [true, true]);
    assert.equal(r.result.release.owned, true);
    for (const m of tracks) assert.equal(viewerMayStreamFull(STATE, media(m), "ln-fan"), true);
    // The sale is on the durable ledger too: the artist's 9.50 credit and the fan's 10 debit.
    const db = STATE.db;
    assert.ok(db, "the harness boots a real database");
    const credit = db.prepare("SELECT amount FROM economy_ledger WHERE to_user_id = ? AND ref_id LIKE ? ORDER BY created_at DESC").get("ln-seller", `purchase:${dtuId}:%`);
    const debit = db.prepare("SELECT amount FROM economy_ledger WHERE from_user_id = ? AND ref_id LIKE ?").get("ln-fan", `purchase:${dtuId}:%:debit`);
    assert.equal(credit?.amount, 9.5);
    assert.equal(debit?.amount, 10);
    const lib = await lensRun("music", "library-purchases", {}, fan);
    assert.deepEqual(lib.result.releases.map((x) => x.title), ["Paper Moons"]);
    const mine = await lensRun("music", "release-list-mine", {}, artist);
    const sold = mine.result.releases.find((x) => x.id === releaseId);
    assert.equal(sold.sales, 1);
  });

  it("buying twice, buying your own, and buying a free or unknown release are refused without charging", async () => {
    fund("ln-fan", 15);
    assert.match((await lensRun("music", "release-buy", { params: { id: releaseId } }, fan)).result.error, /already in your library/);
    assert.equal(wallet("ln-fan"), 15);
    assert.match((await lensRun("music", "release-buy", { params: { id: releaseId } }, artist)).result.error, /your own release/);
    assert.match((await lensRun("music", "release-buy", { params: { id: "rel_nope" } }, fan)).result.error, /release not found/);
    const free = await lensRun("music", "release-create", { params: { title: "Free Single" } }, artist);
    await lensRun("music", "release-add-track", { params: { id: free.result.release.id, mediaId: upload("ln-seller", "Gift") } }, artist);
    await lensRun("music", "release-publish", { params: { id: free.result.release.id } }, artist);
    assert.match((await lensRun("music", "release-buy", { params: { id: free.result.release.id } }, fan)).result.error, /free/);
    const freeTrack = (await lensRun("music", "release-get", { params: { id: free.result.release.id } }, fan)).result.release.tracks[0];
    assert.equal(freeTrack.fullStream, true);
  });

  it("a remix release pays its source artist through the cascade", async () => {
    const remixer = await depthCtx("ln-remixer");
    const buyer = await depthCtx("ln-remix-fan");
    fund("ln-remix-fan", 100);
    fund("ln-seller", wallet("ln-seller"));
    const r = await lensRun("music", "release-create", { params: { title: "Paper Moons (Dusk Mix)", priceCC: 20, remixOf: [releaseId] } }, remixer);
    assert.equal(r.ok, true, JSON.stringify(r.result));
    await lensRun("music", "release-add-track", { params: { id: r.result.release.id, mediaId: upload("ln-remixer", "Dusk Mix") } }, remixer);
    const pub = await lensRun("music", "release-publish", { params: { id: r.result.release.id } }, remixer);
    assert.deepEqual(pub.result.release.remixOf.map((x) => x.title), ["Paper Moons"]);
    const sourceBefore = wallet("ln-seller");
    const remixerBefore = wallet("ln-remixer");
    const bought = await lensRun("music", "release-buy", { params: { id: r.result.release.id } }, buyer);
    assert.equal(bought.ok, true, JSON.stringify(bought.result));
    const bd = bought.result.breakdown;
    // pool = 20 × 0.95 = 19; the source's royalty plus the remixer's share is the whole pool.
    assert.equal(bd.platformFee, 1);
    assert.equal(bd.royaltiesPaid.length, 1);
    const royalty = bd.royaltiesPaid[0].amount;
    assert.ok(royalty > 0);
    assert.equal(Math.round((royalty + bd.sellerReceived) * 100) / 100, 19);
    assert.equal(Math.round((wallet("ln-seller") - sourceBefore) * 100) / 100, royalty);
    assert.equal(Math.round((wallet("ln-remixer") - remixerBefore) * 100) / 100, bd.sellerReceived);
    // A remix cannot cite an unreleased draft or itself.
    const draft = await lensRun("music", "release-create", { params: { title: "Draft src" } }, remixer);
    assert.match((await lensRun("music", "release-create", { params: { title: "Bad remix", remixOf: [draft.result.release.id] } }, remixer)).result.error, /published release/);
  });

  it("plays count once per listener per 30 s, only for tracks on the release", async () => {
    const a = await lensRun("music", "release-play", { params: { id: releaseId, mediaId: tracks[0] } }, fan);
    const b = await lensRun("music", "release-play", { params: { id: releaseId, mediaId: tracks[0] } }, fan);
    const c = await lensRun("music", "release-play", { params: { id: releaseId, mediaId: tracks[0] } }, broke);
    assert.deepEqual([a.result.counted, b.result.counted, c.result.counted, c.result.plays], [true, false, true, 2]);
    assert.match((await lensRun("music", "release-play", { params: { id: releaseId, mediaId: "media_other" } }, fan)).result.error, /not on this release/);
    const page = await lensRun("music", "artist-page", { params: { artistKey: artistKeyFor("ln-seller") } }, fan);
    assert.equal(page.result.topTracks[0].title, "Side A");
    assert.equal(page.result.topTracks[0].plays, 2);
  });

  it("price changes after release reach the listing; tracks and lineage stay fixed", async () => {
    const u = await lensRun("music", "release-update", { params: { id: releaseId, priceCC: 12 } }, artist);
    assert.equal(u.result.release.priceCC, 12);
    assert.equal(STATE.dtus.get(dtuId).marketplace.price, 12);
    assert.equal(media(tracks[0]).tiers.find((t) => t.tier === "commercial").price, 12);
    assert.match((await lensRun("music", "release-update", { params: { id: releaseId, type: "album" } }, artist)).result.error, /cannot change after release/);
  });

  it("saving a release track builds the library entry from the release; likes, plays and playlists then work on it", async () => {
    const add = await lensRun("music", "library-add-release-track", { params: { id: releaseId, mediaId: tracks[1], like: true } }, fan);
    assert.equal(add.ok, true);
    const t = add.result.track;
    assert.deepEqual([t.title, t.album, t.liked, t.releaseId, t.mediaId, t.genre], ["Side B", "Paper Moons", true, releaseId, tracks[1], "indie"]);
    assert.ok(!JSON.stringify(t).includes("ln-seller"), "raw artist id leaked into the library");
    const again = await lensRun("music", "library-add-release-track", { params: { id: releaseId, mediaId: tracks[1] } }, fan);
    assert.deepEqual([again.result.added, again.result.track.id], [false, t.id]);
    const liked = await lensRun("music", "liked-songs", {}, fan);
    assert.ok(liked.result.tracks.some((x) => x.id === t.id));
    const pl = await lensRun("music", "playlist-create", { params: { name: "Late" } }, fan);
    const put = await lensRun("music", "playlist-add-track", { params: { playlistId: pl.result.playlist.id, trackId: t.id } }, fan);
    assert.equal(put.result.trackCount, 1);
    const play = await lensRun("music", "release-play", { params: { id: releaseId, mediaId: tracks[1] } }, fan);
    assert.equal(play.result.counted, true);
    const recent = await lensRun("music", "recently-played", {}, fan);
    assert.equal(recent.result.tracks[0].id, t.id);
    assert.match((await lensRun("music", "library-add-release-track", { params: { id: releaseId, mediaId: "media_nope" } }, fan)).result.error, /not on this release/);
    const page = await lensRun("music", "release-get", { params: { id: releaseId } }, fan);
    assert.deepEqual(page.result.release.remixes.map((x) => x.title), ["Paper Moons (Dusk Mix)"]);
  });
});
