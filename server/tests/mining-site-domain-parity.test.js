// Contract tests for the mining lens — mine-operations substrate
// (site CRUD + incident log + dashboard) in server/domains/mining.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMiningActions from "../domains/mining.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`mining.${name}`);
  assert.ok(fn, `mining.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMiningActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("mining.site management", () => {
  it("adds a site scoped per user", () => {
    call("site-add", ctxA, { name: "Pit 7", kind: "surface", commodity: "copper", productionTonnes: 500 });
    const list = call("site-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.sites[0].commodity, "copper");
    assert.equal(call("site-list", ctxB, {}).result.count, 0);
  });
  it("rejects a nameless site; unknown kind falls back to surface", () => {
    assert.equal(call("site-add", ctxA, {}).ok, false);
    assert.equal(call("site-add", ctxA, { name: "X", kind: "weird" }).result.site.kind, "surface");
  });
  it("updates status + production and deletes a site", () => {
    const site = call("site-add", ctxA, { name: "S" }).result.site;
    call("site-update", ctxA, { id: site.id, status: "suspended", productionTonnes: 99 });
    assert.equal(call("site-list", ctxA, {}).result.sites[0].status, "suspended");
    call("site-delete", ctxA, { id: site.id });
    assert.equal(call("site-list", ctxA, {}).result.count, 0);
  });
  it("logs incidents and surfaces serious counts in the dashboard", () => {
    const site = call("site-add", ctxA, { name: "S", productionTonnes: 100 }).result.site;
    call("incident-log", ctxA, { siteId: site.id, severity: "serious", description: "rockfall" });
    call("incident-log", ctxA, { siteId: site.id, severity: "minor" });
    const d = call("mining-dashboard", ctxA, {});
    assert.equal(d.result.sites, 1);
    assert.equal(d.result.totalProduction, 100);
    assert.equal(d.result.incidents, 2);
    assert.equal(d.result.seriousIncidents, 1);
  });
  it("incident-log rejects an unknown site", () => {
    assert.equal(call("incident-log", ctxA, { siteId: "nope" }).ok, false);
  });
});
