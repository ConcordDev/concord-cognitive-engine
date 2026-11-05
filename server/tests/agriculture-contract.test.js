// server/tests/agriculture-contract.test.js
//
// build(agriculture) — the lens's missing contract, pinned.
// Until this build, agriculture had NO entry in domain-logic's
// DOMAIN_RULES: validateArtifact failed open for it, Livestock and
// Certifications had no machinery at any layer (cross-check #65:
// "livestock" 0 registry-wide), and field-create refused every caller
// that didn't supply a GPS pair the surface never collects.
//
// Pins:
//  S1a — the declared contract: schema known; the seven record types the
//        surface creates validate; invalid type/status are refused with
//        NAMED errors listing the valid values; a missing recommended
//        field warns but never blocks (framework semantics).
//  S2/S3 — Animal (Livestock) and Certification payloads in the exact
//        shape RecordsPanel's payloadFromForm sends them validate clean
//        — the two views have a contract underneath them now.
//  S1b — field-create with NO coordinates succeeds and stores nulls (an
//        omitted coordinate is absence, not NaN); provided-but-invalid
//        coordinates are still refused with the named errors; the
//        created field round-trips through field-list.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgricultureActions from "../domains/agriculture.js";
import { validateArtifact, getDomainSchema } from "../lib/domain-logic.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`agriculture.${name}`);
  if (!fn) throw new Error(`agriculture.${name} not registered`);
  return fn({ actor: { userId: "farmer-1" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAgricultureActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

// The meta handleSave sends (RecordsPanel): { status, tags: [artifactType] }.
const META = (status) => ({ status, tags: [] });

describe("S1a — agriculture's declared artifact contract", () => {
  it("schema is known and lists the seven surface types", () => {
    const s = getDomainSchema("agriculture");
    assert.equal(s.known, true);
    assert.deepEqual(
      [...s.types].sort(),
      ["Animal", "Certification", "Crop", "FarmEquipment", "Field", "Harvest", "WaterSystem"].sort(),
    );
  });

  it("a valid payload for every surface type validates clean", () => {
    const cases = [
      ["Field", { acreage: 40, soilType: "Loam" }, "planned"],
      ["Crop", { variety: "Pioneer 1234" }, "planted"],
      ["Animal", { species: "Cattle" }, "growing"],
      ["FarmEquipment", { equipmentType: "Tractor" }, "active"],
      ["WaterSystem", { systemType: "Center Pivot" }, "active"],
      ["Harvest", { crop: "corn" }, "harvested"],
      ["Certification", { certBody: "USDA", certType: "USDA Organic", expiryDate: "2027-01-01" }, "active"],
    ];
    for (const [type, data, status] of cases) {
      const v = validateArtifact("agriculture", type, data, META(status));
      assert.equal(v.ok, true, `${type}: ${JSON.stringify(v)}`);
      assert.deepEqual(v.errors, []);
    }
  });

  it("an undeclared type is refused with a named error listing the valid types", () => {
    const v = validateArtifact("agriculture", "Spaceship", {}, META("planned"));
    assert.equal(v.ok, false);
    assert.equal(v.errors.length, 1);
    assert.match(v.errors[0], /Invalid type "Spaceship" for domain "agriculture"/);
    assert.match(v.errors[0], /Certification/);
  });

  it("an out-of-vocabulary status is refused with a named error", () => {
    const v = validateArtifact("agriculture", "Field", { acreage: 1, soilType: "Loam" }, META("bogus"));
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /Invalid status "bogus" for domain "agriculture"/);
  });

  it("a missing recommended field warns but never blocks the create", () => {
    const v = validateArtifact("agriculture", "Animal", {}, META("planned"));
    assert.equal(v.ok, true);
    assert.ok(v.warnings.some((w) => w.includes('"species"')), JSON.stringify(v.warnings));
  });
});

describe("S2/S3 — Livestock + Certifications payloads (RecordsPanel shapes)", () => {
  it("the Animal payload payloadFromForm builds validates clean", () => {
    // RecordsPanel Animal branch: { name, type, status, description, notes,
    // species, breed, headCount, pasture } — name/title travels outside data.
    const data = { species: "Cattle", breed: "Angus", headCount: 24, pasture: "North" };
    const v = validateArtifact("agriculture", "Animal", data, META("growing"));
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(v.warnings, []);
  });

  it("the Certification payload payloadFromForm builds validates clean", () => {
    const data = { certType: "USDA Organic", certBody: "USDA", expiryDate: "2027-06-01" };
    const v = validateArtifact("agriculture", "Certification", data, META("active"));
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(v.warnings, []);
  });
});

describe("S1b — field-create coordinates are optional", () => {
  it("creates with NO coordinates and stores nulls, then round-trips via field-list", () => {
    const r = call("field-create", { name: "Dialog Field", acreage: 12.5, soilType: "Silt" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.field.lat, null);
    assert.equal(r.result.field.lng, null);
    const listed = call("field-list", {}).result.fields;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, "Dialog Field");
    assert.equal(listed[0].lat, null);
  });

  it("still stores a provided valid coordinate pair", () => {
    const r = call("field-create", { name: "GPS Field", acreage: 40, lat: 41.7, lng: -73.9 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.field.lat, 41.7);
    assert.equal(r.result.field.lng, -73.9);
  });

  it("still refuses provided-but-invalid coordinates with the named errors", () => {
    const badLat = call("field-create", { name: "Bad Lat", acreage: 10, lat: 91, lng: 0 });
    assert.equal(badLat.ok, false);
    assert.equal(badLat.error, "lat must be -90..90");
    const badLng = call("field-create", { name: "Bad Lng", acreage: 10, lat: 0, lng: "abc" });
    assert.equal(badLng.ok, false);
    assert.equal(badLng.error, "lng must be -180..180");
    assert.equal(call("field-list", {}).result.fields.length, 0);
  });
});
