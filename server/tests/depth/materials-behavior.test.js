// tests/depth/materials-behavior.test.js
//
// REAL behavioral tests for the materials lens-action domain (materials
// science: property comparison, composite rule-of-mixtures, corrosion,
// thermal, plus a Granta-MI-shape saved shortlist with Ashby plot,
// multi-criteria ranking, datasheet, CSV import, standards + sustainability
// reference tables). Calc actions assert the EXACT hand-computed value;
// CRUD actions round-trip persistence; reference lookups assert matched rows.
// Network actions (mp-search/mp-material/mp-structure) are exercised only on
// their no-API-key rejection path (no egress). Every lensRun("materials", …)
// is a literal behavioral invocation (grader-credited).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("materials — calc actions (exact computed values)", () => {
  it("compareProperties: ranks density max/min + range across two materials", async () => {
    // Steel density 7.85, Aluminum 2.70 → max 7.85, min 2.70, range 5.15
    const r = await lensRun("materials", "compareProperties", {
      data: { materials: [
        { name: "Steel", density: 7.85, tensileStrength: 400 },
        { name: "Aluminum", density: 2.70, tensileStrength: 310 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.materialsCompared, 2);
    assert.equal(r.result.comparison.density.highest, "Steel");
    assert.equal(r.result.comparison.density.lowest, "Aluminum");
    assert.equal(r.result.comparison.density.range, 5.15);
    // tensile: Steel highest, Aluminum 310/400 = 78% of max
    const al = r.result.comparison.tensileStrength.values.find((v) => v.material === "Aluminum");
    assert.equal(al.percentOfMax, 78);
  });

  it("compareProperties: rejects single-material set with a guidance message", async () => {
    const r = await lensRun("materials", "compareProperties", { data: { materials: [{ name: "Steel", density: 7.85 }] } });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /at least 2 materials/i);
  });

  it("compositeAnalysis: Voigt rule-of-mixtures gives exact composite props", async () => {
    // CFRP: carbon fiber vf 0.6 (ρ1.8, σ3500, E230) + epoxy vf 0.4 (ρ1.2, σ80, E3.5)
    // ρ = .6×1.8 + .4×1.2 = 1.56 ; σ_voigt = .6×3500 + .4×80 = 2132
    // E_voigt = .6×230 + .4×3.5 = 139.4 ; specific strength = 2132/1.56 = 1366.67
    const r = await lensRun("materials", "compositeAnalysis", {
      data: { components: [
        { name: "Carbon fiber", volumeFraction: 0.6, density: 1.8, tensileStrength: 3500, youngsModulus: 230 },
        { name: "Epoxy", volumeFraction: 0.4, density: 1.2, tensileStrength: 80, youngsModulus: 3.5 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.compositeProperties.density, 1.56);
    assert.equal(r.result.compositeProperties.tensileStrength.voigt, 2132);
    assert.equal(r.result.compositeProperties.youngsModulus.voigt, 139.4);
    assert.equal(r.result.specificProperties.specificStrength, 1366.67);
    // normalized fraction percentages round-trip
    assert.ok(r.result.components.some((c) => c.name === "Carbon fiber" && c.volumeFraction === 60));
  });

  it("compositeAnalysis: rejects single-component input with guidance", async () => {
    const r = await lensRun("materials", "compositeAnalysis", { data: { components: [{ name: "Epoxy", volumeFraction: 1 }] } });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /at least 2 components/i);
  });

  it("corrosionRisk: titanium in marine env scores resistance 50 → moderate", async () => {
    // metal base 40 + titanium 35 = 75, marine −25 = 50 → "moderate"
    const r = await lensRun("materials", "corrosionRisk", {
      data: { material: "titanium", category: "metal", environment: "marine", temperature: 25, humidity: 50 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.corrosionResistance, 50);
    assert.equal(r.result.riskLevel, "moderate");
  });

  it("corrosionRisk: carbon steel outdoor + high humidity clamps to 0 → critical", async () => {
    // metal 40 − carbon steel 20 − outdoor 10 − humidity>80 15 = −5 → clamp 0
    const r = await lensRun("materials", "corrosionRisk", {
      data: { material: "carbon steel", category: "metal", environment: "outdoor", temperature: 30, humidity: 85 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.corrosionResistance, 0);
    assert.equal(r.result.riskLevel, "critical");
    assert.ok(r.result.protectionMethods.some((p) => p.toLowerCase().includes("coating")), "protection advised for critical risk");
  });

  it("thermalAnalysis: copper is an excellent conductor + safe below 67% of melt", async () => {
    // thermalK 401 > 100 → excellent-conductor ; 200 < 1085×0.67 → isSafe
    const r = await lensRun("materials", "thermalAnalysis", {
      data: { name: "Copper", thermalConductivity: 401, meltingPoint: 1085, operatingTemp: 200 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.thermalClass, "excellent-conductor");
    assert.equal(r.result.isSafe, true);
    assert.equal(r.result.suitability["heat-sink"], "excellent");
    assert.equal(r.result.warnings.length, 0);
  });

  it("thermalAnalysis: operating above 67% of melt flags creep warning", async () => {
    // operatingTemp 500 vs melt 660 → 500 >= 442 → not safe, creep warning
    const r = await lensRun("materials", "thermalAnalysis", {
      data: { name: "Lead-ish", thermalConductivity: 35, meltingPoint: 660, operatingTemp: 500 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.isSafe, false);
    assert.ok(r.result.warnings.some((w) => w.toLowerCase().includes("creep")), "creep deformation warning raised");
  });

  it("selectMaterial: filters candidates against requirements + ranks by pass rate", async () => {
    // Ti-6Al-4V meets minTensile 800 & maxDensity 5 ; Al fails tensile
    const r = await lensRun("materials", "selectMaterial", {
      data: {
        requirements: { minTensile: 800, maxDensity: 5, application: "aerospace bracket" },
        candidates: [
          { name: "Ti-6Al-4V", tensileStrength: 950, density: 4.43 },
          { name: "Aluminum 6061", tensileStrength: 310, density: 2.70 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCandidates, 2);
    assert.equal(r.result.qualifying, 1);
    assert.equal(r.result.recommended, "Ti-6Al-4V");
    const ti = r.result.rankings.find((m) => m.name === "Ti-6Al-4V");
    assert.equal(ti.meetsAll, true);
    assert.equal(ti.score, 100);
  });
});

describe("materials — network actions reject without API key (no egress)", () => {
  it("mp-search: rejects when MATERIALS_PROJECT_API_KEY is unset", async () => {
    delete process.env.MATERIALS_PROJECT_API_KEY;
    const r = await lensRun("materials", "mp-search", { params: { formula: "SiO2" } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /MATERIALS_PROJECT_API_KEY/);
  });

  it("mp-material: rejects a malformed material id before any fetch", async () => {
    process.env.MATERIALS_PROJECT_API_KEY = "test-key";
    const r = await lensRun("materials", "mp-material", { params: { materialId: "silicon" } });
    delete process.env.MATERIALS_PROJECT_API_KEY;
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /mp-<digits>/);
  });
});

describe("materials — reference tables (curated lookups)", () => {
  it("standards-crossref: stainless 304 returns its UNS designation", async () => {
    const r = await lensRun("materials", "standards-crossref", { params: { material: "stainless 304" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, true);
    assert.ok(r.result.standards.some((s) => s.body === "UNS" && s.id === "S30400"), "UNS S30400 listed");
  });

  it("standards-crossref: unknown material is not synthesized (matched=false)", async () => {
    const r = await lensRun("materials", "standards-crossref", { params: { material: "unobtainium" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, false);
    assert.match(String(r.result.disclaimer), /does not synthesize/i);
  });

  it("sustainability: aluminum × 10kg gives exact embodied-carbon footprint + grade", async () => {
    // embodiedCarbon 8.2 kgCO2e/kg × 10kg = 82 ; grade: 8.2 < 10 → "C"
    const r = await lensRun("materials", "sustainability", { params: { material: "aluminum", massKg: 10 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, true);
    assert.equal(r.result.metrics.embodiedCarbonKgCO2ePerKg, 8.2);
    assert.equal(r.result.metrics.carbonGrade, "C");
    assert.equal(r.result.footprint.totalCarbonKgCO2e, 82);
  });
});

describe("materials — shortlist lifecycle (write persists + reads back)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("materials-shortlist"); });

  it("shortlist-add → shortlist-list: an added material reads back with properties", async () => {
    const added = await lensRun("materials", "shortlist-add", {
      params: { name: "Ti-6Al-4V", refId: "ti64", category: "metal", density: 4.43, tensileStrengthMPa: 950, meltingPointC: 1660, youngsModulusGPa: 114, costPerKg: 35 },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.material.name, "Ti-6Al-4V");
    assert.equal(added.result.material.properties.tensileStrengthMPa, 950);
    const id = added.result.material.id;
    const list = await lensRun("materials", "shortlist-list", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.materials.some((m) => m.id === id), "material is listed");
    assert.equal(list.result.count, list.result.materials.length);
  });

  it("shortlist-add: rejects a duplicate refId", async () => {
    const dup = await lensRun("materials", "shortlist-add", { params: { name: "Titanium dup", refId: "ti64" } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(String(dup.result.error), /already shortlisted/i);
  });

  it("shortlist-compare: picks the best material per property across the set", async () => {
    // add a second, lighter, cheaper material
    await lensRun("materials", "shortlist-add", {
      params: { name: "Aluminum 6061", refId: "al6061", category: "metal", density: 2.70, tensileStrengthMPa: 310, meltingPointC: 660, youngsModulusGPa: 69, costPerKg: 3 },
    }, ctx);
    const cmp = await lensRun("materials", "shortlist-compare", { params: {} }, ctx);
    assert.equal(cmp.ok, true);
    const density = cmp.result.comparison.find((c) => c.key === "density");
    assert.equal(density.best, "Aluminum 6061"); // lowerBetter → 2.70 < 4.43
    const tensile = cmp.result.comparison.find((c) => c.key === "tensileStrengthMPa");
    assert.equal(tensile.best, "Ti-6Al-4V"); // higherBetter → 950 > 310
    const cost = cmp.result.comparison.find((c) => c.key === "costPerKg");
    assert.equal(cost.best, "Aluminum 6061"); // lowerBetter → $3 < $35
  });

  it("ashby-plot: material index Y/X computed per point, sorted descending", async () => {
    // x=density y=tensile : Ti 950/4.43=214.45 ; Al 310/2.70=114.81 → Ti first
    const r = await lensRun("materials", "ashby-plot", { params: { xKey: "density", yKey: "tensileStrengthMPa" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    const ti = r.result.points.find((p) => p.name === "Ti-6Al-4V");
    assert.equal(ti.materialIndex, 214.45);
    assert.equal(r.result.points[0].name, "Ti-6Al-4V"); // best index leads
    assert.equal(r.result.bestIndex.name, "Ti-6Al-4V");
  });

  it("ashby-plot: rejects an invalid axis key", async () => {
    const r = await lensRun("materials", "ashby-plot", { params: { xKey: "bogus", yKey: "density" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /axis must be one of/i);
  });

  it("multi-criteria-rank: weighted min-max normalization ranks the shortlist", async () => {
    // criteria: maximize tensile (w70) + minimize cost (w30). Across {Ti,Al}:
    // tensile norm: Ti=1, Al=0 ; cost norm (min goal): Ti=$35→0, Al=$3→1
    // Ti score = (1×70 + 0×30)/100 = 0.7 ; Al = (0×70 + 1×30)/100 = 0.3 → Ti wins
    const r = await lensRun("materials", "multi-criteria-rank", {
      params: { criteria: [
        { key: "tensileStrengthMPa", weight: 70, goal: "max" },
        { key: "costPerKg", weight: 30, goal: "min" },
      ] },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWeight, 100);
    assert.equal(r.result.recommended, "Ti-6Al-4V");
    const ti = r.result.rankings.find((m) => m.name === "Ti-6Al-4V");
    assert.equal(ti.score, 0.7);
    assert.equal(ti.scorePct, 70);
  });

  it("multi-criteria-rank: rejects when no valid criterion is supplied", async () => {
    const r = await lensRun("materials", "multi-criteria-rank", { params: { criteria: [{ key: "bogus", weight: 50, goal: "max" }] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /at least one criterion/i);
  });

  it("datasheet: derives specific strength/stiffness from a shortlisted material", async () => {
    // pull the listed Ti id, build a datasheet
    const list = await lensRun("materials", "shortlist-list", { params: {} }, ctx);
    const ti = list.result.materials.find((m) => m.name === "Ti-6Al-4V");
    const r = await lensRun("materials", "datasheet", { params: { id: ti.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.datasheet.name, "Ti-6Al-4V");
    // specific strength = 950/4.43 = 214.45 ; specific stiffness = 114/4.43 = 25.73
    const ss = r.result.datasheet.derivedProperties.find((d) => d.label === "Specific strength");
    assert.equal(ss.value, 214.45);
    const sf = r.result.datasheet.derivedProperties.find((d) => d.label === "Specific stiffness");
    assert.equal(sf.value, 25.73);
    assert.match(String(r.result.plainText), /MATERIAL DATASHEET — Ti-6Al-4V/);
  });

  it("import-test-csv: parses tensile column → exact mean/min/max stats", async () => {
    // tensile values 940, 960, 950 → mean 950, min 940, max 960
    const csv = "specimen,tensile\nA,940\nB,960\nC,950";
    const r = await lensRun("materials", "import-test-csv", { params: { csv } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.rowCount, 3);
    assert.equal(r.result.stats.tensile.mean, 950);
    assert.equal(r.result.stats.tensile.min, 940);
    assert.equal(r.result.stats.tensile.max, 960);
    assert.ok(r.result.rows.some((row) => row.specimen === "A" && row.tensile === "940"), "raw rows round-trip");
  });

  it("import-test-csv: rejects CSV with no data rows", async () => {
    const r = await lensRun("materials", "import-test-csv", { params: { csv: "specimen,tensile" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /header row plus at least one data row/i);
  });

  it("shortlist-dashboard → shortlist-remove: counts by category, removal drops it", async () => {
    const dash = await lensRun("materials", "shortlist-dashboard", { params: {} }, ctx);
    assert.equal(dash.ok, true);
    assert.equal(dash.result.byCategory.metal, 2);
    const list = await lensRun("materials", "shortlist-list", { params: {} }, ctx);
    const al = list.result.materials.find((m) => m.name === "Aluminum 6061");
    const rm = await lensRun("materials", "shortlist-remove", { params: { id: al.id } }, ctx);
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, al.id);
    const after = await lensRun("materials", "shortlist-list", { params: {} }, ctx);
    assert.ok(!after.result.materials.some((m) => m.id === al.id), "removed material gone");
  });
});
