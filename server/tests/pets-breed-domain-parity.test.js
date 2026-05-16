// Contract tests for the new pets breed-API macros (The Dog API +
// The Cat API). Existing pure-compute macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPetsActions from "../domains/pets.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`pets.${name}`);
  if (!fn) throw new Error(`pets.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPetsActions(register); });
beforeEach(() => { globalThis.fetch = async () => { throw new Error("network disabled in tests"); }; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("pets.breed-info (Dog/Cat API)", () => {
  it("rejects bad species", async () => {
    assert.equal((await call("breed-info", ctxA, { species: "horse", name: "x" })).ok, false);
  });

  it("rejects missing name", async () => {
    assert.equal((await call("breed-info", ctxA, { species: "dog" })).ok, false);
  });

  it("hits The Dog API + parses + composes reference image URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([{
          id: 1, name: "Golden Retriever",
          bred_for: "Retrieving",
          breed_group: "Sporting",
          life_span: "10 - 12 years",
          temperament: "Intelligent, Kind, Reliable, Friendly, Trustworthy, Confident",
          origin: "Scotland",
          country_code: "GB",
          weight: { imperial: "55 - 75", metric: "25 - 34" },
          height: { imperial: "21.5 - 24", metric: "55 - 61" },
          hypoallergenic: 0,
          wikipedia_url: "https://en.wikipedia.org/wiki/Golden_Retriever",
          reference_image_id: "HJ7Y2j7XX",
        }]),
      };
    };
    const r = await call("breed-info", ctxA, { species: "dog", name: "golden" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.thedogapi\.com\/v1\/breeds\/search\?q=golden/);
    assert.equal(r.result.breeds[0].name, "Golden Retriever");
    assert.equal(r.result.breeds[0].origin, "Scotland");
    assert.equal(r.result.breeds[0].hypoallergenic, false);
    assert.equal(r.result.breeds[0].referenceImageUrl, "https://cdn2.thedogapi.com/images/HJ7Y2j7XX.jpg");
    assert.equal(r.result.source, "the-dog-api");
  });

  it("hits The Cat API for species:cat (different host)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([{
          id: "siam", name: "Siamese", origin: "Thailand",
          hypoallergenic: 1, reference_image_id: "abc123",
        }]),
      };
    };
    const r = await call("breed-info", ctxA, { species: "cat", name: "siamese" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.thecatapi\.com\/v1\/breeds\/search/);
    assert.equal(r.result.breeds[0].hypoallergenic, true);  // cat API uses 1 not boolean
    assert.equal(r.result.breeds[0].referenceImageUrl, "https://cdn2.thecatapi.com/images/abc123.jpg");
    assert.equal(r.result.source, "the-cat-api");
  });

  it("returns clear 'not found' when API returns empty array", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([]) });
    const r = await call("breed-info", ctxA, { species: "dog", name: "xyzbogus" });
    assert.equal(r.ok, false);
    assert.match(r.error, /breed not found/);
  });
});

describe("pets.breeds-all (Dog/Cat API catalog)", () => {
  it("rejects bad species", async () => {
    assert.equal((await call("breeds-all", ctxA, { species: "fish" })).ok, false);
  });

  it("returns full catalog with limit applied", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          { id: 1, name: "Affenpinscher", origin: "Germany", breed_group: "Toy" },
          { id: 2, name: "Afghan Hound", origin: "Afghanistan", breed_group: "Hound" },
        ]),
      };
    };
    const r = await call("breeds-all", ctxA, { species: "dog", limit: 50 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.thedogapi\.com\/v1\/breeds\?limit=50/);
    assert.equal(r.result.breeds.length, 2);
    assert.equal(r.result.breeds[0].name, "Affenpinscher");
  });
});
