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
beforeEach(() => { globalThis.fetch = async () => { throw new Error("network disabled in tests"); }; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

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
