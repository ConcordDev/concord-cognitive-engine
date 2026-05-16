// Contract tests for atlas (Nominatim + Overpass) + repos (GitHub) real-API macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAtlasActions from "../domains/atlas.js";
import registerReposActions from "../domains/repos.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerAtlasActions(register);
  registerReposActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.GITHUB_TOKEN;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("atlas.nominatim-geocode (OSM Nominatim)", () => {
  it("rejects empty query", async () => {
    assert.equal((await call("atlas.nominatim-geocode", ctxA, {})).ok, false);
  });

  it("sends Wikimedia UA header + parses place response", async () => {
    let capturedUrl = "", capturedUA = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedUA = opts?.headers?.["User-Agent"] || "";
      return {
        ok: true,
        json: async () => ([{
          osm_type: "relation", osm_id: 7259, place_id: 282525632,
          display_name: "San Francisco, California, United States",
          lat: "37.7790262", lon: "-122.4199061",
          category: "boundary", type: "administrative", addresstype: "city",
          importance: 0.85,
          boundingbox: ["37.6398", "37.9298", "-123.1738", "-122.2818"],
          address: { city: "San Francisco", state: "California", country: "United States", country_code: "us" },
        }]),
      };
    };
    const r = await call("atlas.nominatim-geocode", ctxA, { query: "San Francisco" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /nominatim\.openstreetmap\.org\/search/);
    assert.match(capturedUA, /Concord-OS/);
    assert.equal(r.result.places[0].latitude, 37.7790262);
    assert.equal(r.result.places[0].address.country_code, "us");
    assert.equal(r.result.source, "openstreetmap-nominatim");
  });
});

describe("atlas.nominatim-reverse", () => {
  it("rejects missing coords", async () => {
    assert.equal((await call("atlas.nominatim-reverse", ctxA, {})).ok, false);
  });

  it("parses reverse-geocode response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          osm_type: "node", osm_id: 12345,
          display_name: "1600 Pennsylvania Avenue NW, Washington, DC, USA",
          addresstype: "house",
          address: { road: "Pennsylvania Avenue NW", city: "Washington", state: "DC", country_code: "us" },
        }),
      };
    };
    const r = await call("atlas.nominatim-reverse", ctxA, { latitude: 38.8977, longitude: -77.0365 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /\/reverse\?lat=38\.8977&lon=-77\.0365/);
    assert.equal(r.result.address.country_code, "us");
  });

  it("surfaces in-body error from Nominatim", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ error: "Unable to geocode" }) });
    const r = await call("atlas.nominatim-reverse", ctxA, { latitude: 999, longitude: 999 });
    assert.equal(r.ok, false);
    assert.match(r.error, /nominatim: Unable to geocode/);
  });
});

describe("atlas.overpass-poi", () => {
  it("rejects bad bbox", async () => {
    assert.equal((await call("atlas.overpass-poi", ctxA, {})).ok, false);
    // south > north
    assert.equal((await call("atlas.overpass-poi", ctxA, { south: 38, west: -123, north: 37, east: -122 })).ok, false);
  });

  it("POSTs Overpass query + parses elements", async () => {
    let capturedUrl = "", capturedBody = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = opts?.body || "";
      return {
        ok: true,
        json: async () => ({
          elements: [
            {
              type: "node", id: 12345, lat: 37.78, lon: -122.42,
              tags: { amenity: "cafe", name: "Blue Bottle", cuisine: "coffee_shop" },
            },
          ],
        }),
      };
    };
    const r = await call("atlas.overpass-poi", ctxA, {
      south: 37.7, west: -122.5, north: 37.8, east: -122.4, amenity: "cafe",
    });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /overpass-api\.de\/api\/interpreter/);
    assert.match(decodeURIComponent(capturedBody), /\["amenity"="cafe"\]/);
    assert.equal(r.result.elements[0].name, "Blue Bottle");
    assert.equal(r.result.source, "openstreetmap-overpass");
  });

  it("surfaces 429 rate-limit clearly", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("atlas.overpass-poi", ctxA, { south: 37, west: -123, north: 38, east: -122 });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit/);
  });
});

describe("repos.github-commits-recent", () => {
  it("rejects missing params", async () => {
    assert.equal((await call("repos.github-commits-recent", ctxA, {})).ok, false);
  });

  it("parses commit list with author + sha + url", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([{
          sha: "abc123def456",
          commit: {
            message: "feat: real-data macros for atlas + repos",
            author: { name: "Alice", email: "alice@example.com", date: "2026-05-16T10:00:00Z" },
            committer: { name: "Alice", date: "2026-05-16T10:00:00Z" },
          },
          html_url: "https://github.com/owner/repo/commit/abc123def456",
          author: { login: "alice" },
          committer: { login: "alice" },
        }]),
      };
    };
    const r = await call("repos.github-commits-recent", ctxA, { owner: "owner", repo: "repo" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.github\.com\/repos\/owner\/repo\/commits/);
    assert.equal(r.result.commits[0].sha, "abc123def456");
    assert.equal(r.result.commits[0].author, "Alice");
    assert.equal(r.result.source, "github-api");
  });

  it("supports since/until filters", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ([]) };
    };
    await call("repos.github-commits-recent", ctxA, {
      owner: "x", repo: "y",
      since: "2026-01-01T00:00:00Z",
      until: "2026-05-01T00:00:00Z",
    });
    assert.match(capturedUrl, /since=2026-01-01/);
    assert.match(capturedUrl, /until=2026-05-01/);
  });
});

describe("repos.github-issues", () => {
  it("defaults to open state + parses issue list", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([{
          number: 42, title: "Bug: foo", state: "open",
          user: { login: "alice" },
          labels: [{ name: "bug" }, { name: "high-priority" }],
          comments: 5,
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-05-15T00:00:00Z",
          closed_at: null,
          html_url: "https://github.com/x/y/issues/42",
        }]),
      };
    };
    const r = await call("repos.github-issues", ctxA, { owner: "x", repo: "y" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /state=open/);
    assert.equal(r.result.issues[0].number, 42);
    assert.deepEqual(r.result.issues[0].labels, ["bug", "high-priority"]);
    assert.equal(r.result.openIssues, 1);
  });

  it("supports labels filter", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ([]) };
    };
    await call("repos.github-issues", ctxA, { owner: "x", repo: "y", labels: "bug,help-wanted" });
    assert.match(capturedUrl, /labels=bug%2Chelp-wanted/);
  });
});

describe("repos.github-languages", () => {
  it("computes percentages from byte counts", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ TypeScript: 850000, JavaScript: 100000, Python: 50000 }),
    });
    const r = await call("repos.github-languages", ctxA, { owner: "x", repo: "y" });
    assert.equal(r.ok, true);
    assert.equal(r.result.languages[0].language, "TypeScript");
    assert.equal(r.result.languages[0].percent, 85);
    assert.equal(r.result.primaryLanguage, "TypeScript");
    assert.equal(r.result.totalBytes, 1_000_000);
  });

  it("surfaces 404 cleanly", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("repos.github-languages", ctxA, { owner: "x", repo: "missing" });
    assert.equal(r.ok, false);
    assert.match(r.error, /repo not found/);
  });
});
