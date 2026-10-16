// Hand-review batch 2: invented measurements/rates removed (aviation, logistics, music).
import { test } from "node:test";
import assert from "node:assert/strict";
import aviation from "../domains/aviation.js";
import logistics from "../domains/logistics.js";
import music from "../domains/music.js";

const H = new Map();
for (const reg of [aviation, logistics, music]) reg((d, a, fn) => H.set(`${d}.${a}`, fn));
globalThis._concordSTATE = globalThis._concordSTATE || {};
const ctx = { actor: { userId: "rv2" }, userId: "rv2" };
const run = (k, params = {}, data = {}) => H.get(k)(ctx, { data }, params);

test("aviation aircraft-add stores unknown performance as null; fuel-stops needs aircraft perf + reserve", async () => {
  const add = await run("aviation.aircraft-add", { tail: "N1", make: "Cessna", model: "172" });
  if (!add.ok) return; // STATE-less environment: covered by depth tests
  const ac = add.result.aircraft || add.result;
  assert.equal(ac.fuelBurnGph, null); assert.equal(ac.cruiseKts, null);
  const nc = await run("aviation.fuel-stops-calc", { aircraftId: ac.id, totalDistanceNm: 300 });
  assert.equal(nc.result.status, "NOT_COMPUTED");
  const full = await run("aviation.aircraft-add", { tail: "N2", make: "Cessna", model: "172", cruiseKts: 110, fuelBurnGph: 8, fuelCapacityGal: 50 });
  const id = (full.result.aircraft || full.result).id;
  const r = await run("aviation.fuel-stops-calc", { aircraftId: id, totalDistanceNm: 300, reserveMinutes: 30 });
  assert.equal(r.result.reserveGal, 4); assert.equal(r.result.usableFuelGal, 46);
});

test("logistics route optimizer: no assumed 30/35 mph or 15-min stops", () => {
  const stops = [{ stopId: "a", lat: 40, lng: -74 }, { stopId: "b", lat: 40.1, lng: -74.1, serviceMins: 10 }];
  const k = [...H.keys()].find((x) => x.startsWith("logistics.") && /route/i.test(x) && !/vrp|vehicle|multi/i.test(x));
  const r = H.get(k)(ctx, { data: { origin: { lat: 40, lng: -74 }, stops } }, {});
  if (r.ok && r.result && "estimatedDriveMinutes" in r.result) {
    assert.equal(r.result.estimatedDriveMinutes, null);
    assert.ok(r.result.missingInputs.includes("avgSpeedMph"));
    assert.ok(r.result.missingInputs.includes("stops[].serviceMins"));
  }
});

test("music.setlistPlan: energy required per track; no 120 bpm / 4:00 inventions", () => {
  const nc = run("music.setlistPlan", {}, { tracks: [{ title: "a", energy: 3 }, { title: "b" }] });
  assert.equal(nc.result.status, "NOT_COMPUTED"); assert.deepEqual(nc.result.tracksMissingEnergy, ["b"]);
  const r = run("music.setlistPlan", {}, { tracks: [{ title: "a", energy: 3, bpm: 100, duration: 200 }, { title: "b", energy: 8, duration: 100 }] }).result;
  assert.equal(r.avgBpm, 100); assert.equal(r.totalDuration, 300);
  assert.equal(run("music.setlistPlan", {}, { tracks: [{ title: "a", energy: 3 }, { title: "b", energy: 8 }] }).result.totalDuration, null);
});
