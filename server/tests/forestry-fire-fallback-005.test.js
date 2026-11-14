// FIX-forestry-005 — InciWeb's public API is retired (404 at every
// probed path, re-verified live at fix time), which broke Fire Watch's
// incident load with the walker's exact 'inciweb 404' toast. The
// action now falls back to NIFC's WFIGS Incident Locations service —
// the sibling of the WFIGS perimeters service this domain already
// uses — mapping its GeoJSON into the established fire shape. The
// perimeters action also stops reading an ArcGIS { error } body
// (HTTP 200) as 'zero perimeters'.
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerForestryActions from "../domains/forestry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`forestry.${name}`);
  assert.ok(fn, `forestry.${name} not registered`);
  return fn({ actor: { userId: "u1" }, userId: "u1" }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerForestryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
afterEach(() => { delete globalThis.fetch; });

const realFetch = globalThis.fetch;
function stubFetch(handler) { globalThis.fetch = handler; }
function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const WFIGS_FEATURE = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-123.97, 45.16] },
  properties: {
    UniqueFireIdentifier: "2026-ORSUF-260026",
    IncidentName: "2026 SUF RX Piles",
    IncidentTypeCategory: "RX",
    POOState: "US-OR",
    POOCounty: "Tillamook",
    IncidentSize: 12,
    PercentContained: 40,
    FireDiscoveryDateTime: 1767387854000,
  },
};

describe("forestry fire feeds (FIX-forestry-005)", () => {
  it("inciweb 404 falls back to WFIGS incident locations in the established fire shape", async () => {
    stubFetch(async (url) => {
      if (String(url).includes("inciweb")) return jsonRes(404, {});
      if (String(url).includes("WFIGS_Incident_Locations")) return jsonRes(200, { features: [WFIGS_FEATURE] });
      throw new Error(`unexpected fetch ${url}`);
    });
    const r = await call("inciweb-active-fires", {});
    assert.equal(r.ok, true);
    assert.match(r.result.source, /fallback/);
    assert.equal(r.result.count, 1);
    const fire = r.result.fires[0];
    assert.equal(fire.id, "2026-ORSUF-260026");
    assert.equal(fire.name, "2026 SUF RX Piles");
    assert.equal(fire.state, "OR");
    assert.equal(fire.county, "Tillamook");
    assert.equal(fire.containmentPct, 40);
    assert.equal(fire.latitude, 45.16);
    assert.equal(fire.longitude, -123.97);
  });

  it("a healthy inciweb response is used as-is (no fallback fetch)", async () => {
    let wfigsCalled = false;
    stubFetch(async (url) => {
      if (String(url).includes("WFIGS")) { wfigsCalled = true; return jsonRes(200, { features: [] }); }
      return jsonRes(200, { data: [{ id: "i1", name: "Primary Fire", size: 5, percent_contained: 10 }] });
    });
    const r = await call("inciweb-active-fires", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "inciweb");
    assert.equal(r.result.fires[0].name, "Primary Fire");
    assert.equal(wfigsCalled, false);
  });

  it("when both sources fail, the original inciweb error stands", async () => {
    stubFetch(async (url) => {
      if (String(url).includes("inciweb")) return jsonRes(404, {});
      return jsonRes(503, {});
    });
    const r = await call("inciweb-active-fires", {});
    assert.equal(r.ok, false);
    assert.match(r.error, /inciweb unreachable: inciweb 404/);
  });

  it("an ArcGIS error body on perimeters surfaces as an error, not zero features", async () => {
    stubFetch(async () => jsonRes(200, { error: { code: 400, message: "bad where" } }));
    const r = await call("nifc-fire-perimeters", {});
    assert.equal(r.ok, false);
    assert.match(r.error, /nifc/);
  });

  it("perimeters still map real features", async () => {
    stubFetch(async () => jsonRes(200, {
      features: [{ properties: { OBJECTID: 1, poly_IncidentName: "RX Buck Creek", poly_GISAcres: 805.4 }, geometry: { type: "Polygon", coordinates: [] } }],
    }));
    const r = await call("nifc-fire-perimeters", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.features[0].incidentName, "RX Buck Creek");
  });
});
