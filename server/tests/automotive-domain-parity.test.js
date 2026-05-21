// Contract tests for server/domains/automotive.js.
// Covers the SAE J2012 DTC database lookup, NHTSA vPIC VIN decoder,
// NHTSA recall lookup, and the pure-compute macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAutomotiveActions from "../domains/automotive.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`automotive.${name}`);
  if (!fn) throw new Error(`automotive.${name} not registered`);
  // Some macros read from artifact.data, others from params — accept both.
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerAutomotiveActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("automotive.diagnosticLookup (SAE J2012 DTC reference)", () => {
  it("rejects empty code", () => {
    const r = call("diagnosticLookup", ctxA, { data: {} }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /DTC code required/);
  });

  it("rejects malformed code", () => {
    const r = call("diagnosticLookup", ctxA, { data: { code: "XYZ123" } }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /Invalid DTC format/);
  });

  it("returns rich detail for codes in the database (P0300 — misfire)", () => {
    const r = call("diagnosticLookup", ctxA, { data: { code: "P0300" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.code, "P0300");
    assert.equal(r.result.system, "Powertrain");
    assert.equal(r.result.severity, "critical");
    assert.match(r.result.description, /Misfire/);
    assert.ok(r.result.commonCauses.length >= 3);
    assert.equal(r.result.source, "sae-j2012");
    assert.equal(r.result.urgency, "Stop driving — repair immediately");
  });

  it("returns rich detail for codes in the database (P0420 — catalyst)", () => {
    const r = call("diagnosticLookup", ctxA, { data: { code: "P0420" } }, {});
    assert.equal(r.ok, true);
    assert.match(r.result.description, /Catalyst/);
    assert.equal(r.result.severity, "moderate");
  });

  it("returns rich detail for B-codes, C-codes, U-codes", () => {
    const b = call("diagnosticLookup", ctxA, { data: { code: "B0001" } }, {});
    assert.equal(b.result.system, "Body");
    const c = call("diagnosticLookup", ctxA, { data: { code: "C0035" } }, {});
    assert.equal(c.result.system, "Chassis");
    const u = call("diagnosticLookup", ctxA, { data: { code: "U0100" } }, {});
    assert.equal(u.result.system, "Network");
  });

  it("falls back to generic SAE interpretation for unknown codes", () => {
    const r = call("diagnosticLookup", ctxA, { data: { code: "P9999" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.code, "P9999");
    assert.equal(r.result.system, "Powertrain");
    assert.equal(r.result.source, "generic-sae-interpretation");
    assert.deepEqual(r.result.commonCauses, []);
  });

  it("database covers all common P03xx misfire codes (cylinders 1-8)", () => {
    for (const code of ["P0301", "P0302", "P0303", "P0304", "P0305", "P0306", "P0307", "P0308"]) {
      const r = call("diagnosticLookup", ctxA, { data: { code } }, {});
      assert.equal(r.result.source, "sae-j2012", `${code} should be in db`);
      assert.equal(r.result.severity, "critical");
    }
  });
});

describe("automotive.vin-decode (NHTSA vPIC)", () => {
  it("rejects missing vin", async () => {
    const r = await call("vin-decode", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /vin required/);
  });

  it("rejects wrong-length vin", async () => {
    const r = await call("vin-decode", ctxA, { vin: "1234567890" });
    assert.equal(r.ok, false);
    assert.match(r.error, /17 characters/);
  });

  it("rejects vin with forbidden characters (I, O, Q)", async () => {
    const r = await call("vin-decode", ctxA, { vin: "1HGCMI8243A123456" });  // contains I
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid characters/);
  });

  it("hits NHTSA vPIC and parses real response shape", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          Results: [{
            Make: "HONDA", Model: "Civic", ModelYear: "2023",
            Trim: "Sport", BodyClass: "Sedan/Saloon",
            DriveType: "FWD", EngineCylinders: "4",
            DisplacementL: "2.0", FuelTypePrimary: "Gasoline",
            TransmissionStyle: "Continuously Variable Transmission (CVT)",
            Manufacturer: "AMERICAN HONDA MOTOR CO., INC.",
            PlantCountry: "UNITED STATES (USA)", PlantCity: "GREENSBURG",
            VehicleType: "PASSENGER CAR", Series: "Sport",
            Doors: "4", ABS: "Standard",
            BackupCamera: "Standard",
          }],
        }),
      };
    };
    const r = await call("vin-decode", ctxA, { vin: "1HGCM82633A123456" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /vpic\.nhtsa\.dot\.gov\/api\/vehicles\/DecodeVinValues/);
    assert.equal(r.result.make, "HONDA");
    assert.equal(r.result.model, "Civic");
    assert.equal(r.result.year, "2023");
    assert.equal(r.result.source, "nhtsa-vpic");
  });

  it("surfaces NHTSA network errors verbatim", async () => {
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
    const r = await call("vin-decode", ctxA, { vin: "1HGCM82633A123456" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable.*ECONNREFUSED/);
  });
});

