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
