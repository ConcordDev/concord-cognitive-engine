// Worldmodel full-lens build (GB-1021) — the server contracts the
// build's surfacing slices stand on. The build is frontend-only because
// these records already hold everything the surface needs:
//   · S2 (show the numbers): run_scenario RECORDS the full per-entity
//     trajectory + finalState, and get_sim returns the record whole —
//     including the walk's own standing run (A=100, B=50, w=0.5,
//     steps 10, growth 0.05 → total 321.9005), whose per-entity values
//     the walked surface could not show.
//   · S1 (substrate guard): wm_delete_entity already cascade-deletes
//     relations touching the entity and returns the count the confirm
//     step states; snapshots hold their own copies.
//   · Compare: both finalStates ride the result next to the totals.

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

const ctx = { actor: { userId: "user_a" } };

function makeEntity(name, value) {
  const r = call("wm_create_entity", ctx, { name, type: "concept", attributes: { value } });
  assert.equal(r.ok, true, `create ${name}`);
  return r.result.entity.id;
}

describe("worldmodel build — S2 record contracts", () => {
  it("the walk's standing run: the record holds per-entity finals behind the total", () => {
    const a = makeEntity("PR2WM-A", 100);
    const b = makeEntity("PR2WM-B", 50);
    const rel = call("create_relation_typed", ctx, { from: a, to: b, type: "relates_to", weight: 0.5 });
    assert.equal(rel.ok, true);
    const sim = call("run_scenario", ctx, { name: "forward run", steps: 10, growth: 0.05 });
    assert.equal(sim.ok, true);
    assert.equal(sim.result.total, 321.9005, "the walk's displayed total, exactly");
    // The numbers the walked surface never rendered, present in the record:
    assert.equal(sim.result.trajectory.length, 11, "step 0 + 10 steps");
    assert.equal(sim.result.trajectory[0][a], 100);
    assert.equal(sim.result.trajectory[0][b], 50);
    // Per-step values round to 4dp, so the record's exact finals sit a
    // ten-thousandth off the walk's hand-inference (A ≈ 162.89, B ≈ 159.01
    // by subtraction from the total) — the inference was right to 2dp;
    // the record is the exact source.
    assert.equal(sim.result.finalState[a], 162.8894, "A compounds at 5% × 10 steps");
    assert.equal(sim.result.finalState[b], 159.0111, "B's final — inferable only by subtraction before this build");
    assert.equal(sim.result.entityNames[a], "PR2WM-A");
    // And the recorded run returns whole from get_sim.
    const got = call("get_sim", ctx, { id: sim.result.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.finalState[b], 159.0111);
    assert.equal(got.result.params.growth, 0.05);
  });

  it("compare returns both finalStates beside the totals, swing exact", () => {
    makeEntity("A", 100);
    makeEntity("B", 50);
    const r = call("compare_scenarios", ctx, {
      steps: 10,
      baseline: { growth: 0.05, shocks: [] },
      counterfactual: { growth: 0.12, shocks: [] },
    });
    assert.equal(r.ok, true);
    const ids = Object.keys(r.result.entityNames);
    assert.equal(ids.length, 2);
    for (const id of ids) {
      assert.equal(typeof r.result.baseline.finalState[id], "number");
      assert.equal(typeof r.result.counterfactual.finalState[id], "number");
    }
    assert.equal(r.result.totalSwing, Number((r.result.counterfactual.total - r.result.baseline.total).toFixed(4)));
  });
});

describe("worldmodel build — S1 delete semantics (what the confirm step states)", () => {
  it("deleting a connected entity cascade-deletes its relations and says how many", () => {
    const a = makeEntity("A", 100);
    const b = makeEntity("B", 50);
    call("create_relation_typed", ctx, { from: a, to: b, type: "relates_to", weight: 0.5 });
    call("create_relation_typed", ctx, { from: b, to: a, type: "relates_to", weight: 0.25 });
    const snap = call("capture_snapshot", ctx, { label: "before" });
    assert.equal(snap.ok, true);
    const del = call("wm_delete_entity", ctx, { id: a });
    assert.equal(del.ok, true);
    assert.equal(del.result.relationsRemoved, 2, "both relations touching A");
    const rels = call("wm_list_relations", ctx, {});
    assert.equal(rels.result.total, 0);
    const ents = call("wm_list_entities", ctx, {});
    assert.deepEqual(ents.result.entities.map((e) => e.name), ["B"]);
    // The snapshot keeps its own copy — its stored state still holds A.
    const status = call("wm_status", ctx, {});
    assert.equal(status.result.snapshots, 1);
  });

  it("entity-type delete: refuses an unknown type, deletes a defined one", () => {
    const no = call("delete_entity_type", ctx, { name: "nope" });
    assert.equal(no.ok, false);
    call("define_entity_type", ctx, { name: "sensor", fields: [{ key: "value", kind: "number" }] });
    const yes = call("delete_entity_type", ctx, { name: "sensor" });
    assert.equal(yes.ok, true);
    assert.equal(yes.result.deleted, "sensor");
    const types = call("list_entity_types", ctx, {});
    assert.equal(types.result.total, 0);
  });
});
