// Lens compute actions must not invent inputs: a missing required input
// returns NOT_COMPUTED + missingInputs; a fully specified call computes the
// same numbers as before. Network is mocked (globalThis.fetch stub).
import { test } from "node:test";
import assert from "node:assert/strict";
import { needNums, optNum, notComputed } from "../lib/lens-inputs.js";
import ocean from "../domains/ocean.js";
import plumbing from "../domains/plumbing.js";
import mining from "../domains/mining.js";
import photography from "../domains/photography.js";
import urban from "../domains/urbanplanning.js";
import supply from "../domains/supplychain.js";
import vet from "../domains/veterinary.js";
import mh from "../domains/mentalhealth.js";
import pharmacy from "../domains/pharmacy.js";

const H = new Map();
for (const reg of [ocean, plumbing, mining, photography, urban, supply, vet, mh, pharmacy]) {
  reg((d, a, fn) => H.set(`${d}.${a}`, fn));
}
const ctx = { actor: { userId: "t" } };
const run = (key, data = {}, params = {}) => H.get(key)(ctx, { data }, params);
const isNC = (r, missing) => {
  assert.equal(r.ok, true);
  assert.equal(r.result.status, "NOT_COMPUTED");
  for (const m of missing) assert.ok(r.result.missingInputs.includes(m), `missing ${m}: ${JSON.stringify(r.result.missingInputs)}`);
};

test("lens-inputs helpers", () => {
  assert.deepEqual(needNums({ a: "2", b: 0, c: -1 }, ["a>0", "b>=0", "c>0", "d"]), { values: { a: 2, b: 0 }, missing: ["c", "d"] });
  assert.equal(optNum(""), null); assert.equal(optNum("Infinity"), null); assert.equal(optNum("3.5"), 3.5);
  assert.equal(notComputed(["x"]).result.status, "NOT_COMPUTED");
});

test("plumbing: missing inputs → NOT_COMPUTED; full inputs unchanged", () => {
  isNC(run("plumbing.pipeSize"), ["flowGPM", "velocityFPS"]);
  assert.equal(run("plumbing.pipeSize", { flowGPM: 10, velocityFPS: 5 }).result.calculatedDiameter, '0.9"');
  isNC(run("plumbing.waterHeaterSize", { household: 4 }), ["simultaneousFixtures"]);
  const wh = run("plumbing.waterHeaterSize", { household: 4, simultaneousFixtures: 2 }).result;
  assert.equal(wh.tanklessRecommendation, "51 kW tankless");
  assert.ok(wh.assumptions.some(a => /tempRiseF = 70/.test(a)), "ΔT default must be declared");
  isNC(run("plumbing.drainSlope", { pipeSizeInches: 2 }), ["lengthFeet"]);
  assert.equal(run("plumbing.drainSlope", { pipeSizeInches: 2, lengthFeet: 10 }).result.totalDrop, '2.5"');
});

test("ocean.waveAnalysis: no invented height/period; wind optional", () => {
  isNC(run("ocean.waveAnalysis"), ["waveHeightMeters", "wavePeriodSeconds"]);
  const r = run("ocean.waveAnalysis", { waveHeightMeters: 2, wavePeriodSeconds: 10 }).result;
  assert.equal(r.wavelength, "156m"); assert.equal(r.beaufortScale, null);
  assert.equal(run("ocean.waveAnalysis", { waveHeightMeters: 2, wavePeriodSeconds: 10, windSpeedKnots: 15 }).result.beaufortScale, 4);
});

test("ocean.tidalPrediction: NOAA-backed with provenance, NOT_COMPUTED otherwise", async (t) => {
  isNC(await run("ocean.tidalPrediction", { location: "bay" }), ["stationId"]);
  const orig = globalThis.fetch;
  t.after(() => { globalThis.fetch = orig; });
  let url = "";
  globalThis.fetch = async (u) => { url = String(u); return { ok: true, json: async () => ({ predictions: [
    { t: "2999-01-01 03:00", v: "1.80", type: "H" }, { t: "2999-01-01 09:10", v: "0.10", type: "L" }] }) }; };
  const r = await run("ocean.tidalPrediction", { location: "SF", stationId: "9414290" });
  assert.equal(r.ok, true);
  assert.match(url, /tidesandcurrents\.noaa\.gov.*station=9414290/);
  assert.equal(r.result.nextHigh.height, 1.8); assert.equal(r.result.nextLow.height, 0.1);
  assert.equal(r.result.location, "SF");
  assert.match(r.result.provenance.source, /NOAA CO-OPS/);
  globalThis.fetch = async () => { throw new Error("down"); };
  const f = await run("ocean.tidalPrediction", {}, { stationId: "9414290" });
  assert.equal(f.result.status, "NOT_COMPUTED");
});

