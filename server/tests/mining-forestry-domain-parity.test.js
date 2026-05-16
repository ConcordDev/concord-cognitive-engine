// Contract tests for the new mining (MSHA) + forestry (InciWeb +
// NIFC) real-data macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMiningActions from "../domains/mining.js";
import registerForestryActions from "../domains/forestry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerMiningActions(register);
  registerForestryActions(register);
});

beforeEach(() => { globalThis.fetch = async () => { throw new Error("network disabled in tests"); }; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("mining.msha-mine-lookup (MSHA Open Data)", () => {
  it("rejects missing mineId", async () => {
    assert.equal((await call("mining.msha-mine-lookup", ctxA, {})).ok, false);
  });

  it("rejects non-7-digit mineId", async () => {
    assert.equal((await call("mining.msha-mine-lookup", ctxA, { mineId: "12345" })).ok, false);
  });

  it("parses MSHA mine record", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          mine_id: "0100003",
          mine_name: "Concord Test Mine",
          current_operator_name: "Acme Coal Co",
          state: "AL",
          county: "Jefferson",
          coal_metal_ind: "C",
          current_mine_status: "Active",
          current_status_date: "2026-01-01",
          primary_canvass: "Coal",
          average_employee_cnt: 145,
          coal_production_tons: 875432,
          latitude: "33.5",
          longitude: "-86.8",
        }),
      };
    };
    const r = await call("mining.msha-mine-lookup", ctxA, { mineId: "0100003" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /datamine\.msha\.gov\/api\/mines\/0100003/);
    assert.equal(r.result.name, "Concord Test Mine");
    assert.equal(r.result.mineType, "coal");
    assert.equal(r.result.latitude, 33.5);
    assert.equal(r.result.source, "msha-open-data");
  });

  it("returns clear 404 when mine doesn't exist", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("mining.msha-mine-lookup", ctxA, { mineId: "9999999" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Mine ID not found/);
  });
});

describe("mining.msha-violations", () => {
  it("rejects bad mineId", async () => {
    assert.equal((await call("mining.msha-violations", ctxA, { mineId: "abc" })).ok, false);
  });

  it("handles 404 as empty list (not error)", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("mining.msha-violations", ctxA, { mineId: "0100003" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });

  it("parses array-form response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([
        { citation_no: "12345", issued_date: "2026-03-15", section_of_act: "104(a)", proposed_penalty: 1250, final_penalty: 950 },
      ]),
    });
    const r = await call("mining.msha-violations", ctxA, { mineId: "0100003" });
    assert.equal(r.result.violations[0].citationNumber, "12345");
  });
});

describe("forestry.inciweb-active-fires", () => {
  it("rejects bad state code", async () => {
    assert.equal((await call("forestry.inciweb-active-fires", ctxA, { state: "CAL" })).ok, false);
  });

  it("hits InciWeb + parses fire response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: "abc-fire",
            name: "Big Pine Fire",
            type: "wildfire",
            location: "Sequoia NF",
            state: "CA", county: "Tulare",
            size: 4250, percent_contained: 35,
            status: "Active",
            start_date: "2026-05-10",
            updated_at: "2026-05-16T12:00:00Z",
            latitude: "36.5", longitude: "-118.7",
            url: "https://inciweb.wildfire.gov/incident/12345/",
          }],
        }),
      };
    };
    const r = await call("forestry.inciweb-active-fires", ctxA, { state: "CA" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /inciweb\.wildfire\.gov\/api\/v1\/incidents/);
    assert.match(capturedUrl, /state=CA/);
    assert.equal(r.result.fires[0].name, "Big Pine Fire");
    assert.equal(r.result.fires[0].sizeAcres, 4250);
    assert.equal(r.result.fires[0].containmentPct, 35);
    assert.equal(r.result.source, "inciweb");
  });
});

describe("forestry.nifc-fire-perimeters", () => {
  it("hits NIFC ArcGIS feature service + shapes GeoJSON features", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {
              OBJECTID: 12345,
              poly_IncidentName: "Big Pine Fire",
              poly_GISAcres: 4250.5,
              poly_MapMethod: "GPS",
              poly_PolygonDateTime: "2026-05-16T08:00:00Z",
              attr_FireCause: "Lightning",
            },
            geometry: { type: "Polygon", coordinates: [[[-118.7, 36.5], [-118.6, 36.5], [-118.6, 36.6], [-118.7, 36.6], [-118.7, 36.5]]] },
          }],
        }),
      };
    };
    const r = await call("forestry.nifc-fire-perimeters", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /WFIGS_Interagency_Perimeters_Current/);
    assert.match(capturedUrl, /f=geojson/);
    assert.equal(r.result.features[0].incidentName, "Big Pine Fire");
    assert.equal(r.result.totalArea, 4250.5);
    assert.equal(r.result.source, "nifc-wfigs-perimeters");
  });
});
