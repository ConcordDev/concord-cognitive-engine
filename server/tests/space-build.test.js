// Space lens build tests (B2, 2026-11-03) — pins for the R2 first-pass
// findings S2/S4/S5 as built in PR build(space):
//   F4 launchWindow windows/day is a sane estimate (never 492,728)
//   F6 launch-countdown picks the next FUTURE launch on both sources
//   F5 launches-filtered requests mode=detailed so facets populate
//   F7 rocket-detail falls back to Launch Library 2 when SpaceX is down
//   F7 apod serves its last good answer, labelled stale, on quota failure
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSpaceActions from "../domains/space.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";

__setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`space.${name}`);
  if (!fn) throw new Error(`space.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => {
  globalThis._concordSTATE = { spaceLens: {} };
  registerSpaceActions(register);
});
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const nowS = () => Math.floor(Date.now() / 1000);

describe("space.launchWindow (F4)", () => {
  it("LEO at matched latitude/inclination: ~2 windows/day, direct ascent", () => {
    const r = call("launchWindow", ctxA, { targetOrbit: "LEO", launchLatitude: 28.5, inclination: 28.5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.windowsPerDay, 2);
    assert.ok(r.result.windowsPerDay <= 4);
    assert.equal(r.result.inclinationPenalty, "Direct ascent possible");
    assert.match(r.result.nextWindowApprox, /ephemeris/i);
  });
  it("GEO: 1 window/day; large latitude mismatch keeps the dogleg penalty", () => {
    const r = call("launchWindow", ctxA, { targetOrbit: "GEO", launchLatitude: 5, inclination: 51.6 });
    assert.equal(r.result.windowsPerDay, 1);
    assert.match(r.result.inclinationPenalty, /Dogleg/);
  });
});

describe("space.launch-countdown (F6)", () => {
  it("SpaceX path skips a launch whose time has already passed", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([
        { id: "past", name: "Already Gone", date_unix: nowS() - 3600, date_utc: "x", date_precision: "hour", links: {} },
        { id: "next", name: "Next One", date_unix: nowS() + 7200, date_utc: "y", date_precision: "hour", links: {} },
      ]),
    });
    const r = await call("launch-countdown", ctxA, { source: "spacex" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.id, "next");
    assert.ok(r.result.tMinusSeconds > 0);
  });
  it("Launch Library path rolls past a stale NET to the next future launch", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [
          { id: "stale", name: "Stale NET", net: new Date(Date.now() - 3600e3).toISOString(), status: { name: "Go" }, launch_service_provider: { name: "SpaceX" }, rocket: { configuration: { full_name: "Falcon 9" } }, pad: { name: "SLC-40" }, vid_urls: [] },
          { id: "future", name: "Future NET", net: new Date(Date.now() + 86400e3).toISOString(), status: { name: "Go" }, launch_service_provider: { name: "ULA" }, rocket: { configuration: { full_name: "Atlas V" } }, pad: { name: "SLC-41" }, vid_urls: [] },
        ],
      }),
    });
    const r = await call("launch-countdown", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.id, "future");
    assert.ok(r.result.tMinusSeconds > 0);
  });
});

describe("space.launches-filtered (F5)", () => {
  it("requests detailed mode and surfaces real facet values", async () => {
    let url = "";
    globalThis.fetch = async (u) => {
      url = String(u);
      return {
        ok: true,
        json: async () => ({
          results: [
            { id: "a", name: "Falcon 9 · Starlink", net: "2026-06-01T00:00:00Z", status: { name: "Go" }, launch_service_provider: { name: "SpaceX" }, rocket: { configuration: { full_name: "Falcon 9 Block 5" } }, mission: { orbit: { name: "Low Earth Orbit" } }, pad: { name: "SLC-40", country_code: "USA" } },
          ],
        }),
      };
    };
    const r = await call("launches-filtered", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(url, /mode=detailed/);
    assert.equal(r.result.launches[0].provider, "SpaceX");
    assert.equal(r.result.launches[0].orbit, "Low Earth Orbit");
    assert.ok(r.result.facets.countries.includes("USA"));
  });
});

describe("space.rocket-detail (F7 fallback)", () => {
  const ll2 = (path) => {
    if (path.includes("/config/launcher/")) {
      return {
        ok: true,
        json: async () => ({
          results: [
            { id: 164, name: "Falcon 9", full_name: "Falcon 9 Block 5", manufacturer: { name: "SpaceX", country_code: "USA" }, maiden_flight: "2018-05-11", length: 70, diameter: 3.7, launch_mass: 549, leo_capacity: 22800, gto_capacity: 8300, launch_cost: 67000000, max_stage: 2, total_launch_count: 300, successful_launches: 298, description: "Two-stage rocket.", wiki_url: "https://en.wikipedia.org/wiki/Falcon_9", image_url: "https://img.example/f9.jpg" },
          ],
        }),
      };
    }
    throw new Error("unexpected LL2 path");
  };
  it("serves the fleet from Launch Library 2 when SpaceX is unreachable", async () => {
    globalThis.fetch = async (u) => {
      const url = String(u);
      if (url.includes("api.spacexdata.com")) throw new Error("spacex 522");
      return ll2(url);
    };
    const r = await call("rocket-detail", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.fleet.length, 1);
    assert.equal(r.result.fleet[0].name, "Falcon 9 Block 5");
    assert.equal(r.result.source, "thespacedevs-launch-library");
  });
  it("resolves a numeric LL2 fleet id to a spec with kg-converted mass", async () => {
    globalThis.fetch = async (u) => {
      const url = String(u);
      if (url.includes("api.spacexdata.com")) throw new Error("spacex 522");
      return ll2(url);
    };
    const r = await call("rocket-detail", ctxA, { rocketId: "164" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.massKg, 549000);
    assert.equal(r.result.heightMeters, 70);
    assert.equal(r.result.successRatePct, 99);
    assert.equal(r.result.payloadWeights[0].kg, 22800);
    assert.equal(r.result.source, "thespacedevs-launch-library");
  });
});

describe("space.apod (F7 stale fallback)", () => {
  it("serves the last good answer labelled stale when the quota fails", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ date: "2026-05-21", title: "Nebula", explanation: "x", media_type: "image", url: "https://apod.nasa.gov/x.jpg" }),
    });
    const first = await call("apod", ctxA, { date: "2026-05-21" });
    assert.equal(first.ok, true);
    assert.equal(first.result.stale, undefined);
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const second = await call("apod", ctxA, { date: "2026-05-21" });
    assert.equal(second.ok, true);
    assert.equal(second.result.stale, true);
    assert.equal(second.result.items[0].title, "Nebula");
    assert.match(second.result.staleNote, /NASA_API_KEY/);
  });
  it("still fails honestly when nothing has ever been fetched", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const r = await call("apod", ctxA, { date: "2026-01-04" });
    assert.equal(r.ok, false);
    assert.match(r.error, /nasa apod/);
  });
});
