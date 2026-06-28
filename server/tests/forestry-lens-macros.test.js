// Behavioral macro tests for the forestry lens — the PATH-3 registerLensAction
// surface in server/domains/forestry.js that the /lenses/forestry page + its
// child components drive through /api/lens/run.
//
// DISPATCH SHAPE (the run route, server.js:39285-39288):
//   POST /api/lens/run { domain:"forestry", action, input }
//     → rest = peelRedundantArtifactWrapper(body.input)
//     → virtualArtifact = { id:null, domain, type:"domain_action", data: rest, meta:{} }
//     → handler(ctx, virtualArtifact, rest)              [3-ARG; data === params === input]
// So for these handlers artifact.data and params are the SAME flat object — the
// exact `input` the component sent. We invoke each registered handler with that
// exact 3-arg shape (params === artifact.data) to mirror production byte-for-byte.
//
// THE DEAD-CALCULATOR CLASS THIS GATE TARGETS (now fixed, pinned here):
//   ForestryActionPanel posts { species, acres, avgAgeYears, treeCount } to
//   timberVolume — but the OLD handler read artifact.data.trees (a `trees[]`
//   array the panel never sends) and returned totalBoardFeet/estimatedValue
//   while the panel renders result.boardFeet/result.valuation. So in production
//   the workbench ALWAYS rendered the empty-guidance message: a DEAD SURFACE.
//   Same field-name mismatch in fireRisk (read temperatureF, panel sends tempF;
//   returned riskScore, panel reads score), harvestPlan (never returned the
//   `schedule[]` the panel maps), carbonSequestration (returned a STRING
//   "X tons CO2/year", panel reads numeric tonsPerYear/lifetimeTons). All four
//   are now aligned to the component contract AND fail-CLOSED on poison input.
//
// NOT shape-only: every test feeds KNOWN inputs and asserts the EXACT computed
// value + round-trips, validation-rejection, degrade-graceful, and fail-CLOSED
// poison cases (1e999 / "Infinity" / NaN never leak into output; no throw/500).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForestryActions from "../domains/forestry.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "forestry", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Drive a handler EXACTLY like the live run route: params === artifact.data === input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`forestry.${name} not registered`);
  const artifact = { id: null, domain: "forestry", type: "domain_action", data: input, meta: {} };
  return fn(ctx, artifact, input);
}

