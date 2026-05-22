// Contract tests for the Combat Sandbox lens — persistence substrate in
// server/domains/sandbox.js (loadouts, dummy presets, replays, telemetry).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSandboxActions from "../domains/sandbox.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`sandbox.${name}`);
  assert.ok(fn, `sandbox.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSandboxActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("sandbox.catalog", () => {
  it("returns the weapon / skill / behavior vocabulary", () => {
    const r = call("catalog", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.weapons.length >= 3);
    assert.ok(r.result.skills.some((k) => k.id === "none"));
    assert.ok(r.result.behaviors.some((b) => b.id === "aggressive"));
  });
});

describe("sandbox loadouts", () => {
  it("saves, lists and deletes a loadout per user", () => {
    const s = call("saveLoadout", ctxA, { weaponId: "blade", skillId: "ember-arc", name: "DPS test" });
    assert.equal(s.ok, true);
    assert.equal(s.result.loadout.weaponId, "blade");
    const id = s.result.loadout.id;
    assert.equal(call("listLoadouts", ctxA, {}).result.count, 1);
    assert.equal(call("listLoadouts", ctxB, {}).result.count, 0);
    const del = call("deleteLoadout", ctxA, { loadoutId: id });
    assert.equal(del.ok, true);
    assert.equal(call("listLoadouts", ctxA, {}).result.count, 0);
  });
  it("rejects an unknown weapon or skill", () => {
    assert.equal(call("saveLoadout", ctxA, { weaponId: "nope" }).ok, false);
    assert.equal(call("saveLoadout", ctxA, { weaponId: "fist", skillId: "nope" }).ok, false);
  });
});

describe("sandbox dummy configs", () => {
  it("saves, lists and deletes a dummy behavior preset", () => {
    const s = call("saveDummyConfig", ctxA, { behaviorId: "aggressive", hp: 250, count: 5, name: "Pressure test" });
    assert.equal(s.ok, true);
    assert.equal(s.result.dummyConfig.hp, 250);
    assert.equal(s.result.dummyConfig.count, 5);
    const id = s.result.dummyConfig.id;
    assert.equal(call("listDummyConfigs", ctxA, {}).result.count, 1);
    assert.equal(call("deleteDummyConfig", ctxA, { configId: id }).ok, true);
    assert.equal(call("listDummyConfigs", ctxA, {}).result.count, 0);
  });
  it("clamps count to 1..10 and rejects unknown behavior", () => {
    assert.equal(call("saveDummyConfig", ctxA, { behaviorId: "static", count: 99 }).result.dummyConfig.count, 10);
    assert.equal(call("saveDummyConfig", ctxA, { behaviorId: "nope" }).ok, false);
  });
});

describe("sandbox replays", () => {
  it("records a replay and reads it back frame by frame", () => {
    const frames = [
      { t: 0, kind: "hit", targetId: "dummy_0", damage: 12 },
      { t: 320, kind: "hit", targetId: "dummy_0", damage: 26, heavy: true, isCrit: true },
    ];
    const s = call("saveReplay", ctxA, { name: "combo", frames });
    assert.equal(s.ok, true);
    assert.equal(s.result.frameCount, 2);
    const list = call("listReplays", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.replays[0].totalDamage, 38);
    const full = call("getReplay", ctxA, { replayId: list.result.replays[0].id });
    assert.equal(full.result.replay.frames.length, 2);
    assert.equal(full.result.replay.durationMs, 320);
    assert.equal(call("deleteReplay", ctxA, { replayId: list.result.replays[0].id }).ok, true);
  });
  it("rejects an empty replay and an unknown id", () => {
    assert.equal(call("saveReplay", ctxA, { frames: [] }).ok, false);
    assert.equal(call("getReplay", ctxA, { replayId: "nope" }).ok, false);
  });
});

describe("sandbox telemetry", () => {
  it("records frame-time samples and aggregates them", () => {
    const r = call("recordTelemetry", ctxA, {
      name: "feel pass",
      frameTimes: [16.6, 16.7, 33.4, 16.5, 16.8],
      hitstops: [80, 50, 120],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.sample.avgFps > 0);
    assert.equal(r.result.sample.hitstopCount, 3);
    assert.equal(r.result.sample.jankFrames, 1); // the 33.4ms frame
    const stats = call("telemetryStats", ctxA, {});
    assert.equal(stats.result.count, 1);
    assert.ok(stats.result.overall.sessions === 1);
    assert.equal(call("deleteTelemetry", ctxA, { sampleId: r.result.sample.id }).ok, true);
    assert.equal(call("telemetryStats", ctxA, {}).result.count, 0);
  });
  it("rejects an empty telemetry batch", () => {
    assert.equal(call("recordTelemetry", ctxA, { frameTimes: [] }).ok, false);
  });
  it("returns an empty overall when no samples exist", () => {
    assert.equal(call("telemetryStats", ctxB, {}).result.overall, null);
  });
});
