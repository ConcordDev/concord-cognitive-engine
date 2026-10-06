// tests/depth/engineering-workspace-persist.test.js
//
// The Engineering Calcs, Multi-physics and Actions tabs save their inputs and
// latest results per user through engineering.workspace-save and read them
// back through engineering.workspace-get, so a refresh or a server restart
// doesn't lose them. Also checks the calc macros those tabs call compute real
// numbers (not nulls from a missing function).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";
import { serializeLensState, hydrateLensState } from "../../lib/lens-state-persistence.js";

const refused = (r) => r.ok === false || r.result?.ok === false;

describe("engineering — Calcs / Multi-physics / Actions workspace persistence", () => {
  let ctx, other;
  before(async () => {
    ctx = await depthCtx("engineering-ws-a");
    other = await depthCtx("engineering-ws-b");
  });

  it("workspace-get is empty before anything is saved", async () => {
    for (const key of ["calcs.structural", "physics", "bench"]) {
      const r = await lensRun("engineering", "workspace-get", { params: { key } }, other);
      assert.equal(r.ok, true);
      assert.equal(r.result.state, null);
    }
  });

  it("save → get round-trips a panel's inputs and results, per user", async () => {
    const state = { inp: { loadKips: 75, lengthFt: 14 }, result: { buckling: { value: 812.3, unit: "kips" } }, resultAt: "2026-10-05T20:00:00Z" };
    const s = await lensRun("engineering", "workspace-save", { params: { key: "calcs.structural", state } }, ctx);
    assert.equal(s.ok, true);
    assert.equal(s.result.key, "calcs.structural");
    const g = await lensRun("engineering", "workspace-get", { params: { key: "calcs.structural" } }, ctx);
    assert.deepEqual(g.result.state, state);
    assert.ok(g.result.updatedAt);
    const o = await lensRun("engineering", "workspace-get", { params: { key: "calcs.structural" } }, other);
    assert.equal(o.result.state, null);
  });

  it("refuses unknown keys, non-object state and oversized state", async () => {
    assert.ok(refused(await lensRun("engineering", "workspace-save", { params: { key: "../etc", state: {} } }, ctx)));
    assert.ok(refused(await lensRun("engineering", "workspace-get", { params: { key: "nope" } }, ctx)));
    assert.ok(refused(await lensRun("engineering", "workspace-save", { params: { key: "bench", state: [1, 2] } }, ctx)));
    assert.ok(refused(await lensRun("engineering", "workspace-save", { params: { key: "bench", state: { big: "x".repeat(70000) } } }, ctx)));
  });

  it("survives a snapshot round-trip (serialize → JSON → hydrate), i.e. a restart", async () => {
    await lensRun("engineering", "workspace-save", { params: { key: "physics", state: { els: [{ id: "V1", type: "voltage_source", nodeA: "N1", nodeB: "GND", value: 9 }] } } }, ctx);
    const STATE = globalThis._concordSTATE;
    const blob = JSON.parse(JSON.stringify(serializeLensState(STATE)));
    const fresh = {};
    hydrateLensState(fresh, blob);
    assert.ok(fresh.engineeringLens.workspaces instanceof Map);
    const userId = ctx?.actor?.userId || ctx?.userId;
    const mine = fresh.engineeringLens.workspaces.get(userId);
    assert.equal(mine["physics"].state.els[0].value, 9);
    assert.equal(mine["calcs.structural"].state.inp.loadKips, 75);
  });

  it("the Calcs macros the tab calls compute real numbers", async () => {
    const c = await lensRun("engineering", "connectionCheck", { params: { boltDiameter: 0.75, boltGrade: "a325", numBolts: 4, loadType: "single" } }, ctx);
    assert.equal(c.ok, true);
    assert.ok(Number.isFinite(c.result.value ?? c.result.result?.value));
    const t = await lensRun("engineering", "transformerSizing", { params: { loadKva: 100, voltage: 480, phase: 3 } }, ctx);
    assert.equal(t.ok, true);
  });
});