before(() => { registerForestryActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const CALCULATORS = ["timberVolume", "fireRisk", "harvestPlan", "carbonSequestration"];
const STATE_MACROS = [
  "stand-add", "stand-list", "stand-delete", "activity-log", "forestry-dashboard",
  "growth-projection",
  "stand-polygon-save", "stand-polygon-list", "stand-polygon-delete",
  "cruise-plot-add", "cruise-plot-list", "cruise-plot-delete", "cruise-summary",
  "pest-report", "pest-list", "pest-schedule-treatment", "pest-complete-treatment",
  "replant-project-create", "replant-list", "replant-update-status", "replant-survival-survey",
  "carbon-credit-issue", "carbon-credit-verify", "carbon-credit-retire", "carbon-credit-list",
];
const EXTERNAL = ["inciweb-active-fires", "nifc-fire-perimeters", "feed"];

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry — registration", () => {
  it("registers every workbench calculator the ForestryActionPanel reaches", () => {
    for (const m of CALCULATORS) assert.ok(ACTIONS.has(m), `forestry.${m} not registered`);
  });
  it("registers every STATE macro the panels reach", () => {
    for (const m of STATE_MACROS) assert.ok(ACTIONS.has(m), `forestry.${m} not registered`);
  });
  it("registers every external-data macro", () => {
    for (const m of EXTERNAL) assert.ok(ACTIONS.has(m), `forestry.${m} not registered`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry.timberVolume — component-exact shape + board-foot values", () => {
  // ForestryActionPanel.actVolume sends { species, acres, avgAgeYears, treeCount }
  // and renders result.boardFeet + result.valuation + result.cubicFeet.
  it("computes boardFeet/valuation the panel renders, from the panel's exact input", () => {
    const r = call("timberVolume", ctxA, { species: "douglas-fir", acres: 40, avgAgeYears: 35, treeCount: 100 });
    assert.equal(r.ok, true);
    // factor douglas-fir=1.25, ageMaturity=1-e^-1≈0.6321 → 220*1.25*(0.15+0.85*0.6321)=
    // 275*(0.15+0.53729)=275*0.68729=189.0 → round 189 bf/tree × 100 = 18900.
    assert.equal(r.result.boardFeetPerTree, 189);
    assert.equal(r.result.boardFeet, 18900);
    assert.equal(r.result.cubicFeet, Math.round(18900 / 6));
    // valuation = (18900/1000)*400 = 7560.
    assert.equal(r.result.valuation, 7560);
    assert.equal(r.result.pricePerMBF, 400);
    assert.ok(Number.isFinite(r.result.boardFeet));
    assert.ok(Number.isFinite(r.result.valuation));
  });

  it("species changes the board-foot density (oak < douglas-fir at the same age/count)", () => {
    const dfir = call("timberVolume", ctxA, { species: "douglas-fir", acres: 10, avgAgeYears: 40, treeCount: 50 });
    const oak = call("timberVolume", ctxA, { species: "oak", acres: 10, avgAgeYears: 40, treeCount: 50 });
    assert.ok(oak.result.boardFeet < dfir.result.boardFeet, "oak should yield fewer board feet than douglas-fir");
  });

  it("validation: zero tree count returns a guidance message (no broken render)", () => {
    const r = call("timberVolume", ctxA, { species: "oak", acres: 10, avgAgeYears: 30, treeCount: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.boardFeet, undefined);
    assert.match(r.result.message, /tree count/i);
  });

  it("degrade-graceful: empty input returns guidance, never a throw", () => {
    const r = call("timberVolume", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /timber volume/i);
  });

  it("fail-CLOSED poison: 1e999/Infinity/NaN inputs keep boardFeet+valuation FINITE", () => {
    const r = call("timberVolume", ctxA, { species: "mixed", acres: "1e999", avgAgeYears: "Infinity", treeCount: "100", pricePerMBF: "NaN" });
    assert.equal(r.ok, true);
    // acres 1e999 → non-finite → 0 → acres<=0 short-circuits to guidance (fail-closed).
    assert.ok(r.result.message !== undefined || Number.isFinite(r.result.boardFeet));
  });

  it("fail-CLOSED poison: a poisoned price keeps valuation FINITE", () => {
    const r = call("timberVolume", ctxA, { species: "mixed", acres: 10, avgAgeYears: 30, treeCount: 80, pricePerMBF: "1e999" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.valuation), `valuation not finite: ${r.result.valuation}`);
    assert.ok(Number.isFinite(r.result.boardFeet));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry.fireRisk — component-exact shape + risk score", () => {
  // ForestryActionPanel.actRisk sends { tempF, humidity, windMph } and renders
  // result.riskLevel + result.score.
  it("computes score + riskLevel from the panel's tempF/humidity/windMph", () => {
    const r = call("fireRisk", ctxA, { tempF: 100, humidity: 10, windMph: 30 });
    assert.equal(r.ok, true);
    // temp>95:25 + humidity<15:25 + wind>25:20 + drought(default 3)*5=15 + fuelMoist(15)<20:8 = 93.
    assert.equal(r.result.score, 93);
    assert.equal(r.result.riskScore, 93);
    assert.equal(r.result.riskLevel, "extreme");
    assert.ok(Array.isArray(r.result.factors));
    assert.ok(Number.isFinite(r.result.score));
  });

  it("low-danger conditions read as low risk", () => {
    const r = call("fireRisk", ctxA, { tempF: 60, humidity: 70, windMph: 3 });
    assert.equal(r.ok, true);
    // temp<=75:3 + humidity>=40:3 + wind<=8:2 + 15 + fuelMoist 15<20:8 = 31 → moderate.
    assert.equal(r.result.score, 31);
    assert.equal(r.result.riskLevel, "moderate");
  });

  it("score is clamped to [0,100]", () => {
    const r = call("fireRisk", ctxA, { tempF: 120, humidity: 5, windMph: 50, droughtIndex: 5, fuelMoisturePercent: 1 });
    assert.equal(r.ok, true);
    assert.ok(r.result.score <= 100 && r.result.score >= 0);
  });

  it("fail-CLOSED poison: non-finite weather inputs fall back to defaults, score stays FINITE", () => {
    const r = call("fireRisk", ctxA, { tempF: "Infinity", humidity: "NaN", windMph: "1e999" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.score), `score not finite: ${r.result.score}`);
    // all fell back to defaults (temp 80, humidity 30, wind 10) → moderate band.
    assert.equal(r.result.riskLevel, "moderate");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry.harvestPlan — component-exact shape + rotation schedule", () => {
  // ForestryActionPanel.actHarvest sends { species, acres, currentAge } and
  // renders result.schedule.length + result.rotation.
  it("returns a staged schedule[] + rotation the panel renders", () => {
    const r = call("harvestPlan", ctxA, { species: "douglas-fir", acres: 100, currentAge: 25 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.schedule));
    assert.ok(r.result.schedule.length > 0);
    assert.equal(r.result.rotation, 55); // douglas_fir rotation from SPECIES_GROWTH
    assert.equal(r.result.rotationYears, 55);
    for (const s of r.result.schedule) {
      assert.ok(Number.isFinite(s.year));
      assert.ok(Number.isFinite(s.acres));
      assert.ok(Number.isFinite(s.volume));
    }
    // selective default → 3 staged entries.
    assert.equal(r.result.schedule.length, 3);
  });

  it("clearcut collapses to a single final-harvest entry", () => {
    const r = call("harvestPlan", ctxA, { species: "loblolly-pine", acres: 50, currentAge: 10, method: "clearcut" });
    assert.equal(r.ok, true);
    assert.equal(r.result.schedule.length, 1);
    assert.equal(r.result.removalPercent, 100);
  });

  it("validation: zero acres returns a guidance message", () => {
    const r = call("harvestPlan", ctxA, { species: "oak", acres: 0, currentAge: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.schedule, undefined);
    assert.match(r.result.message, /acres/i);
  });

  it("fail-CLOSED poison: 1e999 acres short-circuits to guidance; finite values never NaN", () => {
    const r = call("harvestPlan", ctxA, { species: "mixed", acres: "1e999", currentAge: 20 });
    assert.equal(r.ok, true);
    // acres non-finite → 0 → guidance (no NaN schedule).
    assert.match(r.result.message, /acres/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry.carbonSequestration — component-exact shape + numeric tons", () => {
  // ForestryActionPanel.actCarbon sends { species, acres, ageYears } and renders
  // result.tonsPerYear + result.equivalentCars (numbers, not the legacy string).
  it("returns numeric tonsPerYear/lifetimeTons/equivalentCars the panel renders", () => {
    const r = call("carbonSequestration", ctxA, { species: "douglas-fir", acres: 100, ageYears: 30 });
    assert.equal(r.ok, true);
    // age 30 → 1.8 t/ac/yr × 100 = 180 t/yr.
    assert.equal(r.result.tonsPerYear, 180);
    assert.equal(typeof r.result.tonsPerYear, "number");
    // lifetime = 100 * 200 * 0.015 * 30 = 9000.
    assert.equal(r.result.lifetimeTons, 9000);
    // equivalentCars = round(180/4.6) = 39.
    assert.equal(r.result.equivalentCars, 39);
    assert.ok(Number.isFinite(r.result.tonsPerYear));
    assert.ok(Number.isFinite(r.result.lifetimeTons));
  });

  it("young stands sequester faster per acre than old stands", () => {
    const young = call("carbonSequestration", ctxA, { acres: 10, ageYears: 10 });
    const old = call("carbonSequestration", ctxA, { acres: 10, ageYears: 60 });
    assert.ok(young.result.tonsPerYear > old.result.tonsPerYear);
  });

  it("validation: zero acres returns a guidance message", () => {
    const r = call("carbonSequestration", ctxA, { acres: 0, ageYears: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.tonsPerYear, undefined);
    assert.match(r.result.message, /carbon/i);
  });

  it("fail-CLOSED poison: non-finite inputs never leak NaN/Infinity into output", () => {
    const r = call("carbonSequestration", ctxA, { acres: 50, ageYears: "Infinity", treesPerAcre: "1e999" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.tonsPerYear), `tonsPerYear not finite: ${r.result.tonsPerYear}`);
    assert.ok(Number.isFinite(r.result.lifetimeTons), `lifetimeTons not finite: ${r.result.lifetimeTons}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry.growth-projection — Chapman-Richards yield curve", () => {
  it("projects volume over a rotation with finite MAI/CAI rows (GrowthProjectionPanel)", () => {
    const r = call("growth-projection", ctxA, { species: "douglas_fir", acres: 40, currentAge: 20, siteIndex: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.result.species, "douglas_fir");
    assert.equal(r.result.acres, 40);
    assert.ok(Array.isArray(r.result.projection) && r.result.projection.length > 0);
    for (const row of r.result.projection) {
      assert.ok(Number.isFinite(row.volumePerAcre));
      assert.ok(Number.isFinite(row.totalVolume));
      assert.ok(Number.isFinite(row.mai));
      assert.ok(Number.isFinite(row.cai));
    }
    assert.ok(Number.isFinite(r.result.biologicalRotationAge));
    assert.ok(Number.isFinite(r.result.peakMai));
  });

  it("validation: acres <= 0 is rejected cleanly", () => {
    const r = call("growth-projection", ctxA, { species: "oak", acres: 0 });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /acres/i);
  });

  it("fail-CLOSED poison: 1e999 acres rejected, never an infinite-volume row", () => {
    const r = call("growth-projection", ctxA, { species: "mixed", acres: "1e999" });
    assert.equal(r.ok, false); // frNum non-finite → 0 → acres<=0 → reject
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry STATE substrate — stands / activities / dashboard", () => {
  it("stand-add → stand-list → activity-log round-trips (StandManager)", () => {
    const a = call("stand-add", ctxA, { name: "North 40", species: "douglas_fir", acres: 40, treesPerAcre: 200 });
    assert.equal(a.ok, true);
    const id = a.result.stand.id;
    assert.equal(a.result.stand.name, "North 40");

    const list = call("stand-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.stands.length, 1);
    assert.equal(list.result.stands[0].id, id);
    // estimatedTrees = acres × treesPerAcre = 8000 (derived field the panel reads).
    assert.equal(list.result.stands[0].estimatedTrees, 8000);
    assert.equal(list.result.totalAcres, 40);

    const act = call("activity-log", ctxA, { standId: id, kind: "thinning", notes: "first pass" });
    assert.equal(act.ok, true);
    assert.equal(act.result.activity.kind, "thinning");

    const dash = call("forestry-dashboard", ctxA, {});
    assert.equal(dash.ok, true);
    assert.equal(dash.result.stands, 1);
    assert.equal(dash.result.activities, 1);
    assert.equal(dash.result.bySpecies.douglas_fir, 1);
  });

  it("validation: stand-add requires a name; activity-log requires a real stand", () => {
    assert.equal(call("stand-add", ctxA, { name: "" }).ok, false);
    assert.equal(call("activity-log", ctxA, { standId: "nope", kind: "survey" }).ok, false);
  });

  it("stands are per-user: user_b cannot see or delete user_a's stand", () => {
    const id = call("stand-add", ctxA, { name: "Private Stand", species: "oak", acres: 5 }).result.stand.id;
    assert.equal(call("stand-list", ctxB, {}).result.stands.length, 0);
    assert.equal(call("stand-delete", ctxB, { id }).ok, false);
    // owner can delete.
    assert.equal(call("stand-delete", ctxA, { id }).ok, true);
  });

  it("degrade-graceful: STATE-unavailable returns a clean error, not a throw", () => {
    delete globalThis._concordSTATE;
    const r = call("stand-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(String(r.error), /STATE/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry STATE substrate — GIS polygons (StandPolygonPanel)", () => {
  it("stand-polygon-save computes acreage from a lat/lon ring + round-trips", () => {
    // ~1km × ~1km box near 45°N ≈ 247 acres (shoelace on a spherical projection).
    const verts = [
      { lat: 45.0, lon: -122.0 },
      { lat: 45.009, lon: -122.0 },
      { lat: 45.009, lon: -121.987 },
      { lat: 45.0, lon: -121.987 },
    ];
    const r = call("stand-polygon-save", ctxA, { name: "Block A", vertices: verts });
    assert.equal(r.ok, true);
    assert.ok(r.result.polygon.acres > 200 && r.result.polygon.acres < 320, `acres out of band: ${r.result.polygon.acres}`);
    assert.ok(Number.isFinite(r.result.polygon.perimeterM));

    const list = call("stand-polygon-list", ctxA, {});
    assert.equal(list.result.polygons.length, 1);
    assert.ok(Number.isFinite(list.result.totalAcres));
  });

  it("validation: a 2-vertex ring is rejected; bad coordinates are filtered out", () => {
    assert.equal(call("stand-polygon-save", ctxA, { name: "Bad", vertices: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] }).ok, false);
    const r = call("stand-polygon-save", ctxA, {
      name: "Mixed", vertices: [{ lat: 999, lon: 0 }, { lat: 45, lon: -122 }, { lat: 45.01, lon: -122 }],
    });
    // one vertex invalid (lat 999) → only 2 valid → rejected.
    assert.equal(r.ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry STATE substrate — inventory cruise (CruisePanel)", () => {
  it("cruise-plot-add → cruise-summary computes per-acre stats with a CI", () => {
    const add1 = call("cruise-plot-add", ctxA, {
      standId: "s1", method: "prism_baf", expansionFactor: 10,
      trees: [{ species: "oak", dbhInches: 14, heightFeet: 70 }, { species: "oak", dbhInches: 16, heightFeet: 75 }],
    });
    assert.equal(add1.ok, true);
    assert.equal(add1.result.plot.treeCount, 2);
    assert.ok(Number.isFinite(add1.result.plot.trees[0].basalArea));

    call("cruise-plot-add", ctxA, {
      standId: "s1", method: "prism_baf", expansionFactor: 10,
      trees: [{ species: "oak", dbhInches: 12, heightFeet: 65 }],
    });

    const sum = call("cruise-summary", ctxA, { standId: "s1" });
    assert.equal(sum.ok, true);
    assert.equal(sum.result.plots, 2);
    for (const k of ["treesPerAcre", "basalAreaPerAcre", "boardFeetPerAcre"]) {
      assert.ok(Number.isFinite(sum.result[k].mean), `${k}.mean not finite`);
      assert.ok(Number.isFinite(sum.result[k].ciPercent), `${k}.ci not finite`);
    }
  });

  it("validation: a plot with no tallied trees is rejected; empty summary is honest", () => {
    assert.equal(call("cruise-plot-add", ctxA, { standId: "s1", trees: [] }).ok, false);
    const sum = call("cruise-summary", ctxA, { standId: "empty-stand" });
    assert.equal(sum.ok, true);
    assert.equal(sum.result.plots, 0);
    assert.match(sum.result.message, /no cruise plots/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry STATE substrate — pest/disease (PestPanel)", () => {
  it("pest-report → schedule → complete-treatment lifecycle round-trips", () => {
    const rep = call("pest-report", ctxA, { agent: "Mountain pine beetle", kind: "pest", severity: "high", affectedAcres: 12 });
    assert.equal(rep.ok, true);
    const pestId = rep.result.report.id;
    assert.equal(rep.result.report.status, "open");

    const sched = call("pest-schedule-treatment", ctxA, { pestId, method: "MCH pheromone", scheduledDate: "2030-04-01", cost: 1500 });
    assert.equal(sched.ok, true);
    const trtId = sched.result.treatment.id;

    const list = call("pest-list", ctxA, {});
    assert.equal(list.result.openCount, 1);
    assert.equal(list.result.upcomingTreatments.length, 1);

    const done = call("pest-complete-treatment", ctxA, { pestId, treatmentId: trtId, resolveReport: true });
    assert.equal(done.ok, true);
    assert.equal(done.result.report.status, "resolved");
  });

  it("validation: pest-report requires an agent name; not-found is clean", () => {
    assert.equal(call("pest-report", ctxA, { agent: "" }).ok, false);
    assert.equal(call("pest-schedule-treatment", ctxA, { pestId: "nope", method: "x" }).ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry STATE substrate — replanting (ReplantingPanel)", () => {
  it("replant-project-create derives seedling order + survival survey recommendation", () => {
    const c = call("replant-project-create", ctxA, { name: "Burn replant", species: "loblolly_pine", acres: 20, seedlingsPerAcre: 500 });
    assert.equal(c.ok, true);
    const id = c.result.project.id;
    assert.equal(c.result.project.seedlingsOrdered, 10000); // 20 × 500

    const svy = call("replant-survival-survey", ctxA, { id, sampledSeedlings: 100, aliveSeedlings: 50 });
    assert.equal(svy.ok, true);
    assert.equal(svy.result.survey.survivalPercent, 50);
    assert.match(svy.result.survey.recommendation, /restocking|interplant/i);

    const list = call("replant-list", ctxA, {});
    assert.equal(list.result.projects[0].latestSurvival, 50);
    assert.equal(list.result.totalSeedlings, 10000);
  });

  it("survival survey clamps alive ≤ sampled (no >100% survival)", () => {
    const id = call("replant-project-create", ctxA, { name: "Clamp", acres: 5 }).result.project.id;
    const svy = call("replant-survival-survey", ctxA, { id, sampledSeedlings: 50, aliveSeedlings: 9999 });
    assert.equal(svy.ok, true);
    assert.equal(svy.result.survey.survivalPercent, 100);
  });

  it("validation: create rejects empty name + zero acres; status update validates enum", () => {
    assert.equal(call("replant-project-create", ctxA, { name: "" }).ok, false);
    assert.equal(call("replant-project-create", ctxA, { name: "X", acres: 0 }).ok, false);
    const id = call("replant-project-create", ctxA, { name: "S", acres: 1 }).result.project.id;
    assert.equal(call("replant-update-status", ctxA, { id, status: "bogus" }).ok, false);
    assert.equal(call("replant-update-status", ctxA, { id, status: "planted" }).ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry STATE substrate — carbon-credit registry (CarbonCreditPanel)", () => {
  it("issue → verify → retire lifecycle stamps serial + enforces state machine", () => {
    const i = call("carbon-credit-issue", ctxA, { projectName: "Reforest A", tonsCO2: 1000, vintageYear: 2025, pricePerTon: 30, registry: "Verra" });
    assert.equal(i.ok, true);
    const id = i.result.credit.id;
    assert.equal(i.result.credit.estimatedValue, 30000); // 1000 × 30
    assert.equal(i.result.credit.status, "pending_verification");

    // can't retire before verify.
    assert.equal(call("carbon-credit-retire", ctxA, { id }).ok, false);

    const v = call("carbon-credit-verify", ctxA, { id, verifier: "SCS Global" });
    assert.equal(v.ok, true);
    assert.equal(v.result.credit.status, "verified");
    assert.ok(/^VERRA-2025-/.test(v.result.credit.serialNumber), `serial: ${v.result.credit.serialNumber}`);

    const r = call("carbon-credit-retire", ctxA, { id, retiredBy: "Acme Offsets" });
    assert.equal(r.ok, true);
    assert.equal(r.result.credit.status, "retired");

    const list = call("carbon-credit-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.retiredTons, 1000);
    assert.ok(Number.isFinite(list.result.totalValue));
  });

  it("validation: issue rejects empty name, non-positive tons, out-of-range vintage", () => {
    assert.equal(call("carbon-credit-issue", ctxA, { projectName: "" , tonsCO2: 10 }).ok, false);
    assert.equal(call("carbon-credit-issue", ctxA, { projectName: "X", tonsCO2: 0 }).ok, false);
    assert.equal(call("carbon-credit-issue", ctxA, { projectName: "X", tonsCO2: 10, vintageYear: 1980 }).ok, false);
  });

  it("fail-CLOSED poison: a poisoned tonsCO2 (1e999) is rejected, never an Infinity value", () => {
    const r = call("carbon-credit-issue", ctxA, { projectName: "Poison", tonsCO2: "1e999" });
    assert.equal(r.ok, false); // frNum non-finite → 0 → tons<=0 → reject
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forestry external-data macros — validation + network-disabled degrade", () => {
  it("inciweb-active-fires validates the state code shape", async () => {
    const r = await call("inciweb-active-fires", ctxA, { state: "California" });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /2-letter/i);
  });

  it("inciweb-active-fires degrades cleanly when the network is disabled", async () => {
    const r = await call("inciweb-active-fires", ctxA, { state: "CA" });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /unreachable|inciweb/i);
  });

  it("nifc-fire-perimeters degrades cleanly when the network is disabled", async () => {
    const r = await call("nifc-fire-perimeters", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(String(r.error), /unreachable|nifc/i);
  });
});
