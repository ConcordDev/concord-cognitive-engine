// Contract tests for the astronomy Stellarium + SkySafari 2026-parity
// sky-observation macros (targets, observations, sessions, equipment,
// wishlist, events, catalog). NASA-API macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAstronomyActions from "../domains/astronomy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`astronomy.${name}`);
  assert.ok(fn, `astronomy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAstronomyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newTarget(ctx = ctxA, over = {}) {
  return call("target-add", ctx, { name: "Orion Nebula", type: "nebula", constellation: "Orion", magnitude: 4, ...over }).result.target;
}

describe("astronomy.target-*", () => {
  it("add requires a name, scoped per user", () => {
    assert.equal(call("target-add", ctxA, {}).ok, false);
    newTarget();
    assert.equal(call("target-list", ctxA, {}).result.count, 1);
    assert.equal(call("target-list", ctxB, {}).result.count, 0);
  });

  it("update, detail and delete", () => {
    const t = newTarget();
    assert.equal(call("target-update", ctxA, { id: t.id, magnitude: 3.5 }).result.target.magnitude, 3.5);
    assert.equal(call("target-detail", ctxA, { id: t.id }).ok, true);
    assert.equal(call("target-delete", ctxA, { id: t.id }).ok, true);
    assert.equal(call("target-list", ctxA, {}).result.count, 0);
  });
});

describe("astronomy.observation-*", () => {
  it("log observation marks the target observed", () => {
    const t = newTarget();
    call("observation-log", ctxA, { targetId: t.id, conditions: "clear", rating: 4 });
    const list = call("target-list", ctxA, {});
    assert.equal(list.result.targets[0].observed, true);
    assert.equal(list.result.targets[0].observationCount, 1);
    assert.equal(call("observation-list", ctxA, { targetId: t.id }).result.count, 1);
  });

  it("rejects observation on a missing target", () => {
    assert.equal(call("observation-log", ctxA, { targetId: "nope" }).ok, false);
  });
});

describe("astronomy.sessions", () => {
  it("session detail collects its observations", () => {
    const t = newTarget();
    const ses = call("session-create", ctxA, { location: "Backyard", bortle: 6 }).result.session;
    call("observation-log", ctxA, { targetId: t.id, sessionId: ses.id });
    const detail = call("session-detail", ctxA, { id: ses.id });
    assert.equal(detail.result.observations.length, 1);
    assert.equal(call("session-list", ctxA, {}).result.sessions[0].observationCount, 1);
  });
});

describe("astronomy.equipment", () => {
  it("add, list and delete equipment", () => {
    const eq = call("equipment-add", ctxA, { name: "8\" Dobsonian", kind: "telescope", aperture: 203 }).result.equipment;
    assert.equal(call("equipment-list", ctxA, {}).result.equipment.length, 1);
    assert.equal(call("equipment-delete", ctxA, { id: eq.id }).ok, true);
    assert.equal(call("equipment-add", ctxA, {}).ok, false);
  });
});

describe("astronomy.wishlist", () => {
  it("wishlist tracks observed state by object name", () => {
    call("wishlist-add", ctxA, { name: "Andromeda Galaxy", type: "galaxy", priority: "high" });
    call("wishlist-add", ctxA, { name: "Ring Nebula", type: "nebula", priority: "low" });
    let wl = call("wishlist-list", ctxA, {});
    assert.equal(wl.result.remaining, 2);
    assert.equal(wl.result.items[0].name, "Andromeda Galaxy"); // high priority first
    const t = newTarget(ctxA, { name: "Andromeda Galaxy" });
    call("observation-log", ctxA, { targetId: t.id });
    wl = call("wishlist-list", ctxA, {});
    assert.equal(wl.result.remaining, 1);
  });
});

describe("astronomy.events", () => {
  it("events split into upcoming and past", () => {
    call("event-add", ctxA, { name: "Total lunar eclipse", kind: "eclipse", date: "2099-01-01" });
    call("event-add", ctxA, { name: "Past shower", kind: "meteor_shower", date: "2000-01-01" });
    const ev = call("event-list", ctxA, {});
    assert.equal(ev.result.upcoming, 1);
    assert.equal(ev.result.next.name, "Total lunar eclipse");
    assert.equal(call("event-add", ctxA, { name: "x" }).ok, false);
  });
});

describe("astronomy.catalog (built-in Messier)", () => {
  it("catalog lists real objects and filters by magnitude", () => {
    const all = call("catalog-list", ctxA, {});
    assert.ok(all.result.count >= 16);
    const bright = call("catalog-list", ctxA, { maxMagnitude: 4 });
    assert.ok(bright.result.catalog.every((c) => c.magnitude <= 4));
    assert.equal(bright.result.catalog[0].name, "Pleiades"); // brightest, mag 1.6
  });

  it("catalog-import adds a Messier object as a target", () => {
    const r = call("catalog-import", ctxA, { catalogId: "M31" });
    assert.equal(r.ok, true);
    assert.ok(r.result.target.name.includes("Andromeda"));
    assert.equal(call("target-list", ctxA, {}).result.count, 1);
    assert.equal(call("catalog-import", ctxA, { catalogId: "M999" }).ok, false);
  });
});

describe("astronomy.astro-dashboard", () => {
  it("aggregates observation activity", () => {
    const t = newTarget();
    call("observation-log", ctxA, { targetId: t.id });
    call("session-create", ctxA, {});
    call("event-add", ctxA, { name: "Eclipse", date: "2099-06-01" });
    const d = call("astro-dashboard", ctxA, {});
    assert.equal(d.result.targets, 1);
    assert.equal(d.result.observed, 1);
    assert.equal(d.result.sessions, 1);
    assert.equal(d.result.upcomingEvents, 1);
  });
});
