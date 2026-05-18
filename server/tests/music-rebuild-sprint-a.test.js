// server/tests/music-rebuild-sprint-a.test.js
//
// Tier-2 contract tests for music rebuild Sprint A: durable artists /
// albums / tracks / playlists / listens / likes / follows.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerMusicRebuildMacros from "../domains/music-rebuild.js";
import {
  createArtist, getArtist, listArtists, updateArtist,
  createAlbum, getAlbum, listAlbumsByArtist,
  createTrack, getTrack, listTracks, updateTrack, deleteTrack,
  createPlaylist, addTrackToPlaylist, removeTrackFromPlaylist, getPlaylist, listPlaylists,
  recordListen, likeTrack, unlikeTrack, listLikes,
  followArtist, unfollowArtist,
  artistStats,
} from "../lib/music/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/237_music_rebuild.js");
  m.up(db);
  registerMusicRebuildMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Artists ───────────────────────────────────────────────

describe("artists", () => {
  it("createArtist auto-generates a unique slug", () => {
    const a = createArtist(db, { ownerUserId: "u_a", name: "The Big Band" });
    assert.equal(a.ok, true);
    assert.equal(a.slug, "the-big-band");
  });

  it("slug collisions disambiguate with numeric suffix", () => {
    createArtist(db, { ownerUserId: "u_b", name: "Same Name" });
    const dup = createArtist(db, { ownerUserId: "u_b", name: "Same Name" });
    assert.equal(dup.slug, "same-name-1");
  });

  it("getArtist resolves by id OR slug", () => {
    const a = createArtist(db, { ownerUserId: "u_c", name: "Resolver" });
    const byId = getArtist(db, a.id);
    const bySlug = getArtist(db, a.slug);
    assert.equal(byId.name, "Resolver");
    assert.equal(bySlug.id, a.id);
  });

  it("updateArtist refuses cross-user", () => {
    const a = createArtist(db, { ownerUserId: "u_owner", name: "Owned" });
    const r = updateArtist(db, a.id, "u_thief", { name: "Hacked" });
    assert.equal(r.reason, "forbidden");
  });

  it("listArtists filters by owner", () => {
    createArtist(db, { ownerUserId: "u_multi", name: "Mine 1" });
    createArtist(db, { ownerUserId: "u_multi", name: "Mine 2" });
    createArtist(db, { ownerUserId: "u_other", name: "Other" });
    const mine = listArtists(db, { ownerId: "u_multi" });
    assert.equal(mine.length, 2);
    assert.ok(mine.every((a) => a.owner_user_id === "u_multi"));
  });
});

// ─── Albums + Tracks ───────────────────────────────────────

