// Contract tests for the new real-API macros across poetry, podcast,
// and photography domains.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPoetryActions from "../domains/poetry.js";
import registerPodcastActions from "../domains/podcast.js";
import registerPhotographyActions from "../domains/photography.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerPoetryActions(register);
  registerPodcastActions(register);
  registerPhotographyActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.PEXELS_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("poetry.poetrydb-search (PoetryDB)", () => {
  it("rejects no author + no title", async () => {
    assert.equal((await call("poetry.poetrydb-search", ctxA, {})).ok, false);
  });

  it("hits author endpoint when only author supplied", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          { title: "Sonnet 18", author: "William Shakespeare", lines: ["Shall I compare thee to a summer's day?", "..."], linecount: "14" },
        ]),
      };
    };
    const r = await call("poetry.poetrydb-search", ctxA, { author: "Shakespeare" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /poetrydb\.org\/author\/Shakespeare/);
    assert.equal(r.result.poems[0].author, "William Shakespeare");
    assert.equal(r.result.poems[0].lineCount, 14);
  });

  it("hits author,title compound endpoint when both supplied", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ([{ title: "Sonnet 18", author: "Shakespeare", lines: [] }]) };
    };
    await call("poetry.poetrydb-search", ctxA, { author: "Shakespeare", title: "Sonnet 18" });
    assert.match(capturedUrl, /poetrydb\.org\/author,title\/Shakespeare;Sonnet%2018/);
  });

  it("handles PoetryDB 404 status as empty list (not error)", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: 404, reason: "Not found" }),
    });
    const r = await call("poetry.poetrydb-search", ctxA, { author: "NonexistentPoet" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });
});

describe("poetry.poetrydb-authors (PoetryDB)", () => {
  it("returns full author list", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ authors: ["Adam Lindsay Gordon", "Alan Seeger", "William Shakespeare"] }),
    });
    const r = await call("poetry.poetrydb-authors", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.authors[2], "William Shakespeare");
  });
});

describe("podcast.itunes-search (Apple Podcasts)", () => {
  it("rejects empty query", async () => {
    assert.equal((await call("podcast.itunes-search", ctxA, {})).ok, false);
  });

  it("rejects bad country code", async () => {
    const r = await call("podcast.itunes-search", ctxA, { query: "x", country: "USA" });
    assert.equal(r.ok, false);
  });

  it("hits iTunes Search + shapes podcast response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          resultCount: 42,
          results: [{
            collectionId: 1200361736, trackId: 1200361736,
            collectionName: "The Daily", trackName: "The Daily",
            artistName: "The New York Times",
            primaryGenreName: "News",
            genres: ["News", "Daily News", "Podcasts"],
            artworkUrl600: "https://example.org/600.jpg",
            artworkUrl100: "https://example.org/100.jpg",
            feedUrl: "https://feeds.simplecast.com/54nAGcIl",
            trackCount: 2500,
            country: "USA",
            releaseDate: "2026-05-16T09:00:00Z",
            collectionViewUrl: "https://podcasts.apple.com/us/podcast/the-daily/id1200361736",
          }],
        }),
      };
    };
    const r = await call("podcast.itunes-search", ctxA, { query: "the daily" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /itunes\.apple\.com\/search\?term=the%20daily/);
    assert.match(capturedUrl, /media=podcast/);
    assert.match(capturedUrl, /country=US/);
    assert.equal(r.result.podcasts[0].title, "The Daily");
    assert.equal(r.result.podcasts[0].artist, "The New York Times");
    assert.equal(r.result.podcasts[0].episodeCount, 2500);
    assert.equal(r.result.podcasts[0].feedUrl, "https://feeds.simplecast.com/54nAGcIl");
    assert.equal(r.result.source, "itunes-search");
  });
});

describe("podcast.itunes-podcast (Lookup)", () => {
  it("rejects missing collectionId", async () => {
    assert.equal((await call("podcast.itunes-podcast", ctxA, {})).ok, false);
  });

  it("returns clear error when iTunes returns no results", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
    const r = await call("podcast.itunes-podcast", ctxA, { collectionId: 999999 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("parses lookup response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [{ collectionId: 1200361736, collectionName: "The Daily", artistName: "NYT", feedUrl: "https://feed", trackCount: 2500 }],
      }),
    });
    const r = await call("podcast.itunes-podcast", ctxA, { collectionId: 1200361736 });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "The Daily");
  });
});

describe("photography.pexels-search", () => {
  it("rejects when key not set", async () => {
    const r = await call("photography.pexels-search", ctxA, { query: "sunset" });
    assert.equal(r.ok, false);
    assert.match(r.error, /PEXELS_API_KEY/);
  });

  it("rejects empty query", async () => {
    process.env.PEXELS_API_KEY = "test-key";
    assert.equal((await call("photography.pexels-search", ctxA, {})).ok, false);
  });

  it("hits Pexels with Authorization header + shapes photos", async () => {
    process.env.PEXELS_API_KEY = "test-key";
    let capturedUrl = "", capturedAuth = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedAuth = opts?.headers?.Authorization || "";
      return {
        ok: true,
        json: async () => ({
          total_results: 100, next_page: "https://api.pexels.com/v1/search?query=sunset&page=2",
          photos: [{
            id: 12345, photographer: "Jane Doe", photographer_url: "https://example.org/jane",
            width: 5184, height: 3456, avg_color: "#a37b50",
            src: {
              original: "https://images.pexels.com/photos/12345/.jpg",
              large: "https://images.pexels.com/photos/12345/?h=650",
              medium: "https://images.pexels.com/photos/12345/?h=350",
              small: "https://images.pexels.com/photos/12345/?h=130",
              tiny: "https://images.pexels.com/photos/12345/?w=280&h=200&dpr=1",
              portrait: "https://images.pexels.com/photos/12345/?h=1200&w=800",
              landscape: "https://images.pexels.com/photos/12345/?h=600&w=1200",
            },
            url: "https://www.pexels.com/photo/12345/",
            alt: "Sunset over the ocean",
          }],
        }),
      };
    };
    const r = await call("photography.pexels-search", ctxA, { query: "sunset", orientation: "landscape" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.pexels\.com\/v1\/search/);
    assert.match(capturedUrl, /orientation=landscape/);
    assert.equal(capturedAuth, "test-key");
    assert.equal(r.result.photos[0].photographer, "Jane Doe");
    assert.equal(r.result.totalResults, 100);
  });

  it("surfaces 401 invalid-key", async () => {
    process.env.PEXELS_API_KEY = "bad";
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const r = await call("photography.pexels-search", ctxA, { query: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid/);
  });
});
