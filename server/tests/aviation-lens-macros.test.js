// Phase-2 behavioral gate for the aviation lens artifact-data calculators.
//
// These macros run on the artifact-run dispatch path (POST /api/lens/:domain/:id/run
// → handler(ctx, artifact, params)), reading the PERSISTED artifact.data the
// editors in app/lenses/aviation/page.tsx actually write. The 3-arg dispatch
// is reproduced exactly: every call passes a virtual artifact whose `.data`
// is the precise object the component persists, plus the same object as params.
//
// COMPONENT-EXACT-SHAPE: each test drives the EXACT field names the W&B /
// Weather / Duty / Flight-summary / Maintenance editors persist (flat shapes —
// emptyWeight/fuelWeight/windDirection/… — NOT the structured {aircraft,loading}
// shape the handlers were originally written for) and asserts the EXACT fields
// the page's Action Result panel renders. This pins the dead-calculator class of
// defect that left the safety-critical W&B Calculate button returning gross 0 /
// cg 0 for every input.
//
// Hermetic: no boot, no network, no LLM. fetch is stubbed to throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAviationActions from "../domains/aviation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

// Reproduce the /api/lens/:id/run dispatch: handler(ctx, artifact, params).
// `data` is what the editor persisted into artifact.data; params mirrors it
// (the artifact-run route passes the run body as params — empty here).
function run(name, data = {}, { title, params = {} } = {}) {
  const fn = ACTIONS.get(`aviation.${name}`);
  if (!fn) throw new Error(`aviation.${name} not registered`);
  const artifact = { id: "art_1", domain: "aviation", title: title ?? null, data, meta: {} };
  return fn({ actor: { userId: "u1" }, userId: "u1" }, artifact, params);
}

