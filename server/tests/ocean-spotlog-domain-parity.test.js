// Contract tests for the ocean lens — surf/dive/fishing spot log
// substrate in server/domains/ocean.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerOceanActions from "../domains/ocean.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ocean.${name}`);
  assert.ok(fn, `ocean.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerOceanActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("ocean.spot CRUD", () => {
  it("adds a spot scoped per user", () => {
    call("spot-add", ctxA, { name: "Mavericks", kind: "surf", lat: 37.49, lon: -122.5 });
    assert.equal(call("spot-list", ctxA, {}).result.count, 1);
    assert.equal(call("spot-list", ctxB, {}).result.count, 0);
  });
  it("rejects a nameless spot; unknown kind falls back to surf", () => {
    assert.equal(call("spot-add", ctxA, {}).ok, false);
    assert.equal(call("spot-add", ctxA, { name: "X", kind: "weird" }).result.spot.kind, "surf");
  });
  it("delete removes the spot and its sessions", () => {
    const sp = call("spot-add", ctxA, { name: "Reef" }).result.spot;
    call("session-log", ctxA, { spotId: sp.id, date: "2026-05-01" });
    call("spot-delete", ctxA, { id: sp.id });
    assert.equal(call("spot-list", ctxA, {}).result.count, 0);
    assert.equal(call("session-list", ctxA, {}).result.count, 0);
  });
});

describe("ocean.session log", () => {
  it("logs a session against a spot", () => {
    const sp = call("spot-add", ctxA, { name: "Pipeline", kind: "surf" }).result.spot;
    const ses = call("session-log", ctxA, { spotId: sp.id, waveHeightM: 2.4, rating: 5, conditions: "clean" });
    assert.equal(ses.ok, true);
    assert.equal(ses.result.session.rating, 5);
    assert.equal(call("session-list", ctxA, { spotId: sp.id }).result.count, 1);
  });
  it("rejects a session on an unknown spot", () => {
    assert.equal(call("session-log", ctxA, { spotId: "nope" }).ok, false);
  });
  it("deletes a session", () => {
    const sp = call("spot-add", ctxA, { name: "Cove" }).result.spot;
    const ses = call("session-log", ctxA, { spotId: sp.id }).result.session;
    call("session-delete", ctxA, { id: ses.id });
    assert.equal(call("session-list", ctxA, {}).result.count, 0);
  });
});

describe("ocean.dashboard", () => {
  it("aggregates spots, sessions and average rating", () => {
    const sp = call("spot-add", ctxA, { name: "Bay", kind: "dive" }).result.spot;
    call("session-log", ctxA, { spotId: sp.id, rating: 4 });
    call("session-log", ctxA, { spotId: sp.id, rating: 2 });
    const d = call("ocean-dashboard", ctxA, {});
    assert.equal(d.result.spots, 1);
    assert.equal(d.result.sessions, 2);
    assert.equal(d.result.avgRating, 3);
    assert.equal(d.result.byKind.dive, 1);
  });
});

describe("ocean — analysis macros still intact", () => {
  it("waveAnalysis still responds", () => {
    assert.equal(call("waveAnalysis", ctxA, {}).ok, true);
  });
});
