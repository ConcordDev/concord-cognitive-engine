// server/tests/conkay-rerun-async.test.js
//
// The per-part analysis re-run (PR #1701's DesignConversation.rerunSolver ->
// DesignEngine.rerun) recomputes a solver's downstream closure. On the
// request path that closure can hold heavyweight solvers (frame FE, motor
// thermal), and the synchronous rerun froze the event loop for its whole
// duration (Handoff-4 #42). rerunAsync computes the same closure, yielding
// between runs. These tests pin: (1) the async re-run recomputes exactly
// the set the sync re-run does; (2) a timer scheduled before it fires while
// it is still running.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDesign } from "../lib/conkay/index.js";
import { registerSolver } from "../lib/conkay/physics/registry.js";

registerSolver({
  id: "test.rerun-slow", version: "1", domain: "test", method: "repro", fidelity: 0,
  targets: (graph) => [...graph.nodes.values()].filter((n) => n.kind === "Plate").map((n) => n.id),
  run: (ctx, target) => {
    const t = ctx.get(target, "geometry.thickness");
    if (t === 0.02) {
      const end = performance.now() + 25;
      while (performance.now() < end) { /* busy-wait: one heavy solver run */ }
    }
    return { margins: [{ demand: 1, capacity: 5, label: "ok" }], outputs: { thicknessSeen: { value: t, unit: "m" } } };
  },
});

function bracket() {
  return {
    design: { id: "bracket", name: "Lap-splice bracket" },
    materials: { "astm-a325": { costPerKgUsd: "4 USD/kg", source: "test price" }, "iso-3506-a2-70": { costPerKgUsd: "9 USD/kg", source: "test price" } },
    nodes: [
      { id: "A1", kind: "Assembly", name: "Bracket" },
      { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "20 mm" } },
      { id: "P2", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
      { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "40 mm" } },
      { id: "B2", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "40 mm" } },
      { id: "J1", kind: "Joint", name: "Splice", props: { shearPlanes: 1 } },
    ],
    edges: [
      ...["P1", "P2", "B1", "B2", "J1"].map((to) => ({ type: "CONTAINS", from: "A1", to })),
      ...["P1", "P2", "B1", "B2"].map((to) => ({ type: "CONTAINS", from: "J1", to })),
    ],
    loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "40 kN" }] }],
    requirements: [{ id: "R1", label: "Bracket mass", of: { solver: "mass.assembly", target: "A1", output: "mass" }, max: "4 kg" }],
  };
}

function open() {
  const o = openDesign(bracket());
  assert.equal(o.ok, true, JSON.stringify(o.errors));
  return o.session;
}

describe("DesignEngine.rerunAsync (the #1701 re-run path)", () => {
  it("recomputes exactly the closure the synchronous rerun computes", async () => {
    const a = open();
    const syncSet = a.engine.rerun(["test.rerun-slow@P1"]).sort();
    const b = open();
    const asyncSet = (await b.engine.rerunAsync(["test.rerun-slow@P1"])).sort();
    assert.deepEqual(asyncSet, syncSet);
    assert.ok(syncSet.includes("test.rerun-slow@P1"));
  });

  it("yields — a timer fires while the re-run is still running", async () => {
    const s = open();
    let fired = false;
    setTimeout(() => { fired = true; }, 0);
    const t0 = performance.now();
    const recomputed = await s.engine.rerunAsync(["test.rerun-slow@P1"]);
    const elapsed = performance.now() - t0;
    assert.ok(recomputed.includes("test.rerun-slow@P1"));
    assert.ok(elapsed >= 20, `the slow run (25 ms) ran inside the re-run, took ${elapsed.toFixed(1)} ms`);
    assert.equal(fired, true, "the timer fired during the re-run — the loop was not starved");
  });
});
