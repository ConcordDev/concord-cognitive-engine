import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGovernment from "../domains/government.js";
import registerAutomotive from "../domains/automotive.js";
import registerMasonry from "../domains/masonry.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerGovernment(register);
  registerAutomotive(register);
  registerMasonry(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("shared field checks", () => {
  it("refuses a negative permit fee and a blank application", () => {
    const blank = call("government", "permits-apply", { applicantName: "  ", applicantEmail: "", kind: "" });
    assert.equal(blank.ok, false);
    const fee = call("government", "permits-apply", {
      applicantName: "Ada", applicantEmail: "ada@example.com", kind: "fence", feeUsd: -5,
    });
    assert.equal(fee.ok, false);
    assert.equal(fee.field, "feeUsd");
    const letters = call("government", "permits-apply", {
      applicantName: "Ada", applicantEmail: "ada@example.com", kind: "fence", feeUsd: "abc",
    });
    assert.equal(letters.ok, false);
  });

  it("refuses a negative model year and a non-numeric odometer", () => {
    const year = call("automotive", "vehicles-create", { name: "Daily", year: -5, odometer: 10 });
    assert.equal(year.ok, false);
    assert.equal(year.field, "year");
    const odo = call("automotive", "vehicles-create", { name: "Daily", year: 2018, odometer: "abc" });
    assert.equal(odo.ok, false);
    assert.equal(odo.field, "odometer");
    const ok = call("automotive", "vehicles-create", { name: "Daily", year: 2018, odometer: 12000 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.vehicle.year, 2018);
    assert.equal(ok.result.vehicle.odometer, 12000);
  });

  it("refuses a blank renewal title and a document expiry that is not a date", () => {
    const vehicle = call("automotive", "vehicles-create", { name: "Daily", year: 2018 }).result.vehicle;
    const doc = call("automotive", "documents-create", { vehicleId: vehicle.id, kind: "insurance", expiryDate: "next spring" });
    assert.equal(doc.ok, false);
    assert.match(doc.error, /YYYY-MM-DD/);
    const renewal = call("automotive", "renewals-create", { vehicleId: vehicle.id, title: "   ", renewalDate: "2026-11-10" });
    assert.equal(renewal.ok, false);
    assert.match(renewal.error, /title required/);
    const dated = call("automotive", "renewals-create", { vehicleId: vehicle.id, title: "Policy", renewalDate: "not-a-date" });
    assert.equal(dated.ok, false);
  });

  it("refuses a huge or negative takeoff and a name over 120 characters", () => {
    const huge = call("masonry", "takeoff-save", {
      name: "Wall", segments: [{ lengthFeet: -4, heightFeet: 8 }],
    });
    assert.equal(huge.ok, false);
    assert.equal(huge.field, "dimensions");
    const longName = call("masonry", "takeoff-save", {
      name: "n".repeat(300), segments: [{ lengthFeet: 10, heightFeet: 8 }],
    });
    assert.equal(longName.ok, false);
    assert.equal(longName.field, "name");
    const ok = call("masonry", "takeoff-save", {
      name: "Garden wall", segments: [{ lengthFeet: 10, heightFeet: 8 }],
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.name, "Garden wall");
    assert.equal(ok.result.netAreaSqFt, 80);
  });
});
