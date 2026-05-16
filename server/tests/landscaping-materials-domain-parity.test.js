// Contract tests for the new landscaping (Trefle) + materials
// (Materials Project) real-API macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLandscapingActions from "../domains/landscaping.js";
import registerMaterialsActions from "../domains/materials.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerLandscapingActions(register);
  registerMaterialsActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.TREFLE_API_KEY;
  delete process.env.MATERIALS_PROJECT_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("landscaping.trefle-search (Trefle.io)", () => {
  it("rejects missing key", async () => {
    const r = await call("landscaping.trefle-search", ctxA, { query: "oak" });
    assert.equal(r.ok, false);
    assert.match(r.error, /TREFLE_API_KEY/);
  });

  it("rejects empty query", async () => {
    process.env.TREFLE_API_KEY = "test";
    assert.equal((await call("landscaping.trefle-search", ctxA, {})).ok, false);
  });

  it("hits Trefle + parses plant list", async () => {
    process.env.TREFLE_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          meta: { total: 23 },
          data: [{
            id: 123456, common_name: "Common Oak",
            scientific_name: "Quercus robur",
            family: "Fagaceae", genus: "Quercus",
            slug: "quercus-robur",
            bibliography: "Sp. Pl.: 996 (1753)",
            year: 1753,
            image_url: "https://bs.plantnet.org/image/o/abc.jpg",
            author: "L.",
          }],
        }),
      };
    };
    const r = await call("landscaping.trefle-search", ctxA, { query: "oak" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /trefle\.io\/api\/v1\/plants\/search\?token=test-key&q=oak/);
    assert.equal(r.result.plants[0].scientificName, "Quercus robur");
    assert.equal(r.result.totalResults, 23);
    assert.equal(r.result.source, "trefle.io");
  });

  it("surfaces 401 invalid-key", async () => {
    process.env.TREFLE_API_KEY = "bad";
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const r = await call("landscaping.trefle-search", ctxA, { query: "oak" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid/);
  });
});

describe("landscaping.trefle-plant (full plant detail)", () => {
  it("rejects bad id", async () => {
    process.env.TREFLE_API_KEY = "test";
    assert.equal((await call("landscaping.trefle-plant", ctxA, { id: -1 })).ok, false);
  });

  it("parses growth + specifications", async () => {
    process.env.TREFLE_API_KEY = "test";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: {
          id: 123, common_name: "Lavender",
          scientific_name: "Lavandula angustifolia",
          family: "Lamiaceae",
          main_species: {
            edible: false,
            specifications: {
              growth_habit: "Subshrub",
              average_height: { cm: 60 },
              maximum_height: { cm: 100 },
            },
            growth: {
              light: 9,
              ph_minimum: 6.5, ph_maximum: 8.0,
              minimum_temperature: { deg_c: -15 },
              maximum_temperature: { deg_c: 35 },
              bloom_months: ["jun", "jul", "aug"],
            },
          },
        },
      }),
    });
    const r = await call("landscaping.trefle-plant", ctxA, { id: 123 });
    assert.equal(r.ok, true);
    assert.equal(r.result.commonName, "Lavender");
    assert.equal(r.result.maxHeightCm, 100);
    assert.equal(r.result.phMaximum, 8.0);
    assert.deepEqual(r.result.bloomMonths, ["jun", "jul", "aug"]);
  });
});

describe("materials.mp-search (Materials Project)", () => {
  it("rejects missing key", async () => {
    const r = await call("materials.mp-search", ctxA, { formula: "SiO2" });
    assert.equal(r.ok, false);
    assert.match(r.error, /MATERIALS_PROJECT_API_KEY/);
  });

  it("rejects when neither formula nor elements supplied", async () => {
    process.env.MATERIALS_PROJECT_API_KEY = "test";
    assert.equal((await call("materials.mp-search", ctxA, {})).ok, false);
  });

  it("sends X-API-KEY header + parses material list", async () => {
    process.env.MATERIALS_PROJECT_API_KEY = "test-key-abc";
    let capturedUrl = "", capturedKey = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedKey = opts?.headers?.["X-API-KEY"] || "";
      return {
        ok: true,
        json: async () => ({
          meta: { total_doc: 8 },
          data: [{
            material_id: "mp-149",
            formula_pretty: "Si",
            nelements: 1,
            symmetry: { crystal_system: "Cubic", symbol: "Fd-3m" },
            density: 2.33,
            band_gap: 0.61,
            formation_energy_per_atom: 0,
            energy_above_hull: 0,
            is_stable: true,
            is_magnetic: false,
            total_magnetization: 0,
          }],
        }),
      };
    };
    const r = await call("materials.mp-search", ctxA, { formula: "Si" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.materialsproject\.org\/materials\/summary/);
    assert.equal(capturedKey, "test-key-abc");
    assert.equal(r.result.materials[0].materialId, "mp-149");
    assert.equal(r.result.materials[0].crystalSystem, "Cubic");
    assert.equal(r.result.materials[0].isStable, true);
    assert.equal(r.result.source, "materials-project");
  });

  it("supports elements array filter", async () => {
    process.env.MATERIALS_PROJECT_API_KEY = "test";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ data: [] }) };
    };
    await call("materials.mp-search", ctxA, { elements: ["Fe", "O"] });
    // URLSearchParams encodes "," as "%2C"
    assert.match(capturedUrl, /elements=Fe%2CO/);
  });
});

describe("materials.mp-material (lookup by ID)", () => {
  it("rejects bad ID format", async () => {
    process.env.MATERIALS_PROJECT_API_KEY = "test";
    assert.equal((await call("materials.mp-material", ctxA, { materialId: "not-an-mp-id" })).ok, false);
  });

  it("parses full material record", async () => {
    process.env.MATERIALS_PROJECT_API_KEY = "test";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [{
          material_id: "mp-149",
          formula_pretty: "Si",
          nelements: 1,
          symmetry: { crystal_system: "Cubic", symbol: "Fd-3m" },
          density: 2.33, volume: 40.04,
          band_gap: 0.61,
          is_stable: true,
          nsites: 2,
        }],
      }),
    });
    const r = await call("materials.mp-material", ctxA, { materialId: "mp-149" });
    assert.equal(r.ok, true);
    assert.equal(r.result.formula, "Si");
    assert.equal(r.result.bandGapEv, 0.61);
    assert.equal(r.result.numSites, 2);
  });
});