describe("automotive.recall-lookup (NHTSA Recalls)", () => {
  it("rejects missing make/model/year", async () => {
    assert.equal((await call("recall-lookup", ctxA, {})).ok, false);
    assert.equal((await call("recall-lookup", ctxA, { make: "Honda" })).ok, false);
    assert.equal((await call("recall-lookup", ctxA, { make: "Honda", model: "Civic" })).ok, false);
  });

  it("hits NHTSA recalls + shapes the response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          results: [{
            NHTSACampaignNumber: "23V123000",
            Component: "FUEL SYSTEM, GASOLINE",
            Summary: "Fuel pump may fail",
            Consequence: "Engine stall",
            Remedy: "Dealer replaces fuel pump free",
            Notes: "Owner notification began 5/1/2023",
            Manufacturer: "Honda",
            ReportReceivedDate: "01/15/2023",
          }],
        }),
      };
    };
    const r = await call("recall-lookup", ctxA, { make: "Honda", model: "Civic", year: 2023 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.nhtsa\.gov\/recalls\/recallsByVehicle/);
    assert.match(capturedUrl, /make=Honda/);
    assert.equal(r.result.recalls.length, 1);
    assert.equal(r.result.recalls[0].nhtsaId, "23V123000");
    assert.equal(r.result.source, "nhtsa-recalls");
  });

  it("returns empty array when no recalls + ok:true (not an error)", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
    const r = await call("recall-lookup", ctxA, { make: "Honda", model: "Civic", year: 2030 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });
});

