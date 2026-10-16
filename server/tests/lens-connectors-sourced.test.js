// Connector-sourced lens inputs: provenance on success, NOT_COMPUTED on a
// missing key / failed call. All network is mocked via globalThis.fetch.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { clearExternalFetchCache } from "../lib/external-fetch.js";
import aviation from "../domains/aviation.js";
import ocean from "../domains/ocean.js";
import poetry from "../domains/poetry.js";
import landscaping from "../domains/landscaping.js";
import pharmacy from "../domains/pharmacy.js";
import mining from "../domains/mining.js";
import reasoning from "../domains/reasoning.js";

const H = new Map();
for (const reg of [aviation, ocean, poetry, landscaping, pharmacy, mining, reasoning]) reg((d, a, fn) => H.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "t" } };
const run = (k, data = {}, params = {}) => H.get(k)(ctx, { data }, params);
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
let origFetch, calls;
beforeEach(() => { origFetch = globalThis.fetch; calls = []; clearExternalFetchCache(); });
afterEach(() => { globalThis.fetch = origFetch; delete process.env.TREFLE_API_KEY; });
const mock = (fn) => { globalThis.fetch = async (u, o) => { calls.push(String(u)); return fn(String(u), o); }; };

test("aviation perf: no inputs → NOT_COMPUTED; METAR fills PA/OAT/headwind with provenance", async () => {
  assert.equal(run("aviation.perf-takeoff", {}, {}).result.status, "NOT_COMPUTED");
  const direct = run("aviation.perf-takeoff", {}, { pressureAlt: 0, oat: 15, weight: 2400 }).result;
  assert.equal(direct.densityAltitude_ft, 0);
  mock(() => json([{ icaoId: "KDEN", temp: 25, elev: 1656, altim: 1013.25, wdir: 350, wspd: 10, reportTime: "2026-10-15T20:53:00Z", rawOb: "KDEN ..." }]));
  const r = await run("aviation.perf-takeoff", {}, { station: "kden", weight: 2400, runwayHeading: 350 });
  assert.equal(r.ok, true);
  assert.match(calls[0], /aviationweather\.gov\/api\/data\/metar\?ids=KDEN/);
  assert.equal(r.result.inputs.oat, 25);
  assert.equal(r.result.inputs.pressureAlt, Math.round(1656 * 3.28084 + (29.92 - 1013.25 * 0.02953) * 1000));
  assert.equal(r.result.inputs.headwind, 10);
  assert.ok(r.result.densityAltitude_ft > r.result.inputs.pressureAlt);
  assert.equal(r.result.provenance.station, "KDEN");
  mock(() => json({}, 503));
  const f = await run("aviation.perf-landing", {}, { station: "KDEN", weight: 2400 });
  assert.equal(f.result.status, "NOT_COMPUTED");
});

test("ocean.waveAnalysis: lat/lon → Open-Meteo Marine current values with provenance; failure → NOT_COMPUTED", async () => {
  mock(() => json({ current: { time: "2026-10-15T20:00", wave_height: 2, wave_period: 10 } }));
  const r = await run("ocean.waveAnalysis", { lat: 37.5, lon: -122.6 });
  assert.equal(r.result.wavelength, "156m");
  assert.match(calls[0], /marine-api\.open-meteo\.com\/v1\/marine\?latitude=37\.5&longitude=-122\.6&current=wave_height,wave_period/);
  assert.equal(r.result.provenance.source, "Open-Meteo Marine API");
  clearExternalFetchCache();
  mock(() => { throw new Error("down"); });
  const f = await run("ocean.waveAnalysis", { lat: 1, lon: 1 });
  assert.equal(f.result.status, "NOT_COMPUTED");
  assert.equal(run("ocean.waveAnalysis", { waveHeightMeters: 2, wavePeriodSeconds: 10 }).result.wavelength, "156m"); // no fetch when given
});

test("poetry: heuristic default is ADVISORY; datamuse:true uses Datamuse with provenance", async () => {
  const text = "the cat\nthe hat\na dog\na log";
  const h = run("poetry.rhymeScheme", { text });
  assert.equal(h.result.status, "ADVISORY");
  mock((u) => {
    const w = new URL(u).searchParams.get("rel_rhy");
    const map = { cat: ["hat", "bat"], hat: ["cat"], dog: ["log", "fog"], log: ["dog"] };
    if (w) return json((map[w] || []).map(word => ({ word })));
    const sp = new URL(u).searchParams.get("sp");
    return json([{ word: sp, numSyllables: 1 }]);
  });
  const r = await run("poetry.rhymeScheme", { text, datamuse: true });
  assert.equal(r.result.scheme, "AABB");
  assert.equal(r.result.provenance.source, "Datamuse API");
  assert.notEqual(r.result.status, "ADVISORY");
  const m = await run("poetry.meterAnalysis", { text, datamuse: true });
  assert.deepEqual(m.result.syllablesPerLine, [2, 2, 2, 2]);
  mock(() => { throw new Error("down"); });
  clearExternalFetchCache();
  assert.equal((await run("poetry.rhymeScheme", { text, datamuse: true })).result.status, "NOT_COMPUTED");
});

