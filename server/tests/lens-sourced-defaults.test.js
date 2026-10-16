// Opt-in sourced defaults (FRED, EIA, Open-Meteo): provenance on success,
// NOT_COMPUTED on missing key / failure, unchanged maths when inputs given.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import energy from "../domains/energy.js";
import realestate from "../domains/realestate.js";
import agriculture from "../domains/agriculture.js";

const H = new Map();
for (const reg of [energy, realestate, agriculture]) reg((d, a, fn) => H.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "t" } };
const run = (k, data = {}, params = {}) => H.get(k)(ctx, { data }, params);
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
let orig, calls; const saved = {};
beforeEach(() => { orig = globalThis.fetch; calls = []; for (const k of ["FRED_API_KEY", "EIA_API_KEY"]) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { globalThis.fetch = orig; for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const mock = (fn) => { globalThis.fetch = async (u) => { calls.push(String(u)); return fn(String(u)); }; };

test("energy.consumptionAnalysis: no $0.12 default; EIA state price opt-in", async () => {
  const readings = [{ kWh: 100 }, { kWh: 200 }];
  const none = run("energy.consumptionAnalysis", { readings });
  assert.equal(none.result.estimatedCost, null); assert.deepEqual(none.result.missingInputs, ["costPerKWh"]);
  assert.equal(run("energy.consumptionAnalysis", { readings, costPerKWh: 0.1 }).result.estimatedCost, 30);
  const noKey = await run("energy.consumptionAnalysis", { readings, state: "CA" });
  assert.equal(noKey.result.estimatedCost, null); assert.match(noKey.result.costNote, /EIA_API_KEY/);
  process.env.EIA_API_KEY = "k-secret";
  mock(() => json({ response: { data: [{ period: "2026-07", price: "30.5" }] } }));
  const r = await run("energy.consumptionAnalysis", { readings, state: "ca" });
  assert.equal(r.result.costPerKWh, 0.305); assert.equal(r.result.estimatedCost, 91.5);
  assert.equal(r.result.costProvenance.period, "2026-07");
  assert.ok(!JSON.stringify(r).includes("k-secret"));
});

test("realestate.calc-mortgage: rate/tax/insurance required; FRED MORTGAGE30US opt-in", async () => {
  const nc = run("realestate.calc-mortgage", {}, { price: 400000 });
  assert.equal(nc.result.status, "NOT_COMPUTED"); assert.deepEqual(nc.result.missingInputs, ["taxRate", "insurance", "rate"]);
  const full = { price: 400000, downPercent: 20, rate: 7, termYears: 30, taxRate: 1.1, insurance: 1200 };
  const a = run("realestate.calc-mortgage", {}, full).result;
  assert.equal(a.monthly.principalAndInterest, 2128.97);
  const { rate: _r, ...noRate } = full;
  const noKey = await run("realestate.calc-mortgage", {}, { ...noRate, rateSource: "fred" });
  assert.equal(noKey.result.status, "NOT_COMPUTED");
  process.env.FRED_API_KEY = "f-secret";
  mock(() => json({ observations: [{ date: "2026-10-09", value: "7" }] }));
  const r = await run("realestate.calc-mortgage", {}, { ...noRate, rateSource: "fred" });
  assert.match(calls[0], /series_id=MORTGAGE30US/);
  assert.equal(r.result.monthly.principalAndInterest, 2128.97);
  assert.equal(r.result.rateProvenance.seriesId, "MORTGAGE30US");
  assert.ok(!JSON.stringify(r).includes("f-secret"));
});

test("agriculture.waterSchedule fetchForecast: Open-Meteo fills the 7-day horizon", async () => {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().split("T")[0]; });
  mock(() => json({ daily: { time: days, temperature_2m_max: days.map(() => 80), precipitation_sum: days.map(() => 0) } }));
  const art = { data: { lat: 41.6, lng: -93.6, fields: [{ fieldId: "f", crop: "corn", soilType: "loam", acreage: 1 }] } };
  const r = await H.get("agriculture.waterSchedule")(ctx, art, { daysAhead: 7, fetchForecast: true });
  const f = r.result.fields[0];
  assert.equal(f.notComputedDays, 0); assert.equal(f.activeDays, 7);
  assert.equal(r.result.forecastProvenance.source, "Open-Meteo forecast API");
  mock(() => json({}, 500));
  const art2 = { data: { lat: 41.6, lng: -93.6, fields: [{ fieldId: "f", crop: "corn", soilType: "loam", acreage: 1 }] } };
  const f2 = await H.get("agriculture.waterSchedule")(ctx, art2, { daysAhead: 7, fetchForecast: true });
  assert.equal(f2.result.forecastSource.status, "NOT_COMPUTED"); assert.equal(f2.result.fields[0].notComputedDays, 7);
});