describe("automotive.maintenanceSchedule", () => {
  it("rejects missing mileage", () => {
    const r = call("maintenanceSchedule", ctxA, { data: {} }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /mileage required/);
  });

  it("computes upcoming services from mileage", () => {
    const r = call("maintenanceSchedule", ctxA, { data: { mileage: 47500 } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.services.length >= 9);
    assert.ok(r.result.services[0].milesUntilDue >= 0);
    // Sorted by miles-until-due ascending
    for (let i = 1; i < r.result.services.length; i++) {
      assert.ok(r.result.services[i].milesUntilDue >= r.result.services[i - 1].milesUntilDue);
    }
  });

  it("flags overdue items with status='due-now'", () => {
    // 5000-mile interval, 4900 miles → 100 until due, threshold is 500
    // Use mileage 49900 → 100 until 50k oil change
    const r = call("maintenanceSchedule", ctxA, { data: { mileage: 49900 } }, {});
    const oilChange = r.result.services.find((s) => s.service === "Oil Change");
    assert.equal(oilChange.status, "due-now");
    assert.equal(oilChange.overdue, true);
  });
});

describe("automotive.fuelEfficiency", () => {
  it("rejects fewer than 2 fillups", () => {
    const r = call("fuelEfficiency", ctxA, { data: { fillups: [{ mileage: 100, gallons: 10 }] } }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2/);
  });

  it("computes avg/best/worst MPG from real fill-up sequence", () => {
    const fillups = [
      { mileage: 10000, gallons: 0, pricePerGallon: 3.5 },
      { mileage: 10300, gallons: 10, pricePerGallon: 3.5 },  // 30 mpg
      { mileage: 10600, gallons: 10, pricePerGallon: 3.6 },  // 30 mpg
      { mileage: 10825, gallons: 10, pricePerGallon: 3.7 },  // 22.5 mpg
    ];
    const r = call("fuelEfficiency", ctxA, { data: { fillups } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.bestMPG, 30);
    assert.equal(r.result.worstMPG, 22.5);
    assert.ok(r.result.avgMPG > 25 && r.result.avgMPG < 30);
  });
});

describe("automotive.repairEstimate", () => {
  it("rejects empty repairs", () => {
    const r = call("repairEstimate", ctxA, { data: { repairs: [] } }, {});
    assert.equal(r.ok, false);
  });

  it("computes labor + parts + tax", () => {
    const r = call("repairEstimate", ctxA, {
      data: {
        shopRate: 100,
        repairs: [
          { name: "Brake pads", partsCost: 80, laborHours: 1.5 },
          { name: "Rotors", partsCost: 200, laborHours: 2 },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    // Brake pads: 80 + 150 = 230. Rotors: 200 + 200 = 400. Total 630.
    assert.equal(r.result.grandTotal, 630);
    // 8% tax = 50.4
    assert.equal(r.result.tax, 50.4);
    assert.equal(r.result.totalWithTax, 680.4);
  });
});

// ═════════════════════════════════════════════════════════════════
//  Drivvo + Fuelly + CARFAX Car Care 2026 parity — garage, fuel +
//  MPG, service log + schedule + reminders, expenses, trips, docs.
// ═════════════════════════════════════════════════════════════════

const ctxAu = { actor: { userId: "auto_u" }, userId: "auto_u" };

describe("automotive — 2026 parity macros", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  it("vehicles-create + list + delete cascades records", () => {
    const v = call("vehicles-create", ctxAu, { name: "Daily", make: "Toyota", model: "Corolla", year: 2022, odometer: 30000 });
    assert.equal(v.ok, true);
    assert.match(v.result.vehicle.number, /^V-\d{3}$/);
    assert.equal(call("vehicles-list", ctxAu).result.vehicles.length, 1);
    call("fuel-log", ctxAu, { vehicleId: v.result.vehicle.id, volume: 10, totalCost: 40, odometer: 30100 });
    call("vehicles-delete", ctxAu, { id: v.result.vehicle.id });
    assert.equal(call("vehicles-list", ctxAu).result.vehicles.length, 0);
    assert.equal(call("fuel-list", ctxAu).result.fuel.length, 0);
  });

  it("fuel-log computes MPG against the previous full-tank fill", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car", odometer: 1000 }).result.vehicle;
    call("fuel-log", ctxAu, { vehicleId: v.id, volume: 10, totalCost: 35, odometer: 1000 });
    call("fuel-log", ctxAu, { vehicleId: v.id, volume: 10, totalCost: 36, odometer: 1300 });
    const list = call("fuel-list", ctxAu, { vehicleId: v.id }).result.fuel;
    // newest first; the 1300-odo fill should show 300 mi / 10 gal = 30 mpg
    const second = list.find(f => f.odometer === 1300);
    assert.equal(second.mpg, 30);
  });

  it("fuel-log mirrors an expense and bumps odometer", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car", odometer: 500 }).result.vehicle;
    call("fuel-log", ctxAu, { vehicleId: v.id, volume: 12, totalCost: 48, odometer: 900 });
    const exp = call("expenses-list", ctxAu, { vehicleId: v.id }).result;
    assert.equal(exp.byCategory.fuel, 48);
    assert.equal(call("vehicles-list", ctxAu).result.vehicles[0].odometer, 900);
  });

  it("fuel-log rejects non-positive volume", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car" }).result.vehicle;
    assert.equal(call("fuel-log", ctxAu, { vehicleId: v.id, volume: 0, totalCost: 10, odometer: 1 }).ok, false);
  });

  it("service-log records + mirrors a maintenance expense", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car", odometer: 5000 }).result.vehicle;
    call("service-log", ctxAu, { vehicleId: v.id, serviceType: "Oil change", cost: 65, odometer: 5000 });
    assert.equal(call("service-list", ctxAu, { vehicleId: v.id }).result.service.length, 1);
    assert.equal(call("expenses-list", ctxAu, { vehicleId: v.id }).result.byCategory.maintenance, 65);
  });

  it("service-reminders flags overdue + due-soon by mileage", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car", odometer: 12000 }).result.vehicle;
    // oil change every 5000 mi, last done at 6000 → due at 11000 → overdue (12000 > 11000)
    call("schedule-create", ctxAu, { vehicleId: v.id, serviceType: "Oil change", intervalMiles: 5000, lastDoneOdometer: 6000 });
    // tire rotation every 7500, last at 10000 → due at 17500, 5500 remaining → ok
    call("schedule-create", ctxAu, { vehicleId: v.id, serviceType: "Tire rotation", intervalMiles: 7500, lastDoneOdometer: 10000 });
    // brake check every 1000, last at 11200 → due at 12200, 200 remaining → due_soon
    call("schedule-create", ctxAu, { vehicleId: v.id, serviceType: "Brake check", intervalMiles: 1000, lastDoneOdometer: 11200 });
    const r = call("service-reminders", ctxAu, { vehicleId: v.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.overdueCount, 1);
    assert.equal(r.result.dueSoonCount, 1);
    assert.equal(r.result.reminders[0].status, "overdue");
  });

  it("expenses-list aggregates by category", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car" }).result.vehicle;
    call("expenses-log", ctxAu, { vehicleId: v.id, category: "insurance", amount: 1200 });
    call("expenses-log", ctxAu, { vehicleId: v.id, category: "repair", amount: 300 });
    call("expenses-log", ctxAu, { vehicleId: v.id, category: "repair", amount: 150 });
    const r = call("expenses-list", ctxAu, { vehicleId: v.id });
    assert.equal(r.result.total, 1650);
    assert.equal(r.result.byCategory.repair, 450);
  });

  it("trips-log tracks business vs total miles", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car" }).result.vehicle;
    call("trips-log", ctxAu, { vehicleId: v.id, distance: 40, purpose: "business" });
    call("trips-log", ctxAu, { vehicleId: v.id, distance: 15, purpose: "personal" });
    const r = call("trips-list", ctxAu, { vehicleId: v.id });
    assert.equal(r.result.totalMiles, 55);
    assert.equal(r.result.businessMiles, 40);
  });

  it("documents flag expired + expiring-soon", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car" }).result.vehicle;
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    call("documents-create", ctxAu, { vehicleId: v.id, kind: "registration", expiryDate: past });
    call("documents-create", ctxAu, { vehicleId: v.id, kind: "insurance", expiryDate: soon });
    const docs = call("documents-list", ctxAu, { vehicleId: v.id }).result.documents;
    assert.equal(docs.find(d => d.kind === "registration").expired, true);
    assert.equal(docs.find(d => d.kind === "insurance").expiringSoon, true);
  });

  it("vehicle-stats computes lifetime MPG + cost per mile", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car", odometer: 0 }).result.vehicle;
    call("fuel-log", ctxAu, { vehicleId: v.id, volume: 10, totalCost: 40, odometer: 0 });
    call("fuel-log", ctxAu, { vehicleId: v.id, volume: 10, totalCost: 40, odometer: 300 });
    call("fuel-log", ctxAu, { vehicleId: v.id, volume: 10, totalCost: 40, odometer: 600 });
    const r = call("vehicle-stats", ctxAu, { vehicleId: v.id });
    assert.equal(r.ok, true);
    // 600 mi total / 20 gal (fills after the first) = 30 mpg
    assert.equal(r.result.lifetimeMpg, 30);
    assert.ok(r.result.costPerMile > 0);
  });

  it("automotive-dashboard-summary rolls up vehicles + reminders", () => {
    const v = call("vehicles-create", ctxAu, { name: "Car", odometer: 20000 }).result.vehicle;
    call("schedule-create", ctxAu, { vehicleId: v.id, serviceType: "Oil change", intervalMiles: 5000, lastDoneOdometer: 10000 });
    call("expenses-log", ctxAu, { vehicleId: v.id, category: "repair", amount: 500 });
    const r = call("automotive-dashboard-summary", ctxAu);
    assert.equal(r.ok, true);
    assert.equal(r.result.vehicleCount, 1);
    assert.equal(r.result.overdueServices, 1);
    assert.equal(r.result.spend12moUsd, 500);
  });
});