test("mining: cut-off and blast parameters must be supplied", () => {
  isNC(run("mining.oreGradeCalc", { samples: [{ grade: 1 }] }), ["cutoffGrade"]);
  const o = run("mining.oreGradeCalc", { samples: [{ grade: 1 }, { grade: 0.2 }, { grade: "x" }], cutoffGrade: 0.5 }).result;
  assert.equal(o.invalidSamples, 1); assert.equal(o.aboveCutoff, 1); assert.equal(o.economicPercent, 50);
  isNC(run("mining.blastDesign", { holeDepthMeters: 10 }), ["burdenMeters", "spacingMeters", "rockDensityTonM3", "powderFactor"]);
  const b = run("mining.blastDesign", { holeDepthMeters: 10, burdenMeters: 3, spacingMeters: 3.5, rockDensityTonM3: 2.7, powderFactor: 0.4 }).result;
  assert.equal(b.volumePerHole, 105); assert.equal(b.tonsPerHole, 283.5); assert.equal(b.explosiveKgPerHole, 113.4);
});

test("photography.exposureCalc needs ISO/aperture/EV; EV 0 is a real value", () => {
  isNC(run("photography.exposureCalc", { iso: 100 }), ["aperture", "ev"]);
  const r = run("photography.exposureCalc", { iso: 100, aperture: 1, ev: 0 }).result;
  assert.equal(r.ev, 0); assert.ok(r.shutterSpeed);
});

test("urban-planning.densityCalc needs area; housing optional", () => {
  isNC(run("urban-planning.densityCalc", { population: 1000 }), ["areaSqMiles"]);
  const r = run("urban-planning.densityCalc", { population: 6000, areaSqMiles: 2 }).result;
  assert.equal(r.populationDensity, "3000/sq mi"); assert.equal(r.housingDensity, null);
});

test("supplychain: per-item NOT_COMPUTED instead of default demand/cost/score", () => {
  const inv = run("supplychain.inventoryOptimize", { items: [{ name: "a" }, { name: "b", dailyDemand: 10, leadTimeDays: 7, currentStock: 50, orderCost: 50, holdingCost: 5 }] }).result;
  assert.equal(inv.notComputed, 1); assert.equal(inv.items[0].status, "NOT_COMPUTED");
  assert.equal(inv.items[1].reorderPoint, 105); assert.equal(inv.items[1].eoq, 270);
  const sup = run("supplychain.supplierScore", { suppliers: [{ name: "x" }, { name: "y", qualityScore: 90, onTimePercent: 90, priceCompetitiveness: 80, responsiveness: 80 }] }).result;
  assert.equal(sup.topSupplier, "y"); assert.equal(sup.suppliers[0].totalScore, 86); assert.equal(sup.suppliers[1].status, "NOT_COMPUTED");
});

test("veterinary / mental-health / pharmacy: no assumed values", () => {
  isNC(run("veterinary.weightCheck", {}), ["species", "weight"]);
  assert.equal(run("veterinary.weightCheck", { species: "cat", weight: 10 }).result.status, "healthy-weight");
  isNC(run("mental-health.wellnessScore", { sleepHours: 8 }), ["exerciseMinutes", "socialInteractions", "moodScore"]);
  assert.equal(run("mental-health.wellnessScore", { sleepHours: 8, exerciseMinutes: 30, socialInteractions: 3, moodScore: 10 }).result.wellnessScore, 100);
  const p = run("pharmacy.inventoryAlert", { inventory: [{ name: "a", quantity: 5 }, { name: "b", quantity: 20, reorderPoint: 10 }] }).result;
  assert.equal(p.notComputed, 1); assert.equal(p.allClear, false); assert.equal(p.lowStock, 0);
});
