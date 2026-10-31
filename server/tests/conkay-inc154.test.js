// server/tests/conkay-inc154.test.js
//
// INC-154 reproductions (Workbench knob edit: freeze, partial apply, undo
// does not revert), written against DesignEngine.applyEdits — the path a
// knob edit takes (what-if.js DesignConversation._apply -> DesignSession.edit).
//
//   1. A failure mid-recompute must leave NO trace: applyEdits returns
//      { ok: false } and the graph value, revision and history are exactly
//      as before the edit.
//   2. After such a refused edit, undoing the last good edit (the history
//      inverse, the only mechanism DesignConversation.undo has) restores
//      the original state completely.
//   3. The freeze: the request path's recompute (applyEditsAsync, which
//      DesignConversation awaits) yields between runs, so a timer scheduled
//      before the edit fires while it is still running.
//   4. Conversation level (what-if.js): edit -> undo returns the pre-edit
//      receipt exactly — after a resume-triggering edit (the orchestrator
//      swap: rev.final is replaced by a rebuilt final while undo still
//      reverses the edit on the original session) and after a forced
//      failure (no revision is recorded, the receipt never moves).
//
// The poison solver returns a margin whose demand is a BigInt once the
// plate thickness takes the edited value: envelope() (physics/registry.js)
// computes demand / capacity for every margin, which throws for a BigInt —
// a deterministic mid-recompute failure AFTER earlier runs in the closure
// have already recomputed, of the same class as any throw out of
// envelope construction or the cycle guard in ensure().

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDesign } from "../lib/conkay/index.js";
import { registerSolver } from "../lib/conkay/physics/registry.js";
import { DesignConversation } from "../lib/conkay/chat/what-if.js";
import { cadBodyGeometry, CAD_BODY_DEFAULTS, CAD_BODY_MATERIAL } from "../lib/conkay/cad/body-params.js";

registerSolver({
  id: "test.inc154-tailcheck", version: "1", domain: "test", method: "repro", fidelity: 0,
  targets: (graph) => (graph.node("BODY_SHELL") ? ["BODY_SHELL"] : []),
  run: (ctx, target) => {
    const t = ctx.get(target, "geometry.tailExtension");
    if (t < 0.25) return { failures: [`tail of ${t} m is too short`], outputs: { tail: { value: t, unit: "m" } } };
    return { margins: [{ demand: 1, capacity: 5, label: "ok" }], outputs: { tail: { value: t, unit: "m" } } };
  },
});

registerSolver({
  id: "test.inc154-poison", version: "1", domain: "test", method: "repro", fidelity: 0,
  targets: (graph) => [...graph.nodes.values()].filter((n) => n.kind === "Plate").map((n) => n.id),
  run: (ctx, target) => {
    const t = ctx.get(target, "geometry.thickness");
    if (t > 0.0125 && t < 0.0135) return { margins: [{ demand: 10n, capacity: 5, label: "poison" }], outputs: {} };
    return { margins: [{ demand: 1, capacity: 5, label: "ok" }], outputs: { thicknessSeen: { value: t, unit: "m" } } };
  },
});

