// Contract tests for the space launch-watchlist and geology field
// observation-log substrates (server/domains/space.js + geology.js).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSpaceActions from "../domains/space.js";
import registerGeologyActions from "../domains/geology.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSpaceActions(register); registerGeologyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("space.launch-watchlist", () => {
  it("tracks a launch scoped per user", () => {
    const r = call("space", "launch-track", ctxA, { name: "Starship Flight 12", provider: "SpaceX", net: "2099-06-01" });
    assert.equal(r.ok, true);
    assert.equal(call("space", "launch-watchlist", ctxA, {}).result.count, 1);
    assert.equal(call("space", "launch-watchlist", ctxB, {}).result.count, 0);
  });
  it("rejects a duplicate and a nameless track", () => {
    call("space", "launch-track", ctxA, { name: "Artemis III", launchId: "art-3" });
    assert.equal(call("space", "launch-track", ctxA, { name: "Artemis III again", launchId: "art-3" }).ok, false);
    assert.equal(call("space", "launch-track", ctxA, {}).ok, false);
  });
  it("computes days-until and sorts upcoming first", () => {
    call("space", "launch-track", ctxA, { name: "Far", net: "2099-12-31" });
    call("space", "launch-track", ctxA, { name: "Soon", net: "2099-01-02" });
    const wl = call("space", "launch-watchlist", ctxA, {});
    assert.equal(wl.result.items[0].name, "Soon");
    assert.ok(wl.result.items[0].daysUntil > 0);
  });
  it("marks watched and untracks", () => {
    const t = call("space", "launch-track", ctxA, { name: "Crew-12" }).result.item;
    assert.equal(call("space", "launch-mark-watched", ctxA, { id: t.id }).result.watched, true);
    assert.equal(call("space", "launch-untrack", ctxA, { id: t.id }).ok, true);
    assert.equal(call("space", "launch-watchlist", ctxA, {}).result.count, 0);
  });
});

describe("geology.observation-log", () => {
  it("logs a field observation scoped per user", () => {
    const r = call("geology", "observation-log", ctxA, { name: "Basalt columns", kind: "outcrop", lat: 45.1, lon: -122.3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.observation.kind, "outcrop");
    assert.equal(call("geology", "observation-list", ctxA, {}).result.count, 1);
    assert.equal(call("geology", "observation-list", ctxB, {}).result.count, 0);
  });
  it("defaults an unknown kind to rock and rejects a nameless log", () => {
    const r = call("geology", "observation-log", ctxA, { name: "Sample", kind: "nonsense" });
    assert.equal(r.result.observation.kind, "rock");
    assert.equal(call("geology", "observation-log", ctxA, {}).ok, false);
  });
  it("filters by kind and updates / deletes an observation", () => {
    call("geology", "observation-log", ctxA, { name: "Quartz", kind: "mineral" });
    const fossil = call("geology", "observation-log", ctxA, { name: "Trilobite", kind: "fossil" }).result.observation;
    assert.equal(call("geology", "observation-list", ctxA, { kind: "fossil" }).result.count, 1);
    call("geology", "observation-update", ctxA, { id: fossil.id, notes: "Cambrian" });
    assert.equal(call("geology", "observation-list", ctxA, { kind: "fossil" }).result.observations[0].notes, "Cambrian");
    call("geology", "observation-delete", ctxA, { id: fossil.id });
    assert.equal(call("geology", "observation-list", ctxA, { kind: "fossil" }).result.count, 0);
  });
  it("field-dashboard aggregates by kind + geotag count", () => {
    call("geology", "observation-log", ctxA, { name: "A", kind: "rock", lat: 1, lon: 2 });
    call("geology", "observation-log", ctxA, { name: "B", kind: "rock" });
    const d = call("geology", "field-dashboard", ctxA, {});
    assert.equal(d.result.totalObservations, 2);
    assert.equal(d.result.byKind.rock, 2);
    assert.equal(d.result.geotagged, 1);
  });
});
