// Contract tests for household (Open Food Facts) + commonsense
// (ConceptNet) + fork (GitHub) real-API macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHouseholdActions from "../domains/household.js";
import registerCommonsenseActions from "../domains/commonsense.js";
import registerForkActions from "../domains/fork.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerHouseholdActions(register);
  registerCommonsenseActions(register);
  registerForkActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.GITHUB_TOKEN;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("household.off-product-lookup (Open Food Facts)", () => {
  it("rejects bad barcode length", async () => {
    assert.equal((await call("household.off-product-lookup", ctxA, {})).ok, false);
    assert.equal((await call("household.off-product-lookup", ctxA, { barcode: "123" })).ok, false);
  });

  it("strips non-digits", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ status: 1, product: { product_name: "x" } }) };
    };
    await call("household.off-product-lookup", ctxA, { barcode: "0-12345-67890-1" });
    // Strips hyphens; 12 digits → product/012345678901.json
    assert.match(capturedUrl, /product\/012345678901\.json/);
  });

  it("parses real OFF response with Nutri-Score + nutrition", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        status: 1,
        product: {
          product_name: "Nutella",
          brands: "Ferrero",
          quantity: "400g",
          categories: "Spreads, Sweet spreads, Cocoa and hazelnuts spreads",
          ingredients_text: "Sugar, palm oil, hazelnuts (13%)...",
          allergens_tags: ["en:milk", "en:nuts", "en:soybeans"],
          nutriscore_grade: "e",
          ecoscore_grade: "d",
          nova_group: 4,
          nutriments: {
            "energy-kcal_100g": 539,
            fat_100g: 30.9,
            "saturated-fat_100g": 10.6,
            sugars_100g: 56.3,
            salt_100g: 0.107,
            proteins_100g: 6.3,
            carbohydrates_100g: 57.5,
          },
          image_url: "https://images.openfoodfacts.org/.../front.jpg",
        },
      }),
    });
    const r = await call("household.off-product-lookup", ctxA, { barcode: "3017624010701" });
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "Nutella");
    assert.equal(r.result.nutriScore, "e");
    assert.equal(r.result.novaGroup, 4);
    assert.equal(r.result.nutrition.energyKcal100g, 539);
    assert.deepEqual(r.result.allergens, ["en:milk", "en:nuts", "en:soybeans"]);
    assert.equal(r.result.source, "open-food-facts");
  });

  it("returns clear 'product not found' on status:0", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 0 }) });
    const r = await call("household.off-product-lookup", ctxA, { barcode: "9999999999999" });
    assert.equal(r.ok, false);
    assert.match(r.error, /product not found/);
  });
});

describe("household.off-product-search", () => {
  it("rejects short query", async () => {
    assert.equal((await call("household.off-product-search", ctxA, { query: "x" })).ok, false);
  });

  it("parses search response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ count: 42, products: [{ code: "111", product_name: "Bread", brands: "Acme", nutriscore_grade: "b" }] }) };
    };
    const r = await call("household.off-product-search", ctxA, { query: "bread" });
    assert.match(capturedUrl, /search_terms=bread/);
    assert.equal(r.result.products[0].barcode, "111");
    assert.equal(r.result.totalResults, 42);
  });
});

describe("commonsense.conceptnet-edges", () => {
  it("rejects empty concept", async () => {
    assert.equal((await call("commonsense.conceptnet-edges", ctxA, {})).ok, false);
  });

  it("URL-encodes multi-word concept with underscores", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ "@id": "/c/en/ice_cream", edges: [] }) };
    };
    await call("commonsense.conceptnet-edges", ctxA, { concept: "ice cream" });
    assert.match(capturedUrl, /\/c\/en\/ice_cream/);
  });

  it("parses edges with relation + weight + sources", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        "@id": "/c/en/cat",
        edges: [{
          rel: { label: "IsA", "@id": "/r/IsA" },
          start: { label: "cat", "@id": "/c/en/cat", language: "en" },
          end: { label: "animal", "@id": "/c/en/animal", language: "en" },
          weight: 5.4,
          sources: [{ contributor: "/s/resource/wordnet/rdf/3.1" }],
          surfaceText: "A [[cat]] is an [[animal]]",
        }],
      }),
    });
    const r = await call("commonsense.conceptnet-edges", ctxA, { concept: "cat" });
    assert.equal(r.ok, true);
    assert.equal(r.result.edges[0].relation, "IsA");
    assert.equal(r.result.edges[0].weight, 5.4);
    assert.equal(r.result.source, "conceptnet-5");
  });
});

