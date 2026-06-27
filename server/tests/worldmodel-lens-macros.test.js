// Behavioral macro tests for server/domains/worldmodel.js — the digital-twin /
// counterfactual-simulation surface the /lenses/worldmodel lens drives.
//
// All 25 macros the lens page calls (wm_status, graph, entity/relation CRUD,
// typed schemas, run_scenario, compare_scenarios, snapshots, scenario library,
// ingest) are registered via `registerLensAction(domain, action, handler)` and
// served EXCLUSIVELY through the LENS_ACTIONS registry — `/api/lens/run` prefers
// LENS_ACTIONS over MACROS (server.js:39273), and the inline
// `register("worldmodel", …)` MACROS blocks in server.js use a DISJOINT set of
// names (create_entity / list_entities / status / simulate / …), so there is no
// shadowing: the lens names below are answered only here.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// handlers are invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG
// convention. Our harness calls `fn(ctx, virtualArtifact, input)`, NOT
// (ctx, input), so a regression that confuses param positions surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed values
// + round-trips: a forward simulation produces the exact deterministic trajectory
// the model defines; a snapshot diff reports the real structural delta; ingest
// set/increment math is exact; per-user isolation holds; numeric/string guards
// are fail-CLOSED (Infinity/NaN/1e308/40-char strings can never poison a value or
// trajectory); and an empty STATE degrades to ok:true (never no_db / throw).
//
// Hermetic: no boot, no network, no LLM, no DB — pure in-memory STATE.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWorldmodelActions from "../domains/worldmodel.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "worldmodel", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input).
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

// Helper: create an entity and return its id.
function makeEntity(ctx, name, value, type = "concept") {
  const r = call("wm_create_entity", ctx, { name, type, attributes: { value } });
  assert.equal(r.ok, true, `wm_create_entity ${name} ok`);
  return r.result.entity.id;
}

