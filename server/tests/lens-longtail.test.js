// Long-tail pass: SSA wage base as declared assumption, no silent energy rate,
// and invented measurements removed (automotive, engineering, desert, diy, materials).
import { test } from "node:test";
import assert from "node:assert/strict";
import hr from "../domains/hr.js";
import energy from "../domains/energy.js";
import automotive from "../domains/automotive.js";
import engineering from "../domains/engineering.js";
import desert from "../domains/desert.js";
import diy from "../domains/diy.js";
import materials from "../domains/materials.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

const H = new Map();
for (const reg of [hr, energy, automotive, engineering, desert, diy, materials]) reg((d, a, fn) => H.set(`${d}.${a}`, fn));
globalThis._concordSTATE = {}; // seeded empty in-memory STATE so stateful actions run
const ctx = { actor: { userId: "lt" }, userId: "lt" };
const run = (k, data = {}, params = {}) => H.get(k)(ctx, { data }, params);
const NC = (r) => assert.equal(r.result.status, "NOT_COMPUTED");

test("hr payroll: SSA wage base by pay year, overridable, declared; no invented state tax", async () => {
  const add = await H.get("hr.employee-add")(ctx, {}, { name: "A", salary: 300000, status: "active" });
  assert.equal(add.ok, true, JSON.stringify(add));
  const r = (await H.get("hr.payroll-run")(ctx, {}, { payDate: "2026-03-01" })).result.run;
  assert.equal(r.assumptions.ssWageBase.value, 184500);
  assert.equal(r.assumptions.federalTax.taxYear, 2026);
  assert.equal(r.assumptions.federalTax.standardDeduction, 16100);
  assert.match(r.assumptions.federalTax.source, /irs\.gov/);
  // 2026 single, salary 300000 − std deduction 16100 = 283900 taxable
  const t = 283900, b = [0, 12400, 50400, 105700, 201775, 256225, 640600], rt = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35];
  let tax = 0; for (let i = 0; i < 6; i++) if (t > b[i]) tax += (Math.min(t, b[i + 1]) - b[i]) * rt[i];
  assert.equal(r.stubs[0].federalTax, Math.round(tax / 26 * 100) / 100);
  const y24 = (await H.get("hr.payroll-run")(ctx, {}, { payDate: "2024-06-01" })).result.run;
  assert.equal(y24.assumptions.federalTax.standardDeduction, 14600);
  assert.match(r.assumptions.ssWageBase.source, /ssa\.gov.*|SSA/);
  assert.equal(r.stubs[0].socialSecurity, Math.round(184500 / 26 * 0.062 * 100) / 100);
  assert.equal(r.stubs[0].stateTax, null); assert.deepEqual(r.missingInputs, ["stateTaxRate"]);
  const o = (await H.get("hr.payroll-run")(ctx, {}, { payDate: "2026-03-01", ssWageBase: 100000, stateTaxRate: 0.05 })).result.run;
  assert.equal(o.assumptions.ssWageBase.value, 100000); assert.ok(o.stubs[0].stateTax > 0);
});

test("energy: no rate → null cost + missingInputs; EIA opt-in stores provenance", async () => {
  const g = await H.get("energy.rate-get")({ userId: "lt-e" }, {}, {});
  assert.equal(g.ok, true);
  assert.equal(g.result.rate.ratePerKwh, null);
  const b = await H.get("energy.bill-estimate")({ userId: "lt-e" }, {}, {});
  assert.equal(b.ok, true, JSON.stringify(b)); assert.equal(b.result.estimatedBill, null); assert.deepEqual(b.result.missingInputs, ["ratePerKwh"]);
  process.env.EIA_API_KEY = "test"; clearExternalFetchCache?.();
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map([["content-type", "application/json"]]), json: async () => ({ response: { data: [{ period: "2026-07", price: 16.5, stateid: "NY", sectorid: "RES" }] } }), text: async () => "{}" });
  try {
    const s = await H.get("energy.rate-set")({ userId: "lt-e" }, {}, { fetchEia: true, state: "NY" });
    assert.notEqual(s.result.status, "NOT_COMPUTED", JSON.stringify(s.result));
    assert.ok(s.result.rate.provenance); assert.ok(s.result.rate.ratePerKwh > 0);
  } finally { globalThis.fetch = orig; delete process.env.EIA_API_KEY; }
});

test("invented measurements → NOT_COMPUTED; identical when supplied", () => {
  NC(run("automotive.repairEstimate", { repairs: [{ name: "x", partsCost: 10 }] }));
  assert.equal(run("automotive.repairEstimate", { shopRate: 100, repairs: [{ name: "x", partsCost: 10, laborHours: 2 }] }).result.grandTotal, 210);
  NC(run("engineering.stressAnalysis", { forceNewtons: 1000, crossSectionMm2: 10 }));
  assert.equal(run("engineering.stressAnalysis", { forceNewtons: 1000, crossSectionMm2: 10, yieldStrengthMPa: 250 }).result.safetyFactor, 2.5);
  NC(run("desert.heatStressIndex", { temperatureCelsius: 40 }));
  assert.ok(run("desert.heatStressIndex", { temperatureCelsius: 40, humidityPercent: 20, windSpeedKmh: 10 }).result.heatIndex);
  NC(run("desert.terrainClassification", { soilType: "rock" }));
  NC(run("desert.solarPotential", { latitude: 25 }));
  NC(run("diy.estimateProject", { laborHours: 3 }));
  NC(run("materials.corrosionRisk", { category: "metal" }));
  NC(run("materials.thermalAnalysis", { meltingPoint: 1500 }));
});

test("engineering: no assumed steel density; desert solarInstall needs module/derate/clear days", () => {
  const g = run("engineering.parametricSolid", { kind: "box", params: { width: 0.1, height: 0.1, length: 1 } });
  assert.equal(g.result.mass, null); assert.ok(g.result.volume > 0);
  assert.equal(run("engineering.parametricSolid", { kind: "box", material: "steel-a36", params: { width: 0.1, height: 0.1, length: 1 } }).result.mass, 78.5);
  assert.equal(run("engineering.parametricSolid", { kind: "box", density: 2700, params: { width: 0.1, height: 0.1, length: 1 } }).result.mass, 27);
  NC(H.get("desert.solarInstall")(ctx, {}, { latitude: 25, panelCount: 10 }));
});