describe("commonsense.conceptnet-relatedness", () => {
  it("rejects missing concepts", async () => {
    assert.equal((await call("commonsense.conceptnet-relatedness", ctxA, { concept1: "x" })).ok, false);
  });

  it("returns numeric relatedness + interpretation buckets", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ value: 0.78 }) });
    const r = await call("commonsense.conceptnet-relatedness", ctxA, { concept1: "dog", concept2: "puppy" });
    assert.equal(r.ok, true);
    assert.equal(r.result.relatedness, 0.78);
    assert.equal(r.result.interpretation, "very-related");
  });
});

describe("fork.github-forks", () => {
  it("rejects missing owner/repo", async () => {
    assert.equal((await call("fork.github-forks", ctxA, {})).ok, false);
    assert.equal((await call("fork.github-forks", ctxA, { owner: "x" })).ok, false);
  });

  it("hits GitHub + parses fork list (anonymous tier)", async () => {
    let capturedUrl = "", capturedAuth = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedAuth = opts?.headers?.Authorization || "";
      return {
        ok: true,
        json: async () => ([{
          id: 12345, full_name: "alice/concord-fork",
          owner: { login: "alice", type: "User" },
          html_url: "https://github.com/alice/concord-fork",
          stargazers_count: 5, watchers_count: 5, forks_count: 0,
          open_issues_count: 2, default_branch: "main",
          language: "TypeScript",
          license: { spdx_id: "MIT" },
          archived: false, disabled: false,
          pushed_at: "2026-05-10T00:00:00Z",
          created_at: "2025-08-15T00:00:00Z",
          updated_at: "2026-05-12T00:00:00Z",
        }]),
      };
    };
    const r = await call("fork.github-forks", ctxA, { owner: "ryttps94jq-gif", repo: "concord-cognitive-engine" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.github\.com\/repos\/ryttps94jq-gif\/concord-cognitive-engine\/forks/);
    assert.equal(capturedAuth, "");
    assert.equal(r.result.forks[0].fullName, "alice/concord-fork");
    assert.equal(r.result.forks[0].license, "MIT");
    assert.equal(r.result.authenticated, false);
    assert.equal(r.result.source, "github-api");
  });

  it("uses GITHUB_TOKEN env when set", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    let capturedAuth = "";
    globalThis.fetch = async (_url, opts) => {
      capturedAuth = opts?.headers?.Authorization || "";
      return { ok: true, json: async () => ([]) };
    };
    const r = await call("fork.github-forks", ctxA, { owner: "x", repo: "y" });
    assert.equal(capturedAuth, "Bearer test-token");
    assert.equal(r.result.authenticated, true);
  });

  it("surfaces 403 rate-limit with helpful pointer", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const r = await call("fork.github-forks", ctxA, { owner: "x", repo: "y" });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit.*GITHUB_TOKEN/);
  });
});

describe("fork.github-repo", () => {
  it("rejects missing params", async () => {
    assert.equal((await call("fork.github-repo", ctxA, {})).ok, false);
  });

  it("parses repo metadata + parent link", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        full_name: "alice/concord-fork",
        owner: { login: "alice" },
        description: "Fork of concord",
        html_url: "https://github.com/alice/concord-fork",
        stargazers_count: 5, watchers_count: 5, forks_count: 0,
        open_issues_count: 2,
        size: 5000,
        default_branch: "main",
        language: "TypeScript",
        topics: ["concord", "lens"],
        license: { spdx_id: "MIT", url: "https://api.github.com/licenses/mit" },
        archived: false, disabled: false,
        fork: true,
        parent: { full_name: "ryttps94jq-gif/concord-cognitive-engine" },
        pushed_at: "2026-05-10T00:00:00Z",
        created_at: "2025-08-15T00:00:00Z",
        updated_at: "2026-05-12T00:00:00Z",
      }),
    });
    const r = await call("fork.github-repo", ctxA, { owner: "alice", repo: "concord-fork" });
    assert.equal(r.ok, true);
    assert.equal(r.result.isFork, true);
    assert.equal(r.result.parent, "ryttps94jq-gif/concord-cognitive-engine");
    assert.deepEqual(r.result.topics, ["concord", "lens"]);
  });
});
