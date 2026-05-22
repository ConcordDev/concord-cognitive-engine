// Contract tests for server/domains/space.js — pure-compute orbital
// mechanics plus real free-API integrations: wheretheiss.at (ISS),
// SpaceX r-spacex API, Launch Library 2 (TheSpaceDevs), NASA APOD.
//
// One test per backlog macro: iss-track, iss-groundtrack, iss-passes,
// orbit-3d, launch-countdown, rocket-detail, sky-map, launches-filtered,
// apod — plus the pre-existing pure-math macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSpaceActions from "../domains/space.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`space.${name}`);
  if (!fn) throw new Error(`space.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => {
  globalThis._concordSTATE = { spaceLens: {} };
  registerSpaceActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("space.orbitCalc (pure math)", () => {
  it("computes a 400km LEO orbit", () => {
    const r = call("orbitCalc", ctxA, { data: { altitudeKm: 400 } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "LEO");
    assert.ok(r.result.periodMinutes > 90 && r.result.periodMinutes < 93);
    assert.ok(r.result.velocityKmS > 7 && r.result.velocityKmS < 8);
  });
});

describe("space.iss-track (wheretheiss.at)", () => {
  it("hits the ISS API and shapes the live position", async () => {
    let url = "";
    globalThis.fetch = async (u) => {
      url = u;
      return {
        ok: true,
        json: async () => ({
          id: 25544, name: "iss",
          latitude: 12.5, longitude: -45.2,
          altitude: 421.3, velocity: 27600.1,
          visibility: "daylight", footprint: 4500.2,
          solar_lat: 18, solar_lon: 90, timestamp: 1715882400,
        }),
      };
    };
    const r = await call("iss-track", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(url, /api\.wheretheiss\.at\/v1\/satellites\/25544/);
    assert.equal(r.result.latitude, 12.5);
    assert.equal(r.result.altitudeKm, 421.3);
    assert.equal(r.result.source, "wheretheiss.at");
  });

  it("surfaces ISS API failures", async () => {
    const r = await call("iss-track", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /iss api unreachable/);
  });
});

describe("space.iss-groundtrack (wheretheiss.at batch)", () => {
  it("samples future ISS positions over a window", async () => {
    let url = "";
    globalThis.fetch = async (u) => {
      url = u;
      return {
        ok: true,
        json: async () => [
          { timestamp: 1, latitude: 1, longitude: 2, altitude: 420, velocity: 27600 },
          { timestamp: 2, latitude: 3, longitude: 4, altitude: 421, velocity: 27590 },
        ],
      };
    };
    const r = await call("iss-groundtrack", ctxA, { minutes: 30, stepSeconds: 300 });
    assert.equal(r.ok, true);
    assert.match(url, /positions\?timestamps=/);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.points[0].latitude, 1);
  });
});

describe("space.iss-passes (visible-pass prediction)", () => {
  it("rejects missing observer coordinates", async () => {
    const r = await call("iss-passes", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /latitude and longitude required/);
  });

  it("detects a pass when the ISS rises above the horizon", async () => {
    // Feed the ISS directly overhead the observer for a few samples.
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => Array.from({ length: 10 }, (_, i) => ({
        timestamp: 1715882400 + i * 60,
        latitude: 40.7, longitude: -74, altitude: 420,
      })),
    });
    const r = await call("iss-passes", ctxA, { latitude: 40.7, longitude: -74, minElevationDeg: 10 });
    assert.equal(r.ok, true);
    assert.ok(r.result.passes.length >= 1);
    assert.ok(r.result.passes[0].peakElevationDeg >= 10);
    assert.equal(r.result.source, "wheretheiss.at");
  });
});

describe("space.orbit-3d (pure-compute orbit geometry)", () => {
  it("returns sampled ECI points for an ISS-like orbit", () => {
    const r = call("orbit-3d", ctxA, { altitudeKm: 420, inclinationDeg: 51.6, samples: 48 });
    assert.equal(r.ok, true);
    assert.equal(r.result.sampleCount, 48);
    assert.equal(r.result.zone, "LEO");
    assert.ok(r.result.periodMinutes > 90 && r.result.periodMinutes < 95);
    const p = r.result.points[0];
    assert.ok(typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number");
  });
});

describe("space.launch-countdown (SpaceX + Launch Library)", () => {
  it("resolves the next SpaceX launch with a T-minus delta", async () => {
    const futureUnix = Math.floor(Date.now() / 1000) + 86400;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [
        { id: "l1", name: "Starlink Group 99", date_unix: futureUnix, date_utc: new Date(futureUnix * 1000).toISOString(), date_precision: "hour", links: { webcast: "https://youtu.be/x" } },
      ],
    });
    const r = await call("launch-countdown", ctxA, { source: "spacex" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.name, "Starlink Group 99");
    assert.ok(r.result.tMinusSeconds > 0);
    assert.equal(r.result.source, "spacexdata-api");
  });

  it("resolves the next launch from Launch Library when source omitted", async () => {
    const net = new Date(Date.now() + 172800000).toISOString();
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ results: [{ id: "ll1", name: "Ariane 6", net, status: { name: "Go" }, launch_service_provider: { name: "Arianespace" } }] }),
    });
    const r = await call("launch-countdown", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "Ariane 6");
    assert.equal(r.result.provider, "Arianespace");
    assert.equal(r.result.source, "thespacedevs-launch-library");
  });
});

describe("space.rocket-detail (SpaceX vehicle spec)", () => {
  it("resolves a rocket by id and returns the spec sheet", async () => {
    globalThis.fetch = async (u) => {
      if (/rockets\/falcon9/.test(u)) {
        return {
          ok: true,
          json: async () => ({
            id: "falcon9", name: "Falcon 9", type: "rocket", active: true,
            stages: 2, success_rate_pct: 98, cost_per_launch: 50000000,
            height: { meters: 70 }, diameter: { meters: 3.7 }, mass: { kg: 549054 },
            payload_weights: [{ id: "leo", name: "Low Earth Orbit", kg: 22800 }],
            description: "Reusable two-stage rocket.", country: "United States",
          }),
        };
      }
      throw new Error("unexpected url");
    };
    const r = await call("rocket-detail", ctxA, { rocketId: "falcon9" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.name, "Falcon 9");
    assert.equal(r.result.successRatePct, 98);
    assert.equal(r.result.payloadWeights[0].kg, 22800);
  });

  it("returns the fleet list when no query is given", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => [
        { id: "falcon9", name: "Falcon 9", active: true },
        { id: "falconheavy", name: "Falcon Heavy", active: true },
      ],
    });
    const r = await call("rocket-detail", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.found, false);
    assert.equal(r.result.fleet.length, 2);
  });
});

describe("space.sky-map (planetarium ephemeris)", () => {
  it("rejects missing observer coordinates", () => {
    const r = call("sky-map", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /latitude and longitude required/);
  });

  it("computes alt/az for the visible planets", () => {
    const r = call("sky-map", ctxA, { latitude: 40.7, longitude: -74 });
    assert.equal(r.ok, true);
    assert.equal(r.result.objects.length, 5);
    for (const o of r.result.objects) {
      assert.ok(o.azimuthDeg >= 0 && o.azimuthDeg < 360);
      assert.ok(o.altitudeDeg >= -90 && o.altitudeDeg <= 90);
      assert.equal(typeof o.aboveHorizon, "boolean");
    }
    assert.ok(["Mercury", "Venus", "Mars", "Jupiter", "Saturn"].includes(r.result.objects[0].name));
  });
});

describe("space.launches-filtered (LL2 with facets)", () => {
  it("filters launches by provider and exposes facet lists", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [
          { id: "a", name: "Falcon 9 · Starlink", net: "2026-06-01T00:00:00Z", status: { name: "Go" }, launch_service_provider: { name: "SpaceX" }, mission: { orbit: { name: "Low Earth Orbit" } }, pad: { name: "SLC-40", country_code: "USA" } },
          { id: "b", name: "Ariane 6", net: "2026-06-02T00:00:00Z", status: { name: "Go" }, launch_service_provider: { name: "Arianespace" }, mission: { orbit: { name: "Geostationary" } }, pad: { name: "ELA-4", country_code: "GUF" } },
        ],
      }),
    });
    const r = await call("launches-filtered", ctxA, { provider: "spacex" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.launches[0].provider, "SpaceX");
    assert.equal(r.result.totalBeforeFilter, 2);
    assert.ok(r.result.facets.providers.includes("Arianespace"));
    assert.ok(r.result.facets.orbits.includes("Geostationary"));
  });
});

describe("space.apod (NASA Astronomy Picture of the Day)", () => {
  it("hits NASA APOD and parses the response", async () => {
    let url = "";
    globalThis.fetch = async (u) => {
      url = u;
      return {
        ok: true,
        json: async () => ({
          date: "2026-05-21", title: "The Horsehead Nebula",
          explanation: "A dark cloud in Orion...", media_type: "image",
          url: "https://apod.nasa.gov/x.jpg", hdurl: "https://apod.nasa.gov/x_hd.jpg",
          copyright: "Some Astronomer",
        }),
      };
    };
    const r = await call("apod", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(url, /api\.nasa\.gov\/planetary\/apod/);
    assert.equal(r.result.items[0].title, "The Horsehead Nebula");
    assert.equal(r.result.source, "nasa-apod");
  });

  it("requests a random gallery when count is supplied", async () => {
    let url = "";
    globalThis.fetch = async (u) => {
      url = u;
      return { ok: true, json: async () => [{ date: "2026-05-20", title: "x", explanation: "y", media_type: "image", url: "z" }] };
    };
    const r = await call("apod", ctxA, { count: 5 });
    assert.equal(r.ok, true);
    assert.match(url, /count=5/);
    assert.equal(r.result.count, 1);
  });
});
