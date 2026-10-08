// conkay_design lens actions: open a design, edit it by sentence, and get it
// back after the in-memory session is gone (rebuilt by replaying the stored
// IR and edit log). Another user can't read or edit it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";
import { _resetDesignSessionCache } from "../../domains/conkay-design.js";

const IR = {
  design: { id: "bracket", name: "Lap-splice bracket" },
  materials: { "astm-a325": { costPerKgUsd: "4 USD/kg" }, "iso-3506-a2-70": { costPerKgUsd: "9 USD/kg" } },
  nodes: [
    { id: "A1", kind: "Assembly" },
    { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
    { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "40 mm" } },
    { id: "J1", kind: "Joint", props: { shearPlanes: 1 } },
  ],
  edges: [
    { type: "CONTAINS", from: "A1", to: "P1" }, { type: "CONTAINS", from: "A1", to: "B1" },
    { type: "CONTAINS", from: "J1", to: "P1" }, { type: "CONTAINS", from: "J1", to: "B1" },
  ],
  loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "40 kN" }] }],
};

// lens.run unwraps a successful handler's result and passes a refusal
// ({ ok:false, error }) through whole; normalise both to { ok, result }.
const unwrap = (r) => (r?.result?.ok === false ? r.result : { ok: true, result: r?.result });

describe("conkay_design lens actions", () => {
  it("open → edit → reload replays to the same results; other users can't see it", async () => {
    const owner = await depthCtx("conkay-owner");
    const opened = unwrap(await lensRun("conkay_design", "open", { params: { ir: IR } }, owner));
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const id = opened.result.designId;
    assert.match(id, /^dsg_/);
    assert.equal(opened.result.summary.fail, 0);

    const edited = unwrap(await lensRun("conkay_design", "edit", { params: { designId: id, text: "make bolt B1 stainless" } }, owner));
    assert.equal(edited.ok, true, JSON.stringify(edited));
    assert.ok(edited.result.rerun.includes("joint.bolt-shear@J1"));
    assert.ok(!edited.result.rerun.includes("joint.bolt-bearing@J1"));
    const live = unwrap(await lensRun("conkay_design", "get", { params: { designId: id } }, owner)).result;

    _resetDesignSessionCache();
    const replayed = unwrap(await lensRun("conkay_design", "get", { params: { designId: id } }, owner)).result;
    const pick = (v) => v.results.map((e) => [e.runId, e.status, e.provenance?.inputHash, JSON.stringify(e.outputs)]).sort();
    assert.deepEqual(pick(replayed), pick(live), "replay rebuilds the same results and receipts");
    assert.equal(replayed.graph.revision, 1);
    assert.equal(replayed.graph.nodes.find((n) => n.id === "B1").material, "iso-3506-a2-70");

    const list = unwrap(await lensRun("conkay_design", "list", {}, owner)).result.designs;
    assert.ok(list.some((d) => d.id === id));

    const stranger = await depthCtx("conkay-stranger");
    assert.notEqual(stranger.actor.userId, owner.actor.userId);
    const peek = unwrap(await lensRun("conkay_design", "get", { params: { designId: id } }, stranger));
    assert.equal(peek.ok, false);
    const poke = unwrap(await lensRun("conkay_design", "edit", { params: { designId: id, text: "make bolt B1 A490" } }, stranger));
    assert.equal(poke.ok, false);
  });

  it("a design that does not compile is refused with every error", async () => {
    const ctx = await depthCtx("conkay-bad");
    const r = unwrap(await lensRun("conkay_design", "open", { params: { ir: { nodes: [{ id: "X", kind: "Gizmo" }] } } }, ctx));
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /unknown kind/);
  });

  it("lists the solver registry", async () => {
    const r = unwrap(await lensRun("conkay_design", "solvers", {}));
    assert.ok(r.result.solvers.some((s) => s.id === "beam.fea" && s.fidelity === 2));
  });
});
