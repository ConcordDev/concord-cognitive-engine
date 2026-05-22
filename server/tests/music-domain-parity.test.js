// Contract tests for server/domains/music.js — pure-compute music theory
// helpers + real MusicBrainz metadata.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMusicActions from "../domains/music.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`music.${name}`);
  if (!fn) throw new Error(`music.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerMusicActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("music.bpmAnalyze (pure compute)", () => {
  it("computes ~120 BPM from half-second beat intervals", () => {
    const beats = [0, 0.5, 1.0, 1.5, 2.0, 2.5];  // every 0.5s = 120 BPM
    const r = call("bpmAnalyze", ctxA, { data: { beats } }, {});
    assert.equal(r.result.bpm, 120);
    // 120 BPM lands at the Moderato/Allegro boundary; macro uses < 140 → Allegro
    assert.equal(r.result.tempoClass, "Allegro");
  });
});

describe("music.keyDetect (Krumhansl-Schmuckler)", () => {
  it("detects C major from C-major note bag", () => {
    const r = call("keyDetect", ctxA, { data: { notes: ["C", "E", "G", "C", "F", "G", "A", "C", "E"] } }, {});
    assert.equal(r.result.key, "C");
    assert.equal(r.result.mode, "major");
  });
});

describe("music.mb-search-artist (MusicBrainz)", () => {
  it("rejects empty/short queries", async () => {
    assert.equal((await call("mb-search-artist", ctxA, {})).ok, false);
    assert.equal((await call("mb-search-artist", ctxA, { query: "a" })).ok, false);
  });

  it("hits MusicBrainz + parses real response shape", async () => {
    let capturedUrl = "", capturedHeaders = {};
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts?.headers || {};
      return {
        ok: true,
        json: async () => ({
          count: 1,
          artists: [{
            id: "5b11f4ce-a62d-471e-81fc-a69a8278c7da",
            name: "Nirvana", "sort-name": "Nirvana",
            type: "Group", country: "US",
            "begin-area": { name: "Aberdeen" },
            "life-span": { begin: "1987-01", end: "1994-04-05", ended: true },
            disambiguation: "1980s grunge",
            score: 100,
            tags: [{ name: "rock" }, { name: "grunge" }],
          }],
        }),
      };
    };
    const r = await call("mb-search-artist", ctxA, { query: "nirvana" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /musicbrainz\.org\/ws\/2\/artist\?query=nirvana/);
    assert.match(capturedUrl, /fmt=json/);
    // ToS-mandated User-Agent
    assert.match(capturedHeaders["User-Agent"], /Concord-OS/);
    assert.equal(r.result.artists[0].mbid, "5b11f4ce-a62d-471e-81fc-a69a8278c7da");
    assert.equal(r.result.artists[0].country, "US");
    assert.equal(r.result.artists[0].tags[0], "rock");
    assert.equal(r.result.source, "musicbrainz");
  });

  it("surfaces 503 rate-limit with explicit message", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await call("mb-search-artist", ctxA, { query: "test" });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limited/);
  });
});

describe("music.mb-artist-releases (MusicBrainz)", () => {
  it("rejects missing mbid", async () => {
    assert.equal((await call("mb-artist-releases", ctxA, {})).ok, false);
  });

  it("rejects malformed mbid", async () => {
    const r = await call("mb-artist-releases", ctxA, { mbid: "not-a-uuid" });
    assert.equal(r.ok, false);
    assert.match(r.error, /MusicBrainz UUID/);
  });

  it("hits MusicBrainz + sorts releases newest first", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        "release-count": 2,
        releases: [
          { id: "rel1", title: "Bleach", date: "1989-06-15", country: "US", status: "Official",
            "release-group": { "primary-type": "Album", "secondary-types": [] } },
          { id: "rel2", title: "Nevermind", date: "1991-09-24", country: "US", status: "Official",
            "release-group": { "primary-type": "Album", "secondary-types": [] } },
        ],
      }),
    });
    const r = await call("mb-artist-releases", ctxA, { mbid: "5b11f4ce-a62d-471e-81fc-a69a8278c7da" });
    assert.equal(r.ok, true);
    // Sorted newest first
    assert.equal(r.result.releases[0].title, "Nevermind");
    assert.equal(r.result.releases[1].title, "Bleach");
  });
});

describe("music.mb-lookup-by-isrc (MusicBrainz)", () => {
  it("rejects invalid ISRC format", async () => {
    assert.equal((await call("mb-lookup-by-isrc", ctxA, { isrc: "INVALID" })).ok, false);
  });

  it("accepts hyphenated ISRC and normalizes", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ recordings: [] }) };
    };
    await call("mb-lookup-by-isrc", ctxA, { isrc: "US-RC1-76-07839" });
    assert.match(capturedUrl, /\/isrc\/USRC17607839/);
  });

  it("parses real recording response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        recordings: [{
          id: "rec-uuid",
          title: "Smells Like Teen Spirit",
          length: 301000,
          "artist-credit": [{ name: "Nirvana" }],
          releases: [{ id: "rel-uuid", title: "Nevermind", date: "1991-09-24" }],
          disambiguation: "",
        }],
      }),
    });
    const r = await call("mb-lookup-by-isrc", ctxA, { isrc: "USRC17607839" });
    assert.equal(r.ok, true);
    assert.equal(r.result.recordings[0].title, "Smells Like Teen Spirit");
    assert.equal(r.result.recordings[0].artistCredit, "Nirvana");
    assert.equal(r.result.recordings[0].lengthMs, 301000);
  });
});

// ════════════════════════════════════════════════════════════════════
// Feature-parity backlog — 17 buildable gaps vs Spotify (2026)
// ════════════════════════════════════════════════════════════════════

// STATE-backed macros need a fresh substrate per test.
function resetState() {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
}
function addTrack(ctx = ctxA, over = {}) {
  return call("track-add", ctx, { id: null, data: {}, meta: {} },
    { title: "Song", artist: "Artist", genre: "pop", durationSec: 200, ...over }).result.track;
}

describe("backlog 1 — music.ingest-itunes (free-API ingestion)", () => {
  it("rejects empty term", async () => {
    resetState();
    const r = await call("ingest-itunes", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(r.ok, false);
  });
  it("ingests real iTunes Search results into the library", async () => {
    resetState();
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ results: [
        { trackId: 1, trackName: "Hit", artistName: "Band", collectionName: "Album",
          primaryGenreName: "Rock", trackTimeMillis: 240000, previewUrl: "http://p", artworkUrl100: "http://a" },
      ] }),
    });
    const r = await call("ingest-itunes", ctxA, { id: null, data: {}, meta: {} }, { term: "hit" });
    assert.equal(r.ok, true);
    assert.equal(r.result.ingested, 1);
    assert.equal(r.result.tracks[0].externalId, "itunes:1");
  });
});

describe("backlog 2 — music.lyrics-autofetch (LRCLIB)", () => {
  it("rejects unknown track", async () => {
    resetState();
    const r = await call("lyrics-autofetch", ctxA, { id: null, data: {}, meta: {} }, { id: "nope" });
    assert.equal(r.ok, false);
  });
  it("parses LRC synced lyrics into timed lines", async () => {
    resetState();
    const t = addTrack();
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ syncedLyrics: "[00:01.50]first line\n[00:05.00]second line" }),
    });
    const r = await call("lyrics-autofetch", ctxA, { id: null, data: {}, meta: {} }, { id: t.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.synced, true);
    assert.equal(r.result.lineCount, 2);
  });
});

describe("backlog 3 — music.eq-set / engine-config (playback engine)", () => {
  it("applies an EQ preset and returns normalized config", () => {
    resetState();
    const eq = call("eq-set", ctxA, { id: null, data: {}, meta: {} }, { enabled: true, preset: "bass_boost" });
    assert.equal(eq.result.eq.enabled, true);
    assert.equal(eq.result.eq.bands.bass, 8);
    const cfg = call("engine-config", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(cfg.result.config.eq.preset, "bass_boost");
    assert.equal(typeof cfg.result.crossfadeMs, "number");
  });
});

describe("backlog 4 — music.download-add/list/remove (offline)", () => {
  it("adds, lists and removes an offline download", () => {
    resetState();
    const t = addTrack();
    assert.equal(call("download-add", ctxA, { id: null, data: {}, meta: {} }, { trackId: t.id }).result.downloaded, true);
    assert.equal(call("download-list", ctxA, { id: null, data: {}, meta: {} }, {}).result.count, 1);
    assert.equal(call("download-remove", ctxA, { id: null, data: {}, meta: {} }, { trackId: t.id }).result.count, 0);
  });
});

describe("backlog 5 — music.device-register/list/transfer (Connect)", () => {
  it("registers a device and transfers playback to it", () => {
    resetState();
    const dev = call("device-register", ctxA, { id: null, data: {}, meta: {} }, { name: "Phone", kind: "phone" }).result.device;
    assert.ok(dev.id);
    const xfer = call("device-transfer", ctxA, { id: null, data: {}, meta: {} }, { deviceId: dev.id });
    assert.equal(xfer.result.activeDeviceId, dev.id);
    assert.equal(call("device-list", ctxA, { id: null, data: {}, meta: {} }, {}).result.activeDeviceId, dev.id);
  });
});

describe("backlog 6 — music.karaoke-set (vocal reduction)", () => {
  it("stores karaoke prefs", () => {
    resetState();
    const r = call("karaoke-set", ctxA, { id: null, data: {}, meta: {} }, { enabled: true, vocalReductionPct: 90 });
    assert.equal(r.result.karaoke.enabled, true);
    assert.equal(r.result.karaoke.vocalReductionPct, 90);
  });
});

describe("backlog 7 — music.dj-session (AI DJ with voice)", () => {
  it("builds a session with voice narration payload", async () => {
    resetState();
    addTrack(ctxA, { title: "A" });
    addTrack(ctxA, { title: "B" });
    const r = await call("dj-session", ctxA, { id: null, data: {}, meta: {} }, { limit: 5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.voice.text.length > 0);
    assert.ok(r.result.tracks.length >= 2);
  });
});

describe("backlog 8 — music.ai-playlist (prompt → playlist)", () => {
  it("builds a playlist from a prompt via keyword match", async () => {
    resetState();
    addTrack(ctxA, { title: "Focus Beat", genre: "ambient" });
    const r = await call("ai-playlist", ctxA, { id: null, data: {}, meta: {} }, { prompt: "focus ambient" });
    assert.equal(r.ok, true);
    assert.ok(r.result.playlist.aiGenerated);
    assert.ok(r.result.trackCount >= 1);
  });
});

describe("backlog 9 — music.scheduled-playlist (Discover Weekly etc.)", () => {
  it("refreshes and lists a scheduled playlist", () => {
    resetState();
    addTrack();
    const r = call("scheduled-playlist-refresh", ctxA, { id: null, data: {}, meta: {} }, { kind: "discover_weekly" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "discover_weekly");
    const list = call("scheduled-playlist-list", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(list.result.playlists[0].kind, "discover_weekly");
  });
});

describe("backlog 10 — music.smart-recommend (history-aware model)", () => {
  it("returns recs with a collaborative basis", () => {
    resetState();
    const a = addTrack(ctxA, { title: "A" });
    addTrack(ctxA, { title: "B" });
    call("play-track", ctxA, { id: null, data: {}, meta: {} }, { id: a.id });
    const r = call("smart-recommend", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.basis, "collaborative+recency");
  });
});

describe("backlog 11 — music.jam (synchronized group listening)", () => {
  it("hosts a jam and a second user joins by code", () => {
    resetState();
    const jam = call("jam-create", ctxA, { id: null, data: {}, meta: {} }, { name: "Night Jam" }).result.jam;
    const joined = call("jam-join", ctxB, { id: null, data: {}, meta: {} }, { code: jam.code });
    assert.equal(joined.ok, true);
    assert.equal(joined.result.jam.participants.length, 2);
    assert.equal(call("jam-leave", ctxB, { id: null, data: {}, meta: {} }, {}).result.left, true);
  });
});

describe("backlog 12 — music.friend-activity (social feed)", () => {
  it("surfaces another user's now-playing", () => {
    resetState();
    const t = addTrack(ctxB);
    call("play-track", ctxB, { id: null, data: {}, meta: {} }, { id: t.id });
    const r = call("friend-activity", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.activity[0].kind, "now_playing");
  });
});

describe("backlog 13 — music.playlist-collab-edit (multi-user editing)", () => {
  it("lets a second user add to a collaborative playlist", () => {
    resetState();
    const pl = call("playlist-create", ctxA, { id: null, data: {}, meta: {} }, { name: "Shared", collaborative: true }).result.playlist;
    const t = addTrack(ctxB);
    const r = call("playlist-collab-edit", ctxB, { id: null, data: {}, meta: {} }, { playlistId: pl.id, trackId: t.id, op: "add" });
    assert.equal(r.ok, true);
    assert.equal(r.result.trackCount, 1);
  });
});

describe("backlog 14 — music.share-card (story cards)", () => {
  it("generates a shareable track card", () => {
    resetState();
    const t = addTrack();
    const r = call("share-card", ctxA, { id: null, data: {}, meta: {} }, { kind: "track", id: t.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.kind, "track");
    assert.ok(r.result.card.shareUrl.includes("/music/share/"));
  });
});

describe("backlog 15 — music.stream-analytics (artist analytics)", () => {
  it("aggregates streams of the artist's own catalog", () => {
    resetState();
    const t = addTrack(ctxA, { title: "Mine" });
    call("play-track", ctxA, { id: null, data: {}, meta: {} }, { id: t.id });
    const r = call("stream-analytics", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalStreams, 1);
    assert.equal(r.result.catalogSize, 1);
  });
});

describe("backlog 16 — music.artist-profile (canvas + bio + pick)", () => {
  it("sets and reads back an artist profile", () => {
    resetState();
    const t = addTrack();
    const set = call("artist-profile-set", ctxA, { id: null, data: {}, meta: {} },
      { bio: "Sovereign producer", canvasUrl: "http://c", pickTrackId: t.id });
    assert.equal(set.result.profile.bio, "Sovereign producer");
    const get = call("artist-profile-get", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(get.result.profile.canvasUrl, "http://c");
    assert.equal(get.result.pickTrack.id, t.id);
  });
});

describe("backlog 17 — music.concert-listings (MusicBrainz events)", () => {
  it("rejects missing artist", async () => {
    resetState();
    const r = await call("concert-listings", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(r.ok, false);
  });
  it("resolves an artist and returns upcoming events", async () => {
    resetState();
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    globalThis.fetch = async (url) => {
      if (String(url).includes("/artist?")) {
        return { ok: true, json: async () => ({ artists: [{ id: "mbid-1" }] }) };
      }
      return { ok: true, json: async () => ({ events: [
        { id: "ev1", name: "Live Show", type: "Concert", "life-span": { begin: future } },
      ] }) };
    };
    const r = await call("concert-listings", ctxA, { id: null, data: {}, meta: {} }, { artist: "Band" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.events[0].name, "Live Show");
  });
});
