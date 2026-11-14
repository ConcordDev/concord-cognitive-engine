// FIX-urban-planning-002 — transit stops did not persist: the panel kept
// them in useState only, so a reload dropped every stop while parcels in
// the same workspace (server store) survived. These tests drive the new
// stop-add / stop-list / stop-remove actions through the parity harness
// shape and verify the parcel-mirror behaviour: per-user persistence,
// validation, and removal.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerUrbanPlanningActions from "../domains/urbanplanning.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
__setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`urban-planning.${name}`);
  if (!fn) throw new Error(`urban-planning.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerUrbanPlanningActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("urban-planning transit stops persist (FIX-urban-planning-002)", () => {
  it("a stop added is returned by stop-list (the reload read), scoped to its owner", () => {
    const add = call("stop-add", ctxA, { name: "Concord Ave", mode: "rail", lat: 37.978, lng: -122.0311 });
    assert.equal(add.ok, true);
    assert.equal(add.result.stop.mode, "rail");
    const listA = call("stop-list", ctxA, {});
    assert.equal(listA.ok, true);
    assert.equal(listA.result.stops.length, 1);
    assert.equal(listA.result.stops[0].lat, 37.978);
    const listB = call("stop-list", ctxB, {});
    assert.equal(listB.result.stops.length, 0);
  });

  it("stop-add refuses missing or out-of-range coordinates and stores nothing", () => {
    assert.equal(call("stop-add", ctxA, { mode: "bus" }).ok, false);
    assert.equal(call("stop-add", ctxA, { lat: 91, lng: 0 }).ok, false);
    assert.equal(call("stop-add", ctxA, { lat: 0, lng: -181 }).ok, false);
    assert.equal(call("stop-list", ctxA, {}).result.stops.length, 0);
  });

  it("an unknown mode falls back to bus and an empty name gets a label", () => {
    const add = call("stop-add", ctxA, { mode: "hyperloop", lat: 1, lng: 2 });
    assert.equal(add.ok, true);
    assert.equal(add.result.stop.mode, "bus");
    assert.match(add.result.stop.name, /bus stop/);
  });

  it("stop-remove deletes the owner's stop and reports not_found for a stranger's", () => {
    const add = call("stop-add", ctxA, { name: "Mine", mode: "bus", lat: 3, lng: 4 });
    const id = add.result.stop.id;
    assert.equal(call("stop-remove", ctxB, { id }).ok, false);
    assert.equal(call("stop-list", ctxA, {}).result.stops.length, 1);
    const rm = call("stop-remove", ctxA, { id });
    assert.equal(rm.ok, true);
    assert.equal(call("stop-list", ctxA, {}).result.stops.length, 0);
  });
});