// ═════════════════════════════════════════════════════════════════
//  CARFAX Car Care 2026 backlog — OBD telemetry, TCO rollups,
//  predictive maintenance, photo attachments, multi-vehicle
//  comparison, shop locator + appointments, warranty/insurance.
// ═════════════════════════════════════════════════════════════════

const ctxX = { actor: { userId: "auto_x" }, userId: "auto_x" };

describe("automotive — backlog parity macros", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  it("obd-import stores only valid PID readings + obd-list snapshots latest", () => {
    const v = call("vehicles-create", ctxX, { name: "EV", odometer: 1000 }).result.vehicle;
    const imp = call("obd-import", ctxX, {
      vehicleId: v.id,
      dongle: "ELM327",
      readings: [
        { metric: "rpm", value: 820, unit: "rpm" },
        { metric: "coolantTemp", value: 88, unit: "C" },
        { metric: "bad", value: "NaN" },       // dropped
      ],
    });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.imported, 2);
    const list = call("obd-list", ctxX, { vehicleId: v.id });
    assert.equal(list.result.count, 2);
    assert.equal(list.result.latest.rpm.value, 820);
    assert.equal(list.result.latest.coolantTemp.value, 88);
  });

  it("obd-import rejects unknown vehicle + empty readings", () => {
    assert.equal(call("obd-import", ctxX, { vehicleId: "nope", readings: [{ metric: "rpm", value: 1 }] }).ok, false);
    const v = call("vehicles-create", ctxX, { name: "Car" }).result.vehicle;
    assert.equal(call("obd-import", ctxX, { vehicleId: v.id, readings: [] }).ok, false);
  });

  it("cost-of-ownership rolls expenses + depreciation into cost per mile", () => {
    const v = call("vehicles-create", ctxX, { name: "Daily", odometer: 0 }).result.vehicle;
    call("fuel-log", ctxX, { vehicleId: v.id, volume: 10, totalCost: 40, odometer: 0 });
    call("fuel-log", ctxX, { vehicleId: v.id, volume: 10, totalCost: 40, odometer: 1000 });
    call("service-log", ctxX, { vehicleId: v.id, serviceType: "Oil change", cost: 60, odometer: 1000 });
    const r = call("cost-of-ownership", ctxX, { vehicleId: v.id, purchasePrice: 20000, salvageValue: 12000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.milesTracked, 1000);
    assert.equal(r.result.depreciation, 8000);
    // operating: 40 + 40 + 60 = 140; TCO = 140 + 8000 = 8140
    assert.equal(r.result.operatingCost, 140);
    assert.equal(r.result.totalCostOfOwnership, 8140);
    assert.equal(r.result.costPerMile, 8.14);
  });

  it("predictive-maintenance forecasts a due date from mileage rate", () => {
    const v = call("vehicles-create", ctxX, { name: "Commuter", odometer: 8000 }).result.vehicle;
    const d0 = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
    const d1 = new Date(Date.now() - 0 * 86_400_000).toISOString().slice(0, 10);
    call("fuel-log", ctxX, { vehicleId: v.id, volume: 10, totalCost: 40, odometer: 6000, date: d0 });
    call("fuel-log", ctxX, { vehicleId: v.id, volume: 10, totalCost: 40, odometer: 8000, date: d1 });
    call("schedule-create", ctxX, { vehicleId: v.id, serviceType: "Oil change", intervalMiles: 5000, lastDoneOdometer: 5000 });
    const r = call("predictive-maintenance", ctxX, { vehicleId: v.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.alerts.length, 1);
    const alert = r.result.alerts[0];
    assert.equal(alert.serviceType, "Oil change");
    // due at 10000, 2000 mi remaining; rate 2000mi/100d = 20mi/day
    assert.equal(alert.milesRemaining, 2000);
    assert.equal(alert.milesPerDay, 20);
    assert.ok(alert.daysUntilDue !== null);
    assert.ok(alert.predictedDate !== null);
  });

  it("attachments-add stores a photo ref + bumps odometer", () => {
    const v = call("vehicles-create", ctxX, { name: "Car", odometer: 1000 }).result.vehicle;
    const r = call("attachments-add", ctxX, {
      vehicleId: v.id, kind: "odometer", dataUri: "data:image/png;base64,AAAA",
      caption: "dash photo", odometerReading: 1500,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.attachment.kind, "odometer");
    assert.equal(call("attachments-list", ctxX, { vehicleId: v.id }).result.count, 1);
    assert.equal(call("vehicles-list", ctxX).result.vehicles[0].odometer, 1500);
  });

  it("attachments-add rejects missing url + unknown vehicle", () => {
    const v = call("vehicles-create", ctxX, { name: "Car" }).result.vehicle;
    assert.equal(call("attachments-add", ctxX, { vehicleId: v.id }).ok, false);
    assert.equal(call("attachments-add", ctxX, { vehicleId: "nope", url: "x" }).ok, false);
  });

  it("compare-vehicles ranks fleet by MPG + cost per mile", () => {
    const a = call("vehicles-create", ctxX, { name: "Sipper", odometer: 0 }).result.vehicle;
    const b = call("vehicles-create", ctxX, { name: "Guzzler", odometer: 0 }).result.vehicle;
    call("fuel-log", ctxX, { vehicleId: a.id, volume: 10, totalCost: 30, odometer: 0 });
    call("fuel-log", ctxX, { vehicleId: a.id, volume: 10, totalCost: 30, odometer: 400 }); // 40 mpg
    call("fuel-log", ctxX, { vehicleId: b.id, volume: 10, totalCost: 40, odometer: 0 });
    call("fuel-log", ctxX, { vehicleId: b.id, volume: 10, totalCost: 40, odometer: 150 }); // 15 mpg
    const r = call("compare-vehicles", ctxX, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.vehicleCount, 2);
    assert.equal(r.result.highlights.bestMpg, "Sipper");
  });

  it("shops-create + appointments-create link a shop to a booking", () => {
    const v = call("vehicles-create", ctxX, { name: "Car" }).result.vehicle;
    const shop = call("shops-create", ctxX, { name: "Main St Auto", laborRate: 110, rating: 4 });
    assert.equal(shop.ok, true);
    assert.equal(call("shops-list", ctxX).result.shops.length, 1);
    const appt = call("appointments-create", ctxX, {
      vehicleId: v.id, shopId: shop.result.shop.id, date: "2099-01-01",
      serviceType: "Brake job", estimatedCost: 400,
    });
    assert.equal(appt.ok, true);
    const list = call("appointments-list", ctxX, { vehicleId: v.id });
    assert.equal(list.result.appointments[0].shopName, "Main St Auto");
    assert.equal(list.result.upcomingCount, 1);
  });

  it("appointments-create rejects missing date + unknown shop", () => {
    const v = call("vehicles-create", ctxX, { name: "Car" }).result.vehicle;
    assert.equal(call("appointments-create", ctxX, { vehicleId: v.id }).ok, false);
    assert.equal(call("appointments-create", ctxX, { vehicleId: v.id, date: "2099-01-01", shopId: "nope" }).ok, false);
  });

  it("renewals-create flags expired + due-soon by date and mileage", () => {
    const v = call("vehicles-create", ctxX, { name: "Car", odometer: 59000 }).result.vehicle;
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    call("renewals-create", ctxX, { vehicleId: v.id, kind: "registration", renewalDate: past });
    call("renewals-create", ctxX, { vehicleId: v.id, kind: "insurance", renewalDate: soon, reminderDays: 30 });
    call("renewals-create", ctxX, { vehicleId: v.id, kind: "warranty", renewalDate: "2099-01-01", coverageLimitMiles: 60000 });
    const r = call("renewals-list", ctxX, { vehicleId: v.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.expiredCount, 1);
    assert.equal(r.result.dueSoonCount, 2); // insurance by date + warranty by 1000-mi window
    const warranty = r.result.renewals.find(x => x.kind === "warranty");
    assert.equal(warranty.milesRemaining, 1000);
  });

  it("renewals-upcoming surfaces only renewals inside the window", () => {
    const v = call("vehicles-create", ctxX, { name: "Car" }).result.vehicle;
    const far = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
    const near = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    call("renewals-create", ctxX, { vehicleId: v.id, kind: "lease", renewalDate: far, reminderDays: 5 });
    call("renewals-create", ctxX, { vehicleId: v.id, kind: "insurance", renewalDate: near, reminderDays: 5 });
    const r = call("renewals-upcoming", ctxX, { withinDays: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.renewals[0].kind, "insurance");
  });
});
