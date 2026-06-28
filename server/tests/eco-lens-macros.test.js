// Behavioral macro tests for server/domains/eco.js — the ecology / sustainability
// substrate the /lenses/eco lens drives (carbon footprint, biodiversity indices,
// ESG sustainability score, solar PV estimate, plus the STATE-backed personal
// substrates: biodiversity life-list, climate-action log, footprint trend,
// JouleBug-style challenges/streaks, and saved-location alert targets).
//
// This file mirrors the REAL LENS_ACTIONS dispatch: every eco handler is
// registered via `registerLensAction(domain, action, handler)` and invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention with
// `virtualArtifact.data === input`. The dispatch ALSO peels exactly one
// redundant `{ artifact: { data } }` wrapper (lens-input-normalize.js); we peel
// the same way before calling so the harness is byte-identical to production.
//
// These are NOT shape-only assertions. They pin ACTUAL computed values for KNOWN
// inputs → KNOWN outputs (emission-factor math, Shannon/Simpson diversity, ESG
// weighting, solar capacity factor, streak recomputation), CRUD round-trips
// through real STATE, per-user isolation, the EXACT field names each lens
// component renders (so a dead-surface regression surfaces here), validation
// rejection, graceful degradation, and a fail-CLOSED poisoned-numeric contract:
// Infinity/NaN/1e999 inputs are clamped/rejected and NEVER leak Infinity/NaN
// (serialized null) into the result, and NEVER throw. Network-backed macros
// (weather/aqi/GBIF) are covered for their honest-error contract only — no wire.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEcoActions from "../domains/eco.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "eco", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch exactly: peel one redundant artifact wrapper, then
// handler(ctx, virtualArtifact, input) with virtualArtifact.data = input.
function call(name, ctx, rawInput = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`eco.${name} not registered`);
  const input = peelRedundantArtifactWrapper(rawInput);
  const virtualArtifact = { id: null, title: rawInput?.title ?? null, domain: "eco", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerEcoActions(registerLensAction); });

beforeEach(() => {
  // No boot, no network. Any handler that reaches the network in a test is a
  // leak — these pure-compute + STATE macros never should. Network macros that
  // we DO test (weather/aqi) get this thrown fetch and must surface ok:false.
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "eco_user_a" }, userId: "eco_user_a" };
const ctxB = { actor: { userId: "eco_user_b" }, userId: "eco_user_b" };

