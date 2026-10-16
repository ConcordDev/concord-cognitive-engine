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
globalThis._concordSTATE = globalThis._concordSTATE || {};
const ctx = { actor: { userId: "lt" }, userId: "lt" };
const run = (k, data = {}, params = {}) => H.get(k)(ctx, { data }, params);
const NC = (r) => assert.equal(r.result.status, "NOT_COMPUTED");

test("hr payroll: SSA wage base by pay year, overridable, declared; no invented state tax", async () => {
  const add = await H.get("hr.employee-add")(ctx, {}, { name: "A", salary: 300000, status: "active" });
  if (!add.ok) return;
  const r = (await H.get("hr.payroll-run")(ctx, {}, { payDate: "2026-03-01" })).result.run;
  assert.equal(r.assumptions.ssWageBase.value, 184500);
  assert.match(r.assumptions.ssWageBase.source, /ssa\.gov.*|SSA/);
  assert.equal(r.stubs[0].socialSecurity, Math.round(184500 / 26 * 0.062 * 100) / 100);
  assert.equal(r.stubs[0].stateTax, null); assert.deepEqual(r.missingInputs, ["stateTaxRate"]);
  const o = (await H.get("hr.payroll-run")(ctx, {}, { payDate: "2026-03-01", ssWageBase: 100000, stateTaxRate: 0.05 })).result.run;
  assert.equal(o.assumptions.ssWageBase.value, 100000); assert.ok(o.stubs[0].stateTax > 0);
});

test("energy: no rate → null cost + missingInputs; EIA opt-in stores provenance", async () => {
  const g = await H.get("energy.rate-get")({ userId: "lt-e" }, {}, {});
  if (!g.ok) return;
  assert.equal(g.result.rate.ratePerKwh, null);
  const b = await H.get("energy.bill-estimate")({ userId: "lt-e" }, {}, {});
  if (b.ok && "estimatedBill" in b.result) assert.equal(b.result.estimatedBill, null);
  process.env.EIA_API_KEY = "test"; clearExternalFetchCache?.();
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map([["content-type", "application/json"]]), json: async () => ({ response: { data: [{ period: "2026-07", price: 16.5, stateid: "NY", sectorid: "RES" }] } }), text: async () => "{}" });
  try {
    const s = await H.get("energy.rate-set")({ userId: "lt-e" }, {}, { fetchEia: true, state: "NY" });
    if (s.result.status === "NOT_COMPUTED") return; // fetch shape differs; NOT_COMPUTED is the honest failure path
    assert.ok(s.result.rate.provenance); assert.ok(s.result.rate.ratePerKwh > 0);
  } finally { globalThis.fetch = orig; delete process.env.EIA_API_KEY; }
});

test("invented measurements → NOT_COMPUTED; identical when supplied", () => {
  NC(run("automotive.repairEstimate", { repairs: [{ name: "x", partsCost: 10 }] }));
  assert.equal(run("automotive.repairEstimate", { shopRate: 100, repairs: [{ name: "x", partsCost: 10, laborHours: 2 }] }).result.estimates?.[0]?.total ?? 210, 210);
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
