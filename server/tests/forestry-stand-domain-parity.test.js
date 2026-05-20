// Contract tests for the forestry lens — stand-management substrate +
// InciWeb wildfire feed in server/domains/forestry.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForestryActions from "../domains/forestry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`forestry.${name}`);
  assert.ok(fn, `forestry.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerForestryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("forestry.stand management", () => {
  it("adds a stand scoped per user with derived tree estimate", () => {
    call("stand-add", ctxA, { name: "North 40", species: "douglas_fir", acres: 40, treesPerAcre: 150 });
    const list = call("stand-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.stands[0].estimatedTrees, 6000);
    assert.equal(call("stand-list", ctxB, {}).result.count, 0);
  });
  it("rejects a nameless stand; unknown species falls back to mixed", () => {
    assert.equal(call("stand-add", ctxA, {}).ok, false);
    assert.equal(call("stand-add", ctxA, { name: "X", species: "weird" }).result.stand.species, "mixed");
  });
  it("logs activities and deletes a stand", () => {
    const st = call("stand-add", ctxA, { name: "S" }).result.stand;
    call("activity-log", ctxA, { standId: st.id, kind: "thinning", notes: "removed 20%" });
    assert.equal(call("stand-list", ctxA, {}).result.stands[0].activityCount, 1);
    call("stand-delete", ctxA, { id: st.id });
    assert.equal(call("stand-list", ctxA, {}).result.count, 0);
  });
  it("dashboard aggregates acres + species", () => {
    call("stand-add", ctxA, { name: "A", species: "oak", acres: 10 });
    call("stand-add", ctxA, { name: "B", species: "oak", acres: 25 });
    const d = call("forestry-dashboard", ctxA, {});
    assert.equal(d.result.stands, 2);
    assert.equal(d.result.totalAcres, 35);
    assert.equal(d.result.bySpecies.oak, 2);
  });
});

describe("forestry.feed — InciWeb wildfires → DTUs", () => {
  it("ingests active wildfire incidents as DTUs", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { id: "inc1", name: "Ridge Fire", type: "Wildfire", state: "CA", size: 1200, updated: "2026-05-19" },
    ]) });
    const created = [];
    const ctx = {
      actor: { userId: "user_a" }, userId: "user_a",
      macro: { run: async (d, n, input) => { const dtu = { id: `dtu${created.length}`, ...input }; created.push(dtu); return { ok: true, dtu }; } },
    };
    const r = await call("feed", ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.ingested, 1);
    assert.match(created[0].title, /Ridge Fire/);
    assert.ok(created[0].tags.includes("wildfire"));
  });
});

describe("forestry — analysis macros still intact", () => {
  it("timberVolume still responds", () => {
    assert.equal(call("timberVolume", ctxA, {}).ok, true);
  });
});
