// tests/depth/animation-undo-redo-behavior.test.js — REAL behavioral tests for
// the animation domain's cross-operation undo/redo stack (`anim-undo` /
// `anim-redo`), closing docs/WAVE4_INVENTORY.md's "no full cross-operation
// undo/redo stack" row (animation-capability-map.md item 19).
//
// Scope: this stack covers structural frame/layer mutations — frame-add,
// frame-duplicate, frame-delete, frame-reorder, frame-layer-add,
// frame-layer-update, frame-layer-delete, frame-clear. It is layered
// ALONGSIDE the pre-existing single-level `anim-stroke-undo` (which is
// exercised in animation-behavior.test.js and untouched here), not a
// replacement for it.
//
// NB: lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
// — the OUTER ok is dispatch success; the handler's verdict is in result.ok.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

async function createAnim(ctx, params = {}) {
  const c = await lensRun("animation", "anim-create", { params: { title: "Undo Test", ...params } }, ctx);
  return c.result.animation;
}

describe("animation — anim-undo/anim-redo round-trips per destructive macro (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("animation-undo-redo"); });

  it("frame-add: undo removes the added frame; redo re-adds it", async () => {
    const anim = await createAnim(ctx);
    const before = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(before.frames.length, 1);

    const add = await lensRun("animation", "frame-add", { params: { animId: anim.id } }, ctx);
    assert.ok(add.result.frame); // real success, not a wrapped rejection
    const afterAdd = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterAdd.frames.length, 2);

    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.undone, "frame-add");
    assert.equal(undo.result.frameCount, 1);
    assert.equal(undo.result.canRedo, true);
    const afterUndo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.deepEqual(afterUndo.frames.map((f) => f.id), before.frames.map((f) => f.id)); // exact pre-op match

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.redone, "frame-add");
    assert.equal(redo.result.frameCount, 2);
    const afterRedo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.deepEqual(afterRedo.frames.map((f) => f.id), afterAdd.frames.map((f) => f.id)); // exact post-op match
  });

  it("frame-duplicate: undo restores single-frame state; redo restores the duplicate (with copied stroke)", async () => {
    const anim = await createAnim(ctx);
    const frameId = anim.frames[0].id;
    await lensRun("animation", "anim-stroke-commit", {
      params: { animId: anim.id, frameId, stroke: { tool: "ink", color: "#112233", points: [[1, 1], [2, 2]] } },
    }, ctx);
    const dup = await lensRun("animation", "frame-duplicate", { params: { animId: anim.id, frameId } }, ctx);
    const dupFrameId = dup.result.frame.id;
    const afterDup = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterDup.frames.length, 2);

    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.undone, "frame-duplicate");
    assert.equal(undo.result.frameCount, 1);
    const afterUndo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterUndo.frames.length, 1);
    assert.equal(afterUndo.frames[0].layers[0].strokes.length, 1); // the pre-duplicate stroke survives

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.frameCount, 2);
    const afterRedo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.ok(afterRedo.frames.some((f) => f.id === dupFrameId));
    assert.equal(afterRedo.frames[1].layers[0].strokes.length, 1); // copied stroke restored too
  });

  it("frame-delete: undo restores the deleted frame at its original position; redo removes it again", async () => {
    const anim = await createAnim(ctx);
    const frameId = anim.frames[0].id;
    await lensRun("animation", "frame-add", { params: { animId: anim.id } }, ctx); // now 2 frames
    const twoFrames = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(twoFrames.frames.length, 2);

    const del = await lensRun("animation", "frame-delete", { params: { animId: anim.id, frameId } }, ctx);
    assert.equal(del.result.deleted, frameId);
    const afterDel = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterDel.frames.length, 1);

    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.undone, "frame-delete");
    const afterUndo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.deepEqual(afterUndo.frames.map((f) => f.id), twoFrames.frames.map((f) => f.id)); // exact restoration, order included

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.redone, "frame-delete");
    const afterRedo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.deepEqual(afterRedo.frames.map((f) => f.id), afterDel.frames.map((f) => f.id));
  });

  it("frame-reorder: undo restores original order; redo reapplies the swap", async () => {
    const anim = await createAnim(ctx);
    const f1 = anim.frames[0].id;
    const add1 = await lensRun("animation", "frame-add", { params: { animId: anim.id } }, ctx);
    const f2 = add1.result.frame.id;
    const before = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.deepEqual(before.frames.map((f) => f.id), [f1, f2]);

    const reorder = await lensRun("animation", "frame-reorder", { params: { animId: anim.id, frameId: f1, direction: "right" } }, ctx);
    assert.deepEqual(reorder.result.order, [f2, f1]);

    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.undone, "frame-reorder");
    const afterUndo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.deepEqual(afterUndo.frames.map((f) => f.id), [f1, f2]); // original order restored

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.redone, "frame-reorder");
    const afterRedo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.deepEqual(afterRedo.frames.map((f) => f.id), [f2, f1]);
  });

  it("frame-reorder: a no-op reorder at the boundary does NOT push an undo entry", async () => {
    const anim = await createAnim(ctx);
    const f1 = anim.frames[0].id;
    // Already at the leftmost position — moving left is a no-op (early return, no swap).
    const before = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(before.result.ok, false); // nothing queued yet for this fresh animation
    await lensRun("animation", "frame-reorder", { params: { animId: anim.id, frameId: f1, direction: "left" } }, ctx);
    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.ok, false);
    assert.match(undo.result.error, /nothing to undo/);
  });

  it("frame-layer-add: undo removes the added layer; redo re-adds it", async () => {
    const anim = await createAnim(ctx);
    const frameId = anim.frames[0].id;
    const add = await lensRun("animation", "frame-layer-add", { params: { animId: anim.id, frameId, name: "Ink" } }, ctx);
    const layerId = add.result.layer.id;
    const afterAdd = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterAdd.frames[0].layers.length, 2);

    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.undone, "frame-layer-add");
    const afterUndo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterUndo.frames[0].layers.length, 1);
    assert.ok(!afterUndo.frames[0].layers.some((l) => l.id === layerId));

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.redone, "frame-layer-add");
    const afterRedo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterRedo.frames[0].layers.length, 2);
    assert.ok(afterRedo.frames[0].layers.some((l) => l.id === layerId));
  });

  it("frame-layer-update: undo restores prior visibility/opacity; redo reapplies the change", async () => {
    const anim = await createAnim(ctx);
    const frameId = anim.frames[0].id;
    const layerId = anim.frames[0].layers[0].id;
    const upd = await lensRun("animation", "frame-layer-update", {
      params: { animId: anim.id, frameId, layerId, visible: false, opacity: 0.25 },
    }, ctx);
    assert.equal(upd.result.visible, false);
    assert.equal(upd.result.opacity, 0.25);

    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.undone, "frame-layer-update");
    const afterUndo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    const restoredLayer = afterUndo.frames[0].layers.find((l) => l.id === layerId);
    assert.equal(restoredLayer.visible, true);
    assert.equal(restoredLayer.opacity, 1);

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.redone, "frame-layer-update");
    const afterRedo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    const reappliedLayer = afterRedo.frames[0].layers.find((l) => l.id === layerId);
    assert.equal(reappliedLayer.visible, false);
    assert.equal(reappliedLayer.opacity, 0.25);
  });

  it("frame-layer-delete: undo restores the deleted layer (with its strokes); redo removes it again", async () => {
    const anim = await createAnim(ctx);
    const frameId = anim.frames[0].id;
    const add = await lensRun("animation", "frame-layer-add", { params: { animId: anim.id, frameId, name: "Doomed" } }, ctx);
    const layerId = add.result.layer.id;
    await lensRun("animation", "anim-stroke-commit", {
      params: { animId: anim.id, frameId, layerId, stroke: { tool: "ink", points: [[3, 3], [4, 4]] } },
    }, ctx);

    const del = await lensRun("animation", "frame-layer-delete", { params: { animId: anim.id, frameId, layerId } }, ctx);
    assert.equal(del.result.deleted, layerId);
    const afterDel = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterDel.frames[0].layers.length, 1);

    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.undone, "frame-layer-delete");
    const afterUndo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterUndo.frames[0].layers.length, 2);
    const restoredLayer = afterUndo.frames[0].layers.find((l) => l.id === layerId);
    assert.ok(restoredLayer);
    assert.equal(restoredLayer.strokes.length, 1); // the layer's stroke came back too

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.redone, "frame-layer-delete");
    const afterRedo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterRedo.frames[0].layers.length, 1);
    assert.ok(!afterRedo.frames[0].layers.some((l) => l.id === layerId));
  });

  it("frame-clear: undo restores the cleared strokes; redo re-clears them", async () => {
    const anim = await createAnim(ctx);
    const frameId = anim.frames[0].id;
    await lensRun("animation", "anim-stroke-commit", {
      params: { animId: anim.id, frameId, stroke: { tool: "ink", points: [[5, 5], [6, 6]] } },
    }, ctx);
    const beforeClear = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(beforeClear.frames[0].layers[0].strokes.length, 1);

    const clear = await lensRun("animation", "frame-clear", { params: { animId: anim.id, frameId } }, ctx);
    assert.equal(clear.result.cleared, frameId);
    const afterClear = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterClear.frames[0].layers[0].strokes.length, 0);

    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.undone, "frame-clear");
    const afterUndo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterUndo.frames[0].layers[0].strokes.length, 1); // the stroke is back

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.redone, "frame-clear");
    const afterRedo = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterRedo.frames[0].layers[0].strokes.length, 0);
  });

  it("anim-undo on a fresh animation with no ops is a real rejection, never a fabricated success", async () => {
    const anim = await createAnim(ctx);
    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.ok, false);
    assert.match(undo.result.error, /nothing to undo/);
  });

  it("anim-redo with nothing undone is a real rejection", async () => {
    const anim = await createAnim(ctx);
    await lensRun("animation", "frame-add", { params: { animId: anim.id } }, ctx);
    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.ok, false);
    assert.match(redo.result.error, /nothing to redo/);
  });

  it("a new edit after an undo clears the redo stack (can't redo past a fork in history)", async () => {
    const anim = await createAnim(ctx);
    await lensRun("animation", "frame-add", { params: { animId: anim.id } }, ctx); // op A → 2 frames
    const undoA = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undoA.result.canRedo, true); // redo of op A is available

    // A genuinely new edit (op B) should invalidate the pending redo of op A.
    const addB = await lensRun("animation", "frame-add", { params: { animId: anim.id } }, ctx);
    assert.ok(addB.result.frame);
    const afterB = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterB.frames.length, 2);

    const redo = await lensRun("animation", "anim-redo", { params: { animId: anim.id } }, ctx);
    assert.equal(redo.result.ok, false);
    assert.match(redo.result.error, /nothing to redo/);

    // But undo of op B (the new edit) still works normally.
    const undoB = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undoB.result.undone, "frame-add");
    const afterUndoB = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterUndoB.frames.length, 1);
  });

  it("the op-log respects its depth cap: undoing more than the cap only rewinds that far", async () => {
    const anim = await createAnim(ctx);
    const CAP = 40; // AN_MAX_UNDO_DEPTH in server/domains/animation.js
    const EXTRA = 5;
    // Push CAP + EXTRA frame-add ops (well under AN_MAX_FRAMES=600).
    for (let i = 0; i < CAP + EXTRA; i++) {
      await lensRun("animation", "frame-add", { params: { animId: anim.id } }, ctx);
    }
    const afterAll = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    assert.equal(afterAll.frames.length, 1 + CAP + EXTRA);

    // Undo exactly CAP times — should succeed every time (oldest EXTRA ops
    // pushed the earliest EXTRA entries off the bounded stack, but CAP
    // entries remain).
    let last;
    for (let i = 0; i < CAP; i++) {
      last = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
      assert.equal(last.result.undone, "frame-add", `undo #${i + 1} should succeed`);
    }
    assert.equal(last.result.canUndo, false); // stack now empty
    const afterCapUndos = (await lensRun("animation", "anim-get", { params: { id: anim.id } }, ctx)).result.animation;
    // Only EXTRA ops' worth of frames remain irreversible — the depth cap
    // means we could NOT rewind all the way back to the single starting frame.
    assert.equal(afterCapUndos.frames.length, 1 + EXTRA);

    // One more undo attempt is a real rejection — the stack is genuinely empty,
    // not silently wrapping around or fabricating further history.
    const overUndo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(overUndo.result.ok, false);
    assert.match(overUndo.result.error, /nothing to undo/);
  });

  it("anim-undo/anim-redo on an unknown animation id are rejected", async () => {
    const bad = await lensRun("animation", "anim-undo", { params: { animId: "anm_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /animation not found/);
    const badRedo = await lensRun("animation", "anim-redo", { params: { animId: "anm_nope" } }, ctx);
    assert.equal(badRedo.result.ok, false);
    assert.match(badRedo.result.error, /animation not found/);
  });

  it("anim-stroke-undo (the pre-existing single-level primitive) is untouched by the new op-log", async () => {
    const anim = await createAnim(ctx);
    const frameId = anim.frames[0].id;
    await lensRun("animation", "anim-stroke-commit", {
      params: { animId: anim.id, frameId, stroke: { tool: "ink", points: [[7, 7], [8, 8]] } },
    }, ctx);
    // Stroke-level undo still works exactly as before and does NOT touch/require the op-log.
    const strokeUndo = await lensRun("animation", "anim-stroke-undo", { params: { animId: anim.id, frameId } }, ctx);
    assert.equal(strokeUndo.result.strokeCount, 0);
    // The op-log is still empty (stroke-commit is not one of the wired
    // structural macros), so a structural undo correctly has nothing to do.
    const undo = await lensRun("animation", "anim-undo", { params: { animId: anim.id } }, ctx);
    assert.equal(undo.result.ok, false);
    assert.match(undo.result.error, /nothing to undo/);
  });
});
