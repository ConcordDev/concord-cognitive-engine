// Contract tests for server/domains/worldmodel.js — digital-twin /
// counterfactual-simulation domain. Every macro is exercised and asserted
// `ok`. The model is a self-contained per-user world graph held in
// globalThis._concordSTATE.worldmodelLens.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWorldmodelActions from "../domains/worldmodel.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`worldmodel.${name}`);
  if (!fn) throw new Error(`worldmodel.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerWorldmodelActions(register); });

// Fresh state per test so buckets don't leak between cases.
beforeEach(() => { delete globalThis._concordSTATE; });

const ctx = { actor: { userId: "wm_user" }, userId: "wm_user" };

// Seed N entities with a numeric value attribute; return their ids.
function seedEntities(values) {
  return values.map((v, i) => {
    const r = call("wm_create_entity", ctx, { name: `E${i}`, type: "concept", attributes: { value: v } });
    assert.equal(r.ok, true);
    return r.result.entity.id;
  });
}

describe("worldmodel — entity CRUD + typed schemas", () => {
  it("creates, lists and deletes entities", () => {
    const [a] = seedEntities([100]);
    const list = call("wm_list_entities", ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    const del = call("wm_delete_entity", ctx, { id: a });
    assert.equal(del.ok, true);
    assert.equal(call("wm_list_entities", ctx).result.total, 0);
  });

  it("rejects an entity without a name", () => {
    const r = call("wm_create_entity", ctx, {});
    assert.equal(r.ok, false);
  });

  it("defines, lists and deletes typed entity schemas", () => {
    const def = call("define_entity_type", ctx, {
      name: "asset", fields: [{ key: "value", kind: "number" }, { key: "active", kind: "boolean" }],
    });
    assert.equal(def.ok, true);
    assert.equal(def.result.schema.fields.length, 2);
    assert.equal(call("list_entity_types", ctx).result.total, 1);
    assert.equal(call("delete_entity_type", ctx, { name: "asset" }).ok, true);
    assert.equal(call("list_entity_types", ctx).result.total, 0);
  });

  it("update_entity_attrs coerces against a typed schema", () => {
    call("define_entity_type", ctx, { name: "asset", fields: [{ key: "value", kind: "number" }] });
    const r = call("wm_create_entity", ctx, { name: "Plant", type: "asset" });
    const upd = call("update_entity_attrs", ctx, { id: r.result.entity.id, attributes: { value: "42" } });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.coercedAgainstSchema, true);
    assert.equal(upd.result.entity.attributes.value, 42);
  });
});

describe("worldmodel — relations CRUD", () => {
  it("creates, updates and deletes typed relations", () => {
    const [a, b] = seedEntities([10, 20]);
    const rel = call("create_relation_typed", ctx, { from: a, to: b, type: "feeds", weight: 0.8 });
    assert.equal(rel.ok, true);
    assert.equal(rel.result.relation.type, "feeds");
    const upd = call("update_relation", ctx, { id: rel.result.relation.id, weight: 0.3 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.relation.weight, 0.3);
    assert.equal(call("wm_list_relations", ctx).result.total, 1);
    assert.equal(call("delete_relation", ctx, { id: rel.result.relation.id }).ok, true);
    assert.equal(call("wm_list_relations", ctx).result.total, 0);
  });

  it("rejects self-relations and unknown endpoints", () => {
    const [a] = seedEntities([10]);
    assert.equal(call("create_relation_typed", ctx, { from: a, to: a, type: "x" }).ok, false);
    assert.equal(call("create_relation_typed", ctx, { from: a, to: "nope", type: "x" }).ok, false);
  });
});

describe("worldmodel — graph", () => {
  it("returns nodes, edges and computed degree", () => {
    const [a, b] = seedEntities([1, 2]);
    call("create_relation_typed", ctx, { from: a, to: b, type: "link", weight: 0.5 });
    const g = call("graph", ctx);
    assert.equal(g.ok, true);
    assert.equal(g.result.nodeCount, 2);
    assert.equal(g.result.edgeCount, 1);
    assert.equal(g.result.nodes.find((n) => n.id === a).degree, 1);
  });
});

describe("worldmodel — simulation", () => {
  it("run_scenario produces a real per-step trajectory", () => {
    seedEntities([100, 50]);
    const r = call("run_scenario", ctx, { name: "growth", steps: 5, growth: 0.1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.trajectory.length, 6); // step 0 + 5 steps
    assert.ok(r.result.total > 150);
  });

  it("run_scenario refuses when there are no entities", () => {
    const r = call("run_scenario", ctx, { steps: 5 });
    assert.equal(r.ok, false);
  });

  it("list_sims and get_sim round-trip a stored simulation", () => {
    seedEntities([100]);
    const sim = call("run_scenario", ctx, { name: "s1", steps: 3, growth: 0.05 });
    const list = call("list_sims", ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    const got = call("get_sim", ctx, { id: sim.result.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.id, sim.result.id);
  });

  it("compare_scenarios returns baseline, counterfactual and delta", () => {
    seedEntities([100, 100]);
    const r = call("compare_scenarios", ctx, {
      steps: 5,
      baseline: { growth: 0.02 },
      counterfactual: { growth: 0.2 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.counterfactual.total > r.result.baseline.total);
    assert.equal(r.result.delta.length, 6);
    assert.equal(r.result.verdict, "counterfactual outperforms baseline");
  });
});

describe("worldmodel — snapshots", () => {
  it("captures, lists, diffs and restores snapshots", () => {
    const [a] = seedEntities([100]);
    const snap1 = call("capture_snapshot", ctx, { label: "before" });
    assert.equal(snap1.ok, true);

    // mutate the world, capture again
    call("update_entity_attrs", ctx, { id: a, attributes: { value: 999 } });
    const [b] = seedEntities([5]);
    void b;
    const snap2 = call("capture_snapshot", ctx, { label: "after" });

    const list = call("list_snapshots_full", ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 2);

    const diff = call("diff_snapshots", ctx, { fromId: snap1.result.id, toId: snap2.result.id });
    assert.equal(diff.ok, true);
    assert.equal(diff.result.summary.entitiesAdded, 1);
    assert.equal(diff.result.summary.entitiesChanged, 1);

    const restore = call("restore_snapshot", ctx, { id: snap1.result.id });
    assert.equal(restore.ok, true);
    assert.equal(restore.result.entityCount, 1);
    assert.equal(call("wm_list_entities", ctx).result.total, 1);
  });

  it("diff_snapshots rejects unknown snapshot ids", () => {
    assert.equal(call("diff_snapshots", ctx, { fromId: "x", toId: "y" }).ok, false);
  });
});

describe("worldmodel — scenario library", () => {
  it("saves, lists and deletes named scenarios", () => {
    const save = call("save_scenario", ctx, { name: "boom", steps: 8, growth: 0.15, note: "stress" });
    assert.equal(save.ok, true);
    const list = call("list_scenarios", ctx);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.scenarios[0].name, "boom");
    assert.equal(call("delete_scenario", ctx, { id: save.result.scenario.id }).ok, true);
    assert.equal(call("list_scenarios", ctx).result.total, 0);
  });

  it("rejects a scenario with no name", () => {
    assert.equal(call("save_scenario", ctx, { steps: 5 }).ok, false);
  });
});

describe("worldmodel — live ingestion", () => {
  it("ingest set + increment updates entity attributes and logs events", () => {
    const [a] = seedEntities([10]);
    const set = call("ingest", ctx, { entityId: a, attribute: "value", mode: "set", value: 100, source: "sensor" });
    assert.equal(set.ok, true);
    assert.equal(set.result.entity.attributes.value, 100);

    const inc = call("ingest", ctx, { entityId: a, attribute: "value", mode: "increment", value: 25 });
    assert.equal(inc.ok, true);
    assert.equal(inc.result.entity.attributes.value, 125);

    const log = call("ingest_log", ctx, { limit: 10 });
    assert.equal(log.ok, true);
    assert.equal(log.result.total, 2);
  });

  it("ingest rejects an unknown target entity", () => {
    assert.equal(call("ingest", ctx, { entityId: "nope", value: 1 }).ok, false);
  });
});

describe("worldmodel — status", () => {
  it("wm_status aggregates per-user counts", () => {
    seedEntities([1, 2]);
    call("save_scenario", ctx, { name: "x" });
    const r = call("wm_status", ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.entities, 2);
    assert.equal(r.result.scenarios, 1);
  });
});
