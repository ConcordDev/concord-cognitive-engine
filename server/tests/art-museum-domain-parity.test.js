// Contract tests for server/domains/art.js museum-API additions
// (Met Museum + Art Institute of Chicago). The existing pure-compute
// color/composition/palette/style helpers are covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArtActions from "../domains/art.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`art.${name}`);
  if (!fn) throw new Error(`art.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerArtActions(register); });
beforeEach(() => { globalThis.fetch = async () => { throw new Error("network disabled in tests"); }; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("art.met-search (Metropolitan Museum)", () => {
  it("rejects empty query", async () => {
    assert.equal((await call("met-search", ctxA, {})).ok, false);
  });

  it("hits Met search + truncates objectIDs to 50", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          total: 234,
          objectIDs: Array.from({ length: 100 }, (_, i) => 100000 + i),
        }),
      };
    };
    const r = await call("met-search", ctxA, { query: "vincent van gogh" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /collectionapi\.metmuseum\.org\/public\/collection\/v1\/search/);
    assert.match(capturedUrl, /q=vincent%20van%20gogh/);
    assert.equal(r.result.total, 234);
    assert.equal(r.result.objectIds.length, 50);
    assert.equal(r.result.source, "metmuseum");
  });

  it("supports hasImages filter", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ total: 0, objectIDs: [] }) };
    };
    await call("met-search", ctxA, { query: "monet", hasImages: true });
    assert.match(capturedUrl, /hasImages=true/);
  });
});

describe("art.met-object (Met by ID)", () => {
  it("rejects bad objectId", async () => {
    assert.equal((await call("met-object", ctxA, {})).ok, false);
    assert.equal((await call("met-object", ctxA, { objectId: -1 })).ok, false);
  });

  it("parses real Met response with full metadata", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        objectID: 436524,
        isHighlight: true,
        accessionNumber: "67.187.70a",
        accessionYear: "1967",
        title: "Wheat Field with Cypresses",
        artistDisplayName: "Vincent van Gogh",
        artistDisplayBio: "Dutch, Zundert 1853–1890 Auvers-sur-Oise",
        artistNationality: "Dutch",
        artistRole: "Artist",
        objectDate: "1889",
        objectBeginDate: 1889, objectEndDate: 1889,
        medium: "Oil on canvas",
        dimensions: "28 7/8 x 36 3/4 in. (73.2 x 93.4 cm)",
        classification: "Paintings",
        department: "European Paintings",
        culture: "",
        period: "",
        repository: "Metropolitan Museum of Art, New York, NY",
        isPublicDomain: true,
        primaryImage: "https://images.metmuseum.org/CRDImages/.../DT1567.jpg",
        primaryImageSmall: "https://images.metmuseum.org/CRDImages/.../DT1567s.jpg",
        additionalImages: [],
        objectURL: "https://www.metmuseum.org/art/collection/search/436524",
        tags: [{ term: "Landscapes" }, { term: "Trees" }],
      }),
    });
    const r = await call("met-object", ctxA, { objectId: 436524 });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "Wheat Field with Cypresses");
    assert.equal(r.result.artist, "Vincent van Gogh");
    assert.equal(r.result.publicDomain, true);
    assert.deepEqual(r.result.tags, ["Landscapes", "Trees"]);
  });

  it("returns clear 404 when object doesn't exist", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("met-object", ctxA, { objectId: 9999999 });
    assert.equal(r.ok, false);
    assert.match(r.error, /Met object not found/);
  });
});

describe("art.aic-search (Art Institute of Chicago)", () => {
  it("rejects empty query", async () => {
    assert.equal((await call("aic-search", ctxA, {})).ok, false);
  });

  it("hits AIC + composes IIIF image URLs from image_id", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          pagination: { total: 142 },
          data: [{
            id: 27992,
            title: "A Sunday on La Grande Jatte — 1884",
            artist_title: "Georges Seurat",
            artist_display: "Georges Seurat\nFrench, 1859-1891",
            date_display: "1884–86",
            date_start: 1884, date_end: 1886,
            medium_display: "Oil on canvas",
            dimensions: "207.5 × 308.1 cm (81 3/4 × 121 1/4 in.)",
            image_id: "1adf2696-8489-499b-cad2-821d7fde4b33",
            classification_title: "painting",
            department_title: "Painting and Sculpture of Europe",
            place_of_origin: "France",
            style_title: "Pointillism",
            is_public_domain: true,
          }],
        }),
      };
    };
    const r = await call("aic-search", ctxA, { query: "seurat" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.artic\.edu\/api\/v1\/artworks\/search/);
    assert.equal(r.result.artworks[0].artist, "Georges Seurat");
    assert.equal(r.result.artworks[0].style, "Pointillism");
    // IIIF URL composed from image_id
    assert.match(r.result.artworks[0].imageUrl, /www\.artic\.edu\/iiif\/2\/1adf2696.*\/full\/843,\/0\/default\.jpg/);
    assert.equal(r.result.totalResults, 142);
    assert.equal(r.result.source, "art-institute-of-chicago");
  });

  it("returns imageUrl:null when artwork has no image_id", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        pagination: { total: 1 },
        data: [{ id: 1, title: "x", image_id: null }],
      }),
    });
    const r = await call("aic-search", ctxA, { query: "x" });
    assert.equal(r.result.artworks[0].imageUrl, null);
  });

  it("surfaces AIC network failures", async () => {
    const r = await call("aic-search", ctxA, { query: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /aic unreachable/);
  });
});
