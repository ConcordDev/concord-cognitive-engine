// server/domains/worldmodel.js
//
// Worldmodel lens — digital-twin / counterfactual-simulation domain.
// Category leader: Palantir Foundry — entity-graph world model with
// counterfactual simulation over a modeled system.
//
// The base macros (status, list_entities, create_entity, list_relations,
// simulate, counterfactual, snapshot, list_snapshots, list_simulations)
// live in server.js and are NOT shadowed here. This module adds the
// buildable-backlog macros on top of a self-contained per-user world
// model held in globalThis._concordSTATE.worldmodelLens:
//
//   graph                — full entity+relation graph for visualization
//   create_relation_typed — relation creation/editing from the UI
//   delete_relation       — relation deletion
//   update_entity_attrs   — typed entity attribute editing
//   list_entity_types     — typed schema registry
//   define_entity_type    — register a typed schema
//   run_scenario          — forward simulation that produces real trajectories
//   compare_scenarios     — side-by-side scenario vs counterfactual
//   capture_snapshot      — capture a full world-state snapshot
//   list_snapshots_full   — list captured snapshots
//   diff_snapshots        — structural diff between two snapshots
//   restore_snapshot      — roll the model back to a snapshot
//   save_scenario         — scenario library: save a named scenario
//   list_scenarios        — scenario library listing
//   delete_scenario       — remove a saved scenario
//   ingest                — live data ingestion to update entity state
//   ingest_log            — recent ingestion events
//
// Everything is pure compute over user-supplied data — no synthesized /
// mock / seed values. Every handler returns { ok, result|error } and
// never throws.