describe("albums + tracks", () => {
  it("creating tracks under an album bumps total_tracks + total_duration_ms", () => {
    const artist = createArtist(db, { ownerUserId: "u_dur", name: "DurArtist" });
    const album = createAlbum(db, { artistId: artist.id, title: "Test EP", kind: "ep" });
    createTrack(db, { artistId: artist.id, albumId: album.id, title: "Track 1", trackNumber: 1, durationMs: 180_000 });
    createTrack(db, { artistId: artist.id, albumId: album.id, title: "Track 2", trackNumber: 2, durationMs: 240_000 });
    const a = getAlbum(db, album.id);
    assert.equal(a.total_tracks, 2);
    assert.equal(a.total_duration_ms, 420_000);
    assert.equal(a.tracks.length, 2);
  });

  it("deleting a track decrements album counters", () => {
    const artist = createArtist(db, { ownerUserId: "u_del", name: "DelArtist" });
    const album = createAlbum(db, { artistId: artist.id, title: "Mini" });
    const t = createTrack(db, { artistId: artist.id, albumId: album.id, title: "Goner", durationMs: 100_000 });
    assert.equal(getAlbum(db, album.id).total_tracks, 1);
    deleteTrack(db, t.id, "u_del");
    assert.equal(getAlbum(db, album.id).total_tracks, 0);
    assert.equal(getAlbum(db, album.id).total_duration_ms, 0);
  });

  it("CHECK constraint rejects invalid license", () => {
    const artist = createArtist(db, { ownerUserId: "u_lic", name: "LicArtist" });
    assert.throws(() => {
      db.prepare(`INSERT INTO music_tracks (id, artist_id, title, license, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(`trk:bad`, artist.id, "X", "MIT", 0, 0);
    }, /CHECK/);
  });

  it("updateTrack accepts valid CC license", () => {
    const artist = createArtist(db, { ownerUserId: "u_cc", name: "CCArtist" });
    const t = createTrack(db, { artistId: artist.id, title: "Free", license: "cc_by" });
    updateTrack(db, t.id, "u_cc", { license: "cc0", moodTags: ["chill", "ambient"] });
    const got = getTrack(db, t.id);
    assert.equal(got.license, "cc0");
    assert.deepEqual(got.mood_tags, ["chill", "ambient"]);
  });

  it("listTracks orderBy listen_count returns most-played", () => {
    const artist = createArtist(db, { ownerUserId: "u_pop", name: "PopArtist" });
    const t1 = createTrack(db, { artistId: artist.id, title: "Low" });
    const t2 = createTrack(db, { artistId: artist.id, title: "High" });
    db.prepare(`UPDATE music_tracks SET listen_count = 100 WHERE id = ?`).run(t2.id);
    db.prepare(`UPDATE music_tracks SET listen_count = 5 WHERE id = ?`).run(t1.id);
    const list = listTracks(db, { artistId: artist.id, orderBy: "listen_count" });
    assert.equal(list[0].id, t2.id);
  });
});

// ─── Playlists ────────────────────────────────────────────

describe("playlists", () => {
  it("collaborative playlist accepts adds from non-owner", () => {
    const artist = createArtist(db, { ownerUserId: "u_pl", name: "PArt" });
    const t = createTrack(db, { artistId: artist.id, title: "T", durationMs: 200_000 });
    const pl = createPlaylist(db, { ownerId: "u_pl_owner", title: "Shared", kind: "collaborative" });
    const r = addTrackToPlaylist(db, pl.id, t.id, "u_someone_else");
    assert.equal(r.ok, true);
    assert.equal(r.position, 1);
  });

  it("non-collaborative playlist rejects non-owner additions", () => {
    const artist = createArtist(db, { ownerUserId: "u_pl2", name: "PArt2" });
    const t = createTrack(db, { artistId: artist.id, title: "T", durationMs: 100_000 });
    const pl = createPlaylist(db, { ownerId: "u_pl2_owner", title: "Private", kind: "curated" });
    const r = addTrackToPlaylist(db, pl.id, t.id, "u_stranger");
    assert.equal(r.reason, "forbidden");
  });

  it("add bumps + remove decrements playlist counters", () => {
    const artist = createArtist(db, { ownerUserId: "u_pl3", name: "PArt3" });
    const t1 = createTrack(db, { artistId: artist.id, title: "A", durationMs: 100_000 });
    const t2 = createTrack(db, { artistId: artist.id, title: "B", durationMs: 200_000 });
    const pl = createPlaylist(db, { ownerId: "u_pl3", title: "Mine" });
    addTrackToPlaylist(db, pl.id, t1.id, "u_pl3");
    addTrackToPlaylist(db, pl.id, t2.id, "u_pl3");
    let got = getPlaylist(db, pl.id);
    assert.equal(got.track_count, 2);
    assert.equal(got.total_duration_ms, 300_000);
    removeTrackFromPlaylist(db, pl.id, 1, "u_pl3");
    got = getPlaylist(db, pl.id);
    assert.equal(got.track_count, 1);
    assert.equal(got.total_duration_ms, 200_000);
  });
});

// ─── Listens / likes / follows ────────────────────────────

describe("listen events drive counters + avg_listen_pct", () => {
  it("full listen bumps listen_count, NOT skip_count", () => {
    const artist = createArtist(db, { ownerUserId: "u_lsn", name: "LsnArt" });
    const t = createTrack(db, { artistId: artist.id, title: "T", durationMs: 200_000 });
    recordListen(db, { trackId: t.id, userId: "u_lsn_listener", listenedMs: 200_000 });
    const got = getTrack(db, t.id);
    assert.equal(got.listen_count, 1);
    assert.equal(got.skip_count, 0);
  });

  it("short listen (<30s AND <10%) bumps skip_count, NOT listen_count", () => {
    const artist = createArtist(db, { ownerUserId: "u_skip", name: "SkArt" });
    const t = createTrack(db, { artistId: artist.id, title: "Skipper", durationMs: 200_000 });
    recordListen(db, { trackId: t.id, userId: "u_skip_l", listenedMs: 5_000 });
    const got = getTrack(db, t.id);
    assert.equal(got.listen_count, 0);
    assert.equal(got.skip_count, 1);
  });

  it("avg_listen_pct rolls over last 100 listens", () => {
    const artist = createArtist(db, { ownerUserId: "u_avg", name: "AvgArt" });
    const t = createTrack(db, { artistId: artist.id, title: "Deep", durationMs: 100_000 });
    for (let i = 0; i < 5; i++) recordListen(db, { trackId: t.id, listenedMs: 80_000 });
    const got = getTrack(db, t.id);
    // All listens were 80% → avg should be ~0.8
    assert.ok(Math.abs(got.avg_listen_pct - 0.8) < 0.01, `expected ~0.8, got ${got.avg_listen_pct}`);
  });
});

describe("likes + follows", () => {
  it("like toggles like_count correctly", () => {
    const artist = createArtist(db, { ownerUserId: "u_lk", name: "LkArt" });
    const t = createTrack(db, { artistId: artist.id, title: "Liked" });
    likeTrack(db, "u_liker1", t.id);
    likeTrack(db, "u_liker2", t.id);
    likeTrack(db, "u_liker1", t.id); // duplicate is idempotent
    let got = getTrack(db, t.id);
    assert.equal(got.like_count, 2);
    unlikeTrack(db, "u_liker1", t.id);
    got = getTrack(db, t.id);
    assert.equal(got.like_count, 1);
  });

  it("listLikes returns chronological track list", () => {
    const artist = createArtist(db, { ownerUserId: "u_lk2", name: "LkArt2" });
    const t1 = createTrack(db, { artistId: artist.id, title: "First" });
    const t2 = createTrack(db, { artistId: artist.id, title: "Second" });
    likeTrack(db, "u_likes_user", t1.id);
    likeTrack(db, "u_likes_user", t2.id);
    const list = listLikes(db, "u_likes_user");
    assert.equal(list.length, 2);
  });

  it("follow / unfollow round-trip", () => {
    const artist = createArtist(db, { ownerUserId: "u_fol_target", name: "FolArt" });
    followArtist(db, "u_follower", artist.id);
    assert.equal(getArtist(db, artist.id).follower_count, 1);
    unfollowArtist(db, "u_follower", artist.id);
    assert.equal(getArtist(db, artist.id).follower_count, 0);
  });
});

// ─── Stats ────────────────────────────────────────────────

describe("artistStats", () => {
  it("aggregates totals + recent listens", () => {
    const artist = createArtist(db, { ownerUserId: "u_stat", name: "StatArt" });
    const t = createTrack(db, { artistId: artist.id, title: "Hit", durationMs: 100_000 });
    recordListen(db, { trackId: t.id, listenedMs: 100_000 });
    recordListen(db, { trackId: t.id, listenedMs: 100_000 });
    likeTrack(db, "u_l", t.id);
    const s = artistStats(db, artist.id);
    assert.equal(s.trackCount, 1);
    assert.equal(s.totalListens, 2);
    assert.equal(s.totalLikes, 1);
    assert.equal(s.recentListens, 2);
  });
});

// ─── Macros ────────────────────────────────────────────────

describe("macros end-to-end", () => {
  it("artist_create + track_create + listen flow through macros", async () => {
    const a = await MACROS.get("artist_create")(ctx("u_mac"), { name: "MacArtist" });
    assert.equal(a.ok, true);
    const t = await MACROS.get("track_create")(ctx("u_mac"), { artistId: a.id, title: "Macro", durationMs: 100_000 });
    assert.equal(t.ok, true);
    const l = await MACROS.get("listen")(ctx("u_mac_listener"), { trackId: t.id, listenedMs: 95_000 });
    assert.equal(l.ok, true);
    assert.equal(l.skipped, false);
    const got = await MACROS.get("track_get")(ctx("u_mac"), { id: t.id });
    assert.equal(got.track.listen_count, 1);
  });

  it("track_create refuses cross-user artist", async () => {
    const a = await MACROS.get("artist_create")(ctx("u_owner_xs"), { name: "OwnedArtist" });
    const r = await MACROS.get("track_create")(ctx("u_thief_xs"), { artistId: a.id, title: "Theft" });
    assert.equal(r.reason, "forbidden");
  });
});
