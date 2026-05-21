// Contract tests for server/domains/geology.js — pure-compute helpers
// plus real USGS Earthquake + DESIGNMAPS integrations.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGeologyActions from "../domains/geology.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`geology.${name}`);
  if (!fn) throw new Error(`geology.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerGeologyActions(register); });
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = { dtus: new Map() };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("geology.rockClassify (pure compute)", () => {
  it("classifies foliated specimen as metamorphic", () => {
    const r = call("rockClassify", ctxA, { data: { texture: "foliated", mohsHardness: 6, color: "gray" } }, {});
    assert.equal(r.result.rockType, "metamorphic");
    assert.equal(r.result.durability, "moderate");
  });
});

describe("geology.recent-earthquakes (USGS catalog)", () => {
  it("hits USGS + parses GeoJSON FeatureCollection", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          metadata: { generated: 1715882400000 },
          features: [
            {
              id: "us6000mzqw",
              properties: {
                mag: 5.2, magType: "mb",
                place: "30 km W of Petrolia, CA",
                time: 1715882000000, updated: 1715882400000,
                url: "https://earthquake.usgs.gov/earthquakes/eventpage/us6000mzqw",
                status: "reviewed", tsunami: 0, felt: 42, cdi: 4.5, mmi: 5.1,
                alert: "green", sig: 416,
              },
              geometry: { coordinates: [-124.5, 40.3, 18.5] },
            },
          ],
        }),
      };
    };
    const r = await call("recent-earthquakes", ctxA, { minMagnitude: 5, sinceHours: 24 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /earthquake\.usgs\.gov\/fdsnws\/event\/1\/query/);
    assert.match(capturedUrl, /format=geojson/);
    assert.match(capturedUrl, /minmagnitude=5/);
    assert.equal(r.result.events.length, 1);
    assert.equal(r.result.events[0].magnitude, 5.2);
    assert.equal(r.result.events[0].latitude, 40.3);
    assert.equal(r.result.events[0].longitude, -124.5);
    assert.equal(r.result.events[0].depthKm, 18.5);
    assert.equal(r.result.events[0].alert, "green");
    assert.equal(r.result.events[0].tsunami, false);
    assert.equal(r.result.source, "usgs-earthquake-catalog");
  });

  it("supports circle filter (lat/lng/radiusKm)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ features: [] }) };
    };
    await call("recent-earthquakes", ctxA, { latitude: 37.7, longitude: -122.4, radiusKm: 100 });
    assert.match(capturedUrl, /latitude=37\.7/);
    assert.match(capturedUrl, /longitude=-122\.4/);
    assert.match(capturedUrl, /maxradiuskm=100/);
  });

  it("supports bbox filter (min/max lat/lng)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ features: [] }) };
    };
    await call("recent-earthquakes", ctxA, {
      minlatitude: 30, maxlatitude: 45,
      minlongitude: -130, maxlongitude: -100,
    });
    assert.match(capturedUrl, /minlatitude=30/);
    assert.match(capturedUrl, /maxlatitude=45/);
    assert.match(capturedUrl, /minlongitude=-130/);
    assert.match(capturedUrl, /maxlongitude=-100/);
  });

  it("surfaces USGS network errors", async () => {
    const r = await call("recent-earthquakes", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /usgs earthquake unreachable/);
  });
});

describe("geology.usgs-seismic-hazard (DESIGNMAPS ASCE 7-22)", () => {
  it("rejects missing or invalid coords", async () => {
    assert.equal((await call("usgs-seismic-hazard", ctxA, {})).ok, false);
    const r = await call("usgs-seismic-hazard", ctxA, { latitude: 5, longitude: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /only covers US/);
  });

  it("hits DESIGNMAPS and parses ASCE 7 spectrum", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          response: {
            data: {
              ss: 2.106, s1: 0.815, fa: 1.0, fv: 1.5,
              sms: 2.106, sm1: 1.223,
              sds: 1.404, sd1: 0.815,
              sdc: "D", pga: 0.847, pgam: 0.847,
              tl: 12,
            },
          },
        }),
      };
    };
    const r = await call("usgs-seismic-hazard", ctxA, {
      latitude: 37.78, longitude: -122.42,
      riskCategory: 2, siteClass: "D",
    });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /asce7-22\.json/);
    assert.match(capturedUrl, /latitude=37\.78/);
    assert.match(capturedUrl, /siteClass=D/);
    assert.equal(r.result.ss, 2.106);
    assert.equal(r.result.sdc, "D");
    assert.equal(r.result.source, "usgs-designmaps-asce7-22");
  });

  it("returns clear error on USGS 400 (outside coverage)", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
    const r = await call("usgs-seismic-hazard", ctxA, { latitude: 37.78, longitude: -122.42 });
    assert.equal(r.ok, false);
    assert.match(r.error, /outside ASCE 7 coverage/);
  });
});

describe("geology.geologic-map (Macrostrat bedrock overlay)", () => {
  it("requires lat + lon", async () => {
    const r = await call("geologic-map", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /lat \+ lon required/);
  });

  it("hits Macrostrat and parses geologic-map units", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          success: { data: [
            { map_id: 7, name: "Franciscan Complex", t_age: 66, b_age: 145,
              b_int_name: "Cretaceous", t_int_name: "Cretaceous",
              lith: "graywacke", descrip: "subduction mélange", color: "#1f8a70" },
          ] },
        }),
      };
    };
    const r = await call("geologic-map", ctxA, { lat: 37.78, lon: -122.42, scale: "medium" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /macrostrat\.org\/api\/v2\/geologic_units\/map/);
    assert.match(capturedUrl, /scale=medium/);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.units[0].name, "Franciscan Complex");
    assert.equal(r.result.units[0].ageInterval, "Cretaceous");
    assert.equal(r.result.source, "macrostrat-geologic-map");
  });

  it("surfaces Macrostrat network errors", async () => {
    const r = await call("geologic-map", ctxA, { lat: 37, lon: -122 });
    assert.equal(r.ok, false);
    assert.match(r.error, /macrostrat unreachable/);
  });
});

describe("geology.rock-units-here (location bedrock lookup)", () => {
  it("requires lat + lon", async () => {
    const r = await call("rock-units-here", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("resolves bedrock + stratigraphic column at a point", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/geologic_units/map")) {
        return { ok: true, json: async () => ({ success: { data: [
          { name: "Monterey Formation", lith: "chert", b_int_name: "Miocene", t_age: 5, b_age: 16, descrip: "diatomaceous" },
        ] } }) };
      }
      return { ok: true, json: async () => ({ success: { data: [
        { unit_name: "Monterey Fm", b_int_name: "Miocene", t_int_name: "Miocene", t_age: 5, b_age: 16, lith: "chert", max_thick: 900, min_thick: 100 },
      ] } }) };
    };
    const r = await call("rock-units-here", ctxA, { lat: 36.6, lon: -121.9 });
    assert.equal(r.ok, true);
    assert.equal(r.result.bedrockCount, 1);
    assert.equal(r.result.bedrock[0].name, "Monterey Formation");
    assert.equal(r.result.columnCount, 1);
    assert.equal(r.result.columnUnits[0].maxThicknessM, 900);
  });
});

describe("geology.measurement-* (strike/dip structural)", () => {
  it("records a strike/dip measurement with right-hand-rule dip direction", () => {
    const r = call("measurement-record", ctxA, { planeKind: "bedding", strike: 45, dip: 30, locationName: "Outcrop A" });
    assert.equal(r.ok, true);
    assert.equal(r.result.measurement.strike, 45);
    assert.equal(r.result.measurement.dip, 30);
    assert.equal(r.result.measurement.dipDirection, 135);
  });

  it("rejects missing strike/dip and out-of-range dip", () => {
    assert.equal(call("measurement-record", ctxA, { strike: 10 }).ok, false);
    assert.equal(call("measurement-record", ctxA, { strike: 10, dip: 120 }).ok, false);
  });

  it("lists measurements with mean-strike summary", () => {
    call("measurement-record", ctxA, { planeKind: "joint", strike: 90, dip: 80 });
    call("measurement-record", ctxA, { planeKind: "joint", strike: 100, dip: 70 });
    const r = call("measurement-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(typeof r.result.meanStrike, "number");
    assert.equal(r.result.byKind.joint, 2);
  });

  it("deletes a measurement and isolates users", () => {
    const a = call("measurement-record", ctxA, { strike: 12, dip: 12 });
    call("measurement-record", ctxB, { strike: 99, dip: 20 });
    assert.equal(call("measurement-list", ctxB, {}).result.count, 1);
    const del = call("measurement-delete", ctxA, { id: a.result.measurement.id });
    assert.equal(del.ok, true);
    assert.equal(call("measurement-list", ctxA, {}).result.count, 0);
    assert.equal(call("measurement-list", ctxB, {}).result.count, 1);
  });
});

describe("geology.photo-* (geotagged sample photos)", () => {
  it("attaches a geotagged photo to an observation and backfills coords", () => {
    const obs = call("observation-log", ctxA, { name: "Basalt block" });
    const r = call("photo-attach", ctxA, {
      observationId: obs.result.observation.id,
      dataUrl: "data:image/jpeg;base64,/9j/AAAA",
      caption: "weathered face",
      exifLat: 19.42, exifLon: -155.29, exifTakenAt: "2026-03-01T10:00:00",
      cameraModel: "Pixel 9",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.photo.exifLat, 19.42);
    const list = call("observation-list", ctxA, {});
    assert.equal(list.result.observations[0].lat, 19.42);
  });

  it("rejects invalid dataUrl and unknown observation", () => {
    const obs = call("observation-log", ctxA, { name: "X" });
    assert.equal(call("photo-attach", ctxA, { observationId: obs.result.observation.id, dataUrl: "notimage" }).ok, false);
    assert.equal(call("photo-attach", ctxA, { observationId: "missing", dataUrl: "data:image/png;base64,AA" }).ok, false);
  });

  it("lists and deletes photos", () => {
    const obs = call("observation-log", ctxA, { name: "Granite" });
    const p = call("photo-attach", ctxA, { observationId: obs.result.observation.id, dataUrl: "data:image/jpeg;base64,AA" });
    const list = call("photo-list", ctxA, { observationId: obs.result.observation.id });
    assert.equal(list.result.count, 1);
    assert.equal(call("photo-delete", ctxA, { id: p.result.photo.id }).ok, true);
    assert.equal(call("photo-list", ctxA, {}).result.count, 0);
  });
});

describe("geology.collection-* (specimen checklist)", () => {
  it("adds a specimen and increments count on repeat", () => {
    const first = call("collection-add", ctxA, { name: "Quartz", kind: "mineral" });
    assert.equal(first.result.isNew, true);
    const again = call("collection-add", ctxA, { name: "quartz", kind: "mineral" });
    assert.equal(again.result.isNew, false);
    assert.equal(again.result.entry.count, 2);
  });

  it("lists collection with stats and kind facets", () => {
    call("collection-add", ctxA, { name: "Pyrite", kind: "mineral" });
    call("collection-add", ctxA, { name: "Trilobite", kind: "fossil" });
    const r = call("collection-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.uniqueCount, 2);
    assert.equal(r.result.byKind.fossil, 1);
  });

  it("toggles identified status and removes entries", () => {
    const e = call("collection-add", ctxA, { name: "Amethyst", kind: "gem" });
    assert.equal(e.result.entry.identified, true);
    const t = call("collection-toggle", ctxA, { id: e.result.entry.id });
    assert.equal(t.result.entry.identified, false);
    assert.equal(call("collection-remove", ctxA, { id: e.result.entry.id }).ok, true);
    assert.equal(call("collection-list", ctxA, {}).result.uniqueCount, 0);
  });
});

describe("geology.fieldtrip-* (outcrop sequencing)", () => {
  it("creates a field trip, adds stops, and reorders them", () => {
    const trip = call("fieldtrip-create", ctxA, { name: "Coast Ranges traverse", area: "California" });
    assert.equal(trip.ok, true);
    const tid = trip.result.fieldTrip.id;
    const s1 = call("fieldtrip-add-stop", ctxA, { tripId: tid, name: "Stop 1", lithology: "shale" });
    const s2 = call("fieldtrip-add-stop", ctxA, { tripId: tid, name: "Stop 2", lithology: "sandstone" });
    assert.equal(s2.result.stopCount, 2);
    const re = call("fieldtrip-reorder-stops", ctxA, { tripId: tid, stopIds: [s2.result.stop.id, s1.result.stop.id] });
    assert.equal(re.ok, true);
    assert.equal(re.result.fieldTrip.stops[0].name, "Stop 2");
    assert.equal(re.result.fieldTrip.stops[0].order, 1);
  });

  it("lists trips with total stop count and updates a stop", () => {
    const trip = call("fieldtrip-create", ctxA, { name: "Quarry visit" });
    const tid = trip.result.fieldTrip.id;
    const stop = call("fieldtrip-add-stop", ctxA, { tripId: tid, name: "Quarry face" });
    const upd = call("fieldtrip-update-stop", ctxA, { tripId: tid, stopId: stop.result.stop.id, notes: "fresh exposure" });
    assert.equal(upd.result.stop.notes, "fresh exposure");
    const list = call("fieldtrip-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.totalStops, 1);
  });

  it("rejects bad reorder input and deletes a trip", () => {
    const trip = call("fieldtrip-create", ctxA, { name: "Roadcut survey" });
    const tid = trip.result.fieldTrip.id;
    call("fieldtrip-add-stop", ctxA, { tripId: tid, name: "Cut 1" });
    assert.equal(call("fieldtrip-reorder-stops", ctxA, { tripId: tid, stopIds: [] }).ok, false);
    assert.equal(call("fieldtrip-delete", ctxA, { id: tid }).ok, true);
    assert.equal(call("fieldtrip-list", ctxA, {}).result.count, 0);
  });
});
