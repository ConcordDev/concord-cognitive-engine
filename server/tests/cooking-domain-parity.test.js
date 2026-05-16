// Contract tests for server/domains/cooking.js — pure-compute recipe
// helpers + real USDA FoodData Central integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCookingActions from "../domains/cooking.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`cooking.${name}`);
  if (!fn) throw new Error(`cooking.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerCookingActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.FDC_API_KEY;
  delete process.env.NASA_FDC_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("cooking.scaleRecipe", () => {
  it("doubles a 4-serving recipe to 8 servings", () => {
    const r = call("scaleRecipe", ctxA, {
      data: { servings: 4, targetServings: 8, ingredients: [{ name: "flour", quantity: "2", unit: "cups" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.scaleFactor, 2);
    assert.match(r.result.ingredients[0].scaled, /^4 cups$/);
  });
});

describe("cooking.substitution", () => {
  it("returns common butter substitutions", () => {
    const r = call("substitution", ctxA, { data: { ingredient: "unsalted butter" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.ok(r.result.substitutions.some((s) => s.sub.toLowerCase().includes("coconut")));
  });
});

describe("cooking.usda-search (USDA FoodData Central)", () => {
  it("rejects empty query", async () => {
    const r = await call("usda-search", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("rejects query shorter than 2 chars", async () => {
    const r = await call("usda-search", ctxA, { query: "a" });
    assert.equal(r.ok, false);
  });

  it("hits FDC + parses real response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          totalHits: 142, currentPage: 1, totalPages: 15,
          foods: [{
            fdcId: 173410, description: "Cheese, cheddar",
            dataType: "SR Legacy", publishedDate: "2019-04-01",
            score: 850.0,
          }, {
            fdcId: 1097518, description: "Cheese, cheddar, sharp, sliced",
            dataType: "Branded", brandOwner: "Sargento", brandName: "Sargento",
            gtinUpc: "046100000557",
            servingSize: 28, servingSizeUnit: "g",
            score: 720.5,
          }],
        }),
      };
    };
    const r = await call("usda-search", ctxA, { query: "cheddar" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.nal\.usda\.gov\/fdc\/v1\/foods\/search/);
    assert.match(capturedUrl, /api_key=DEMO_KEY/);
    assert.match(capturedUrl, /query=cheddar/);
    assert.equal(r.result.foods.length, 2);
    assert.equal(r.result.foods[0].fdcId, 173410);
    assert.equal(r.result.foods[1].brandOwner, "Sargento");
    assert.equal(r.result.totalHits, 142);
    assert.equal(r.result.source, "usda-fooddata-central");
    assert.equal(r.result.usingDemoKey, true);
  });

  it("uses FDC_API_KEY env when set", async () => {
    process.env.FDC_API_KEY = "real-fdc-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ foods: [] }) };
    };
    const r = await call("usda-search", ctxA, { query: "apple" });
    assert.match(capturedUrl, /api_key=real-fdc-key/);
    assert.equal(r.result.usingDemoKey, false);
  });

  it("supports dataType filter", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ foods: [] }) };
    };
    await call("usda-search", ctxA, { query: "apple", dataType: "SR Legacy" });
    assert.match(capturedUrl, /dataType=SR%20Legacy/);
  });

  it("surfaces 429 rate limit with helpful key-setup pointer", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("usda-search", ctxA, { query: "apple" });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit exceeded.*FDC_API_KEY/);
  });
});

describe("cooking.usda-nutrition (USDA FoodData Central)", () => {
  it("rejects missing fdcId", async () => {
    const r = await call("usda-nutrition", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("rejects non-positive fdcId", async () => {
    assert.equal((await call("usda-nutrition", ctxA, { fdcId: 0 })).ok, false);
    assert.equal((await call("usda-nutrition", ctxA, { fdcId: -1 })).ok, false);
  });

  it("hits FDC + parses headline + full nutrient list", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          fdcId: 173410, description: "Cheese, cheddar", dataType: "SR Legacy",
          foodNutrients: [
            { nutrient: { name: "Energy", unitName: "KCAL" }, amount: 403 },
            { nutrient: { name: "Protein", unitName: "G" }, amount: 22.87 },
            { nutrient: { name: "Total lipid (fat)", unitName: "G" }, amount: 33.31 },
            { nutrient: { name: "Carbohydrate, by difference", unitName: "G" }, amount: 3.09 },
            { nutrient: { name: "Calcium, Ca", unitName: "MG" }, amount: 721 },
            { nutrient: { name: "Sodium, Na", unitName: "MG" }, amount: 643 },
            { nutrient: { name: "Iron, Fe", unitName: "MG" }, amount: 0.16 },
          ],
        }),
      };
    };
    const r = await call("usda-nutrition", ctxA, { fdcId: 173410 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /\/fdc\/v1\/food\/173410/);
    assert.equal(r.result.description, "Cheese, cheddar");
    assert.equal(r.result.headline.caloriesKcal, 403);
    assert.equal(r.result.headline.proteinG, 22.87);
    assert.equal(r.result.headline.calciumMg, 721);
    // full nutrient dict has all 7 entries
    assert.equal(Object.keys(r.result.nutrients).length, 7);
    assert.equal(r.result.source, "usda-fooddata-central");
  });

  it("returns clear 404 when FDC ID doesn't exist", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("usda-nutrition", ctxA, { fdcId: 9999999 });
    assert.equal(r.ok, false);
    assert.match(r.error, /FDC ID not found/);
  });
});
