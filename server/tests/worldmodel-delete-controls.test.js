// FIX-worldmodel-001 (audit sweep CB-0447) — snapshots and simulation
// runs gain the delete control the ticket found missing: fixtures could
// not be cleaned up because worldmodel registered delete_scenario only.
// Pins delete_snapshot / delete_sim: owner-scoped removal, honest
// not-found errors, and no effect on the sibling stores.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWorldmodelActions from "../domains/worldmodel.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "worldmodel", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`worldmodel.${name} not registered`);
  const virtualArtifact = { id: null, domain: "worldmodel", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerWorldmodelActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

function makeEntity(ctx, name, value) {
  const r = call("wm_create_entity", ctx, { name, type: "concept", attributes: { value } });
  assert.equal(r.ok, true, `create ${name}`);
  return r.result.entity.id;
}

describe("worldmodel delete controls (FIX-worldmodel-001)", () => {
  it("captures then deletes a snapshot; the list empties", () => {
    makeEntity(ctxA, "Alpha", 10);
    const cap = call("capture_snapshot", ctxA, { label: "baseline" });
    assert.equal(cap.ok, true);
    assert.equal(call("list_snapshots_full", ctxA).result.total, 1);
    const del = call("delete_snapshot", ctxA, { id: cap.result.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, cap.result.id);
    assert.equal(call("list_snapshots_full", ctxA).result.total, 0);
  });

  it("delete_snapshot on an unknown id is an honest not-found", () => {
    const del = call("delete_snapshot", ctxA, { id: "snap_nope" });
    assert.equal(del.ok, false);
    assert.match(del.error, /snapshot not found/);
  });

  it("a snapshot is owner-scoped: another user cannot delete it", () => {
    makeEntity(ctxA, "Alpha", 10);
    const cap = call("capture_snapshot", ctxA, { label: "mine" });
    const del = call("delete_snapshot", ctxB, { id: cap.result.id });
    assert.equal(del.ok, false);
    assert.equal(call("list_snapshots_full", ctxA).result.total, 1);
  });

  it("runs then deletes a simulation; the list empties", () => {
    makeEntity(ctxA, "Alpha", 100);
    const run = call("run_scenario", ctxA, { name: "forward", steps: 3 });
    assert.equal(run.ok, true);
    assert.equal(call("list_sims", ctxA).result.total, 1);
    const del = call("delete_sim", ctxA, { id: run.result.id });
    assert.equal(del.ok, true);
    assert.equal(call("list_sims", ctxA).result.total, 0);
    assert.equal(call("get_sim", ctxA, { id: run.result.id }).ok, false);
  });

  it("delete_sim on an unknown id is an honest not-found", () => {
    const del = call("delete_sim", ctxA, { id: "sim_nope" });
    assert.equal(del.ok, false);
    assert.match(del.error, /simulation not found/);
  });

  it("deleting a snapshot leaves scenarios and sims untouched", () => {
    makeEntity(ctxA, "Alpha", 5);
    const cap = call("capture_snapshot", ctxA, { label: "keep-others" });
    const sc = call("save_scenario", ctxA, { name: "sc1", steps: 4, growth: 0.1, shocks: [] });
    assert.equal(sc.ok, true);
    call("run_scenario", ctxA, { name: "r1", steps: 2 });
    assert.equal(call("delete_snapshot", ctxA, { id: cap.result.id }).ok, true);
    assert.equal(call("list_scenarios", ctxA).result.total, 1);
    assert.equal(call("list_sims", ctxA).result.total, 1);
  });
});