registerSolver({
  id: "test.inc154-slow", version: "1", domain: "test", method: "repro", fidelity: 0,
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
      { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
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

function bracketWithBody() {
  const ir = bracket();
  ir.nodes.push({ id: "BODY_SHELL", kind: "Part", material: CAD_BODY_MATERIAL, geometry: cadBodyGeometry({ ...CAD_BODY_DEFAULTS, tailExtensionM: 0.3 }) });
  ir.edges.push({ type: "CONTAINS", from: "A1", to: "BODY_SHELL" });
  return ir;
}

function openWithBody() {
  const o = openDesign(bracketWithBody());
  assert.equal(o.ok, true, JSON.stringify(o.errors));
  return o.session;
}

const envMapOf = (session) => new Map(session.results().filter(Boolean).map((e) => [e.runId, e]));

/** A conversation over the bracket-with-body design. The evaluate stub stands
 * in for the car evaluator (whose own truth is the gated OCC E2E): every
 * rebuild returns a fresh session at the original tail, all checks passing —
 * enough to drive _apply's resume branch, which is what these tests pin. */
function conversation() {
  const session = openWithBody();
  const evaluate = async () => {
    const fresh = openWithBody();
    return { session: fresh, envelopes: envMapOf(fresh), requirementsHash: "r", designHash: "d", report: null };
  };
  const conv = new DesignConversation({
    evaluate, rules: [], requirements: {}, state: { tailExtensionM: 0.3 },
    final: { session, envelopes: envMapOf(session) },
  });
  return { conv, session };
}

const thickness = (s) => s.engine.graph.get("P1", "geometry.thickness");

describe("INC-154: a mid-recompute failure", () => {
  it("leaves no trace — the edit is refused whole", () => {
    const s = open();
    const rev0 = s.engine.graph.revision;
    const hist0 = s.engine.graph.history.length;
    const env0 = s.result("test.inc154-poison@P1");
    const r = s.edit([{ node: "P1", path: "geometry.thickness", value: 0.013 }]);
    assert.equal(r.ok, false, "the failed edit must be refused, not thrown or half-applied");
    assert.equal(thickness(s), 0.01, "graph value unchanged");
    assert.equal(s.engine.graph.revision, rev0, "revision unchanged");
    assert.equal(s.engine.graph.history.length, hist0, "no history entry for a refused edit");
    assert.equal(s.result("test.inc154-poison@P1"), env0, "prior envelope untouched");
  });

  it("does not block the undo of the last good edit", () => {
    const s = open();
    const good = s.edit([{ node: "P1", path: "geometry.thickness", value: 0.012 }]);
    assert.equal(good.ok, true);
    const refused = s.edit([{ node: "P1", path: "geometry.thickness", value: 0.013 }]);
    assert.equal(refused.ok, false);
    // DesignConversation.undo's mechanism: apply the last history entry's inverse.
    const inverse = s.engine.graph.history.at(-1).ops.map((o) => ({ node: o.node, path: o.path, value: o.before }));
    const back = s.edit(inverse);
    assert.equal(back.ok, true);
    assert.equal(thickness(s), 0.01, "undo restores the original value completely");
  });
});

describe("INC-154: a mid-recompute failure on the async (request) path", () => {
  it("leaves no trace — the edit is refused whole", async () => {
    const s = open();
    const rev0 = s.engine.graph.revision;
    const hist0 = s.engine.graph.history.length;
    const r = await s.editAsync([{ node: "P1", path: "geometry.thickness", value: 0.013 }]);
    assert.equal(r.ok, false, "the failed edit must be refused, not thrown or half-applied");
    assert.equal(thickness(s), 0.01, "graph value unchanged");
    assert.equal(s.engine.graph.revision, rev0, "revision unchanged");
    assert.equal(s.engine.graph.history.length, hist0, "no history entry for a refused edit");
  });
});

describe("INC-154: the freeze", () => {
  it("the async recompute yields — a timer fires while the edit is still running", async () => {
    const s = open();
    let fired = false;
    setTimeout(() => { fired = true; }, 0);
    const t0 = performance.now();
    const r = await s.editAsync([{ node: "P1", path: "geometry.thickness", value: 0.02 }]);
    const elapsed = performance.now() - t0;
    assert.equal(r.ok, true);
    assert.ok(elapsed >= 20, `the slow run in the closure (25 ms) ran inside the edit, took ${elapsed.toFixed(1)} ms`);
    assert.equal(fired, true, "the timer fired during the recompute — the loop was not starved");
    assert.equal(thickness(s), 0.02, "the edit still applied completely");
  });
});

describe("INC-154: conversation receipts (edit -> undo)", () => {
  it("undo after a resume-triggering edit returns the pre-edit receipt exactly", async () => {
    const { conv, session } = conversation();
    const r0 = conv.current.receipt;
    const reply = await conv.ask("make the tail shorter");
    assert.equal(reply.kind, "parameter");
    assert.equal(reply.ok, true);
    assert.ok(reply.resumed, "the new tail failure resumed the orchestrator (the swap this test pins)");
    assert.notEqual(conv.current.final.session, session, "the revision's final was swapped for the rebuilt one");
    const back = await conv.undo();
    assert.equal(back.ok, true);
    assert.equal(back.matches, true, "undo's own receipt check holds");
    assert.equal(back.receipt, r0, "the receipt equals the pre-edit receipt");
    assert.equal(session.engine.graph.get("BODY_SHELL", "geometry.tailExtension"), 0.3, "the tail is restored on the original session");
  });

  it("a forced failure records no revision and the receipt never moves", async () => {
    const { conv } = conversation();
    const r0 = conv.current.receipt;
    const reply = await conv.ask("set plate P1 thickness to 13 mm");
    assert.equal(reply.kind, "error", JSON.stringify(reply));
    assert.equal(conv.revisions.length, 1, "no revision was recorded for the refused edit");
    assert.equal(conv.current.receipt, r0, "the receipt equals the pre-edit receipt");
  });
});

describe("INC-154: bounded settle, committed-with-pending, busy lock, early inverse", () => {
  const slowSettle = (session, ms) => {
    const real = session.settle.bind(session);
    session.settle = () => new Promise((resolve, reject) => setTimeout(() => real().then(resolve, reject), ms));
  };

  it("a settle slower than the deadline commits the edit with kernels pending, undo works afterwards", async () => {
    const { conv, session } = conversation();
    conv.settleDeadlineMs = 30;
    slowSettle(session, 250);
    const r0 = conv.current.receipt;
    const t0 = performance.now();
    const reply = await conv.ask("make the tail shorter");
    const waited = performance.now() - t0;
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.ok(waited < 200, `the request returned at the deadline (${waited.toFixed(0)} ms), not at the end of the settle`);
    assert.equal(reply.pending, true);
    assert.match(reply.pendingNote, /NOT_COMPUTED/);
    assert.equal(conv.revisions.length, 2, "the edit is committed with a revision, so view and revisions agree");
    assert.equal(conv.settling, true);
    // while the settle is still running, a second edit and an undo are refused rather than interleaved
    const busyEdit = await conv.ask("make the tail shorter");
    assert.equal(busyEdit.error, "busy");
    const busyUndo = await conv.undo();
    assert.equal(busyUndo.ok, false);
    assert.equal(busyUndo.busy, true);
    assert.equal(conv.revisions.length, 2, "a refused undo pops nothing");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(conv.settling, false, "the background settle finished and released the lock");
    const back = await conv.undo();
    assert.equal(back.ok, true);
    assert.equal(back.receipt, r0, "undo restores the pre-edit receipt");
  });

  it("a settle that throws leaves no trace: values restored, no revision", async () => {
    const { conv, session } = conversation();
    session.settle = async () => { throw new Error("kernel exploded"); };
    const r0 = conv.current.receipt;
    const reply = await conv.ask("make the tail shorter");
    assert.equal(reply.kind, "error");
    assert.match(reply.error, /settle_failed/);
    assert.equal(reply.restored, true);
    assert.equal(conv.revisions.length, 1);
    assert.equal(conv.current.receipt, r0);
    assert.equal(session.engine.graph.get("BODY_SHELL", "geometry.tailExtension"), 0.3, "the tail is back at its original value");
    assert.equal(conv.settling, false);
  });

  it("the inverse is the edit's own record even when settle is slow (read before the await)", async () => {
    const { conv, session } = conversation();
    conv.settleDeadlineMs = 5000;
    slowSettle(session, 60);
    await conv.ask("make the tail shorter");
    const rev = conv.revisions.at(-1);
    assert.ok(rev.inverse.length > 0);
    assert.ok(rev.inverse.every((o) => o.node && o.path && o.value !== undefined));
    assert.equal(rev.inverse.find((o) => o.node === "BODY_SHELL" && o.path === "geometry.tailExtension")?.value, 0.3);
  });

  it("undo with nothing to undo is a refusal, not a success", async () => {
    const { conv } = conversation();
    const u = await conv.undo();
    assert.equal(u.ok, false);
    assert.match(u.error, /nothing to undo/);
  });
});

describe("INC-154: one exclusive operation per conversation, from the first await", () => {
  const slowSettle = (session, ms) => {
    const real = session.settle.bind(session);
    session.settle = () => new Promise((resolve, reject) => setTimeout(() => real().then(resolve, reject), ms));
  };
  const histLen = (session) => session.engine.graph.history.length;

  it("a second edit that starts inside the first's settle window is refused; history gets exactly one entry", async () => {
    const { conv, session } = conversation();
    conv.settleDeadlineMs = 5000; // the whole first request happens inside the window
    slowSettle(session, 120);
    const h0 = histLen(session);
    const first = conv.ask("make the tail shorter");
    // started while the first is still in editAsync / its slow settle: settling must already be true
    assert.equal(conv.settling, true, "busy from the very start of the operation, not only after a timeout");
    const second = await conv.ask("make the tail shorter");
    assert.equal(second.error, "busy");
    assert.equal(second.busy, true);
    const r1 = await first;
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.equal(histLen(session), h0 + 1, "exactly one edit reached the graph history");
    assert.equal(conv.revisions.length, 2);
    assert.equal(conv.settling, false, "released when the operation completed inside the window");
    const sameTick = await Promise.all([conv.ask("make the tail shorter"), conv.ask("make the tail shorter")]);
    assert.equal(sameTick.filter((x) => x.busy).length, 1, "of two concurrent edits exactly one is refused");
  });

  it("an undo that arrives during an in-window settle is refused and pops nothing", async () => {
    const { conv, session } = conversation();
    conv.settleDeadlineMs = 5000;
    slowSettle(session, 120);
    const first = conv.ask("make the tail shorter");
    const u = await conv.undo();
    assert.equal(u.ok, false);
    assert.equal(u.busy, true);
    await first;
    assert.equal(conv.revisions.length, 2, "the edit's revision is still there");
    const ok = await conv.undo();
    assert.equal(ok.ok, true);
    assert.equal(conv.revisions.length, 1);
  });

  it("undo has the same deadline: pending:true on timeout, busy held until the background settle ends", async () => {
    const { conv, session } = conversation();
    const r0 = conv.current.receipt;
    await conv.ask("make the tail shorter");
    conv.settleDeadlineMs = 30;
    slowSettle(session, 250);
    const t0 = performance.now();
    const u = await conv.undo();
    assert.ok(performance.now() - t0 < 200, "the undo answered at the deadline");
    assert.equal(u.ok, true);
    assert.equal(u.pending, true);
    assert.equal(u.matches, null, "not claimed as matching while kernels are pending");
    assert.equal(conv.settling, true);
    assert.equal((await conv.ask("make the tail shorter")).busy, true);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(conv.settling, false);
    assert.equal(conv.current.receipt, r0);
  });

  it("a throwing settle during undo puts the edit back", async () => {
    const { conv, session } = conversation();
    await conv.ask("make the tail shorter");
    const tailAfterEdit = session.engine.graph.get("BODY_SHELL", "geometry.tailExtension");
    session.settle = async () => { throw new Error("kernel exploded"); };
    const u = await conv.undo();
    assert.equal(u.ok, false);
    assert.match(u.error, /settle_failed/);
    assert.equal(conv.revisions.length, 2, "the revision is back");
    assert.equal(session.engine.graph.get("BODY_SHELL", "geometry.tailExtension"), tailAfterEdit);
    assert.equal(conv.settling, false);
  });
});
