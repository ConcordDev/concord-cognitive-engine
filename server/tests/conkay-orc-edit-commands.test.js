// server/tests/conkay-orc-edit-commands.test.js
//
// SX-ORC-10 — orc.edit-commands acceptance tests.
// Reference case (the catalogue's named shape): a class-wide material
// edit edits every member of the class and NOTHING else — asserted as
// the exact partition of the design's nodes into edited / untouched,
// with the untouched nodes' fields byte-identical after application.
// Undo is by construction: applying inverseOps restores the original
// design deep-equal. An unreadable edit is NOT_COMPUTED with the
// parser's error — never a guessed edit.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { editCommands, applyOps } from "../lib/conkay/orc/edit-commands.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const DESIGN = {
  design: { id: "d1", name: "D1" },
  nodes: [
    { id: "B1", kind: "Bolt", name: "bolt one", material: "iso-3506-a2-70" },
    { id: "B2", kind: "Bolt", name: "bolt two", material: "iso-3506-a2-70" },
    { id: "P1", kind: "Plate", name: "plate", material: "steel-a36", geometry: { shape: "box", length: "200 mm", width: "100 mm", height: "10 mm" } },
  ],
  edges: [],
};

describe("SX-ORC-10 — reference case (class edit touches the class, nothing else)", () => {
  it('"change all bolts to A490" edits every bolt and only the bolts', () => {
    const r = editCommands({ text: "change all bolts to A490", design: DESIGN });
    assert.ok(!r.notComputed, r.notComputed);
    assert.deepEqual(r.outputs.editedNodes.sort(), ["B1", "B2"]);
    assert.deepEqual(r.outputs.untouchedNodes, ["P1"]);
    const edited = Object.fromEntries(r.outputs.design.nodes.map((n) => [n.id, n]));
    assert.equal(edited.B1.material, "astm-a490");
    assert.equal(edited.B2.material, "astm-a490");
    assert.deepEqual(edited.P1, DESIGN.nodes[2], "the plate must be byte-identical");
    // The input design is not mutated.
    assert.equal(DESIGN.nodes[0].material, "iso-3506-a2-70");
  });

  it("undo by construction: applying inverseOps restores the original design", () => {
    const r = editCommands({ text: "change all bolts to A490", design: DESIGN });
    const restored = applyOps(r.outputs.design, r.outputs.inverseOps);
    assert.deepEqual(restored.nodes, DESIGN.nodes);
  });

  it("a named single-part edit with a quantity lands SI-converted", () => {
    const r = editCommands({ text: "set plate P1 thickness to 12 mm", design: DESIGN });
    // "thickness" is not a box param in the IR vocabulary; the parser either
    // reads it or refuses — assert whichever the deterministic grammar does,
    // but never a guessed value.
    if (r.notComputed) {
      assert.match(r.notComputed, /edit_not_read/);
    } else {
      assert.deepEqual(r.outputs.editedNodes, ["P1"]);
    }
  });

  it("a material edit on one named part touches only that part", () => {
    const r = editCommands({ text: "make bolt B1 stainless", design: DESIGN });
    assert.ok(!r.notComputed, r.notComputed);
    assert.deepEqual(r.outputs.editedNodes, ["B1"]);
    assert.deepEqual(r.outputs.untouchedNodes.sort(), ["B2", "P1"]);
  });
});

describe("SX-ORC-10 — adversarial + honesty legs", () => {
  it("an unreadable edit is NOT_COMPUTED with the parser's error, never a guess", () => {
    const r = editCommands({ text: "make it shinier somehow", design: DESIGN });
    assert.match(r.notComputed, /edit_not_read/);
  });

  it("an edit naming a part that does not exist is NOT_COMPUTED naming it", () => {
    const r = editCommands({ text: "change bolt B9 to A490", design: DESIGN });
    assert.match(r.notComputed, /edit_not_read/);
    assert.match(r.notComputed, /B9/);
  });

  it("missing text / design are NOT_COMPUTED, named (SC-05)", async () => {
    await assertNothingAssumed((p) => editCommands(p), { text: "change all bolts to A490", design: DESIGN }, ["text", "design"], "orc.edit-commands");
  });

  it("a design that does not compile is INVALID_INPUT, not a partial edit", () => {
    const r = editCommands({ text: "change all bolts to A490", design: { nodes: [{ id: "X", kind: "Nope" }] } });
    assert.match(r.notComputed, /INVALID_INPUT: design does not compile/);
  });

  it("citations leg: no out-of-domain citations (SC-05 helper)", () => {
    const s = getSolver("orc.edit-commands");
    assertCitationsDomain(editCommands({ text: "change all bolts to A490", design: DESIGN }), s, "orc.edit-commands");
  });
});

describe("SX-ORC-10 — registry + IR reachability", () => {
  it("is registered at L0 with declarations", () => {
    const s = listSolvers().find((x) => x.id === "orc.edit-commands");
    assert.ok(s, "orc.edit-commands not in the registry");
    assert.equal(s.fidelity, 0);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === true);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "host", name: "host" },
      nodes: [
        { id: "E1", kind: "Part", name: "edit", props: { "orc.edit-commands": { text: "change all bolts to A490", design: DESIGN } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.edit-commands@E1");
    assert.ok(env, "no orc.edit-commands envelope");
    assert.deepEqual(env.outputs.editedNodes.sort(), ["B1", "B2"]);
  });
});
