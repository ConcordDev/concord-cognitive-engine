// Tier-2 contract tests for forestry lens parity macros:
// growth projection, GIS polygon mapping, cruise plotting,
// pest/disease tracking, replanting scheduler, carbon-credit registry.
// Pins per-user scoping + input validation + computed-field correctness.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForestryActions from "../domains/forestry.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`forestry.${name}`);
  if (!fn) throw new Error(`forestry.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerForestryActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("forestry — growth & yield projection", () => {
  it("projects volume over a rotation with MAI / CAI", () => {
    const r = call("growth-projection", ctxA, {
      species: "douglas_fir", acres: 40, currentAge: 20, siteIndex: 90,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.species, "douglas_fir");
    assert.equal(r.result.acres, 40);
    assert.ok(Array.isArray(r.result.projection));
    assert.ok(r.result.projection.length > 1);
    assert.ok(r.result.finalTotalVolume >= r.result.currentTotalVolume);
    assert.ok(r.result.biologicalRotationAge > 0);
  });

  it("honours a measured current volume as an anchor offset", () => {
    const r = call("growth-projection", ctxA, {
      species: "loblolly_pine", acres: 10, currentAge: 15, currentVolumePerAcre: 4000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.currentVolumePerAcre, 4000);
  });

  it("rejects zero acres", () => {
    const r = call("growth-projection", ctxA, { species: "oak", acres: 0, currentAge: 30 });
    assert.equal(r.ok, false);
    assert.match(r.error, /acres must be/);
  });
});

describe("forestry — GIS stand polygon mapping", () => {
  it("saves a polygon and computes acreage from coordinates", () => {
    // ~1km square near 45N → roughly 247 acres.
    const r = call("stand-polygon-save", ctxA, {
      name: "North block",
      vertices: [
        { lat: 45.0, lon: -122.0 },
        { lat: 45.009, lon: -122.0 },
        { lat: 45.009, lon: -121.987 },
        { lat: 45.0, lon: -121.987 },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.polygon.acres > 100 && r.result.polygon.acres < 400);
    assert.ok(r.result.polygon.perimeterM > 0);
    assert.equal(r.result.polygon.vertices.length, 4);
  });

  it("rejects polygons with fewer than 3 vertices", () => {
    const r = call("stand-polygon-save", ctxA, {
      name: "bad", vertices: [{ lat: 45, lon: -122 }, { lat: 46, lon: -122 }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /3 vertices/);
  });

  it("lists and deletes polygons per user", () => {
    call("stand-polygon-save", ctxB, {
      name: "B block",
      vertices: [{ lat: 1, lon: 1 }, { lat: 1.01, lon: 1 }, { lat: 1.01, lon: 1.01 }],
    });
    const listB = call("stand-polygon-list", ctxB, {});
    assert.equal(listB.result.count, 1);
    const listA = call("stand-polygon-list", ctxA, {});
    assert.equal(listA.result.count, 0); // user_a isolated
    const del = call("stand-polygon-delete", ctxB, { id: listB.result.polygons[0].id });
    assert.equal(del.ok, true);
    assert.equal(call("stand-polygon-list", ctxB, {}).result.count, 0);
  });
});

describe("forestry — inventory cruise plotting", () => {
  it("adds plots and computes a statistical summary", () => {
    const p1 = call("cruise-plot-add", ctxA, {
      standId: "std_1", method: "prism_baf", expansionFactor: 10,
      trees: [
        { species: "oak", dbhInches: 14, heightFeet: 70 },
        { species: "oak", dbhInches: 16, heightFeet: 75 },
      ],
    });
    assert.equal(p1.ok, true);
    assert.equal(p1.result.plot.treeCount, 2);
    call("cruise-plot-add", ctxA, {
      standId: "std_1", method: "prism_baf", expansionFactor: 10,
      trees: [{ species: "oak", dbhInches: 12, heightFeet: 65 }],
    });
    const sum = call("cruise-summary", ctxA, { standId: "std_1" });
    assert.equal(sum.ok, true);
    assert.equal(sum.result.plots, 2);
    assert.ok(sum.result.treesPerAcre.mean > 0);
    assert.ok(sum.result.basalAreaPerAcre.mean > 0);
    assert.ok("ciPercent" in sum.result.boardFeetPerAcre);
  });

  it("rejects a plot with no tallied trees", () => {
    const r = call("cruise-plot-add", ctxA, { standId: "std_1", trees: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /tallied tree/);
  });

  it("returns an empty-state summary when no plots exist", () => {
    const r = call("cruise-summary", ctxB, { standId: "none" });
    assert.equal(r.ok, true);
    assert.equal(r.result.plots, 0);
  });
});

describe("forestry — pest / disease tracking", () => {
  it("reports a pest, schedules and completes a treatment", () => {
    const rep = call("pest-report", ctxA, {
      agent: "Mountain pine beetle", kind: "pest", severity: "high",
      affectedAcres: 25, standId: "std_1",
    });
    assert.equal(rep.ok, true);
    assert.equal(rep.result.report.status, "open");
    const trt = call("pest-schedule-treatment", ctxA, {
      pestId: rep.result.report.id, method: "Sanitation thinning",
      scheduledDate: "2099-06-01", cost: 4000,
    });
    assert.equal(trt.ok, true);
    const listOpen = call("pest-list", ctxA, { status: "open" });
    assert.equal(listOpen.result.openCount, 1);
    assert.equal(listOpen.result.upcomingTreatments.length, 1);
    const done = call("pest-complete-treatment", ctxA, {
      pestId: rep.result.report.id, treatmentId: trt.result.treatment.id, resolveReport: true,
    });
    assert.equal(done.ok, true);
    assert.equal(done.result.report.status, "resolved");
  });

  it("rejects a pest report without an agent name", () => {
    const r = call("pest-report", ctxA, { agent: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /agent name required/);
  });
});

describe("forestry — replanting / silviculture scheduler", () => {
  it("creates a project, updates status, runs a survival survey", () => {
    const proj = call("replant-project-create", ctxA, {
      name: "Block 7 reforestation", species: "douglas_fir", acres: 30,
      seedlingsPerAcre: 400, method: "containerized", plannedDate: "2099-03-01",
    });
    assert.equal(proj.ok, true);
    assert.equal(proj.result.project.seedlingsOrdered, 12000);
    const upd = call("replant-update-status", ctxA, { id: proj.result.project.id, status: "planted" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.project.status, "planted");
    const svy = call("replant-survival-survey", ctxA, {
      id: proj.result.project.id, sampledSeedlings: 100, aliveSeedlings: 55,
    });
    assert.equal(svy.ok, true);
    assert.equal(svy.result.survey.survivalPercent, 55);
    assert.match(svy.result.survey.recommendation, /restocking/i);
    const list = call("replant-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalSeedlings, 12000);
    assert.equal(list.result.projects[0].latestSurvival, 55);
  });

  it("rejects a project with zero acres", () => {
    const r = call("replant-project-create", ctxA, { name: "X", acres: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /acres must be/);
  });
});

describe("forestry — carbon-credit registry workflow", () => {
  it("issues, verifies and retires a credit", () => {
    const issue = call("carbon-credit-issue", ctxA, {
      projectName: "Riparian afforestation", tonsCO2: 500, vintageYear: 2025,
      pricePerTon: 30, registry: "Verra",
    });
    assert.equal(issue.ok, true);
    assert.equal(issue.result.credit.status, "pending_verification");
    assert.equal(issue.result.credit.estimatedValue, 15000);
    const cantRetire = call("carbon-credit-retire", ctxA, { id: issue.result.credit.id });
    assert.equal(cantRetire.ok, false);
    const verify = call("carbon-credit-verify", ctxA, {
      id: issue.result.credit.id, verifier: "SCS Global",
    });
    assert.equal(verify.ok, true);
    assert.equal(verify.result.credit.status, "verified");
    assert.ok(verify.result.credit.serialNumber);
    const retire = call("carbon-credit-retire", ctxA, {
      id: issue.result.credit.id, retiredBy: "Acme Corp", reason: "Scope 1 offset",
    });
    assert.equal(retire.ok, true);
    assert.equal(retire.result.credit.status, "retired");
    const list = call("carbon-credit-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.retiredTons, 500);
  });

  it("rejects an out-of-range vintage year", () => {
    const r = call("carbon-credit-issue", ctxA, {
      projectName: "X", tonsCO2: 10, vintageYear: 1850,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /vintageYear/);
  });

  it("rejects zero tons", () => {
    const r = call("carbon-credit-issue", ctxA, { projectName: "X", tonsCO2: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /tonsCO2/);
  });
});
