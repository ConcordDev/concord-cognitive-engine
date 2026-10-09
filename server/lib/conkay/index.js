// server/lib/conkay/index.js
//
// ConKay physical-system compiler, first slice: Design IR → Design Graph →
// Solver Registry → dependency engine. openDesign() compiles a design, runs
// every applicable solver and returns a session that takes edits (graph ops
// or plain-language sentences) and recomputes only what they affect.

import { DesignGraph } from "./graph/design-graph.js";
import { DesignEngine } from "./graph/engine.js";
import { parseEdit } from "./compiler/edit-parser.js";
import { coverage } from "./verification/coverage.js";
import { buildRealizationPackage } from "./verification/realization.js";
import { hasPendingKernels, settleKernels, KERNEL_PENDING } from "./cad/kernel-queue.js";
import { listSolvers } from "./physics/registry.js";
import "./physics/solvers/mass-cost.js";
import "./physics/solvers/bolted-joint.js";
import "./physics/solvers/requirements.js";
import "./physics/solvers/structural-members.js";
import "./physics/solvers/vehicle.js";
import "./physics/solvers/mass-properties.js";
import "./physics/solvers/mass-budget.js";
import "./physics/solvers/geometry-stability.js";
import "./physics/solvers/tube-actuation.js";
import "./physics/solvers/electrical.js";
import "./physics/solvers/energy-balance.js";
import "./physics/solvers/powertrain.js";
import "./physics/solvers/package.js";
import "./physics/solvers/cad-body.js";
import "./physics/solvers/ga-drawing.js";
import "./physics/solvers/packaging.js";
import "./physics/solvers/vehicle-acceptance.js";
import "./safety-case/solvers.js";

export { listSolvers };

export function openDesign(ir) {
  const built = DesignGraph.fromIR(ir);
  if (!built.ok) return { ok: false, errors: built.errors };
  const engine = new DesignEngine(built.graph);
  engine.runAll();
  return { ok: true, session: new DesignSession(engine) };
}

export class DesignSession {
  constructor(engine) {
    this.engine = engine;
    this.graph = engine.graph;
  }

  results() {
    return this.engine.results();
  }

  result(runId) {
    return this.engine.result(runId);
  }

  coverage() {
    return coverage(this.graph, this.engine.results());
  }

  /** Edit with explicit ops: [{ node, path, value }] (SI values). */
  edit(ops) {
    return this.engine.applyEdits(ops, { source: "ops" });
  }

  /** Edit with a sentence. The parsed ops are returned with the report. */
  editText(text) {
    const p = parseEdit(text, this.graph);
    if (!p.ok) return { ok: false, error: p.error };
    const r = this.engine.applyEdits(p.ops, { source: "text", text });
    return r.ok ? { ...r, parsed: { ops: p.ops, notes: p.notes } } : r;
  }

  /**
   * Run every external kernel the solvers are waiting for (asynchronously, off the request path), then rerun those
   * solvers and their dependents; repeat until nothing is pending (a drawing waits for the body it projects).
   * Returns { rounds, kernels, rerun }.
   */
  async settle({ maxRounds = 6 } = {}) {
    let rounds = 0, kernels = 0;
    const rerun = new Set();
    while (hasPendingKernels() && rounds < maxRounds) {
      kernels += await settleKernels();
      rounds += 1;
      const waiting = this.engine.results().filter((e) => e?.status === "NOT_COMPUTED" && typeof e.reason === "string" && e.reason.startsWith(KERNEL_PENDING)).map((e) => e.runId);
      for (const id of this.engine.rerun(waiting)) rerun.add(id);
    }
    return { rounds, kernels, rerun: [...rerun], pending: hasPendingKernels() };
  }

  /** The Realization Package: { files: { path: text } }. */
  realizationPackage() {
    return buildRealizationPackage(this);
  }

  summary() {
    const env = this.results();
    const count = (s) => env.filter((e) => e?.status === s).length;
    return {
      design: this.graph.design,
      revision: this.graph.revision,
      runs: env.length,
      pass: count("PASS"), warn: count("WARN"), fail: count("FAIL"),
      notComputed: count("NOT_COMPUTED"), error: count("ERROR"),
    };
  }
}
