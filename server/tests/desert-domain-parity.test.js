// Contract tests for server/domains/desert.js — desert field-survey /
// expedition tooling macros: route planner, heat/UV alerts, resource
// node mapping, solar calculator, terrain overlay, survival kit.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDesertActions from "../domains/desert.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`desert.${name}`);
  if (!fn) throw new Error(`desert.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  globalThis._concordSTATE = globalThis._concordSTATE || {};
  registerDesertActions(register);
});

beforeEach(() => {
  // Reset per-user desert state between tests.
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.desertLens;
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

const WP = [
  { name: "Camp", lat: 25.0, lng: 30.0, terrain: "rocky" },
  { name: "Dune Ridge", lat: 25.2, lng: 30.3, terrain: "dune" },
  { name: "Oasis", lat: 25.4, lng: 30.5, terrain: "oasis" },
];

describe("desert route planner", () => {
  it("routePreview computes legs + totals without persisting", () => {
    const r = call("routePreview", ctxA, { waypoints: WP, teamSize: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.legs.length, 2);
    assert.ok(r.result.totals.distanceKm > 0);
    assert.ok(r.result.totals.waterLiters > 0);
    assert.equal(r.result.totals.teamSize, 3);
  });

  it("routePreview rejects fewer than 2 valid waypoints", () => {
    const r = call("routePreview", ctxA, { waypoints: [WP[0]] });
    assert.equal(r.ok, false);
  });

  it("routeSave persists and routeList returns it", () => {
    const saved = call("routeSave", ctxA, { name: "Sahara Crossing", waypoints: WP });
    assert.equal(saved.ok, true);
    assert.ok(saved.result.id);
    const list = call("routeList", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.routes[0].name, "Sahara Crossing");
  });

  it("routeDelete removes a saved route", () => {
    const saved = call("routeSave", ctxA, { name: "X", waypoints: WP });
    const del = call("routeDelete", ctxA, { id: saved.result.id });
    assert.equal(del.ok, true);
    assert.equal(call("routeList", ctxA, {}).result.count, 0);
  });
});

describe("desert heat/UV alerts", () => {
  function stubWeather() {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 47, relative_humidity_2m: 12, wind_speed_10m: 55, apparent_temperature: 49, time: "2026-05-21T12:00" },
        hourly: { time: ["2099-01-01T00:00"], uv_index: [11.5], temperature_2m: [47], relative_humidity_2m: [12], wind_speed_10m: [55] },
        daily: { time: ["2026-05-21"], uv_index_max: [11], temperature_2m_max: [48], temperature_2m_min: [28], sunrise: ["x"], sunset: ["y"] },
      }),
    });
  }

  it("heatUvAlert shapes a live forecast into alert levels", async () => {
    stubWeather();
    const r = await call("heatUvAlert", ctxA, { name: "Death Valley", lat: 36.5, lng: -116.9 });
    assert.equal(r.ok, true);
    assert.ok(r.result.heatIndexC > 0);
    assert.equal(r.result.alertLevel, "extreme");
    assert.ok(r.result.alerts.length > 0);
  });

  it("heatUvAlert rejects missing coordinates", async () => {
    const r = await call("heatUvAlert", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("trackedAdd + trackedAlerts + trackedDelete round-trip", async () => {
    stubWeather();
    const add = call("trackedAdd", ctxA, { name: "Base", lat: 25, lng: 30 });
    assert.equal(add.ok, true);
    const alerts = await call("trackedAlerts", ctxA, {});
    assert.equal(alerts.ok, true);
    assert.equal(alerts.result.count, 1);
    assert.ok(alerts.result.tracked[0].alert);
    const del = call("trackedDelete", ctxA, { id: add.result.id });
    assert.equal(del.ok, true);
  });
});

describe("desert resource node mapping", () => {
  it("nodeSave + nodeList + nodeDelete round-trip", () => {
    const saved = call("nodeSave", ctxA, { name: "Spring", kind: "water", lat: 25, lng: 30, reliability: "confirmed" });
    assert.equal(saved.ok, true);
    const list = call("nodeList", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.byKind.water, 1);
    const del = call("nodeDelete", ctxA, { id: saved.result.id });
    assert.equal(del.ok, true);
  });

  it("nodeSave rejects an unknown kind", () => {
    const r = call("nodeSave", ctxA, { name: "x", kind: "lava", lat: 25, lng: 30 });
    assert.equal(r.ok, false);
  });

  it("nodesNearby returns nearest water + shade with distances", () => {
    call("nodeSave", ctxA, { name: "Well", kind: "water", lat: 25.0, lng: 30.0 });
    call("nodeSave", ctxA, { name: "Rock shade", kind: "shade", lat: 25.1, lng: 30.1 });
    call("nodeSave", ctxA, { name: "Sinkhole", kind: "hazard", lat: 25.05, lng: 30.05 });
    const r = call("nodesNearby", ctxA, { lat: 25.0, lng: 30.0, radiusKm: 100 });
    assert.equal(r.ok, true);
    assert.ok(r.result.nearestWater);
    assert.ok(r.result.nearestShade);
    assert.equal(r.result.hazards.length, 1);
    assert.ok(r.result.nodes.every((n) => typeof n.distanceKm === "number"));
  });
});

describe("desert solar-installation calculator", () => {
  it("solarInstall sizes an array from a target daily load", () => {
    const r = call("solarInstall", ctxA, { latitude: 25, targetDailyKwh: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.sizedFor, "targetLoad");
    assert.ok(r.result.panelCount > 0);
    assert.ok(r.result.dailyKwh >= 30 * 0.9);
    assert.ok(r.result.annualKwh > 0);
  });

  it("solarInstall sizes by fixed panel count", () => {
    const r = call("solarInstall", ctxA, { latitude: 25, panelCount: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.result.sizedFor, "panelCount");
    assert.equal(r.result.panelCount, 100);
    assert.ok(r.result.footprintM2 > 0);
  });

  it("solarInstall rejects missing latitude", () => {
    assert.equal(call("solarInstall", ctxA, { panelCount: 10 }).ok, false);
  });
});

describe("desert terrain overlay", () => {
  it("terrainOverlay classifies samples and reports distribution", () => {
    const r = call("terrainOverlay", ctxA, {
      samples: [
        { lat: 25, lng: 30, soil: "sand", duneHeightM: 8 },
        { lat: 25.1, lng: 30.1, soil: "rock", slopePercent: 3 },
        { lat: 25.2, lng: 30.2, soil: "salt" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.ok(r.result.distribution.length > 0);
    assert.ok(r.result.dominant);
    assert.ok(["easy", "moderate", "difficult"].includes(r.result.overallTraversability));
  });

  it("terrainOverlay rejects an empty sample set", () => {
    assert.equal(call("terrainOverlay", ctxA, { samples: [] }).ok, false);
  });
});

describe("desert survival kit checklist", () => {
  it("kitSave generates a baseline kit scaled to team + days", () => {
    const r = call("kitSave", ctxA, { name: "Recon kit", teamSize: 4, days: 5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.items.length > 0);
    assert.equal(r.result.stats.packed, 0);
    assert.ok(r.result.stats.criticalTotal > 0);
  });

  it("kitToggleItem flips packed state and recomputes stats", () => {
    const kit = call("kitSave", ctxA, { name: "K", teamSize: 1, days: 1 }).result;
    const itemId = kit.items[0].id;
    const toggled = call("kitToggleItem", ctxA, { id: kit.id, itemId });
    assert.equal(toggled.ok, true);
    assert.equal(toggled.result.stats.packed, 1);
  });

  it("kitList + kitDelete round-trip", () => {
    const kit = call("kitSave", ctxA, { name: "K2", teamSize: 2, days: 2 }).result;
    assert.equal(call("kitList", ctxA, {}).result.count, 1);
    const del = call("kitDelete", ctxA, { id: kit.id });
    assert.equal(del.ok, true);
    assert.equal(call("kitList", ctxA, {}).result.count, 0);
  });
});

describe("desert pure-compute analysis macros", () => {
  it("waterBudget classifies aridity", () => {
    const fn = ACTIONS.get("desert.waterBudget");
    const r = fn(ctxA, { data: { annualRainfallMm: 50 } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.aridity, "hyper-arid");
  });

  it("heatStressIndex returns a risk level", () => {
    const fn = ACTIONS.get("desert.heatStressIndex");
    const r = fn(ctxA, { data: { temperatureCelsius: 50, humidityPercent: 30 } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.riskLevel);
  });
});