export default function registerWorldmodelActions(registerLensAction) {
  // ---------------------------------------------------------------------------
  // State container
  // ---------------------------------------------------------------------------

  function wmState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.worldmodelLens) {
      STATE.worldmodelLens = {
        entities: new Map(),   // userId -> Map<entityId, entity>
        relations: new Map(),  // userId -> Map<relationId, relation>
        types: new Map(),      // userId -> Map<typeName, schema>
        snapshots: new Map(),  // userId -> Map<snapshotId, snapshot>
        scenarios: new Map(),  // userId -> Map<scenarioId, scenario>
        sims: new Map(),       // userId -> Map<simId, sim>
        ingest: new Map(),     // userId -> Array<ingestEvent>
      };
    }
    return STATE.worldmodelLens;
  }

  function userIdOf(ctx) {
    return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
  }

  function bucket(map, uid) {
    if (!map.has(uid)) map.set(uid, new Map());
    return map.get(uid);
  }

  function listBucket(map, uid) {
    if (!map.has(uid)) map.set(uid, []);
    return map.get(uid);
  }

  function rid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi, fallback = lo) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function str(v, max = 200) {
    return String(v == null ? "" : v).slice(0, max);
  }

  // ---------------------------------------------------------------------------
  // 1. Graph — full entity/relation graph for interactive visualization
  // ---------------------------------------------------------------------------

  registerLensAction("worldmodel", "graph", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = bucket(S.entities, uid);
      const rels = bucket(S.relations, uid);
      const typeFilter = params.type ? str(params.type) : null;

      const nodes = Array.from(ents.values())
        .filter((e) => !typeFilter || e.type === typeFilter)
        .map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          attributes: e.attributes || {},
          // degree is computed below
          degree: 0,
        }));
      const nodeIndex = new Map(nodes.map((n) => [n.id, n]));

      const edges = Array.from(rels.values())
        .filter((r) => nodeIndex.has(r.from) && nodeIndex.has(r.to))
        .map((r) => ({
          id: r.id,
          from: r.from,
          to: r.to,
          type: r.type,
          weight: r.weight,
        }));
      for (const e of edges) {
        const a = nodeIndex.get(e.from);
        const b = nodeIndex.get(e.to);
        if (a) a.degree += 1;
        if (b) b.degree += 1;
      }

      return {
        ok: true,
        result: {
          nodes,
          edges,
          nodeCount: nodes.length,
          edgeCount: edges.length,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // Entity helpers — wm-scoped entity store so the lens is fully self-contained
  // ---------------------------------------------------------------------------

  registerLensAction("worldmodel", "wm_create_entity", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = bucket(S.entities, uid);
      const name = str(params.name);
      if (!name) return { ok: false, error: "name required" };
      const type = str(params.type || "concept", 60);
      const id = rid("ent");
      const attrs = (params.attributes && typeof params.attributes === "object")
        ? { ...params.attributes }
        : {};
      const entity = {
        id, name, type,
        attributes: attrs,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      ents.set(id, entity);
      return { ok: true, result: { entity } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "wm_list_entities", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = Array.from(bucket(S.entities, uid).values());
      const type = params.type ? str(params.type) : null;
      const filtered = type ? ents.filter((e) => e.type === type) : ents;
      return { ok: true, result: { entities: filtered, total: ents.length } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "wm_delete_entity", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = bucket(S.entities, uid);
      const rels = bucket(S.relations, uid);
      const id = str(params.id || params.entityId);
      if (!id) return { ok: false, error: "id required" };
      if (!ents.has(id)) return { ok: false, error: "entity not found" };
      ents.delete(id);
      // cascade-delete relations touching this entity
      let removed = 0;
      for (const [rId, r] of rels) {
        if (r.from === id || r.to === id) { rels.delete(rId); removed += 1; }
      }
      return { ok: true, result: { deleted: id, relationsRemoved: removed } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Relation creation / editing / deletion from the UI
  // ---------------------------------------------------------------------------

  registerLensAction("worldmodel", "create_relation_typed", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = bucket(S.entities, uid);
      const rels = bucket(S.relations, uid);
      const from = str(params.from);
      const to = str(params.to);
      const type = str(params.type || "relates_to", 60);
      if (!from || !to) return { ok: false, error: "from and to required" };
      if (!ents.has(from)) return { ok: false, error: "from entity not found" };
      if (!ents.has(to)) return { ok: false, error: "to entity not found" };
      if (from === to) return { ok: false, error: "self-relations not allowed" };
      const weight = clamp(params.weight, 0, 1, 0.5);
      const id = rid("rel");
      const relation = {
        id, from, to, type, weight,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      rels.set(id, relation);
      return { ok: true, result: { relation } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "update_relation", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const rels = bucket(S.relations, uid);
      const id = str(params.id);
      if (!id) return { ok: false, error: "id required" };
      const rel = rels.get(id);
      if (!rel) return { ok: false, error: "relation not found" };
      if (params.type != null) rel.type = str(params.type, 60);
      if (params.weight != null) rel.weight = clamp(params.weight, 0, 1, rel.weight);
      rel.updatedAt = new Date().toISOString();
      return { ok: true, result: { relation: rel } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "delete_relation", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const rels = bucket(S.relations, uid);
      const id = str(params.id);
      if (!id) return { ok: false, error: "id required" };
      if (!rels.has(id)) return { ok: false, error: "relation not found" };
      rels.delete(id);
      return { ok: true, result: { deleted: id } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "wm_list_relations", (ctx, _artifact, _params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const rels = Array.from(bucket(S.relations, uid).values());
      return { ok: true, result: { relations: rels, total: rels.length } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Typed entity schemas + attribute editing
  // ---------------------------------------------------------------------------

  registerLensAction("worldmodel", "define_entity_type", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const types = bucket(S.types, uid);
      const name = str(params.name, 60).trim();
      if (!name) return { ok: false, error: "type name required" };
      // fields: [{ key, kind: 'number'|'string'|'boolean', label? }]
      const raw = Array.isArray(params.fields) ? params.fields : [];
      const fields = raw
        .filter((f) => f && f.key)
        .map((f) => ({
          key: str(f.key, 60),
          kind: ["number", "string", "boolean"].includes(f.kind) ? f.kind : "string",
          label: str(f.label || f.key, 80),
        }));
      const schema = { name, fields, updatedAt: new Date().toISOString() };
      types.set(name, schema);
      return { ok: true, result: { schema } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "list_entity_types", (ctx, _artifact, _params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const types = Array.from(bucket(S.types, uid).values());
      return { ok: true, result: { types, total: types.length } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "delete_entity_type", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const types = bucket(S.types, uid);
      const name = str(params.name, 60);
      if (!types.has(name)) return { ok: false, error: "type not found" };
      types.delete(name);
      return { ok: true, result: { deleted: name } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "update_entity_attrs", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = bucket(S.entities, uid);
      const types = bucket(S.types, uid);
      const id = str(params.id || params.entityId);
      if (!id) return { ok: false, error: "id required" };
      const entity = ents.get(id);
      if (!entity) return { ok: false, error: "entity not found" };
      if (params.name != null) entity.name = str(params.name);
      const attrs = (params.attributes && typeof params.attributes === "object")
        ? params.attributes : {};
      // coerce against the typed schema when one exists for the entity type
      const schema = types.get(entity.type);
      const coerced = {};
      for (const [k, v] of Object.entries(attrs)) {
        const field = schema && schema.fields.find((f) => f.key === k);
        if (field && field.kind === "number") coerced[k] = num(v, 0);
        else if (field && field.kind === "boolean") coerced[k] = Boolean(v);
        else coerced[k] = typeof v === "object" ? v : str(v, 500);
      }
      entity.attributes = { ...(entity.attributes || {}), ...coerced };
      entity.updatedAt = new Date().toISOString();
      return { ok: true, result: { entity, coercedAgainstSchema: !!schema } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Forward simulation that produces real trajectories
  //
  // The model: every entity carries a numeric `value` attribute. A scenario
  // applies, per step, a growth rate plus per-relation propagation: an entity
  // pulls a fraction of each neighbour's value scaled by the relation weight.
  // Output is a real per-step trajectory, deterministic for given inputs.
  // ---------------------------------------------------------------------------

  // Fail-CLOSED magnitude bound on a modeled value. `num()` accepts any finite
  // float — including 1e308 — but compounding growth over up to 60 steps could
  // overflow a finite-but-extreme seed to Infinity, poisoning the whole
  // trajectory + total. capValue() clamps every value that enters or is produced
  // by the simulation to ±VALUE_CAP so the trajectory is ALWAYS finite. NaN/±Inf
  // collapse to 0. VALUE_CAP (1e12) is far above any legitimate modeled quantity
  // yet leaves headroom for 60 steps of growth/propagation without overflow.
  const VALUE_CAP = 1e12;
  function capValue(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(VALUE_CAP, Math.max(-VALUE_CAP, n));
  }

  function runTrajectory({ entities, relations, steps, growth, shocks }) {
    // entities: [{id, value}], relations: [{from,to,weight}]
    const stepCount = clamp(steps, 1, 60, 10);
    const g = clamp(growth, -0.5, 0.5, 0.0);
    const state = new Map(entities.map((e) => [e.id, capValue(num(e.value, 0))]));
    const shockMap = new Map(); // step -> [{id, delta}]
    for (const sh of (shocks || [])) {
      const at = clamp(sh.step, 1, stepCount, 1);
      if (!shockMap.has(at)) shockMap.set(at, []);
      shockMap.get(at).push({ id: str(sh.entityId), delta: num(sh.delta, 0) });
    }
    const trajectory = [];
    // step 0 = initial
    trajectory.push({
      step: 0,
      ...Object.fromEntries(Array.from(state.entries())),
    });
    for (let s = 1; s <= stepCount; s += 1) {
      const next = new Map();
      for (const [id, v] of state) {
        // intrinsic growth
        let nv = v * (1 + g);
        // relational propagation
        for (const r of relations) {
          if (r.to === id && state.has(r.from)) {
            nv += state.get(r.from) * clamp(r.weight, 0, 1, 0.5) * 0.1;
          }
        }
        next.set(id, nv);
      }
      // apply shocks for this step
      for (const sh of (shockMap.get(s) || [])) {
        if (next.has(sh.id)) next.set(sh.id, next.get(sh.id) + sh.delta);
      }
      state.clear();
      for (const [k, v] of next) state.set(k, Number(capValue(v).toFixed(4)));
      trajectory.push({
        step: s,
        ...Object.fromEntries(Array.from(state.entries())),
      });
    }
    const finalState = Object.fromEntries(Array.from(state.entries()));
    const total = Object.values(finalState).reduce((a, b) => a + b, 0);
    return { trajectory, finalState, total: Number(total.toFixed(4)) };
  }

  function snapshotEntitiesForSim(S, uid) {
    const ents = Array.from(bucket(S.entities, uid).values());
    return ents.map((e) => ({
      id: e.id,
      name: e.name,
      value: num(e.attributes && e.attributes.value, 0),
    }));
  }

  registerLensAction("worldmodel", "run_scenario", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = snapshotEntitiesForSim(S, uid);
      if (ents.length === 0) {
        return { ok: false, error: "no entities to simulate — create entities with a numeric 'value' attribute first" };
      }
      const rels = Array.from(bucket(S.relations, uid).values());
      const steps = clamp(params.steps, 1, 60, 10);
      const growth = clamp(params.growth, -0.5, 0.5, 0.05);
      const shocks = Array.isArray(params.shocks) ? params.shocks : [];
      const out = runTrajectory({ entities: ents, relations: rels, steps, growth, shocks });
      const sim = {
        id: rid("sim"),
        name: str(params.name || "scenario", 120),
        mode: "scenario",
        params: { steps, growth, shocks },
        trajectory: out.trajectory,
        finalState: out.finalState,
        total: out.total,
        entityNames: Object.fromEntries(ents.map((e) => [e.id, e.name])),
        createdAt: new Date().toISOString(),
      };
      bucket(S.sims, uid).set(sim.id, sim);
      return { ok: true, result: sim };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "list_sims", (ctx, _artifact, _params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const sims = Array.from(bucket(S.sims, uid).values())
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
        .map((s) => ({
          id: s.id, name: s.name, mode: s.mode,
          total: s.total, createdAt: s.createdAt,
        }));
      return { ok: true, result: { simulations: sims, total: sims.length } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "get_sim", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const id = str(params.id);
      const sim = bucket(S.sims, uid).get(id);
      if (!sim) return { ok: false, error: "simulation not found" };
      return { ok: true, result: sim };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Side-by-side scenario vs counterfactual comparison
  //
  // Runs two trajectories over the same entity graph: a baseline and a
  // counterfactual (different growth / shocks), returns both plus a
  // per-step, per-entity delta series for charting.
  // ---------------------------------------------------------------------------

  registerLensAction("worldmodel", "compare_scenarios", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = snapshotEntitiesForSim(S, uid);
      if (ents.length === 0) {
        return { ok: false, error: "no entities to simulate — create entities with a numeric 'value' attribute first" };
      }
      const rels = Array.from(bucket(S.relations, uid).values());
      const steps = clamp(params.steps, 1, 60, 10);

      const baseCfg = params.baseline || {};
      const cfCfg = params.counterfactual || {};
      const base = runTrajectory({
        entities: ents, relations: rels, steps,
        growth: clamp(baseCfg.growth, -0.5, 0.5, 0.05),
        shocks: Array.isArray(baseCfg.shocks) ? baseCfg.shocks : [],
      });
      const cf = runTrajectory({
        entities: ents, relations: rels, steps,
        growth: clamp(cfCfg.growth, -0.5, 0.5, 0.05),
        shocks: Array.isArray(cfCfg.shocks) ? cfCfg.shocks : [],
      });

      // delta trajectory: cf - base per entity per step
      const delta = base.trajectory.map((row, i) => {
        const cfRow = cf.trajectory[i] || {};
        const out = { step: row.step };
        for (const e of ents) {
          out[e.id] = Number(((cfRow[e.id] || 0) - (row[e.id] || 0)).toFixed(4));
        }
        return out;
      });

      const totalSwing = Number((cf.total - base.total).toFixed(4));
      return {
        ok: true,
        result: {
          steps,
          entityNames: Object.fromEntries(ents.map((e) => [e.id, e.name])),
          baseline: { trajectory: base.trajectory, finalState: base.finalState, total: base.total },
          counterfactual: { trajectory: cf.trajectory, finalState: cf.finalState, total: cf.total },
          delta,
          totalSwing,
          verdict: totalSwing > 0
            ? "counterfactual outperforms baseline"
            : totalSwing < 0
              ? "counterfactual underperforms baseline"
              : "no net difference",
        },
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Snapshots — capture / list / diff / restore
  // ---------------------------------------------------------------------------

  function captureState(S, uid) {
    const ents = Array.from(bucket(S.entities, uid).values());
    const rels = Array.from(bucket(S.relations, uid).values());
    return {
      entities: ents.map((e) => ({ ...e, attributes: { ...(e.attributes || {}) } })),
      relations: rels.map((r) => ({ ...r })),
    };
  }

  registerLensAction("worldmodel", "capture_snapshot", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const snaps = bucket(S.snapshots, uid);
      const state = captureState(S, uid);
      const snap = {
        id: rid("snap"),
        label: str(params.label || `snapshot-${new Date().toISOString()}`, 120),
        entityCount: state.entities.length,
        relationCount: state.relations.length,
        state,
        capturedAt: new Date().toISOString(),
      };
      snaps.set(snap.id, snap);
      return {
        ok: true,
        result: {
          id: snap.id, label: snap.label,
          entityCount: snap.entityCount, relationCount: snap.relationCount,
          capturedAt: snap.capturedAt,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "list_snapshots_full", (ctx, _artifact, _params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const snaps = Array.from(bucket(S.snapshots, uid).values())
        .sort((a, b) => (b.capturedAt > a.capturedAt ? 1 : -1))
        .map((s) => ({
          id: s.id, label: s.label,
          entityCount: s.entityCount, relationCount: s.relationCount,
          capturedAt: s.capturedAt,
        }));
      return { ok: true, result: { snapshots: snaps, total: snaps.length } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "diff_snapshots", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const snaps = bucket(S.snapshots, uid);
      const a = snaps.get(str(params.fromId));
      const b = snaps.get(str(params.toId));
      if (!a) return { ok: false, error: "fromId snapshot not found" };
      if (!b) return { ok: false, error: "toId snapshot not found" };

      const aEnt = new Map(a.state.entities.map((e) => [e.id, e]));
      const bEnt = new Map(b.state.entities.map((e) => [e.id, e]));
      const aRel = new Map(a.state.relations.map((r) => [r.id, r]));
      const bRel = new Map(b.state.relations.map((r) => [r.id, r]));

      const addedEntities = [];
      const removedEntities = [];
      const changedEntities = [];
      for (const [id, e] of bEnt) {
        if (!aEnt.has(id)) { addedEntities.push({ id, name: e.name, type: e.type }); }
        else {
          const old = aEnt.get(id);
          const changes = [];
          if (old.name !== e.name) changes.push({ field: "name", from: old.name, to: e.name });
          if (old.type !== e.type) changes.push({ field: "type", from: old.type, to: e.type });
          const keys = new Set([
            ...Object.keys(old.attributes || {}),
            ...Object.keys(e.attributes || {}),
          ]);
          for (const k of keys) {
            const ov = (old.attributes || {})[k];
            const nv = (e.attributes || {})[k];
            if (JSON.stringify(ov) !== JSON.stringify(nv)) {
              changes.push({ field: `attr.${k}`, from: ov ?? null, to: nv ?? null });
            }
          }
          if (changes.length) changedEntities.push({ id, name: e.name, changes });
        }
      }
      for (const [id, e] of aEnt) {
        if (!bEnt.has(id)) removedEntities.push({ id, name: e.name, type: e.type });
      }

      const addedRelations = [];
      const removedRelations = [];
      for (const [id, r] of bRel) {
        if (!aRel.has(id)) addedRelations.push({ id, from: r.from, to: r.to, type: r.type });
      }
      for (const [id, r] of aRel) {
        if (!bRel.has(id)) removedRelations.push({ id, from: r.from, to: r.to, type: r.type });
      }

      return {
        ok: true,
        result: {
          from: { id: a.id, label: a.label, capturedAt: a.capturedAt },
          to: { id: b.id, label: b.label, capturedAt: b.capturedAt },
          addedEntities, removedEntities, changedEntities,
          addedRelations, removedRelations,
          summary: {
            entitiesAdded: addedEntities.length,
            entitiesRemoved: removedEntities.length,
            entitiesChanged: changedEntities.length,
            relationsAdded: addedRelations.length,
            relationsRemoved: removedRelations.length,
          },
        },
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "restore_snapshot", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const snaps = bucket(S.snapshots, uid);
      const snap = snaps.get(str(params.id));
      if (!snap) return { ok: false, error: "snapshot not found" };
      const ents = bucket(S.entities, uid);
      const rels = bucket(S.relations, uid);
      ents.clear();
      rels.clear();
      for (const e of snap.state.entities) {
        ents.set(e.id, { ...e, attributes: { ...(e.attributes || {}) } });
      }
      for (const r of snap.state.relations) {
        rels.set(r.id, { ...r });
      }
      return {
        ok: true,
        result: {
          restored: snap.id, label: snap.label,
          entityCount: ents.size, relationCount: rels.size,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Scenario library — save / list / delete named scenarios
  // ---------------------------------------------------------------------------

  registerLensAction("worldmodel", "save_scenario", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const scenarios = bucket(S.scenarios, uid);
      const name = str(params.name, 120).trim();
      if (!name) return { ok: false, error: "scenario name required" };
      const scenario = {
        id: rid("scn"),
        name,
        steps: clamp(params.steps, 1, 60, 10),
        growth: clamp(params.growth, -0.5, 0.5, 0.05),
        shocks: Array.isArray(params.shocks)
          ? params.shocks.map((sh) => ({
              entityId: str(sh.entityId),
              step: clamp(sh.step, 1, 60, 1),
              delta: num(sh.delta, 0),
            }))
          : [],
        note: str(params.note || "", 500),
        savedAt: new Date().toISOString(),
      };
      scenarios.set(scenario.id, scenario);
      return { ok: true, result: { scenario } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "list_scenarios", (ctx, _artifact, _params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const scenarios = Array.from(bucket(S.scenarios, uid).values())
        .sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
      return { ok: true, result: { scenarios, total: scenarios.length } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "delete_scenario", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const scenarios = bucket(S.scenarios, uid);
      const id = str(params.id);
      if (!scenarios.has(id)) return { ok: false, error: "scenario not found" };
      scenarios.delete(id);
      return { ok: true, result: { deleted: id } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // 8. Live data ingestion — feed observations into entity attributes
  //
  // An ingestion event sets / increments a numeric attribute on a target
  // entity, keeping the modeled world synced with real observations.
  // ---------------------------------------------------------------------------

  registerLensAction("worldmodel", "ingest", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const ents = bucket(S.entities, uid);
      const log = listBucket(S.ingest, uid);
      const entityId = str(params.entityId);
      const entity = ents.get(entityId);
      if (!entity) return { ok: false, error: "target entity not found" };
      const key = str(params.attribute || "value", 60);
      const mode = params.mode === "increment" ? "increment" : "set";
      const value = num(params.value, 0);
      const prev = num(entity.attributes && entity.attributes[key], 0);
      const nextVal = mode === "increment" ? prev + value : value;
      entity.attributes = { ...(entity.attributes || {}), [key]: Number(nextVal.toFixed(4)) };
      entity.updatedAt = new Date().toISOString();
      const event = {
        id: rid("ing"),
        entityId, entityName: entity.name,
        attribute: key, mode,
        from: prev, to: entity.attributes[key],
        source: str(params.source || "manual", 80),
        at: new Date().toISOString(),
      };
      log.unshift(event);
      if (log.length > 200) log.length = 200;
      return { ok: true, result: { event, entity } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  registerLensAction("worldmodel", "ingest_log", (ctx, _artifact, params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      const log = listBucket(S.ingest, uid);
      const limit = clamp(params.limit, 1, 200, 50);
      return { ok: true, result: { events: log.slice(0, limit), total: log.length } };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------------------------------------------------------------------------
  // Aggregate status for the lens header
  // ---------------------------------------------------------------------------

  registerLensAction("worldmodel", "wm_status", (ctx, _artifact, _params = {}) => {
    try {
      const S = wmState();
      const uid = userIdOf(ctx);
      return {
        ok: true,
        result: {
          entities: bucket(S.entities, uid).size,
          relations: bucket(S.relations, uid).size,
          types: bucket(S.types, uid).size,
          snapshots: bucket(S.snapshots, uid).size,
          scenarios: bucket(S.scenarios, uid).size,
          simulations: bucket(S.sims, uid).size,
          ingestEvents: listBucket(S.ingest, uid).length,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
}
