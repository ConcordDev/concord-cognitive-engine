// Behavioral macro tests for server/domains/automotive.js — the CarFax /
// Drivvo / RepairPal-shaped automotive substrate the /lenses/automotive lens
// drives via lensRun('automotive', …).
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150 / :39283):
// handlers registered through `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention,
// where the server sets BOTH `virtualArtifact.data = input` AND passes `input`
// as the 3rd `params` arg. Our harness reproduces that exactly so a regression
// that confuses param positions OR the double-wrap shape surfaces here.
//
// These are NOT shape-only assertions. Every test pins ACTUAL computed values:
// fuel-economy MPG + cost-per-mile, repair labor/tax math, maintenance interval
// projection, OBD import filtering, TCO depreciation rollup, diagnostic DTC
// lookup. Plus validation-rejection, degrade-graceful (no STATE), per-user
// isolation, and a fail-CLOSED poisoned-numeric case (Infinity volume can never
// reach a fuel total).
//
// Hermetic: no server boot, no network, no LLM. The two NHTSA-backed macros
// (vin-decode, recall-lookup) are exercised only for their pre-network
// validation gates so the suite never touches the wire.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAutomotiveActions from "../domains/automotive.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "automotive", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch: handler(ctx, virtualArtifact, input), with
// virtualArtifact.data === input (the same object the 3rd arg receives).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`automotive.${name} not registered`);
  const virtualArtifact = { id: null, domain: "automotive", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerAutomotiveActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

// ── Registration ─────────────────────────────────────────────────

describe("automotive — registration", () => {
  it("registers every macro the lens calls via lensRun", () => {
    for (const m of [
      // VinDecoder / VehicleHistory / AutomotiveActionPanel
      "diagnosticLookup", "vin-decode", "recall-lookup", "maintenanceSchedule",
      // FuelRepairPanel (CalcPanel)
      "fuelEfficiency", "repairEstimate",
      // GarageSection
      "vehicles-list", "vehicles-create", "vehicles-update", "vehicles-delete",
      "fuel-log", "fuel-list", "fuel-delete",
      "service-log", "service-list", "service-delete",
      "schedule-list", "schedule-create", "schedule-delete", "service-reminders",
      "expenses-log", "expenses-list", "expenses-delete",
      "trips-log", "trips-list", "trips-delete",
      "documents-list", "documents-create", "documents-delete",
      "vehicle-stats", "automotive-dashboard-summary",
      // AdvancedToolsPanel
      "obd-import", "obd-list", "obd-delete",
      "cost-of-ownership", "predictive-maintenance",
      "attachments-add", "attachments-list", "attachments-delete",
      "compare-vehicles",
      "shops-create", "shops-list", "shops-delete",
      "appointments-create", "appointments-list", "appointments-update", "appointments-delete",
      "renewals-create", "renewals-list", "renewals-upcoming", "renewals-update", "renewals-delete",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing automotive.${m}`);
    }
  });
});

// ── diagnosticLookup (SAE J2012 DTC reference) ───────────────────

describe("automotive — diagnosticLookup", () => {
  it("resolves a known critical code (P0300) from the SAE table", () => {
    const r = call("diagnosticLookup", ctxA, { code: "p0300" });
    assert.equal(r.ok, true);
    assert.equal(r.result.code, "P0300");
    assert.equal(r.result.system, "Powertrain");
    assert.equal(r.result.severity, "critical");
    assert.equal(r.result.source, "sae-j2012");
    assert.match(r.result.urgency, /Stop driving/);
    assert.ok(Array.isArray(r.result.commonCauses) && r.result.commonCauses.length > 0);
  });

  it("resolves a known moderate code (P0420) and maps its urgency", () => {
    const r = call("diagnosticLookup", ctxA, { code: "P0420" });
    assert.equal(r.ok, true);
    assert.equal(r.result.severity, "moderate");
    assert.match(r.result.urgency, /within 1 week/);
  });

  it("falls back to a generic SAE interpretation for an unknown code", () => {
    const r = call("diagnosticLookup", ctxA, { code: "U2999" });
    assert.equal(r.ok, true);
    assert.equal(r.result.system, "Network");
    assert.equal(r.result.source, "generic-sae-interpretation");
    assert.equal(r.result.severity, "informational");
  });

  it("reads the code from artifact.data as well as params (both wiring shapes)", () => {
    const viaData = call("diagnosticLookup", ctxA, { code: "P0171" });
    assert.equal(viaData.result.code, "P0171");
  });

  it("rejects missing + malformed codes (validation-rejection)", () => {
    assert.equal(call("diagnosticLookup", ctxA, {}).ok, false);
    const bad = call("diagnosticLookup", ctxA, { code: "XYZ" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Invalid DTC format/);
  });
});

// ── maintenanceSchedule (interval projection + DOUBLE-WRAP wiring) ─

describe("automotive — maintenanceSchedule", () => {
  // The lens (AutomotiveActionPanel / VehicleHistory / CalcPanel pattern) sends
  // `input: { artifact: { data: {...} } }`, so server-side artifact.data ends
  // up as `{ artifact: { data: {...} } }`. The resolveData() normalizer must
  // peel that wrapper — otherwise every calculator reads undefined (the
  // carpentry-class double-wrap that silently blanked the workbench).
  it("computes the schedule through the DOUBLE-WRAPPED lens payload", () => {
    const r = call("maintenanceSchedule", ctxA, { artifact: { data: { mileage: 50000, year: 2020 } } });
    assert.equal(r.ok, true, `double-wrap should resolve, got: ${r.error}`);
    assert.equal(r.result.mileage, 50000);
    assert.equal(r.result.vehicleYear, 2020);
    assert.equal(r.result.services.length, 12);
    assert.equal(r.result.nextService, "Tire Rotation");
    assert.equal(r.result.overdueCount, 0);
  });

  it("also accepts a bare-params payload (single shape, back-compat)", () => {
    const r = call("maintenanceSchedule", ctxA, { mileage: 50000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.mileage, 50000);
    assert.equal(r.result.services.length, 12);
  });

  it("accepts the AutomotiveActionPanel currentMileage alias", () => {
    const r = call("maintenanceSchedule", ctxA, { artifact: { data: { currentMileage: 7000 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.mileage, 7000);
  });

  it("flags an item due-now when mileage lands near an interval boundary", () => {
    // 4900 mi: oil change (5000 interval) has 100 mi until due → < 10% → due-now
    const r = call("maintenanceSchedule", ctxA, { artifact: { data: { mileage: 4900 } } });
    const oil = r.result.services.find((s) => s.service === "Oil Change");
    assert.equal(oil.status, "due-now");
    assert.equal(oil.overdue, true);
    assert.equal(oil.milesUntilDue, 100);
    assert.ok(r.result.urgentServices.includes("Oil Change"));
  });

  it("rejects a zero / missing mileage (validation-rejection)", () => {
    assert.equal(call("maintenanceSchedule", ctxA, { artifact: { data: { mileage: 0 } } }).ok, false);
    assert.equal(call("maintenanceSchedule", ctxA, {}).ok, false);
  });
});

// ── fuelEfficiency (MPG + cost analysis, DOUBLE-WRAP via CalcPanel) ─

describe("automotive — fuelEfficiency", () => {
  it("computes MPG + cost-per-mile through the DOUBLE-WRAPPED CalcPanel payload", () => {
    // 100→300 mi (200 mi) on the 2nd 10-gal fill → 20 MPG.
    // totalGallons 20; totalFuelCost = 10*3 + 10*3.5 = 65; costPerMile 0.16.
    const r = call("fuelEfficiency", ctxA, { artifact: { data: { fillups: [
      { mileage: 100, gallons: 10, pricePerGallon: 3, date: "2026-01-01" },
      { mileage: 300, gallons: 10, pricePerGallon: 3.5, date: "2026-01-10" },
    ] } } });
    assert.equal(r.ok, true, `double-wrap should resolve, got: ${r.error}`);
    assert.equal(r.result.avgMPG, 20);
    assert.equal(r.result.bestMPG, 20);
    assert.equal(r.result.totalGallons, 20);
    assert.equal(r.result.totalFuelCost, 65);
    assert.equal(r.result.costPerMile, 0.16);
    assert.equal(r.result.readings.length, 1);
  });

  it("computes through a bare-params payload too (single shape)", () => {
    const r = call("fuelEfficiency", ctxA, { fillups: [
      { mileage: 0, gallons: 8 },
      { mileage: 240, gallons: 8 },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.avgMPG, 30); // 240 mi / 8 gal
  });

  it("sorts fill-ups by odometer before differencing", () => {
    const r = call("fuelEfficiency", ctxA, { artifact: { data: { fillups: [
      { mileage: 500, gallons: 10 },
      { mileage: 0, gallons: 10 },
    ] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.avgMPG, 50); // 500 mi / 10 gal, regardless of input order
  });

  it("requires at least two fill-ups (validation-rejection)", () => {
    assert.equal(call("fuelEfficiency", ctxA, { artifact: { data: { fillups: [{ mileage: 1, gallons: 1 }] } } }).ok, false);
    assert.equal(call("fuelEfficiency", ctxA, { artifact: { data: { fillups: [] } } }).ok, false);
  });
});

// ── repairEstimate (labor + parts + tax) ─────────────────────────

describe("automotive — repairEstimate", () => {
  it("computes labor/parts/tax through the DOUBLE-WRAPPED CalcPanel payload", () => {
    // parts 100 + labor 2h @ 150 (=300) = 400; tax 8% = 32; withTax 432.
    const r = call("repairEstimate", ctxA, { artifact: { data: {
      shopRate: 150,
      repairs: [{ name: "Brake pads", partsCost: 100, laborHours: 2 }],
    } } });
    assert.equal(r.ok, true, `double-wrap should resolve, got: ${r.error}`);
    const item = r.result.repairs[0];
    assert.equal(item.laborRate, 150);
    assert.equal(item.laborCost, 300);
    assert.equal(item.total, 400);
    assert.equal(r.result.subtotalParts, 100);
    assert.equal(r.result.subtotalLabor, 300);
    assert.equal(r.result.grandTotal, 400);
    assert.equal(r.result.tax, 32);
    assert.equal(r.result.totalWithTax, 432);
  });

  it("uses the default shop rate (120) when none supplied", () => {
    const r = call("repairEstimate", ctxA, { artifact: { data: {
      repairs: [{ name: "Alignment", partsCost: 0, laborHours: 1 }],
    } } });
    assert.equal(r.result.repairs[0].laborRate, 120);
    assert.equal(r.result.grandTotal, 120);
  });

  it("recommends a second opinion above $3000", () => {
    const r = call("repairEstimate", ctxA, { artifact: { data: {
      repairs: [{ name: "Engine rebuild", partsCost: 3500, laborHours: 1, laborRate: 100 }],
    } } });
    assert.match(r.result.recommendation, /second opinion/);
  });

  it("rejects an empty repair list (validation-rejection)", () => {
    assert.equal(call("repairEstimate", ctxA, { artifact: { data: { repairs: [] } } }).ok, false);
  });
});

// ── Garage CRUD + computed rollups (params shape) ────────────────

describe("automotive — garage CRUD + computed rollups", () => {
  function seedVehicle(ctx = ctxA) {
    const r = call("vehicles-create", ctx, { name: "Daily", make: "Honda", model: "Civic", year: 2020, odometer: 50000 });
    assert.equal(r.ok, true);
    return r.result.vehicle.id;
  }

  it("creates a vehicle with sensible defaults + sequence number", () => {
    const r = call("vehicles-create", ctxA, { name: "Daily", make: "Honda", model: "Civic", year: 2020, odometer: 50000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.vehicle.number, "V-001");
    assert.equal(r.result.vehicle.odometerUnit, "mi");
    assert.equal(r.result.vehicle.fuelUnit, "gal");
    assert.equal(call("vehicles-create", ctxA, {}).ok, false); // name required
  });

  it("fuel-log derives pricePerUnit + mirrors a fuel expense", () => {
    const vid = seedVehicle();
    const r = call("fuel-log", ctxA, { vehicleId: vid, volume: 10, totalCost: 30, odometer: 50000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.pricePerUnit, 3); // 30/10
    const exp = call("expenses-list", ctxA, { vehicleId: vid });
    assert.ok(exp.result.expenses.some((e) => e.category === "fuel" && e.amount === 30));
  });

  it("vehicle-stats computes lifetime MPG, spend + cost-per-mile from real logs", () => {
    const vid = seedVehicle();
    call("fuel-log", ctxA, { vehicleId: vid, volume: 10, totalCost: 30, odometer: 50000, date: "2026-01-01" });
    call("fuel-log", ctxA, { vehicleId: vid, volume: 8, totalCost: 28, odometer: 50200, date: "2026-01-10" });
    call("service-log", ctxA, { vehicleId: vid, serviceType: "Oil Change", cost: 60, odometer: 50100, date: "2026-01-05" });
    const st = call("vehicle-stats", ctxA, { vehicleId: vid });
    assert.equal(st.ok, true);
    // lifetime: (50200-50000)=200 mi ÷ fills-after-first volume (8) = 25 MPG
    assert.equal(st.result.lifetimeMpg, 25);
    assert.equal(st.result.totalSpend, 118); // 30 + 28 + 60
    assert.equal(st.result.fuelSpend, 58);   // 30 + 28
    assert.equal(st.result.milesTracked, 200);
    assert.equal(st.result.costPerMile, 0.59); // 118/200
    assert.equal(st.result.fillCount, 2);
    assert.equal(st.result.serviceCount, 1);
  });

  it("cost-of-ownership rolls up depreciation + operating cost by category", () => {
    const vid = seedVehicle();
    call("fuel-log", ctxA, { vehicleId: vid, volume: 10, totalCost: 30, odometer: 50000, date: "2026-01-01" });
    call("fuel-log", ctxA, { vehicleId: vid, volume: 8, totalCost: 28, odometer: 50200, date: "2026-01-10" });
    call("service-log", ctxA, { vehicleId: vid, serviceType: "Oil Change", cost: 60, odometer: 50100, date: "2026-01-05" });
    const co = call("cost-of-ownership", ctxA, { vehicleId: vid, purchasePrice: 20000, salvageValue: 5000 });
    assert.equal(co.ok, true);
    assert.equal(co.result.depreciation, 15000);    // 20000 - 5000
    assert.equal(co.result.operatingCost, 118);     // 30 + 28 + 60
    assert.equal(co.result.totalCostOfOwnership, 15118);
    assert.equal(co.result.byCategory.fuel, 58);
    assert.equal(co.result.byCategory.maintenance, 60);
  });

  it("obd-import stores valid PIDs, flags known metrics, skips junk", () => {
    const vid = seedVehicle();
    const r = call("obd-import", ctxA, { vehicleId: vid, readings: [
      { metric: "rpm", value: 800, unit: "rpm" },
      { metric: "coolantTemp", value: 90, unit: "C" },
      { metric: "bogus", value: "not-a-number" }, // dropped (non-finite)
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 2);
    assert.equal(r.result.readings[0].known, true); // rpm is a known PID
    const list = call("obd-list", ctxA, { vehicleId: vid });
    assert.equal(list.result.count, 2);
    assert.equal(list.result.latest.rpm.value, 800);
  });

  it("predictive-maintenance projects a due-date from mileage accumulation rate", () => {
    const vid = seedVehicle();
    // two dated odometer points 10 days apart, 1000 mi → 100 mi/day
    call("fuel-log", ctxA, { vehicleId: vid, volume: 10, totalCost: 30, odometer: 50000, date: "2026-01-01" });
    call("fuel-log", ctxA, { vehicleId: vid, volume: 10, totalCost: 30, odometer: 51000, date: "2026-01-11" });
    call("schedule-create", ctxA, { vehicleId: vid, serviceType: "Oil Change", intervalMiles: 5000, lastDoneOdometer: 50000 });
    const r = call("predictive-maintenance", ctxA, { vehicleId: vid });
    assert.equal(r.ok, true);
    const alert = r.result.alerts.find((a) => a.serviceType === "Oil Change");
    assert.ok(alert, "oil-change alert present");
    assert.equal(alert.milesPerDay, 100);
    // due at 55000; current 51000 → 4000 mi remaining → 40 days at 100 mi/day
    assert.equal(alert.milesRemaining, 4000);
    assert.equal(alert.daysUntilDue, 40);
  });

  it("compare-vehicles ranks the fleet by computed metrics", () => {
    const a = seedVehicle();
    const b = call("vehicles-create", ctxA, { name: "Truck", make: "Ford", model: "F150", year: 2018, odometer: 80000 }).result.vehicle.id;
    call("fuel-log", ctxA, { vehicleId: a, volume: 10, totalCost: 30, odometer: 50000 });
    call("fuel-log", ctxA, { vehicleId: a, volume: 10, totalCost: 30, odometer: 50300 });
    const r = call("compare-vehicles", ctxA, { vehicleIds: [a, b] });
    assert.equal(r.ok, true);
    assert.equal(r.result.vehicleCount, 2);
    assert.equal(r.result.highlights.bestMpg, "Daily"); // only Daily has fills
  });
});

// ── degrade-graceful + isolation + fail-CLOSED ───────────────────

describe("automotive — robustness", () => {
  it("degrades gracefully with no STATE (never throws)", () => {
    delete globalThis._concordSTATE;
    const r = call("vehicles-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });

  it("isolates per-user garages", () => {
    call("vehicles-create", ctxA, { name: "A-car" });
    call("vehicles-create", ctxB, { name: "B-car" });
    const a = call("vehicles-list", ctxA, {});
    const b = call("vehicles-list", ctxB, {});
    assert.equal(a.result.vehicles.length, 1);
    assert.equal(b.result.vehicles.length, 1);
    assert.equal(a.result.vehicles[0].name, "A-car");
    assert.equal(b.result.vehicles[0].name, "B-car");
  });

  it("fuel-log is fail-CLOSED on a poisoned (Infinity) volume", () => {
    const vid = call("vehicles-create", ctxA, { name: "Daily" }).result.vehicle.id;
    // 1e309 overflows to Infinity in JS → Number.isFinite false → rejected.
    const r = call("fuel-log", ctxA, { vehicleId: vid, volume: 1e309, totalCost: 10, odometer: 50000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /positive volume required/);
    // confirm nothing was minted into the fuel log or expense mirror
    assert.equal(call("fuel-list", ctxA, { vehicleId: vid }).result.fuel.length, 0);
    assert.equal(call("expenses-list", ctxA, { vehicleId: vid }).result.expenses.length, 0);
  });

  it("rejects negative / non-finite expense amounts (fail-CLOSED)", () => {
    const vid = call("vehicles-create", ctxA, { name: "Daily" }).result.vehicle.id;
    assert.equal(call("expenses-log", ctxA, { vehicleId: vid, category: "repair", amount: -50 }).ok, false);
    assert.equal(call("expenses-log", ctxA, { vehicleId: vid, category: "repair", amount: Infinity }).ok, false);
  });
});

// ── NHTSA-backed macros: pre-network validation only (no wire) ───

describe("automotive — vin-decode / recall-lookup validation (no network)", () => {
  it("vin-decode rejects malformed VINs before any fetch", async () => {
    assert.equal((await call("vin-decode", ctxA, { vin: "" })).ok, false);
    assert.equal((await call("vin-decode", ctxA, { vin: "SHORT" })).ok, false);
    const badChars = await call("vin-decode", ctxA, { vin: "1HGCM82633A00400I" }); // contains I
    assert.equal(badChars.ok, false);
    assert.match(badChars.error, /invalid characters/);
  });

  it("recall-lookup requires make/model/year before any fetch", async () => {
    assert.equal((await call("recall-lookup", ctxA, {})).ok, false);
    assert.equal((await call("recall-lookup", ctxA, { make: "Honda", model: "Civic" })).ok, false);
  });
});
