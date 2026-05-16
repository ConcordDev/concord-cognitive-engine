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