test("landscaping.seasonalPlan species: Trefle data with provenance; no key → speciesData NOT_COMPUTED", async () => {
  const noKey = await run("landscaping.seasonalPlan", { hardnessZone: 6, species: "tomato" });
  assert.equal(noKey.result.speciesData.status, "NOT_COMPUTED");
  process.env.TREFLE_API_KEY = "test-token";
  mock((u) => u.includes("/plants/search") ? json({ data: [{ id: 7, common_name: "tomato", scientific_name: "Solanum lycopersicum" }], meta: { total: 1 } })
    : json({ data: { id: 7, common_name: "tomato", scientific_name: "Solanum lycopersicum", main_species: { growth: { light: 8 }, specifications: {} } } }));
  const r = await run("landscaping.seasonalPlan", { hardnessZone: 6, species: "tomato" });
  assert.equal(r.result.speciesData.scientificName, "Solanum lycopersicum");
  assert.equal(r.result.speciesData.provenance.source, "Trefle API");
  assert.ok(!JSON.stringify(r).includes("test-token"), "API key must not leak into output");
  assert.equal(r.result.status, "ADVISORY"); // generic calendar stays advisory
});

test("pharmacy.inventoryAlert checkRecalls: openFDA enforcement, per-item NOT_COMPUTED on failure", async () => {
  mock((u) => u.includes("Amoxicillin") ? json({ results: [{ recall_number: "D-1", classification: "Class II", reason_for_recall: "x", recall_initiation_date: "20261001", recalling_firm: "F" }] })
    : u.includes("Ibuprofen") ? json({}, 404) : json({}, 500));
  const r = await run("pharmacy.inventoryAlert", { checkRecalls: true, inventory: [{ name: "Amoxicillin", quantity: 5, reorderPoint: 10 }, { name: "Ibuprofen", quantity: 50, reorderPoint: 10 }, { name: "Other", quantity: 1, reorderPoint: 0 }] });
  assert.match(calls[0], /api\.fda\.gov\/drug\/enforcement\.json/);
  assert.equal(r.result.activeRecalls, 1);
  assert.equal(r.result.recallCheck.find(x => x.name === "Other").status, "NOT_COMPUTED");
  assert.equal(r.result.recallProvenance.source, "openFDA drug enforcement API");
  assert.equal(run("pharmacy.inventoryAlert", { inventory: [{ name: "a", quantity: 1, reorderPoint: 2 }] }).result.lowStock, 1); // sync, no fetch without opt-in
});

test("mining.safetyMetrics: TRIR benchmark is an input, not a constant; resourceEstimate needs price/recovery", () => {
  assert.equal(run("mining.safetyMetrics", {}).result.status, "NOT_COMPUTED");
  const r = run("mining.safetyMetrics", { hoursWorked: 1000000, incidents: 5, lostTimeIncidents: 2 }).result;
  assert.equal(r.trir, 1); assert.equal(r.industryAvgTRIR, null); assert.equal(r.belowIndustry, null);
  const b = run("mining.safetyMetrics", { hoursWorked: 1000000, incidents: 5, lostTimeIncidents: 2, industryTRIR: 2.1 }).result;
  assert.equal(b.belowIndustry, true); assert.equal(b.safetyRating, "good");
  assert.equal(run("mining.resourceEstimate", { volumeM3: 1000 }).result.status, "NOT_COMPUTED");
  assert.equal(run("mining.resourceEstimate", { volumeM3: 1000, avgGradePercent: 1, densityTonM3: 2.7, recoveryPercent: 85, metalPricePerTon: 5000 }).result.grossValue, 114750);
});

test("reasoning argumentMap / fallacyDetect are ADVISORY", () => {
  assert.equal(run("reasoning.fallacyDetect", { text: "Everyone believes it so it must be true." }).result.status, "ADVISORY");
  assert.equal(run("reasoning.argumentMap", { claims: [{ id: "a", text: "x" }] }).result.status, "ADVISORY");
});
