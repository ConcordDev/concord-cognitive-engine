// Contract tests for the music Spotify + Apple Music 2026-parity
// streaming-library macros (tracks, playlists, queue, playback,
// followed artists, stats). Theory + MusicBrainz macros covered
// in music-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMusicActions from "../domains/music.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`music.${name}`);
  assert.ok(fn, `music.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMusicActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newTrack(ctx = ctxA, over = {}) {
  return call("track-add", ctx, { title: "Song One", artist: "Artist X", genre: "pop", durationSec: 200, ...over }).result.track;
}

describe("music.track-* library", () => {
  it("add requires a title, scoped per user", () => {
    assert.equal(call("track-add", ctxA, {}).ok, false);
    newTrack();
    assert.equal(call("track-list", ctxA, {}).result.count, 1);
    assert.equal(call("track-list", ctxB, {}).result.count, 0);
  });

  it("like toggles and liked-songs filters", () => {
    const t = newTrack();
    assert.equal(call("track-like", ctxA, { id: t.id }).result.liked, true);
    assert.equal(call("liked-songs", ctxA, {}).result.count, 1);
    assert.equal(call("track-like", ctxA, { id: t.id }).result.liked, false);
    assert.equal(call("liked-songs", ctxA, {}).result.count, 0);
  });

  it("search and delete", () => {
    newTrack(ctxA, { title: "Findable" });
    newTrack(ctxA, { title: "Other" });
    assert.equal(call("track-list", ctxA, { query: "findable" }).result.count, 1);
    const t = call("track-list", ctxA, {}).result.tracks[0];
    assert.equal(call("track-delete", ctxA, { id: t.id }).ok, true);
  });
});

describe("music.playlists", () => {
  it("create, add tracks, detail with duration", () => {
    const t1 = newTrack(ctxA, { durationSec: 180 });
    const t2 = newTrack(ctxA, { durationSec: 240, title: "Two" });
    const pl = call("playlist-create", ctxA, { name: "Roadtrip" }).result.playlist;
    call("playlist-add-track", ctxA, { playlistId: pl.id, trackId: t1.id });
    call("playlist-add-track", ctxA, { playlistId: pl.id, trackId: t2.id });
    const d = call("playlist-detail", ctxA, { id: pl.id });
    assert.equal(d.result.tracks.length, 2);
    assert.equal(d.result.durationSec, 420);
  });

  it("reorder + delete", () => {
    const t1 = newTrack();
    const t2 = newTrack(ctxA, { title: "Two" });
    const pl = call("playlist-create", ctxA, { name: "P" }).result.playlist;
    call("playlist-add-track", ctxA, { playlistId: pl.id, trackId: t1.id });
    call("playlist-add-track", ctxA, { playlistId: pl.id, trackId: t2.id });
    call("playlist-reorder", ctxA, { id: pl.id, trackId: t2.id, direction: "up" });
    assert.equal(call("playlist-detail", ctxA, { id: pl.id }).result.playlist.trackIds[0], t2.id);
    assert.equal(call("playlist-delete", ctxA, { id: pl.id }).ok, true);
  });
});

describe("music.playback + queue", () => {
  it("play-track increments count and sets now-playing", () => {
    const t = newTrack();
    call("play-track", ctxA, { id: t.id });
    call("play-track", ctxA, { id: t.id });
    assert.equal(call("track-detail", ctxA, { id: t.id }).result.track.playCount, 2);
    const np = call("now-playing", ctxA, {});
    assert.equal(np.result.nowPlaying.track.id, t.id);
  });

  it("queue add / list / clear", () => {
    const t1 = newTrack();
    const t2 = newTrack(ctxA, { title: "Two" });
    call("queue-add", ctxA, { trackId: t1.id });
    call("queue-add", ctxA, { trackId: t2.id, next: true });
    const q = call("queue-list", ctxA, {});
    assert.equal(q.result.count, 2);
    assert.equal(q.result.tracks[0].id, t2.id); // added with next
    call("queue-clear", ctxA, {});
    assert.equal(call("queue-list", ctxA, {}).result.count, 0);
  });
});

describe("music.artists + stats", () => {
  it("follow artists and count their tracks", () => {
    newTrack(ctxA, { artist: "Followed" });
    call("artist-follow", ctxA, { name: "Followed" });
    const list = call("artist-list", ctxA, {});
    assert.equal(list.result.artists[0].name, "Followed");
    assert.equal(list.result.artists[0].trackCount, 1);
  });

  it("top-tracks and top-artists rank by plays", () => {
    const a = newTrack(ctxA, { title: "Hit", artist: "Star" });
    const b = newTrack(ctxA, { title: "Deep cut", artist: "Indie" });
    call("play-track", ctxA, { id: a.id });
    call("play-track", ctxA, { id: a.id });
    call("play-track", ctxA, { id: b.id });
    assert.equal(call("top-tracks", ctxA, {}).result.tracks[0].title, "Hit");
    assert.equal(call("top-artists", ctxA, {}).result.artists[0].artist, "Star");
  });

  it("listening-stats and wrapped aggregate plays", () => {
    const t = newTrack(ctxA, { durationSec: 240 });
    call("play-track", ctxA, { id: t.id });
    call("play-track", ctxA, { id: t.id });
    const stats = call("listening-stats", ctxA, {});
    assert.equal(stats.result.totalPlays, 2);
    assert.equal(stats.result.listenedMinutes, 8);
    const yr = new Date().getFullYear().toString();
    const w = call("wrapped", ctxA, { year: yr });
    assert.equal(w.result.totalPlays, 2);
    assert.equal(w.result.topTracks[0].plays, 2);
  });
});

describe("music.discovery", () => {
  it("daily-mix excludes very recently played", () => {
    const a = newTrack(ctxA, { title: "Recent", genre: "pop" });
    newTrack(ctxA, { title: "Fresh", genre: "pop" });
    call("play-track", ctxA, { id: a.id });
    const mix = call("daily-mix", ctxA, {});
    assert.ok(mix.result.tracks.every((t) => t.id !== a.id));
  });

  it("recently-played dedupes by track, newest first", () => {
    const a = newTrack(ctxA, { title: "A" });
    const b = newTrack(ctxA, { title: "B" });
    call("play-track", ctxA, { id: a.id });
    call("play-track", ctxA, { id: b.id });
    call("play-track", ctxA, { id: a.id });
    const rp = call("recently-played", ctxA, {});
    assert.equal(rp.result.tracks[0].id, a.id);
    assert.equal(rp.result.count, 2);
  });

  it("music-dashboard aggregates", () => {
    const t = newTrack();
    call("play-track", ctxA, { id: t.id });
    call("playlist-create", ctxA, { name: "P" });
    const d = call("music-dashboard", ctxA, {});
    assert.equal(d.result.tracks, 1);
    assert.equal(d.result.totalPlays, 1);
    assert.equal(d.result.playlists, 1);
  });
});

describe("music.lyrics", () => {
  it("stores synced lyrics sorted by time and reads them back", () => {
    const t = newTrack();
    const r = call("track-lyrics-set", ctxA, { id: t.id, lyrics: [
      { timeSec: 12, line: "second line" },
      { timeSec: 4, line: "first line" },
    ] });
    assert.equal(r.result.synced, true);
    assert.equal(r.result.lineCount, 2);
    const got = call("track-lyrics-get", ctxA, { id: t.id });
    assert.equal(got.result.lyrics[0].line, "first line");
    assert.equal(got.result.synced, true);
  });

  it("plain-text lyrics split to unsynced lines", () => {
    const t = newTrack();
    call("track-lyrics-set", ctxA, { id: t.id, lyrics: "line a\nline b\nline c" });
    const got = call("track-lyrics-get", ctxA, { id: t.id });
    assert.equal(got.result.lyrics.length, 3);
    assert.equal(got.result.synced, false);
  });
});

describe("music.radio + smart-shuffle", () => {
  it("radio-start builds a queue weighted to the seed genre", () => {
    newTrack(ctxA, { title: "Pop A", genre: "pop" });
    newTrack(ctxA, { title: "Pop B", genre: "pop" });
    newTrack(ctxA, { title: "Jazz", genre: "jazz" });
    const r = call("radio-start", ctxA, { seedGenre: "pop", limit: 10 });
    assert.equal(r.ok, true);
    assert.match(r.result.station.label, /pop Radio/);
    assert.equal(call("queue-list", ctxA, {}).result.count, 3);
    assert.equal(r.result.tracks[0].genre, "pop");
  });

  it("radio-start rejects empty seed", () => {
    newTrack();
    assert.equal(call("radio-start", ctxA, {}).ok, false);
  });

  it("smart-shuffle fills the queue and returns a DJ line + breakdown", () => {
    const a = newTrack(ctxA, { title: "Liked" });
    newTrack(ctxA, { title: "Fresh" });
    call("track-like", ctxA, { id: a.id });
    const r = call("smart-shuffle", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 2);
    assert.ok(typeof r.result.dj === "string" && r.result.dj.length > 0);
    assert.equal(call("queue-list", ctxA, {}).result.count, r.result.count);
  });
});

describe("music.sleep-timer", () => {
  it("set / get / cancel lifecycle", () => {
    assert.equal(call("sleep-timer-get", ctxA, {}).result.active, false);
    call("sleep-timer-set", ctxA, { minutes: 45 });
    const g = call("sleep-timer-get", ctxA, {});
    assert.equal(g.result.active, true);
    assert.ok(g.result.remainingMin <= 45 && g.result.remainingMin >= 44);
    call("sleep-timer-cancel", ctxA, {});
    assert.equal(call("sleep-timer-get", ctxA, {}).result.active, false);
  });
});

describe("music.blend + recommend + genre-hub", () => {
  it("blend round-robin merges liked + played into a playlist", () => {
    const a = newTrack(ctxA, { title: "A" });
    const b = newTrack(ctxA, { title: "B" });
    call("track-like", ctxA, { id: a.id });
    call("play-track", ctxA, { id: b.id });
    const r = call("blend", ctxA, { name: "Mix" });
    assert.equal(r.ok, true);
    assert.ok(r.result.trackCount >= 2);
    assert.ok(call("playlist-list", ctxA, {}).result.playlists.some((p) => p.name === "Mix"));
  });

  it("recommend ranks same-genre tracks higher when seeded", () => {
    const seed = newTrack(ctxA, { title: "Seed", genre: "rock" });
    newTrack(ctxA, { title: "Same", genre: "rock" });
    newTrack(ctxA, { title: "Other", genre: "pop" });
    const r = call("recommend", ctxA, { seedTrackId: seed.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.tracks[0].genre, "rock");
    assert.match(r.result.basis, /^seed:/);
  });

  it("genre-hub groups library by genre", () => {
    newTrack(ctxA, { genre: "pop" });
    newTrack(ctxA, { genre: "pop" });
    newTrack(ctxA, { genre: "jazz" });
    const r = call("genre-hub", ctxA, {});
    assert.equal(r.result.count, 2);
    assert.equal(r.result.genres[0].genre, "pop");
    assert.equal(r.result.genres[0].trackCount, 2);
  });
});

describe("music.audio-settings", () => {
  it("returns defaults then persists overrides with clamping", () => {
    const d = call("audio-settings-get", ctxA, {});
    assert.equal(d.result.settings.quality, "high");
    assert.equal(d.result.settings.gapless, true);
    const set = call("audio-settings-set", ctxA, { crossfadeSec: 99, quality: "lossless", gapless: false });
    assert.equal(set.result.settings.crossfadeSec, 12); // clamped
    assert.equal(set.result.settings.quality, "lossless");
    assert.equal(set.result.settings.gapless, false);
    assert.equal(call("audio-settings-get", ctxA, {}).result.settings.quality, "lossless");
  });
});