before(() => { registerAviationActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

// The EXACT flat W&B shape app/lenses/aviation/page.tsx#renderWBEditor persists.
function wbEditorData() {
  return {
    aircraft: "C172S", tailNumber: "N12345",
    emptyWeight: 1500, emptyArm: 39,
    fuelWeight: 180, fuelArm: 48,
    pilotWeight: 170, pilotArm: 37,
    copilotWeight: 150, copilotArm: 37,
    paxRow1Weight: 0, paxRow1Arm: 0,
    paxRow2Weight: 0, paxRow2Arm: 0,
    cargoWeight: 40, cargoArm: 95,
    baggageWeight: 20, baggageArm: 123,
    maxGross: 2550, fwdCGLimit: 35, aftCGLimit: 47.3,
  };
}

describe("aviation.calculate-wb (W&B — flat editor shape)", () => {
  it("computes real gross weight + CG from the flat editor fields", () => {
    const r = run("calculate-wb", wbEditorData());
    assert.equal(r.ok, true);
    // Hand-computed: weights 1500+180+170+150+40+20 = 2060
    assert.equal(r.result.grossWeight, 2060);
    // moment: 1500*39 + 180*48 + 170*37 + 150*37 + 40*95 + 20*123
    //       = 58500 + 8640 + 6290 + 5550 + 3800 + 2460 = 85240
    assert.equal(r.result.totalMoment, 85240);
    // cg = 85240 / 2060 = 41.38 (2dp)
    assert.equal(r.result.cg, 41.38);
    assert.equal(r.result.maxGrossWeight, 2550);
    // EXACT rendered fields: stations array with station/weight/arm/moment.
    assert.ok(Array.isArray(r.result.stations));
    const fuel = r.result.stations.find(s => s.station === "Fuel");
    assert.equal(fuel.weight, 180);
    assert.equal(fuel.arm, 48);
    assert.equal(fuel.moment, 8640);
    // Zero-weight stations (paxRow1/paxRow2) are dropped, not rendered as empty rows.
    assert.ok(!r.result.stations.some(s => s.station === "PAX Row 1"));
    assert.equal(typeof r.result.summary, "string");
    assert.match(r.result.summary, /Gross 2060/);
  });

  it("still accepts the structured { aircraft:{}, loading:[] } shape (back-compat)", () => {
    const r = run("calculate-wb", {
      aircraft: { tailNumber: "N1", emptyWeight: 1500, emptyArm: 39, maxGrossWeight: 2550, cgEnvelope: { fwd: 35, aft: 47.3 } },
      loading: [{ station: "Pilot", weight: 170, arm: 37 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.grossWeight, 1670);
    assert.equal(r.result.cg, Math.round(((1500 * 39 + 170 * 37) / 1670) * 100) / 100);
    assert.equal(r.result.stations.length, 1);
  });

  it("degrades gracefully on empty data (no inputs → gross = empty weight only)", () => {
    const r = run("calculate-wb", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.grossWeight, 0);
    assert.equal(r.result.cg, 0);
    assert.deepEqual(r.result.stations, []);
  });

  it("FAIL-CLOSED: poisoned numeric fields never emit NaN/Infinity", () => {
    const r = run("calculate-wb", {
      emptyWeight: "NaN", emptyArm: "Infinity",
      fuelWeight: Number.POSITIVE_INFINITY, fuelArm: "abc",
      pilotWeight: 170, pilotArm: 37,
      maxGross: "not-a-number",
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.grossWeight), "grossWeight finite");
    assert.ok(Number.isFinite(r.result.cg), "cg finite");
    assert.ok(Number.isFinite(r.result.totalMoment), "totalMoment finite");
    // Only the valid pilot station survives; poisoned weights fold to 0.
    assert.equal(r.result.grossWeight, 170);
    assert.equal(r.result.maxGrossWeight, null);
    for (const st of r.result.stations) {
      assert.ok(Number.isFinite(st.weight) && Number.isFinite(st.arm) && Number.isFinite(st.moment));
    }
  });
});

describe("aviation.validate-wb (W&B envelope check — flat editor shape)", () => {
  it("flags over-gross as critical / DO NOT FLY", () => {
    const d = wbEditorData();
    d.fuelWeight = 400; d.pilotWeight = 300; d.copilotWeight = 300; d.cargoWeight = 200; d.baggageWeight = 120;
    const r = run("validate-wb", d);
    assert.equal(r.ok, true);
    assert.equal(r.result.withinEnvelope, false);
    assert.equal(r.result.overallSeverity, "critical");
    assert.ok(r.result.issues.some(i => i.kind === "over-gross"));
    assert.match(r.result.message, /DO NOT FLY/);
  });

  it("reports within-limits for a balanced flat-shape load", () => {
    const r = run("validate-wb", wbEditorData());
    assert.equal(r.ok, true);
    assert.equal(r.result.withinEnvelope, true);
    assert.equal(r.result.overallSeverity, "ok");
    assert.ok(Number.isFinite(r.result.grossWeight));
    assert.ok(Number.isFinite(r.result.cg));
  });

  it("FAIL-CLOSED: poisoned numerics keep gross/cg finite", () => {
    const r = run("validate-wb", { emptyWeight: "NaN", maxGross: "Infinity", fuelWeight: 1e9, fuelArm: "x" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.grossWeight));
    assert.ok(Number.isFinite(r.result.cg));
  });
});

describe("aviation.weatherCheck (flat windDirection/windSpeed editor shape)", () => {
  // EXACT shape app/lenses/aviation/page.tsx#renderWeatherEditor persists.
  function wxEditorData() {
    return {
      stationId: "KJFK", windDirection: 270, windSpeed: 15, windGust: 25,
      visibility: 10, ceiling: 25000, wxConditions: "FEW250",
      temperature: 8, dewpoint: -4, altimeter: 30.12,
    };
  }
  it("formats wind from the FLAT fields (not 000/00KT)", () => {
    const r = run("weatherCheck", wxEditorData(), { title: "KJFK" });
    assert.equal(r.ok, true);
    assert.equal(r.result.wind, "27015G25KT");
    assert.deepEqual(r.result.windComponents, { direction: 270, speed: 15, gust: 25 });
    assert.equal(r.result.station, "KJFK");
  });
  it("derives the EXACT flightCategory the page colour-codes", () => {
    const lifr = run("weatherCheck", { windDirection: 0, windSpeed: 0, visibility: 0.5, ceiling: 200 });
    assert.equal(lifr.result.flightCategory, "LIFR");
    const ifr = run("weatherCheck", { windDirection: 0, windSpeed: 0, visibility: 2, ceiling: 800 });
    assert.equal(ifr.result.flightCategory, "IFR");
    const vfr = run("weatherCheck", { windDirection: 0, windSpeed: 0, visibility: 10, ceiling: 25000 });
    assert.equal(vfr.result.flightCategory, "VFR");
  });
  it("still accepts the structured wind:{} shape (back-compat)", () => {
    const r = run("weatherCheck", { wind: { direction: 90, speed: 8, gust: null }, visibility: 6, ceiling: 12000 });
    assert.equal(r.result.windComponents.direction, 90);
    assert.equal(r.result.wind, "09008KT");
  });
  it("FAIL-CLOSED: poisoned visibility/ceiling never crash; category stays a known enum", () => {
    const r = run("weatherCheck", { windDirection: 270, windSpeed: 15, visibility: "NaN", ceiling: "abc" });
    assert.equal(r.ok, true);
    assert.ok(["VFR", "MVFR", "IFR", "LIFR"].includes(r.result.flightCategory));
  });
});

describe("aviation.dutyTimeCheck (FAR 117 limits)", () => {
  it("computes current/7-day/28-day limits with real exceedance flags", () => {
    const now = Date.now();
    const r = run("dutyTimeCheck", {
      shifts: [
        { startTime: new Date(now - 2 * 3600000).toISOString(), dutyHours: 11 },
        { startTime: new Date(now - 3 * 86400000).toISOString(), dutyHours: 9 },
      ],
    }, { title: "Capt. Reyes" });
    assert.equal(r.ok, true);
    assert.equal(r.result.limits.flightDuty.exceeded, true); // 11 > 10
    assert.equal(r.result.compliant, false);
    assert.equal(r.result.crewMember, "Capt. Reyes");
    assert.equal(typeof r.result.limits.sevenDay.actual, "number");
    assert.equal(typeof r.result.limits.twentyEightDay.actual, "number");
  });
  it("reports compliant for a light schedule", () => {
    const r = run("dutyTimeCheck", { shifts: [{ startTime: new Date().toISOString(), dutyHours: 6 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.compliant, true);
    assert.equal(r.result.limits.flightDuty.exceeded, false);
  });
  it("degrades gracefully with no shifts/flights", () => {
    const r = run("dutyTimeCheck", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.compliant, true);
    assert.equal(r.result.totalDutyPeriods, 0);
  });
  it("FAIL-CLOSED: poisoned dutyHours never NaN the totals", () => {
    const r = run("dutyTimeCheck", { shifts: [{ startTime: new Date().toISOString(), dutyHours: "NaN" }] });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.limits.flightDuty.actual));
    assert.ok(Number.isFinite(r.result.limits.sevenDay.actual));
  });
});

describe("aviation.flightSummary", () => {
  it("aggregates totals the page renders (totalHours/averageDuration/…)", () => {
    const r = run("flightSummary", {
      flights: [
        { hobbsTime: 1.4, fuelUsed: 12 },
        { hobbsTime: 2.0, fuelUsed: 17 },
        { hobbsTime: 0.6, fuelUsed: 5 },
      ],
    }, { title: "J. Pilot" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFlights, 3);
    assert.equal(r.result.totalHours, 4);
    assert.equal(r.result.averageDuration, 1.3);
    assert.equal(r.result.longestFlight, 2);
    assert.equal(r.result.shortestFlight, 0.6);
    assert.equal(r.result.totalFuelConsumed, 34);
    // EXACT fields page renders:
    assert.equal(typeof r.result.avgFuelPerHour, "number");
  });
  it("degrades gracefully on no flights", () => {
    const r = run("flightSummary", { flights: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFlights, 0);
    assert.equal(r.result.totalHours, 0);
  });
});

describe("aviation.maintenanceAlert", () => {
  it("flags hours/cycles/date overdue items and sorts critical first", () => {
    const r = run("maintenanceAlert", {
      registration: "N777", totalTime: 1200, totalCycles: 800,
      maintenanceItems: [
        { name: "100hr inspection", dueAtHours: 1100, priority: "normal" },
        { name: "AD compliance", dueDate: "2020-01-01", priority: "critical" },
        { name: "Future item", dueAtHours: 5000, priority: "low" },
      ],
    }, { title: "N777 Skyhawk" });
    assert.equal(r.ok, true);
    assert.equal(r.result.allClear, false);
    assert.equal(r.result.overdueCount, 2);
    assert.equal(r.result.alerts[0].priority, "critical"); // sorted first
    assert.ok(r.result.alerts.every(a => Array.isArray(a.reasons) && a.reasons.length > 0));
  });
  it("reports allClear when nothing is due", () => {
    const r = run("maintenanceAlert", { totalTime: 100, maintenanceItems: [{ name: "x", dueAtHours: 500 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.allClear, true);
    assert.equal(r.result.overdueCount, 0);
  });
  it("FAIL-CLOSED: missing maintenanceItems degrades to empty alert set", () => {
    const r = run("maintenanceAlert", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalItems, 0);
    assert.equal(r.result.allClear, true);
  });
});

describe("aviation.currencyCheck + maintenanceDue + hobbsLog (page-rendered shapes)", () => {
  it("currencyCheck returns checks[] + allCurrent (the EXACT page guard)", () => {
    const future = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
    const r = run("currencyCheck", { medicalExpiry: future, recentLandings: 5, certifications: [] }, { title: "Pilot A" });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.checks));
    assert.equal(typeof r.result.allCurrent, "boolean");
    assert.equal(r.result.crewMember, "Pilot A");
  });
  it("maintenanceDue returns items[] + overdueCount (the EXACT page guard)", () => {
    const r = run("maintenanceDue", { registration: "N1", totalTime: 500, hoursSinceOilChange: 60, oilChangeInterval: 50 }, { title: "N1" });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.items));
    assert.equal(typeof r.result.overdueCount, "number");
    const oil = r.result.items.find(i => i.type === "Oil Change");
    assert.equal(oil.overdue, true);
  });
  it("hobbsLog returns totalTime + picTime (the EXACT page guard)", () => {
    const r = run("hobbsLog", { flights: [{ hobbsTime: 1.5, isPIC: true, nightTime: 0.2 }] }, { title: "Pilot B" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalTime, 1.5);
    assert.equal(r.result.picTime, 1.5);
    assert.equal(r.result.nightTime, 0.2);
  });
});
