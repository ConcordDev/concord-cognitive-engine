// tests/depth/ar-render-behavior.test.js
//
// Behavioral coverage for ar.render (lens-audit: the last "blocked" wire — turned out to
// reuse the existing ar.webxrPreview plan + the WebXR/Three.js stack, not a missing
// capability). Asserts the render descriptor is built deterministically from a scene
// artifact, synthesizes a single renderable from flat form fields, computes the WebXR
// session features + a sorted draw list, and degrades gracefully on an empty artifact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

test("ar.render builds a descriptor from an artifact's objects[] (multi-object scene)", async () => {
  const r = await lensRun("ar", "render", {
    data: {
      name: "Demo scene", anchor: "plane",
      objects: [
        { id: "a", kind: "model", model: "/models/ar/chair.glb", position: { x: 0, y: 0, z: 0 }, opacity: 1 },
        { id: "b", kind: "model", primitive: "sphere", position: { x: 1, y: 0, z: 0 }, opacity: 0.5, occlusion: { enabled: true } },
      ],
    },
  });
  const res = r.result ?? r;
  assert.equal(res.sessionMode, "immersive-ar");
  assert.ok(res.requiredFeatures.includes("local-floor"));
  assert.ok(res.requiredFeatures.includes("plane-detection"));
  assert.ok(res.optionalFeatures.includes("depth-sensing"), "occlusion object adds depth-sensing");
  assert.equal(res.objectCount, 2);
  // opaque object sorts before the transparent one
  assert.equal(res.drawList[0].opacity, 1);
  assert.equal(res.drawList[1].opacity, 0.5);
  assert.equal(res.inlineFallback, true);
  // model URL is collected for GLTF cache warming
  assert.ok(res.assets.includes("/models/ar/chair.glb"));
  // bounds computed from positions
  assert.equal(res.bounds.center.x, 0.5);
});

test("ar.render synthesizes a single renderable from flat form fields (string vecs)", async () => {
  const r = await lensRun("ar", "render", {
    data: { name: "Single model", format: "glb", position: "2,3,4", rotation: "0,90,0", scale: "2", opacity: 75, anchorType: "image" },
  });
  const res = r.result ?? r;
  assert.equal(res.objectCount, 1);
  assert.equal(res.anchor, "image");
  assert.ok(res.optionalFeatures.includes("image-tracking"), "image anchor adds image-tracking");
  const t = res.drawList[0].transform;
  assert.deepEqual(t.position, { x: 2, y: 3, z: 4 }, "parses the x,y,z position string");
  assert.equal(t.scale, 2);
  assert.equal(res.drawList[0].opacity, 0.75, "0-100 opacity normalized to 0-1");
});

test("ar.render degrades gracefully on an empty artifact (no throw, valid plan)", async () => {
  const r = await lensRun("ar", "render", { data: {} });
  const res = r.result ?? r;
  assert.equal(res.sessionMode, "immersive-ar");
  assert.deepStrictEqual(res.objectCount, 1, "synthesizes a default renderable");
  assert.ok(Array.isArray(res.requiredFeatures));
});