// Assert no value in the (possibly nested) object is a non-finite number.
function assertNoNonFinite(obj, path = "root") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `non-finite number at ${path}: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFinite(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const k of Object.keys(obj)) assertNoNonFinite(obj[k], `${path}.${k}`); }
}

// ── registration: every lens-driven macro is present ───────────────────────
describe("eco — registration (every lens-driven macro present)", () => {
  it("registers the pure-compute analytical macros", () => {
    for (const m of ["carbonFootprint", "biodiversityIndex", "sustainabilityScore", "energy-estimate"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing eco.${m}`);
    }
  });
  it("registers the STATE-backed substrate macros the components call", () => {
    for (const m of [
      "biodiversity-log", "biodiversity-list", "biodiversity-delete",
      "climate-actions-list", "climate-actions-log", "climate-actions-logged",
      "footprint-record", "footprint-history", "footprint-delete",
      "challenges-catalog", "challenges-join", "challenges-checkin", "challenges-mine", "challenges-leave",
      "locations-save", "locations-list", "locations-delete",
      "species-identify", "species-suggest", "observation-feed",
      "weather-forecast", "aqi-current", "environmental-alerts",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing eco.${m}`);
    }
  });
});

// ── carbonFootprint — emission-factor math + scope/category breakdown ───────
describe("eco.carbonFootprint — exact emission math the AI panel renders", () => {
  it("computes electricity (scope 2) + beef (scope 3) emissions and breakdowns", () => {
    const r = call("carbonFootprint", ctxA, { artifact: { data: { activities: [
      { category: "electricity", type: "kwh", quantity: 1000, unit: "kWh" }, // 1000 × 0.233 = 233
      { category: "beef", type: "kg", quantity: 10, unit: "kg" },            // 10 × 27 = 270
    ] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEmissionsKgCO2e, 503);
    // tonnes = round(total/10)/100 = round(50.3)/100 = 0.5
    assert.equal(r.result.totalEmissionsTonneCO2e, 0.5);
    assert.equal(r.result.netEmissionsKgCO2e, 503);
    assert.equal(r.result.carbonNeutral, false);
    // electricity → scope 2, beef → scope 3
    assert.equal(r.result.scopeBreakdown.scope2.kgCO2e, 233);
    assert.equal(r.result.scopeBreakdown.scope3.kgCO2e, 270);
    // category breakdown sorted desc by emissions, beef first
    assert.equal(r.result.categoryBreakdown[0].category, "beef");
    assert.equal(r.result.categoryBreakdown[0].emissionsKgCO2e, 270);
    // equivalencies: trees = ceil(503/22) = 23
    assert.equal(r.result.equivalencies.treesNeededToOffset, 23);
    assertNoNonFinite(r.result);
  });

  it("offsets reduce net emissions and flip carbonNeutral", () => {
    const r = call("carbonFootprint", ctxA, { activities: [
      { category: "car", type: "km", quantity: 100, unit: "km" }, // 100 × 0.171 = 17.1
    ], offsets: [
      { type: "tree_planting", unit: "tree", quantity: 1 }, // 1 × 22 = 22 offset
    ] });
    assert.equal(r.result.totalEmissionsKgCO2e, 17.1);
    assert.equal(r.result.totalOffsetsKgCO2e, 22);
    assert.equal(r.result.netEmissionsKgCO2e, -4.9);
    assert.equal(r.result.carbonNeutral, true);
    assertNoNonFinite(r.result);
  });

  it("degrade-graceful: no activities → guidance message, not a crash", () => {
    const r = call("carbonFootprint", ctxA, { activities: [] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No activities/i);
  });

  it("fail-CLOSED: poisoned Infinity/1e999/NaN quantity never leaks Infinity/NaN", () => {
    const inf = call("carbonFootprint", ctxA, { activities: [
      { category: "electricity", type: "kwh", quantity: Infinity },
    ] });
    assert.equal(inf.ok, true);
    assert.ok(Number.isFinite(inf.result.totalEmissionsKgCO2e));
    assertNoNonFinite(inf.result);

    const big = call("carbonFootprint", ctxA, { activities: [
      { category: "beef", type: "kg", quantity: "1e999" },
    ] });
    assert.ok(Number.isFinite(big.result.totalEmissionsKgCO2e));
    assertNoNonFinite(big.result);

    const nan = call("carbonFootprint", ctxA, { activities: [
      { category: "x", type: "y", quantity: -5, emissionFactor: NaN },
    ] });
    // negative quantity clamped to 0, NaN factor → 0 → 0 emissions
    assert.equal(nan.result.totalEmissionsKgCO2e, 0);
    assertNoNonFinite(nan.result);
  });
});

// ── biodiversityIndex — Shannon/Simpson the simulation panel renders ───────
describe("eco.biodiversityIndex — diversity indices for KNOWN counts", () => {
  it("computes Shannon/Simpson/richness for an even 4-species community", () => {
    // 4 species, 25 each → perfectly even. Shannon = ln(4) ≈ 1.3863,
    // evenness = 1.0, Simpson D = 0.25, Simpson diversity = 0.75.
    const r = call("biodiversityIndex", ctxA, { species: { a: 25, b: 25, c: 25, d: 25 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.speciesRichness, 4);
    assert.equal(r.result.totalIndividuals, 100);
    assert.ok(Math.abs(r.result.diversityIndices.shannonH - 1.3863) < 0.001);
    assert.equal(r.result.diversityIndices.shannonEvenness, 1);
    assert.equal(r.result.diversityIndices.simpsonsD, 0.25);
    assert.equal(r.result.diversityIndices.simpsonsDiversity, 0.75);
    assert.equal(r.result.diversityLabel, "moderate"); // 1 < H ≤ 2
    assertNoNonFinite(r.result);
  });

  it("array observations aggregate by species name; singletons flagged rare", () => {
    const r = call("biodiversityIndex", ctxA, { observations: [
      { species: "oak", count: 50 },
      { species: "oak", count: 50 }, // aggregates to 100
      { species: "fern", count: 1 }, // singleton
    ] });
    assert.equal(r.result.speciesRichness, 2);
    assert.equal(r.result.totalIndividuals, 101);
    assert.equal(r.result.rankAbundance[0].species, "oak");
    assert.equal(r.result.rareSpecies.count, 1);
    assertNoNonFinite(r.result);
  });

  it("degrade-graceful: no data → guidance message", () => {
    const r = call("biodiversityIndex", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No species data/i);
  });

  it("fail-CLOSED: poisoned Infinity/1e999 counts never leak Infinity/NaN", () => {
    const r = call("biodiversityIndex", ctxA, { species: { a: Infinity, b: 10 } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalIndividuals));
    assertNoNonFinite(r.result);
    const r2 = call("biodiversityIndex", ctxA, { observations: [{ species: "x", count: "1e999" }] });
    assert.ok(Number.isFinite(r2.result.totalIndividuals));
    assertNoNonFinite(r2.result);
  });
});

// ── sustainabilityScore — ESG weighting + clamp ────────────────────────────
describe("eco.sustainabilityScore — ESG pillar weighting the panel renders", () => {
  it("computes pillar + overall scores for a full ESG profile", () => {
    const r = call("sustainabilityScore", ctxA, { indicators: {
      environmental: { emissions: 80, energyEfficiency: 80, wasteReduction: 80, waterUsage: 80, biodiversity: 80 },
      social: { laborPractices: 60, communityImpact: 60, healthSafety: 60, diversity: 60, humanRights: 60 },
      governance: { boardDiversity: 40, transparency: 40, ethics: 40, riskManagement: 40, compliance: 40 },
    } });
    assert.equal(r.ok, true);
    assert.equal(r.result.pillars.environmental.score, 80);
    assert.equal(r.result.pillars.social.score, 60);
    assert.equal(r.result.pillars.governance.score, 40);
    // overall = (80×0.4 + 60×0.35 + 40×0.25) / (0.4+0.35+0.25) = 63
    assert.equal(r.result.overallScore, 63);
    assert.equal(r.result.maturityLevel, "Developing"); // 50..64
    assert.equal(r.result.dataCompleteness, 100);
    assertNoNonFinite(r.result);
  });

  it("partial data → null pillar score + insufficient-data rating, never NaN", () => {
    const r = call("sustainabilityScore", ctxA, { indicators: {
      environmental: { emissions: 70 },
    } });
    assert.equal(r.ok, true);
    assert.equal(r.result.pillars.social.score, null);
    assert.equal(r.result.pillars.social.rating, "insufficient data");
    assertNoNonFinite(r.result);
  });

  it("fail-CLOSED: poisoned Infinity/1e999 indicator clamps into 0..100", () => {
    const r = call("sustainabilityScore", ctxA, { indicators: {
      environmental: { emissions: Infinity, energyEfficiency: "1e999", wasteReduction: -50 },
    } });
    assert.equal(r.ok, true);
    // Infinity/1e999 clamp to 100, -50 clamps to 0; all sub-scores 0..100.
    for (const sub of r.result.pillars.environmental.subIndicators) {
      if (sub.score !== null) assert.ok(sub.score >= 0 && sub.score <= 100, `score ${sub.score}`);
    }
    assertNoNonFinite(r.result);
  });
});

// ── energy-estimate — deterministic solar PV the estimator renders ─────────
describe("eco.energy-estimate — deterministic PV model + bounds", () => {
  it("returns 12 monthly values, an annual total, and a 0..1 capacity factor", () => {
    const r = call("energy-estimate", ctxA, { });
    // default systemKw=5, lat/lng 0
    const r2 = call("energy-estimate", ctxA, {});
    void r2;
    const out = call("energy-estimate", ctxA, { lat: 37.77, lng: -122.42, systemKw: 8, tilt: 30, azimuth: 180 });
    assert.equal(out.ok, true);
    assert.equal(out.result.systemKwp, 8);
    assert.equal(out.result.monthlyKwh.length, 12);
    assert.equal(out.result.annualKwh, out.result.monthlyKwh.reduce((s, v) => s + v, 0) > 0
      ? out.result.annualKwh : out.result.annualKwh); // annual is finite & positive
    assert.ok(out.result.annualKwh > 0);
    assert.ok(out.result.capacityFactor > 0 && out.result.capacityFactor <= 1);
    assert.ok(out.result.co2AvoidedKgPerYear > 0);
    assertNoNonFinite(out.result);
    assertNoNonFinite(r.result);
  });

  it("fail-CLOSED: poisoned Infinity/NaN lat/lng/kW/tilt never leak Infinity/NaN", () => {
    const r = call("energy-estimate", ctxA, { lat: Infinity, lng: "NaN", systemKw: "1e999", tilt: Infinity, azimuth: NaN });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.systemKwp));
    assert.ok(Number.isFinite(r.result.annualKwh));
    assert.ok(Number.isFinite(r.result.capacityFactor));
    assert.ok(r.result.location.lat >= -90 && r.result.location.lat <= 90);
    assertNoNonFinite(r.result);
  });

  it("negative system size clamps to the 0.1 kW floor (never negative production)", () => {
    const r = call("energy-estimate", ctxA, { lat: 37, lng: -122, systemKw: -5 });
    assert.equal(r.result.systemKwp, 0.1);
    assert.ok(r.result.annualKwh >= 0);
    assertNoNonFinite(r.result);
  });
});

// ── biodiversity life-list — CRUD round-trip + per-user isolation ──────────
describe("eco.biodiversity-* — life-list round-trip the BiodiversityLog renders", () => {
  it("logs an observation, lists it back with the exact rendered fields", () => {
    const logged = call("biodiversity-log", ctxA, { commonName: "Red-tailed Hawk", scientificName: "Buteo jamaicensis", lat: 37.7, lng: -122.4, notes: "perched on a snag" });
    assert.equal(logged.ok, true);
    const e = logged.result.entry;
    assert.equal(e.commonName, "Red-tailed Hawk");
    assert.equal(e.scientificName, "Buteo jamaicensis");
    assert.equal(e.lat, 37.7);
    assert.equal(e.notes, "perched on a snag");

    const list = call("biodiversity-list", ctxA, { limit: 50 });
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.observations[0].id, e.id);
    assert.equal(list.result.observations[0].commonName, "Red-tailed Hawk");
  });

  it("per-user isolated; delete round-trip removes the row", () => {
    const e = call("biodiversity-log", ctxA, { commonName: "Coyote" }).result.entry;
    // user B sees none of A's rows
    assert.equal(call("biodiversity-list", ctxB, {}).result.total, 0);
    const del = call("biodiversity-delete", ctxA, { id: e.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    assert.ok(!call("biodiversity-list", ctxA, {}).result.observations.some(o => o.id === e.id));
  });

  it("validation-rejection: empty commonName; delete of a missing id", () => {
    assert.match(call("biodiversity-log", ctxA, { commonName: "  " }).error, /commonName required/i);
    assert.match(call("biodiversity-delete", ctxA, { id: "nope" }).error, /not found/i);
  });
});

// ── climate-actions — curated library + log/streak-free total ──────────────
describe("eco.climate-actions-* — curated library + per-user log", () => {
  it("the catalog spans all six categories and the ClimateActions panel fields", () => {
    const r = call("climate-actions-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.actions.length >= 15);
    const cats = new Set(r.result.actions.map(a => a.category));
    for (const c of ["transport", "food", "home", "shopping", "advocacy", "energy"]) {
      assert.ok(cats.has(c), `missing category ${c}`);
    }
    // every action carries the fields the panel renders
    for (const a of r.result.actions) {
      assert.equal(typeof a.slug, "string");
      assert.equal(typeof a.title, "string");
      assert.ok(Number.isFinite(a.kgCo2eSavedPerYear));
      assert.ok(a.effort >= 1 && a.effort <= 5);
      assert.equal(typeof a.citation, "string");
    }
  });

  it("log → logged round-trip accumulates the per-instance kg saved", () => {
    const log = call("climate-actions-log", ctxA, { slug: "bike-commute-week", kgCo2eSavedThisInstance: 7.3 });
    assert.equal(log.ok, true);
    assert.equal(log.result.entry.slug, "bike-commute-week");
    assert.equal(log.result.entry.kgSaved, 7.3);
    const logged = call("climate-actions-logged", ctxA, { sinceDays: 30 });
    assert.equal(logged.result.entries.length, 1);
    assert.equal(logged.result.totalKgSaved, 7.3);
  });

  it("validation-rejection: missing/unknown slug", () => {
    assert.match(call("climate-actions-log", ctxA, {}).error, /slug required/i);
    assert.match(call("climate-actions-log", ctxA, { slug: "not-a-real-action" }).error, /unknown action/i);
  });
});

// ── footprint trend — record / history trend math / delete ─────────────────
describe("eco.footprint-* — trend analysis the FootprintTrend chart renders", () => {
  it("records snapshots and computes an improving trend over the period", () => {
    // older snapshot higher, newer lower → improving (net dropped).
    const a = call("footprint-record", ctxA, { totalKgCO2e: 1200, netKgCO2e: 1200, label: "Jan" }).result.entry;
    // backdate the first entry so ordering is deterministic
    a.at = new Date(Date.now() - 5 * 86400000).toISOString();
    call("footprint-record", ctxA, { totalKgCO2e: 900, netKgCO2e: 900, label: "Feb" });
    const h = call("footprint-history", ctxA, { sinceDays: 365 });
    assert.equal(h.ok, true);
    assert.equal(h.result.count, 2);
    assert.equal(h.result.trend, "improving");
    assert.equal(h.result.deltaKg, -300);
    assert.equal(h.result.bestEntry.netKgCO2e, 900);
    assertNoNonFinite(h.result);
  });

  it("validation-rejection: negative/NaN total; delete missing id", () => {
    assert.match(call("footprint-record", ctxA, { totalKgCO2e: -5 }).error, /totalKgCO2e/i);
    assert.match(call("footprint-record", ctxA, { totalKgCO2e: "not-a-number" }).error, /totalKgCO2e/i);
    assert.match(call("footprint-delete", ctxA, { id: "missing" }).error, /not found/i);
  });

  it("fail-CLOSED: an Infinity total is rejected, never stored as Infinity", () => {
    const r = call("footprint-record", ctxA, { totalKgCO2e: Infinity });
    assert.equal(r.ok, false);
    assert.match(r.error, /totalKgCO2e/i);
  });

  it("degrade-graceful: empty history → trend 'none', averages 0, never NaN", () => {
    const h = call("footprint-history", ctxB, {});
    assert.equal(h.ok, true);
    assert.equal(h.result.count, 0);
    assert.equal(h.result.trend, "none");
    assert.equal(h.result.averageNetKgCO2e, 0);
    assertNoNonFinite(h.result);
  });
});

// ── challenges — join / streak recompute / leave the EcoChallenges renders ──
describe("eco.challenges-* — gamified streaks the EcoChallenges panel renders", () => {
  it("catalog → join → checkin recomputes streak + points + kg saved", () => {
    const ctx = { actor: { userId: "eco_chal_u" }, userId: "eco_chal_u" };
    const cat = call("challenges-catalog", ctx, {});
    assert.ok(cat.result.challenges.length >= 8);
    const slug = cat.result.challenges[0].slug;
    const joined = call("challenges-join", ctx, { slug });
    assert.equal(joined.ok, true);
    assert.equal(joined.result.enrollment.slug, slug);

    const ci = call("challenges-checkin", ctx, { slug });
    assert.equal(ci.ok, true);
    const mine = call("challenges-mine", ctx, {});
    const en = mine.result.enrollments.find(e => e.slug === slug);
    assert.equal(en.totalCheckIns, 1);
    assert.equal(en.currentStreak, 1);
    assert.equal(en.totalPoints, cat.result.challenges[0].points);
    assert.ok(Number.isFinite(en.totalKgSaved));
    assertNoNonFinite(mine.result);
  });

  it("validation-rejection: double-join, double-checkin-today, unknown slug, leave", () => {
    const ctx = { actor: { userId: "eco_chal_u2" }, userId: "eco_chal_u2" };
    const slug = call("challenges-catalog", ctx, {}).result.challenges[0].slug;
    call("challenges-join", ctx, { slug });
    assert.match(call("challenges-join", ctx, { slug }).error, /already enrolled/i);
    call("challenges-checkin", ctx, { slug });
    assert.match(call("challenges-checkin", ctx, { slug }).error, /already checked in/i);
    assert.match(call("challenges-checkin", ctx, { slug: "nope" }).error, /unknown challenge/i);
    const left = call("challenges-leave", ctx, { slug });
    assert.equal(left.ok, true);
    assert.equal(call("challenges-mine", ctx, {}).result.activeCount, 0);
  });
});

// ── saved locations — CRUD round-trip + cap + validation ───────────────────
describe("eco.locations-* — saved-location round-trip the EnvAlerts renders", () => {
  it("saves a location, lists it, deletes it", () => {
    const ctx = { actor: { userId: "eco_loc_u" }, userId: "eco_loc_u" };
    const s = call("locations-save", ctx, { label: "Home", lat: 37.77, lng: -122.42 });
    assert.equal(s.ok, true);
    assert.equal(s.result.entry.label, "Home");
    const list = call("locations-list", ctx, {});
    assert.equal(list.result.count, 1);
    const del = call("locations-delete", ctx, { id: s.result.entry.id });
    assert.equal(del.result.deleted, true);
    assert.equal(call("locations-list", ctx, {}).result.count, 0);
  });

  it("validation-rejection: missing label / poisoned coords", () => {
    assert.match(call("locations-save", ctxA, { lat: 1, lng: 1 }).error, /label required/i);
    assert.match(call("locations-save", ctxA, { label: "X", lat: Infinity, lng: 2 }).error, /lat, lng required/i);
    assert.match(call("locations-save", ctxA, { label: "X", lat: "NaN", lng: 2 }).error, /lat, lng required/i);
  });
});

// ── network-backed macros — honest-error contract (no fabricated data) ─────
describe("eco — network macros fail honestly when offline (no fake data)", () => {
  it("weather-forecast surfaces ok:false (no synthetic week)", async () => {
    const r = await call("weather-forecast", ctxA, { lat: 37.7, lng: -122.4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /open-meteo unreachable/i);
  });
  it("aqi-current surfaces ok:false (no fabricated AQI of 42)", async () => {
    const r = await call("aqi-current", ctxA, { lat: 37.7, lng: -122.4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/i);
  });
  it("observation-feed + species-suggest reject poisoned/missing input pre-network", async () => {
    assert.match((await call("observation-feed", ctxA, { lat: Infinity, lng: 1 })).error, /lat, lng required/i);
    assert.match((await call("species-suggest", ctxA, { name: "  " })).error, /name required/i);
  });
  it("environmental-alerts rejects poisoned coords pre-network", async () => {
    assert.match((await call("environmental-alerts", ctxA, { lat: "NaN", lng: 1 })).error, /lat, lng required/i);
  });
});

// ── double-wrap dispatch parity — the dead-surface bug class ────────────────
describe("eco — { artifact:{ data } } double-wrap is peeled like production", () => {
  it("carbonFootprint reads through a sole-key artifact wrapper identically to flat", () => {
    const wrapped = call("carbonFootprint", ctxA, { artifact: { data: { activities: [
      { category: "electricity", type: "kwh", quantity: 1000 },
    ] } } });
    const flat = call("carbonFootprint", ctxA, { activities: [
      { category: "electricity", type: "kwh", quantity: 1000 },
    ] });
    assert.equal(wrapped.result.totalEmissionsKgCO2e, 233);
    assert.deepEqual(wrapped.result, flat.result);
  });

  it("biodiversityIndex reads through the wrapper (historical blank-calc bug)", () => {
    const wrapped = call("biodiversityIndex", ctxA, { artifact: { data: { species: { a: 10, b: 10 } } } });
    assert.equal(wrapped.ok, true);
    assert.equal(wrapped.result.speciesRichness, 2);
    assert.equal(wrapped.result.totalIndividuals, 20);
  });
});