describe("worldmodel — registration (every lens-driven macro present)", () => {
  it("registers all 25 macros the lens calls via lensRun", () => {
    for (const m of [
      "wm_status", "graph",
      "wm_create_entity", "wm_list_entities", "wm_delete_entity",
      "create_relation_typed", "update_relation", "delete_relation", "wm_list_relations",
      "define_entity_type", "list_entity_types", "delete_entity_type", "update_entity_attrs",
      "run_scenario", "list_sims", "get_sim", "compare_scenarios",
      "capture_snapshot", "list_snapshots_full", "diff_snapshots", "restore_snapshot",
      "save_scenario", "list_scenarios", "delete_scenario",
      "ingest", "ingest_log",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing worldmodel.${m}`);
    }
  });
});

describe("worldmodel — degrade-graceful on empty STATE (never no_db / throw)", () => {
  it("every read macro returns ok:true with an empty payload when nothing exists", () => {
    assert.deepEqual(call("wm_status", ctxA, {}).result, {
      entities: 0, relations: 0, types: 0, snapshots: 0, scenarios: 0, simulations: 0, ingestEvents: 0,
    });
    assert.deepEqual(call("wm_list_entities", ctxA, {}).result, { entities: [], total: 0 });
    assert.deepEqual(call("wm_list_relations", ctxA, {}).result, { relations: [], total: 0 });
    assert.deepEqual(call("list_entity_types", ctxA, {}).result, { types: [], total: 0 });
    assert.deepEqual(call("list_sims", ctxA, {}).result, { simulations: [], total: 0 });
    assert.deepEqual(call("list_snapshots_full", ctxA, {}).result, { snapshots: [], total: 0 });
    assert.deepEqual(call("list_scenarios", ctxA, {}).result, { scenarios: [], total: 0 });
    assert.deepEqual(call("ingest_log", ctxA, {}).result, { events: [], total: 0 });
    const g = call("graph", ctxA, {});
    assert.equal(g.ok, true);
    assert.deepEqual(g.result, { nodes: [], edges: [], nodeCount: 0, edgeCount: 0 });
  });

  it("run_scenario / compare_scenarios fail-CLOSED (ok:false) with no entities — not a throw", () => {
    const s = call("run_scenario", ctxA, {});
    assert.equal(s.ok, false);
    assert.match(s.error, /no entities/);
    const c = call("compare_scenarios", ctxA, {});
    assert.equal(c.ok, false);
    assert.match(c.error, /no entities/);
  });
});

describe("worldmodel — entity CRUD + graph", () => {
  it("create → list → graph round-trip carries the real entity + degree", () => {
    const a = makeEntity(ctxA, "Reactor", 120, "system");
    const b = makeEntity(ctxA, "Grid", 80, "system");
    const rel = call("create_relation_typed", ctxA, { from: a, to: b, type: "feeds", weight: 0.4 });
    assert.equal(rel.ok, true);
    assert.equal(rel.result.relation.weight, 0.4);

    const list = call("wm_list_entities", ctxA, {});
    assert.equal(list.result.total, 2);

    const g = call("graph", ctxA, {});
    assert.equal(g.ok, true);
    assert.equal(g.result.nodeCount, 2);
    assert.equal(g.result.edgeCount, 1);
    // degree is computed from the real edges: each endpoint of the one edge has degree 1.
    const byId = Object.fromEntries(g.result.nodes.map((n) => [n.id, n]));
    assert.equal(byId[a].degree, 1);
    assert.equal(byId[b].degree, 1);
  });

  it("wm_create_entity rejects an empty name; delete cascades its relations", () => {
    assert.equal(call("wm_create_entity", ctxA, { name: "" }).error, "name required");
    const a = makeEntity(ctxA, "A", 1);
    const b = makeEntity(ctxA, "B", 2);
    call("create_relation_typed", ctxA, { from: a, to: b, type: "x" });
    const del = call("wm_delete_entity", ctxA, { id: a });
    assert.equal(del.ok, true);
    assert.equal(del.result.relationsRemoved, 1, "cascade-deleted the touching relation");
    assert.equal(call("wm_list_relations", ctxA, {}).result.total, 0);
  });

  it("graph drops dangling edges (an edge whose endpoint is filtered out)", () => {
    const a = makeEntity(ctxA, "A", 1, "alpha");
    const b = makeEntity(ctxA, "B", 2, "beta");
    call("create_relation_typed", ctxA, { from: a, to: b, type: "x" });
    // filter to type 'alpha' → only node A survives → the A→B edge is dropped.
    const g = call("graph", ctxA, { type: "alpha" });
    assert.equal(g.result.nodeCount, 1);
    assert.equal(g.result.edgeCount, 0);
  });
});

describe("worldmodel — relations (typed create / edit / delete + guards)", () => {
  it("create rejects missing endpoints, unknown ids, and self-relations", () => {
    const a = makeEntity(ctxA, "A", 1);
    assert.equal(call("create_relation_typed", ctxA, {}).error, "from and to required");
    assert.equal(call("create_relation_typed", ctxA, { from: a, to: "ghost" }).error, "to entity not found");
    assert.equal(call("create_relation_typed", ctxA, { from: a, to: a }).error, "self-relations not allowed");
  });

  it("update_relation reprices weight (clamped to [0,1]) and re-types", () => {
    const a = makeEntity(ctxA, "A", 1);
    const b = makeEntity(ctxA, "B", 2);
    const id = call("create_relation_typed", ctxA, { from: a, to: b, type: "x", weight: 0.5 }).result.relation.id;
    const up = call("update_relation", ctxA, { id, weight: 5, type: "y" });
    assert.equal(up.ok, true);
    assert.equal(up.result.relation.weight, 1, "weight 5 clamps to 1");
    assert.equal(up.result.relation.type, "y");
    assert.equal(call("delete_relation", ctxA, { id }).result.deleted, id);
    assert.equal(call("delete_relation", ctxA, { id }).error, "relation not found");
  });
});

describe("worldmodel — typed schemas + attribute coercion", () => {
  it("define a typed schema → editing attrs coerces against it", () => {
    const def = call("define_entity_type", ctxA, {
      name: "sensor",
      fields: [{ key: "value", kind: "number" }, { key: "active", kind: "boolean" }, { key: "label", kind: "string" }],
    });
    assert.equal(def.ok, true);
    assert.equal(def.result.schema.fields.length, 3);
    assert.equal(call("list_entity_types", ctxA, {}).result.total, 1);

    const id = makeEntity(ctxA, "S1", 0, "sensor");
    const up = call("update_entity_attrs", ctxA, {
      id,
      attributes: { value: "42", active: 1, label: "hot" },
    });
    assert.equal(up.ok, true);
    assert.equal(up.result.coercedAgainstSchema, true);
    // number coercion: "42" → 42 (a real number, not the string).
    assert.strictEqual(up.result.entity.attributes.value, 42);
    assert.strictEqual(up.result.entity.attributes.active, true);
    assert.strictEqual(up.result.entity.attributes.label, "hot");

    assert.equal(call("delete_entity_type", ctxA, { name: "sensor" }).result.deleted, "sensor");
    assert.equal(call("delete_entity_type", ctxA, { name: "sensor" }).error, "type not found");
  });

  it("define_entity_type rejects an empty name; update_entity_attrs rejects a ghost id", () => {
    assert.equal(call("define_entity_type", ctxA, { name: "" }).error, "type name required");
    assert.equal(call("update_entity_attrs", ctxA, { id: "ghost", attributes: {} }).error, "entity not found");
  });
});

describe("worldmodel — forward simulation (exact deterministic trajectory)", () => {
  it("run_scenario computes the precise per-step growth + relational propagation", () => {
    // Two entities: A(value 100), B(value 50). One edge A→B weight 0.5.
    // Model: nv = v*(1+g) + Σ(neighbour-into-id * weight * 0.1); g = 0.1.
    const a = makeEntity(ctxA, "A", 100);
    const b = makeEntity(ctxA, "B", 50);
    call("create_relation_typed", ctxA, { from: a, to: b, type: "feeds", weight: 0.5 });

    const r = call("run_scenario", ctxA, { name: "run", steps: 1, growth: 0.1 });
    assert.equal(r.ok, true);
    const t = r.result.trajectory;
    // step 0 is the initial state.
    assert.equal(t[0][a], 100);
    assert.equal(t[0][b], 50);
    // step 1:  A = 100*1.1 = 110 (no inbound edge into A).
    //          B = 50*1.1 + 100*0.5*0.1 = 55 + 5 = 60.
    assert.equal(t[1][a], 110);
    assert.equal(t[1][b], 60);
    // final total = 110 + 60 = 170.
    assert.equal(r.result.total, 170);
    assert.equal(r.result.finalState[a], 110);
    assert.equal(r.result.finalState[b], 60);

    // The run is recorded and retrievable.
    const sims = call("list_sims", ctxA, {});
    assert.equal(sims.result.total, 1);
    const got = call("get_sim", ctxA, { id: r.result.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.total, 170);
    assert.equal(call("get_sim", ctxA, { id: "ghost" }).error, "simulation not found");
  });

  it("a step-1 shock is applied exactly once at that step", () => {
    const a = makeEntity(ctxA, "A", 100);
    const r = call("run_scenario", ctxA, { steps: 1, growth: 0, shocks: [{ entityId: a, step: 1, delta: 25 }] });
    assert.equal(r.ok, true);
    // step1: 100*(1+0) + shock 25 = 125.
    assert.equal(r.result.trajectory[1][a], 125);
    assert.equal(r.result.total, 125);
  });

  it("compare_scenarios returns baseline, counterfactual, delta, and the verdict swing", () => {
    const a = makeEntity(ctxA, "A", 100);
    const r = call("compare_scenarios", ctxA, {
      steps: 1,
      baseline: { growth: 0.0 },
      counterfactual: { growth: 0.2 },
    });
    assert.equal(r.ok, true);
    // baseline final A = 100; counterfactual final A = 120.
    assert.equal(r.result.baseline.total, 100);
    assert.equal(r.result.counterfactual.total, 120);
    assert.equal(r.result.totalSwing, 20);
    assert.match(r.result.verdict, /outperforms/);
    // delta at step 1 = 120 - 100 = 20.
    assert.equal(r.result.delta[1][a], 20);
  });
});

describe("worldmodel — snapshots (capture / diff / restore round-trip)", () => {
  it("capture two snapshots across an edit → diff reports the exact structural delta", () => {
    const a = makeEntity(ctxA, "A", 1);
    const b = makeEntity(ctxA, "B", 2);
    const s1 = call("capture_snapshot", ctxA, { label: "before" });
    assert.equal(s1.ok, true);
    assert.equal(s1.result.entityCount, 2);

    // mutate: rename A, add C, delete B.
    call("update_entity_attrs", ctxA, { id: a, name: "A-prime" });
    const c = makeEntity(ctxA, "C", 3);
    call("wm_delete_entity", ctxA, { id: b });
    const s2 = call("capture_snapshot", ctxA, { label: "after" });

    const d = call("diff_snapshots", ctxA, { fromId: s1.result.id, toId: s2.result.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.summary.entitiesAdded, 1);
    assert.equal(d.result.summary.entitiesRemoved, 1);
    assert.equal(d.result.summary.entitiesChanged, 1);
    assert.equal(d.result.addedEntities[0].id, c);
    assert.equal(d.result.removedEntities[0].id, b);
    const change = d.result.changedEntities.find((e) => e.id === a);
    assert.ok(change.changes.some((ch) => ch.field === "name" && ch.from === "A" && ch.to === "A-prime"));

    assert.equal(call("diff_snapshots", ctxA, { fromId: "ghost", toId: s2.result.id }).error, "fromId snapshot not found");
  });

  it("restore_snapshot rolls the model back to the captured world-state", () => {
    const a = makeEntity(ctxA, "A", 1);
    const snap = call("capture_snapshot", ctxA, { label: "saved" });
    // diverge: add a second entity.
    makeEntity(ctxA, "B", 2);
    assert.equal(call("wm_list_entities", ctxA, {}).result.total, 2);

    const r = call("restore_snapshot", ctxA, { id: snap.result.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.entityCount, 1);
    const list = call("wm_list_entities", ctxA, {});
    assert.equal(list.result.total, 1);
    assert.equal(list.result.entities[0].id, a);
    assert.equal(call("restore_snapshot", ctxA, { id: "ghost" }).error, "snapshot not found");
  });
});

describe("worldmodel — scenario library", () => {
  it("save → list → re-run → delete round-trip", () => {
    makeEntity(ctxA, "A", 100);
    const s = call("save_scenario", ctxA, { name: "growth run", steps: 2, growth: 0.1, note: "baseline" });
    assert.equal(s.ok, true);
    const id = s.result.scenario.id;
    assert.equal(call("list_scenarios", ctxA, {}).result.total, 1);

    // The saved scenario can be re-run against the live model.
    const re = call("run_scenario", ctxA, { name: "growth run", steps: 2, growth: 0.1, shocks: [] });
    assert.equal(re.ok, true);
    assert.equal(re.result.trajectory.length, 3); // step 0..2

    assert.equal(call("delete_scenario", ctxA, { id }).result.deleted, id);
    assert.equal(call("list_scenarios", ctxA, {}).result.total, 0);
    assert.equal(call("save_scenario", ctxA, { name: "" }).error, "scenario name required");
  });
});

describe("worldmodel — ingestion (exact set / increment math)", () => {
  it("set then increment updates the entity attribute precisely and logs each event", () => {
    const a = makeEntity(ctxA, "A", 0);
    const set = call("ingest", ctxA, { entityId: a, attribute: "value", mode: "set", value: 40, source: "sensor" });
    assert.equal(set.ok, true);
    assert.equal(set.result.event.from, 0);
    assert.equal(set.result.event.to, 40);
    assert.equal(set.result.entity.attributes.value, 40);

    const inc = call("ingest", ctxA, { entityId: a, attribute: "value", mode: "increment", value: 10 });
    assert.equal(inc.result.event.from, 40);
    assert.equal(inc.result.event.to, 50);

    const log = call("ingest_log", ctxA, { limit: 10 });
    assert.equal(log.result.total, 2);
    // newest-first.
    assert.equal(log.result.events[0].to, 50);
    assert.equal(call("ingest", ctxA, { entityId: "ghost" }).error, "target entity not found");
  });
});

describe("worldmodel — per-user isolation", () => {
  it("one user's entities, relations, sims, snapshots, scenarios, and ingest never leak", () => {
    const a = makeEntity(ctxA, "A", 100);
    call("run_scenario", ctxA, { steps: 1, growth: 0.05 });
    call("capture_snapshot", ctxA, { label: "x" });
    call("save_scenario", ctxA, { name: "s", steps: 1, growth: 0 });
    call("ingest", ctxA, { entityId: a, mode: "set", value: 1 });

    // user_b sees nothing of user_a's world.
    assert.equal(call("wm_status", ctxB, {}).result.entities, 0);
    assert.equal(call("wm_list_entities", ctxB, {}).result.total, 0);
    assert.equal(call("list_sims", ctxB, {}).result.total, 0);
    assert.equal(call("list_snapshots_full", ctxB, {}).result.total, 0);
    assert.equal(call("list_scenarios", ctxB, {}).result.total, 0);
    assert.equal(call("ingest_log", ctxB, {}).result.total, 0);
    assert.equal(call("graph", ctxB, {}).result.nodeCount, 0);

    // and user_a's status reflects exactly its own writes.
    const st = call("wm_status", ctxA, {});
    assert.equal(st.result.entities, 1);
    assert.equal(st.result.simulations, 1);
    assert.equal(st.result.snapshots, 1);
    assert.equal(st.result.scenarios, 1);
    assert.equal(st.result.ingestEvents, 1);
  });
});

describe("worldmodel — fail-CLOSED numeric / string guards (no poisoned value or trajectory)", () => {
  it("a poisoned entity value never produces a non-finite simulation total", () => {
    for (const poison of [Infinity, -Infinity, NaN, 1e308]) {
      globalThis._concordSTATE = {};
      // The numeric guard num() coerces a bad value to its fallback 0; growth/weight
      // clamp to their valid ranges. So even with a poisoned value, the trajectory
      // stays finite — never Infinity / NaN.
      const id = makeEntity(ctxA, "A", poison);
      const r = call("run_scenario", ctxA, { steps: 3, growth: poison, name: "p" });
      assert.equal(r.ok, true, `run still ok for poison=${String(poison)}`);
      assert.ok(Number.isFinite(r.result.total), `total finite for poison=${String(poison)}`);
      for (const row of r.result.trajectory) {
        assert.ok(Number.isFinite(row[id]), `trajectory value finite for poison=${String(poison)}`);
      }
    }
  });

  it("a poisoned ingest value is coerced to a finite number, never minted into Infinity", () => {
    const a = makeEntity(ctxA, "A", 10);
    for (const poison of [Infinity, NaN, "9".repeat(40)]) {
      const r = call("ingest", ctxA, { entityId: a, mode: "increment", value: poison });
      assert.equal(r.ok, true, `ingest ok for poison=${String(poison)}`);
      assert.ok(Number.isFinite(r.result.entity.attributes.value), `value finite after poison=${String(poison)}`);
    }
  });

  it("an over-length string field is truncated, never stored unbounded (str guard)", () => {
    const huge = "z".repeat(5000);
    const r = call("wm_create_entity", ctxA, { name: huge, type: "concept" });
    assert.equal(r.ok, true);
    // name guard caps at 200 chars.
    assert.ok(r.result.entity.name.length <= 200, "name is bounded");
  });

  it("a relation weight outside [0,1] clamps; it never widens propagation past the model bound", () => {
    const a = makeEntity(ctxA, "A", 100);
    const b = makeEntity(ctxA, "B", 0);
    call("create_relation_typed", ctxA, { from: a, to: b, type: "x", weight: 1e9 });
    const r = call("run_scenario", ctxA, { steps: 1, growth: 0 });
    // weight clamps to 1 → B gains 100*1*0.1 = 10, not a runaway.
    assert.equal(r.result.trajectory[1][b], 10);
  });
});
