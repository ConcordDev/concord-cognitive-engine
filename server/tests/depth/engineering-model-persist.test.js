// tests/depth/engineering-model-persist.test.js
//
// The Engineering lens's in-progress FEA frame model (nodes, members,
// supports, loads) must survive a refresh and a server restart. model-save
// stores it per user under STATE.engineeringLens.models; model-get reads it
// back; the lens-state snapshot (serialize → JSON → hydrate) carries it.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";
import { serializeLensState, hydrateLensState } from "../../lib/lens-state-persistence.js";

const MODEL = {
  nodes: [{ id: "N1", x: 0, y: 0, z: 0 }, { id: "N2", x: 10, y: 0, z: 0 }],
  members: [{ id: "M1", nodeI: "N1", nodeJ: "N2", area: 8.25, momentI: 82.8, elasticModulus: 29e6, allowableStress: 21600, material: "A36 Steel" }],
  supports: [{ nodeId: "N1", type: "fixed", fixedDOF: ["x", "y", "z", "rx", "ry", "rz"] }],
  loads: [{ nodeId: "N2", Fy: -1000 }],
};

describe("engineering — working model persistence", () => {
  let ctx, other;
  before(async () => {
    ctx = await depthCtx("engineering-model-a");
    other = await depthCtx("engineering-model-b");
  });

  it("model-get is null before anything is saved (no sample model)", async () => {
    const r = await lensRun("engineering", "model-get", { params: {} }, other);
    assert.equal(r.ok, true);
    assert.equal(r.result.model, null);
  });

  it("model-save → model-get round-trips nodes, members, supports and loads", async () => {
    const saved = await lensRun("engineering", "model-save", { params: { model: MODEL } }, ctx);
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.result.counts, { nodes: 2, members: 1, loads: 1, supports: 1 });
    const got = await lensRun("engineering", "model-get", { params: {} }, ctx);
    assert.equal(got.ok, true);
    assert.deepEqual(got.result.model, MODEL);
    assert.ok(got.result.updatedAt);
  });

  it("is per user: another user does not see it", async () => {
    const r = await lensRun("engineering", "model-get", { params: {} }, other);
    assert.equal(r.result.model, null);
  });

  it("rejects a missing model and sanitizes junk values", async () => {
    const bad = await lensRun("engineering", "model-save", { params: {} }, other);
    // lens.run wraps a handler refusal as { ok: true, result: { ok: false, error } }.
    assert.equal(bad.ok === false || bad.result?.ok === false, true);
    const junk = await lensRun("engineering", "model-save", {
      params: { model: { nodes: [{ id: "A", x: "nope", y: 2 }], members: "x", loads: [{ nodeId: "A", Fy: "-5" }], supports: [{ nodeId: "A", fixedDOF: ["x", "evil"] }] } },
    }, other);
    assert.equal(junk.ok, true);
    const got = await lensRun("engineering", "model-get", { params: {} }, other);
    assert.deepEqual(got.result.model, {
      nodes: [{ id: "A", x: 0, y: 2, z: 0 }],
      members: [],
      loads: [{ nodeId: "A", Fy: -5 }],
      supports: [{ nodeId: "A", type: "fixed", fixedDOF: ["x"] }],
    });
  });

  it("survives a snapshot round-trip (serialize → JSON → hydrate), i.e. a restart", async () => {
    const STATE = globalThis._concordSTATE;
    const blob = JSON.parse(JSON.stringify(serializeLensState(STATE)));
    const fresh = {};
    hydrateLensState(fresh, blob);
    assert.ok(fresh.engineeringLens.models instanceof Map);
    const userId = ctx?.actor?.userId || ctx?.userId;
    assert.deepEqual(fresh.engineeringLens.models.get(userId).model, MODEL);
  });
});
