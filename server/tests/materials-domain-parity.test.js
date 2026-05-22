// Contract tests for server/domains/materials.js — the Granta MI
// feature-parity macros: ashby-plot, multi-criteria-rank, mp-structure,
// datasheet, import-test-csv, standards-crossref, sustainability.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMaterialsActions from "../domains/materials.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`materials.${name}`);
  assert.ok(fn, `materials.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMaterialsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function seedShortlist(ctx) {
  call("shortlist-add", ctx, {
    name: "Titanium Ti-6Al-4V", category: "alloy",
    density: 4.43, tensileStrengthMPa: 1170, meltingPointC: 1660,
    youngsModulusGPa: 114, costPerKg: 35,
  });
  call("shortlist-add", ctx, {
    name: "Aluminum 6061", category: "alloy",
    density: 2.70, tensileStrengthMPa: 310, meltingPointC: 650,
    youngsModulusGPa: 69, costPerKg: 3,
  });
}

describe("materials.ashby-plot", () => {
  it("builds a 2D selection scatter with a material index", () => {
    seedShortlist(ctxA);
    const r = call("ashby-plot", ctxA, { xKey: "density", yKey: "tensileStrengthMPa" });
    assert.equal(r.ok, true);
    assert.equal(r.result.points.length, 2);
    assert.ok(r.result.bestIndex);
    assert.ok(r.result.points.every((p) => typeof p.materialIndex === "number"));
  });
  it("rejects an invalid axis", () => {
    const r = call("ashby-plot", ctxA, { xKey: "notreal" });
    assert.equal(r.ok, false);
  });
  it("returns an empty plot with a message when nothing is shortlisted", () => {
    const r = call("ashby-plot", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.points.length, 0);
    assert.ok(r.result.message);
  });
});

describe("materials.multi-criteria-rank", () => {
  it("weighted-ranks the shortlist against criteria", () => {
    seedShortlist(ctxA);
    const r = call("multi-criteria-rank", ctxA, {
      criteria: [
        { key: "tensileStrengthMPa", weight: 60, goal: "max" },
        { key: "density", weight: 40, goal: "min" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.rankings.length, 2);
    assert.ok(r.result.recommended);
    assert.ok(r.result.rankings[0].score >= r.result.rankings[1].score);
  });
  it("rejects when no valid criteria are supplied", () => {
    seedShortlist(ctxA);
    const r = call("multi-criteria-rank", ctxA, { criteria: [] });
    assert.equal(r.ok, false);
  });
  it("rejects when the shortlist is empty", () => {
    const r = call("multi-criteria-rank", ctxA, {
      criteria: [{ key: "density", weight: 50, goal: "min" }],
    });
    assert.equal(r.ok, false);
  });
});

describe("materials.mp-structure", () => {
  it("validates material id format", async () => {
    process.env.MATERIALS_PROJECT_API_KEY = "test-key";
    const r = await call("mp-structure", ctxA, { materialId: "not-an-id" });
    assert.equal(r.ok, false);
    delete process.env.MATERIALS_PROJECT_API_KEY;
  });
  it("requires an API key", async () => {
    delete process.env.MATERIALS_PROJECT_API_KEY;
    const r = await call("mp-structure", ctxA, { materialId: "mp-149" });
    assert.equal(r.ok, false);
    assert.match(r.error, /MATERIALS_PROJECT_API_KEY/);
  });
});

describe("materials.datasheet", () => {
  it("generates a datasheet from inline properties with derived metrics", () => {
    const r = call("datasheet", ctxA, {
      name: "Steel S275", category: "alloy",
      density: 7.85, tensileStrengthMPa: 430, youngsModulusGPa: 210,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.datasheet.name, "Steel S275");
    assert.ok(r.result.datasheet.derivedProperties.length >= 1);
    assert.ok(r.result.plainText.includes("MATERIAL DATASHEET"));
  });
  it("generates a datasheet from a shortlisted material id", () => {
    const m = call("shortlist-add", ctxA, {
      name: "Brass", density: 8.5, tensileStrengthMPa: 340,
    }).result.material;
    const r = call("datasheet", ctxA, { id: m.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.datasheet.name, "Brass");
  });
  it("rejects when neither id nor name is provided", () => {
    const r = call("datasheet", ctxA, {});
    assert.equal(r.ok, false);
  });
});

describe("materials.import-test-csv", () => {
  it("parses CSV and computes per-column stats", () => {
    const csv = "specimen,stress_MPa,strain_pct\nS1,420,12.3\nS2,440,11.7\nS3,430,12.0";
    const r = call("import-test-csv", ctxA, { csv });
    assert.equal(r.ok, true);
    assert.equal(r.result.rowCount, 3);
    assert.ok(r.result.stats.stress_MPa);
    assert.equal(r.result.stats.stress_MPa.count, 3);
    assert.equal(r.result.stats.stress_MPa.min, 420);
    assert.equal(r.result.stats.stress_MPa.max, 440);
  });
  it("attaches imported test data to a shortlisted material", () => {
    const m = call("shortlist-add", ctxA, { name: "Inconel 718" }).result.material;
    const csv = "load,extension\n100,0.5\n200,1.1";
    const r = call("import-test-csv", ctxA, { csv, id: m.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.attachedTo, "Inconel 718");
  });
  it("rejects CSV without a data row", () => {
    const r = call("import-test-csv", ctxA, { csv: "only,a,header" });
    assert.equal(r.ok, false);
  });
});

describe("materials.standards-crossref", () => {
  it("returns the curated standard set for a known material", () => {
    const r = call("standards-crossref", ctxA, { material: "stainless 304" });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, true);
    assert.ok(r.result.standards.some((s) => s.body === "ASTM"));
  });
  it("returns the available list when no material is passed", () => {
    const r = call("standards-crossref", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.available));
  });
  it("does not synthesize standards for unknown materials", () => {
    const r = call("standards-crossref", ctxA, { material: "unobtanium" });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, false);
    assert.equal(r.result.standards.length, 0);
  });
});

describe("materials.sustainability", () => {
  it("returns embodied-carbon metrics for a known material", () => {
    const r = call("sustainability", ctxA, { material: "aluminum" });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, true);
    assert.ok(r.result.metrics.embodiedCarbonKgCO2ePerKg > 0);
    assert.ok(["A", "B", "C", "D", "E"].includes(r.result.metrics.carbonGrade));
  });
  it("computes total footprint for a given mass", () => {
    const r = call("sustainability", ctxA, { material: "steel", massKg: 100 });
    assert.equal(r.ok, true);
    assert.ok(r.result.footprint);
    assert.equal(r.result.footprint.massKg, 100);
    assert.ok(r.result.footprint.totalCarbonKgCO2e > 0);
  });
  it("does not estimate carbon for unknown materials", () => {
    const r = call("sustainability", ctxA, { material: "unobtanium" });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, false);
  });
});
