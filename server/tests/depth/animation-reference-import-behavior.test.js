// tests/depth/animation-reference-import-behavior.test.js — REAL behavioral
// tests for the animation domain's rotoscope-style reference-image import
// (`frame-layer-import-image`), closing docs/WAVE4_INVENTORY.md row 93.
//
// Scope pinned here: importing a reference image attaches it to a frame as a
// non-destructive, semi-transparent TRACING UNDERLAY — it never converts the
// raster image into strokes/vector artwork. `frame-layer-update` (already
// generic) is reused for opacity edits, so there is no separate
// opacity-update macro to test here beyond confirming it accepts a reference
// layer's id like any other layer's.
//
// NB: lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
// — the OUTER ok is dispatch success; the handler's verdict is in result.ok.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

const STREAM_REF = "/api/media/med_abc123/stream";

describe("animation — frame-layer-import-image (reference/rotoscope layer)", () => {
  let ctx, animId, frameId;
  before(async () => {
    ctx = await depthCtx("animation-ref-import");
    const a = await lensRun("animation", "anim-create", { params: { title: "Rotoscope Test", width: 800, height: 600, fps: 12 } }, ctx);
    animId = a.result.animation.id;
    frameId = a.result.animation.frames[0].id;
  });

  it("imports a reference image onto the frame as a real reference-type layer, default opacity 0.5", async () => {
    const r = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: STREAM_REF, name: "Sketch ref" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.ok, undefined); // no error envelope on success
    const layer = r.result.layer;
    assert.equal(layer.type, "reference");
    assert.equal(layer.isReference, true);
    assert.equal(layer.imageRef, STREAM_REF);
    assert.equal(layer.opacity, 0.5);
    assert.equal(layer.name, "Sketch ref");
    assert.equal(layer.strokeCount, 0);
    assert.equal(layer.strokes, undefined); // stripped from the response, same as frame-layer-add

    // Read back from the project to confirm it was actually persisted, not
    // just echoed in the response.
    const got = await lensRun("animation", "anim-get", { params: { id: animId } }, ctx);
    const frame = got.result.animation.frames.find((f) => f.id === frameId);
    const persisted = frame.layers.find((l) => l.id === layer.id);
    assert.ok(persisted, "reference layer must be persisted on the frame");
    assert.equal(persisted.type, "reference");
    assert.equal(persisted.imageRef, STREAM_REF);
    assert.deepEqual(persisted.strokes, []); // never auto-vectorized into strokes
  });

  it("accepts an http(s) URL and a data:image/ URI as valid imageRef shapes", async () => {
    const http = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: "https://cdn.example.com/ref.png" },
    }, ctx);
    assert.equal(http.result.layer.imageRef, "https://cdn.example.com/ref.png");

    const data = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: "data:image/png;base64,AAAA" },
    }, ctx);
    assert.equal(data.result.layer.imageRef, "data:image/png;base64,AAAA");
  });

  it("opacity is clamped into [0,1] and defaults to 0.5 when omitted or non-numeric", async () => {
    const over = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: STREAM_REF, opacity: 5 },
    }, ctx);
    assert.equal(over.result.layer.opacity, 1);

    const under = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: STREAM_REF, opacity: -3 },
    }, ctx);
    assert.equal(under.result.layer.opacity, 0);

    const garbage = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: STREAM_REF, opacity: "not-a-number" },
    }, ctx);
    assert.equal(garbage.result.layer.opacity, 0.5);
  });

  it("frame-layer-update changes a reference layer's opacity — no separate opacity-update macro needed", async () => {
    const imp = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: STREAM_REF },
    }, ctx);
    const layerId = imp.result.layer.id;
    const upd = await lensRun("animation", "frame-layer-update", {
      params: { animId, frameId, layerId, opacity: 0.2 },
    }, ctx);
    assert.equal(upd.result.opacity, 0.2);
    const got = await lensRun("animation", "anim-get", { params: { id: animId } }, ctx);
    const frame = got.result.animation.frames.find((f) => f.id === frameId);
    const persisted = frame.layers.find((l) => l.id === layerId);
    assert.equal(persisted.opacity, 0.2);
    assert.equal(persisted.type, "reference"); // generic update never strips the reference marker
  });

  it("rejects import once the frame's layer limit is reached", async () => {
    const c = await lensRun("animation", "anim-create", { params: { title: "Full frame" } }, ctx);
    const fAnimId = c.result.animation.id;
    const fFrameId = c.result.animation.frames[0].id;
    // Frame starts with 1 layer ("Layer 1"); fill to AN_MAX_LAYERS (10).
    for (let i = 0; i < 9; i++) {
      const add = await lensRun("animation", "frame-layer-add", { params: { animId: fAnimId, frameId: fFrameId } }, ctx);
      assert.equal(add.result.ok, undefined, `layer-add ${i} should succeed`);
    }
    const full = await lensRun("animation", "anim-get", { params: { id: fAnimId } }, ctx);
    assert.equal(full.result.animation.frames[0].layers.length, 10);

    const rejected = await lensRun("animation", "frame-layer-import-image", {
      params: { animId: fAnimId, frameId: fFrameId, imageRef: STREAM_REF },
    }, ctx);
    assert.equal(rejected.result.ok, false);
    assert.match(rejected.result.error, /layer limit \(10\) reached/);
  });

  it("rejects a nonexistent animId or frameId", async () => {
    const badAnim = await lensRun("animation", "frame-layer-import-image", {
      params: { animId: "anm_nope", frameId, imageRef: STREAM_REF },
    }, ctx);
    assert.equal(badAnim.result.ok, false);
    assert.match(badAnim.result.error, /animation not found/);

    const badFrame = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId: "frm_nope", imageRef: STREAM_REF },
    }, ctx);
    assert.equal(badFrame.result.ok, false);
    assert.match(badFrame.result.error, /frame not found/);
  });

  it("rejects a missing or invalid imageRef — never silently accepts garbage", async () => {
    const missing = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId },
    }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /valid imageRef/);

    const emptyString = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: "   " },
    }, ctx);
    assert.equal(emptyString.result.ok, false);
    assert.match(emptyString.result.error, /valid imageRef/);

    const garbage = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: "not-a-url-or-data-uri" },
    }, ctx);
    assert.equal(garbage.result.ok, false);
    assert.match(garbage.result.error, /valid imageRef/);

    // A relative path that ISN'T the real /api/media/:id/stream shape is
    // also rejected — the validator matches the real route, not any string
    // that merely starts with a slash.
    const wrongPath = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: "/etc/passwd" },
    }, ctx);
    assert.equal(wrongPath.result.ok, false);
    assert.match(wrongPath.result.error, /valid imageRef/);
  });

  it("a reference layer can never receive strokes — anim-stroke-commit/batch/pressure all reject it", async () => {
    const imp = await lensRun("animation", "frame-layer-import-image", {
      params: { animId, frameId, imageRef: STREAM_REF, name: "No-draw ref" },
    }, ctx);
    const layerId = imp.result.layer.id;

    const commit = await lensRun("animation", "anim-stroke-commit", {
      params: { animId, frameId, layerId, stroke: { tool: "ink", points: [[1, 1], [2, 2]] } },
    }, ctx);
    assert.equal(commit.result.ok, false);
    assert.match(commit.result.error, /cannot draw on a reference layer/);

    const batch = await lensRun("animation", "anim-stroke-batch", {
      params: { animId, frameId, layerId, strokes: [{ tool: "ink", points: [[1, 1], [2, 2]] }] },
    }, ctx);
    assert.equal(batch.result.ok, false);
    assert.match(batch.result.error, /cannot draw on a reference layer/);

    const pressure = await lensRun("animation", "stroke-commit-pressure", {
      params: { animId, frameId, layerId, stroke: { tool: "ink", size: 10, points: [[1, 1, 0.5], [2, 2, 0.5]] } },
    }, ctx);
    assert.equal(pressure.result.ok, false);
    assert.match(pressure.result.error, /cannot draw on a reference layer/);

    // Confirm no stroke actually landed despite the rejections.
    const got = await lensRun("animation", "anim-get", { params: { id: animId } }, ctx);
    const frame = got.result.animation.frames.find((f) => f.id === frameId);
    const persisted = frame.layers.find((l) => l.id === layerId);
    assert.deepEqual(persisted.strokes, []);
  });

  it("frame-duplicate preserves a reference layer's type/imageRef/isReference (not just paintable layers)", async () => {
    const c = await lensRun("animation", "anim-create", { params: { title: "Dup w/ ref" } }, ctx);
    const dAnimId = c.result.animation.id;
    const dFrameId = c.result.animation.frames[0].id;
    const imp = await lensRun("animation", "frame-layer-import-image", {
      params: { animId: dAnimId, frameId: dFrameId, imageRef: STREAM_REF, opacity: 0.35, name: "Dup ref" },
    }, ctx);
    const origLayerId = imp.result.layer.id;

    const dup = await lensRun("animation", "frame-duplicate", { params: { animId: dAnimId, frameId: dFrameId } }, ctx);
    const copiedRef = dup.result.frame.layers.find((l) => l.name === "Dup ref");
    assert.ok(copiedRef, "the duplicated frame must carry a copy of the reference layer");
    assert.notEqual(copiedRef.id, origLayerId); // fresh id
    assert.equal(copiedRef.type, "reference");
    assert.equal(copiedRef.isReference, true);
    assert.equal(copiedRef.imageRef, STREAM_REF);
    assert.equal(copiedRef.opacity, 0.35);
    assert.deepEqual(copiedRef.strokes, []);

    // Regular paintable layers still duplicate exactly as before.
    const paintable = dup.result.frame.layers.find((l) => l.name === "Layer 1");
    assert.equal(paintable.type, "paintable");
  });

  it("per-user isolation: one user's imported reference layer is invisible to another user", async () => {
    const ctxA = await depthCtx("animation-ref-isolation-a");
    const ctxB = await depthCtx("animation-ref-isolation-b");
    const a = await lensRun("animation", "anim-create", { params: { title: "Owner A anim" } }, ctxA);
    const aAnimId = a.result.animation.id;
    const aFrameId = a.result.animation.frames[0].id;
    const imp = await lensRun("animation", "frame-layer-import-image", {
      params: { animId: aAnimId, frameId: aFrameId, imageRef: STREAM_REF },
    }, ctxA);
    assert.equal(imp.ok, true);
    assert.ok(imp.result.layer);

    // User B cannot see or import onto user A's animation at all.
    const bGet = await lensRun("animation", "anim-get", { params: { id: aAnimId } }, ctxB);
    assert.equal(bGet.result.ok, false);
    assert.match(bGet.result.error, /animation not found/);

    const bImport = await lensRun("animation", "frame-layer-import-image", {
      params: { animId: aAnimId, frameId: aFrameId, imageRef: STREAM_REF },
    }, ctxB);
    assert.equal(bImport.result.ok, false);
    assert.match(bImport.result.error, /animation not found/);

    // User A's own project list doesn't leak into user B's.
    const bList = await lensRun("animation", "anim-list", {}, ctxB);
    assert.ok(!bList.result.animations.some((x) => x.id === aAnimId));
  });
});
