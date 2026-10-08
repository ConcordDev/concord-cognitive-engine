// server/lib/conkay/graph/engine.js
//
// The dependency / invalidation engine.
//
// Solvers read the design through a context that records every value they
// touch: node properties ("node:B1/material"), material properties
// ("material:astm-a325/ultimatePa"), loads ("loads:J1"), the graph's
// structure ("structure") and other solvers' results ("result:mass.part@B1").
// Those recorded reads ARE the compute DAG; nothing is declared by hand, so
// it can't drift from what the solvers actually use.
//
// An edit changes some keys. Every run that read one of them is stale, and so
// is every run that read a stale run's result. Only stale runs are recomputed;
// everything else keeps its envelope. Results are pulled on demand, so runs
// always see up-to-date inputs regardless of order, and a cycle is an error.

import { getSolver, listSolvers, envelope, runId } from "../physics/registry.js";
import { nodeKey } from "./design-graph.js";

function touches(readKey, changedKey) {
  return readKey === changedKey || changedKey.startsWith(`${readKey}.`) || readKey.startsWith(`${changedKey}.`);
}

export class DesignEngine {
  constructor(graph, solverIds = listSolvers().map((s) => s.id)) {
    this.graph = graph;
    this.solverIds = solverIds;
    this.runs = new Map(); // runId -> { solverId, target, reads:Set, envelope, stale }
    this.computing = new Set();
    this.computedThisPass = [];
    this.plan();
  }

  /** Which solver applies to which target. Rebuilt on structural edits. */
  plan() {
    const keep = new Map();
    for (const sid of this.solverIds) {
      const s = getSolver(sid);
      if (!s) throw new Error(`unknown solver ${sid}`);
      for (const target of s.targets(this.graph)) {
        const id = runId(sid, target);
        keep.set(id, this.runs.get(id) || { solverId: sid, target, reads: new Set(), envelope: null, stale: true });
      }
    }
    this.runs = keep;
  }

  context(run) {
    const g = this.graph;
    const read = (k) => run.reads.add(k);
    return {
      graph: g,
      get: (id, path) => { read(nodeKey(id, path)); return g.get(id, path); },
      node: (id) => {
        const n = g.node(id);
        if (!n) return null;
        read(nodeKey(id, "kind")); read(nodeKey(id, "name"));
        return { id: n.id, kind: n.kind, name: n.name };
      },
      material: (id) => {
        read(nodeKey(id, "material"));
        const m = g.materialOf(id);
        if (!m) return null;
        return new Proxy(m, { get: (t, p) => { if (typeof p === "string") read(`material:${t.id}/${p}`); return t[p]; } });
      },
      children: (id, type) => { read("structure"); return g.children(id, type); },
      loadsOn: (id) => { read(`loads:${id}`); return g.loadsOn(id); },
      requirement: (id) => { read(`requirement:${id}`); return g.requirements.find((r) => r.id === id) || null; },
      result: (solverId, target) => {
        const id = runId(solverId, target);
        read(`result:${id}`);
        return this.ensure(id);
      },
    };
  }

  ensure(id) {
    const run = this.runs.get(id);
    if (!run) return null;
    if (!run.stale && run.envelope) return run.envelope;
    if (this.computing.has(id)) throw new Error(`dependency cycle through ${id}`);
    this.computing.add(id);
    try {
      const s = getSolver(run.solverId);
      run.reads = new Set();
      const t0 = performance.now();
      let raw;
      try { raw = s.run(this.context(run), run.target); }
      catch (e) { raw = null; run.envelope = { runId: id, status: "ERROR", error: e instanceof Error ? e.message : String(e), solver: { id: s.id, version: s.version }, target: run.target }; }
      if (raw) run.envelope = envelope(s, run.target, raw, { runtimeMs: +(performance.now() - t0).toFixed(3), revision: this.graph.revision });
      run.stale = false;
      this.computedThisPass.push(id);
      return run.envelope;
    } finally {
      this.computing.delete(id);
    }
  }

  runAll() {
    this.computedThisPass = [];
    for (const id of this.runs.keys()) this.ensure(id);
    return { computed: [...this.computedThisPass] };
  }

  /** Mark stale every run that read a changed key, then everything downstream. */
  invalidate(changedKeys) {
    const stale = new Set();
    for (const [id, run] of this.runs) {
      if ([...run.reads].some((r) => changedKeys.some((c) => touches(r, c)))) stale.add(id);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const [id, run] of this.runs) {
        if (stale.has(id)) continue;
        if ([...run.reads].some((r) => r.startsWith("result:") && stale.has(r.slice(7)))) { stale.add(id); grew = true; }
      }
    }
    for (const id of stale) this.runs.get(id).stale = true;
    return stale;
  }

  /**
   * Apply graph edits [{ node, path, value }] and recompute only what they
   * affect. Returns a report of what changed, what reran and what was reused.
   */
  applyEdits(ops, { source = "api", text = null } = {}) {
    const applied = [];
    for (const op of ops) {
      const r = this.graph.set(op.node, op.path, op.value);
      if (!r.ok) {
        // Undo what this batch already changed, so a failed edit leaves no trace.
        for (const a of applied.reverse()) this.graph.set(a.node, a.path, a.before);
        return { ok: false, error: r.error };
      }
      applied.push({ node: op.node, path: op.path, before: r.before, after: r.after, key: r.key });
    }
    const before = new Map([...this.runs].map(([id, run]) => [id, run.envelope]));
    this.graph.revision += 1;
    const changedKeys = applied.map((a) => a.key);
    const stale = this.invalidate(changedKeys);
    this.computedThisPass = [];
    for (const id of stale) this.ensure(id);
    const rerun = [...this.computedThisPass];
    const entry = { revision: this.graph.revision, source, text, ops: applied.map(({ key, ...a }) => a), changedKeys, rerun, at: new Date().toISOString() };
    this.graph.history.push(entry);
    return {
      ok: true,
      revision: this.graph.revision,
      changedKeys,
      rerun,
      reused: [...this.runs.keys()].filter((id) => !rerun.includes(id)),
      changes: rerun.map((id) => diffEnvelope(id, before.get(id), this.runs.get(id).envelope)),
    };
  }

  results() {
    return [...this.runs.values()].map((r) => r.envelope);
  }

  result(id) {
    return this.runs.get(id)?.envelope || null;
  }

  dependencies(id) {
    const r = this.runs.get(id);
    return r ? [...r.reads].sort() : null;
  }
}

function diffEnvelope(id, a, b) {
  const outputs = {};
  for (const k of new Set([...Object.keys(a?.outputs || {}), ...Object.keys(b?.outputs || {})])) {
    const x = a?.outputs?.[k]?.value;
    const y = b?.outputs?.[k]?.value;
    if (x !== y) outputs[k] = { before: x ?? null, after: y ?? null, unit: (b?.outputs?.[k] || a?.outputs?.[k])?.unit };
  }
  return { runId: id, statusBefore: a?.status ?? null, statusAfter: b?.status ?? null, outputs };
}
