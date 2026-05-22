// Contract tests for server/domains/astronomy.js — pure-math macros
// plus real NASA / wheretheiss.at API integrations.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAstronomyActions from "../domains/astronomy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`astronomy.${name}`);
  if (!fn) throw new Error(`astronomy.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerAstronomyActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("astronomy.celestialPosition (pure math)", () => {
  it("computes altitude/azimuth for a star", () => {
    const r = call("celestialPosition", ctxA, {
      data: { rightAscension: 6.7525, declination: -16.7161, latitude: 40.7, longitude: -74, name: "Sirius" },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.object, "Sirius");
    assert.ok(typeof r.result.altitude === "number");
    assert.ok(typeof r.result.azimuth === "number");
    assert.ok(r.result.azimuth >= 0 && r.result.azimuth < 360);
  });
});

describe("astronomy.orbitalMechanics (Kepler's third law)", () => {
  it("computes Earth's orbital period as ≈ 1 year", () => {
    const r = call("orbitalMechanics", ctxA, {
      data: { name: "Earth", semiMajorAxis: 1, eccentricity: 0.0167, centralMass: 1 },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.periodYears - 1) < 0.01);
    assert.equal(r.result.orbitType, "nearly-circular");
  });

  it("computes Halley's comet as highly-eccentric", () => {
    const r = call("orbitalMechanics", ctxA, {
      data: { name: "Halley", semiMajorAxis: 17.8, eccentricity: 0.967, centralMass: 1 },
    }, {});
    assert.equal(r.result.orbitType, "highly-eccentric");
    // Halley's period ≈ 75.3 years
    assert.ok(Math.abs(r.result.periodYears - 75.3) < 1);
  });
});

describe("astronomy.apod (NASA Astronomy Picture of the Day)", () => {
  it("hits NASA APOD and parses real response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          date: "2026-05-16",
          title: "The Pillars of Creation",
          explanation: "M16 imaged by JWST...",
          media_type: "image",
          url: "https://apod.nasa.gov/apod/image/2305/Pillars_JWST_960.jpg",
          hdurl: "https://apod.nasa.gov/apod/image/2305/Pillars_JWST_4000.jpg",
          copyright: "NASA, ESA, CSA, STScI",
        }),
      };
    };
    const r = await call("apod", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.nasa\.gov\/planetary\/apod/);
    assert.match(capturedUrl, /api_key=DEMO_KEY/);
    assert.equal(r.result.title, "The Pillars of Creation");
    assert.equal(r.result.mediaType, "image");
    assert.equal(r.result.source, "nasa-apod");
    assert.equal(r.result.usingDemoKey, true);
  });

  it("uses NASA_API_KEY env when set", async () => {
    process.env.NASA_API_KEY = "real-key-abc";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ date: "2026-05-16", title: "x", explanation: "y", media_type: "image", url: "z" }) };
    };
    const r = await call("apod", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api_key=real-key-abc/);
    assert.equal(r.result.usingDemoKey, false);
    delete process.env.NASA_API_KEY;
  });

  it("passes date param when supplied", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ date: "2024-01-01", title: "x", explanation: "y", media_type: "image", url: "z" }) };
    };
    await call("apod", ctxA, { date: "2024-01-01" });
    assert.match(capturedUrl, /date=2024-01-01/);
  });

  it("surfaces NASA API errors verbatim", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await call("apod", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /nasa apod unreachable.*503/);
  });
});

describe("astronomy.iss-current-location (wheretheiss.at)", () => {
  it("hits the ISS API and shapes the response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          id: 25544, name: "iss",
          latitude: 47.5,  longitude: -122.3,
          altitude: 420.5, velocity: 27580.2,
          visibility: "daylight",
          footprint: 4490.5,
          solar_lat: 22.5, solar_lon: 180,
          timestamp: 1715882400, daynum: 2460441.5,
          units: "kilometers",
        }),
      };
    };
    const r = await call("iss-current-location", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.wheretheiss\.at\/v1\/satellites\/25544/);
    assert.equal(r.result.satelliteId, 25544);
    assert.equal(r.result.altitudeKm, 420.5);
    assert.equal(r.result.velocityKmH, 27580.2);
    assert.equal(r.result.source, "wheretheiss.at");
  });

  it("surfaces ISS API failures", async () => {
    const r = await call("iss-current-location", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /iss api unreachable/);
  });
});

describe("astronomy.near-earth-objects (NASA NeoWs)", () => {
  it("rejects malformed date", async () => {
    const r = await call("near-earth-objects", ctxA, { startDate: "yesterday" });
    assert.equal(r.ok, false);
    assert.match(r.error, /YYYY-MM-DD/);
  });

  it("hits NeoWs and parses real response shape", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          near_earth_objects: {
            "2026-05-16": [{
              id: "3542519", name: "(2010 PK9)",
              nasa_jpl_url: "https://ssd.jpl.nasa.gov/...",
              absolute_magnitude_h: 19.1,
              estimated_diameter: { meters: { estimated_diameter_min: 290.6, estimated_diameter_max: 650.0 } },
              is_potentially_hazardous_asteroid: true,
              is_sentry_object: false,
              close_approach_data: [{
                relative_velocity: { kilometers_per_hour: "63552.6" },
                miss_distance: { kilometers: "5482310.4", lunar: "14.26" },
                orbiting_body: "Earth",
              }],
            }, {
              id: "1234567", name: "(2024 X1)",
              absolute_magnitude_h: 25.0,
              estimated_diameter: { meters: { estimated_diameter_min: 10, estimated_diameter_max: 25 } },
              is_potentially_hazardous_asteroid: false,
              close_approach_data: [{
                relative_velocity: { kilometers_per_hour: "30000" },
                miss_distance: { kilometers: "500000", lunar: "1.3" },
                orbiting_body: "Earth",
              }],
            }],
          },
        }),
      };
    };
    const r = await call("near-earth-objects", ctxA, { startDate: "2026-05-16" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.nasa\.gov\/neo\/rest\/v1\/feed/);
    assert.match(capturedUrl, /start_date=2026-05-16/);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.hazardousCount, 1);
    // Sorted by miss distance ascending — closer one (500k km) first
    assert.equal(r.result.objects[0].name, "(2024 X1)");
    assert.equal(r.result.objects[1].name, "(2010 PK9)");
    assert.equal(r.result.source, "nasa-neows");
  });

  it("defaults to today when startDate not supplied", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ near_earth_objects: {} }) };
    };
    await call("near-earth-objects", ctxA, {});
    const today = new Date().toISOString().slice(0, 10);
    assert.match(capturedUrl, new RegExp(`start_date=${today}`));
  });

  it("surfaces NeoWs failures verbatim", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("near-earth-objects", ctxA, { startDate: "2026-05-16" });
    assert.equal(r.ok, false);
    assert.match(r.error, /neows unreachable.*429/);
  });
});

// ─── SkySafari / Stellarium feature-parity macros ──────────────────────

describe("astronomy.sky-chart (interactive real-time sky chart)", () => {
  it("requires observer coordinates", () => {
    const r = call("sky-chart", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /latitude and longitude/);
  });

  it("computes alt/az for bright stars at observer location/time", () => {
    const r = call("sky-chart", ctxA, { latitude: 40.7, longitude: -74, when: "2026-05-21T03:00:00Z" });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.stars) && r.result.stars.length > 0);
    const star = r.result.stars[0];
    assert.ok(typeof star.altitude === "number" && star.altitude >= -90 && star.altitude <= 90);
    assert.ok(star.azimuth >= 0 && star.azimuth < 360);
    assert.ok(typeof r.result.sun.altitude === "number");
    assert.ok(typeof r.result.moon.illumination === "number");
    assert.ok(Array.isArray(r.result.constellationLines));
    assert.equal(typeof r.result.visibleCount, "number");
  });

  it("Polaris altitude ≈ observer latitude (north star property)", () => {
    const r = call("sky-chart", ctxA, { latitude: 51.5, longitude: 0, when: "2026-05-21T22:00:00Z" });
    const polaris = r.result.stars.find((s) => s.name === "Polaris");
    assert.ok(polaris);
    assert.ok(Math.abs(polaris.altitude - 51.5) < 2);
  });
});

describe("astronomy.whats-up (tonight's-best visibility list)", () => {
  it("requires observer coordinates", () => {
    const r = call("whats-up", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("returns objects above the horizon sorted by altitude", () => {
    const r = call("whats-up", ctxA, { latitude: 40.7, longitude: -74, when: "2026-05-21T04:00:00Z", minAltitude: 0 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.objects));
    for (let i = 1; i < r.result.objects.length; i++) {
      assert.ok(r.result.objects[i - 1].altitude >= r.result.objects[i].altitude);
    }
    assert.equal(typeof r.result.darkSky, "boolean");
  });
});

describe("astronomy.constellations (lines + deep-sky overlay)", () => {
  it("returns constellation line topology and deep-sky catalogue", () => {
    const r = call("constellations", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
    assert.ok(r.result.deepSkyCount > 0);
    const orion = r.result.constellations.find((c) => c.name === "Orion");
    assert.ok(orion && orion.segments.length > 0);
    assert.ok(orion.segments[0].fromRaDec && orion.segments[0].toRaDec);
  });

  it("resolves alt/az for endpoints when observer supplied", () => {
    const r = call("constellations", ctxA, { latitude: 40.7, longitude: -74, when: "2026-05-21T03:00:00Z" });
    const seg = r.result.constellations[0].segments[0];
    assert.ok(seg.fromAltAz && typeof seg.fromAltAz.altitude === "number");
  });
});

describe("astronomy.ephemeris-calendar (moon phase + rise/set)", () => {
  it("requires observer coordinates", () => {
    const r = call("ephemeris-calendar", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("produces a multi-day moon-phase + rise/set calendar", () => {
    const r = call("ephemeris-calendar", ctxA, { latitude: 40.7, longitude: -74, startDate: "2026-05-21", days: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.calendar.length, 7);
    const day = r.result.calendar[0];
    assert.equal(day.date, "2026-05-21");
    assert.ok(typeof day.moonPhase === "string");
    assert.ok(day.moonIllumination >= 0 && day.moonIllumination <= 1);
  });
});

describe("astronomy.observing-forecast (light-pollution / conditions)", () => {
  it("requires observer coordinates", async () => {
    const r = await call("observing-forecast", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("hits open-meteo and scores observing conditions", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          hourly: {
            time: ["2026-05-21T22:00", "2026-05-21T23:00"],
            cloud_cover: [10, 80],
            visibility: [24000, 12000],
            relative_humidity_2m: [50, 70],
            temperature_2m: [12, 11],
          },
        }),
      };
    };
    const r = await call("observing-forecast", ctxA, { latitude: 40.7, longitude: -74 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.open-meteo\.com/);
    assert.equal(r.result.source, "open-meteo");
    assert.ok(r.result.hours[0].observingScore > r.result.hours[1].observingScore);
    assert.ok(r.result.bestWindow);
  });
});

describe("astronomy.goto-* (telescope GoTo INDI/ASCOM bridge)", () => {
  before(() => { globalThis._concordSTATE = globalThis._concordSTATE || {}; });

  it("sets and reads a mount profile", () => {
    const set = call("goto-mount-set", ctxA, { protocol: "ascom", host: "192.168.1.5", port: 11880, name: "EQ6-R" });
    assert.equal(set.ok, true);
    assert.equal(set.result.mount.protocol, "ascom");
    const get = call("goto-mount-get", ctxA, {});
    assert.equal(get.result.mount.name, "EQ6-R");
  });

  it("enqueues a GoTo command with resolved alt/az", () => {
    const r = call("goto-command", ctxA, { targetName: "M31", ra: 10.68, dec: 41.27, latitude: 40.7, longitude: -74 });
    assert.equal(r.ok, true);
    assert.equal(r.result.command.targetName, "M31");
    assert.ok(r.result.command.altAz);
    assert.equal(r.result.command.status, "queued");
  });

  it("rejects a command without ra/dec", () => {
    const r = call("goto-command", ctxA, { targetName: "Nowhere" });
    assert.equal(r.ok, false);
  });

  it("lists the queue and updates command status", () => {
    const q = call("goto-queue", ctxA, {});
    assert.ok(q.result.count >= 1);
    const upd = call("goto-command-update", ctxA, { id: q.result.queue[0].id, status: "completed" });
    assert.equal(upd.result.command.status, "completed");
    const cleared = call("goto-clear", ctxA, {});
    assert.ok(cleared.result.removed >= 1);
  });
});

describe("astronomy.ar-resolve (point-phone-at-sky AR)", () => {
  it("requires observer + pointing direction", () => {
    const r = call("ar-resolve", ctxA, { latitude: 40.7, longitude: -74 });
    assert.equal(r.ok, false);
  });

  it("resolves the bright stars near a device-pointing direction", () => {
    const chart = call("sky-chart", ctxA, { latitude: 40.7, longitude: -74, when: "2026-05-21T03:00:00Z" });
    const upStar = chart.result.stars.filter((s) => s.visible).sort((a, b) => b.altitude - a.altitude)[0];
    assert.ok(upStar);
    const r = call("ar-resolve", ctxA, {
      latitude: 40.7, longitude: -74, when: "2026-05-21T03:00:00Z",
      altitude: upStar.altitude, azimuth: upStar.azimuth, fov: 20,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.nearest);
    assert.ok(r.result.nearest.separationDeg <= 20);
  });
});
