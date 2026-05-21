// Contract tests for server/domains/ar.js
// Covers the legacy compute macros (spatialMapping/markerDetection/sceneGraph)
// and the AR scene-authoring substrate (scenes, behaviors, animation,
// image targets, publish, WebXR preview).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArActions from "../domains/ar.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`ar.${name}`);
  if (!fn) throw new Error(`ar.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerArActions(register); });

// Fresh per-user state each test — wipe the shared substrate.
beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.arLens;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

const sampleScene = {
  name: "Storefront AR",
  anchor: "plane",
  objects: [
    {
      id: "obj1", name: "Logo", kind: "model", model: "logo.glb",
      position: { x: 0, y: 0, z: 0 }, animation: { clip: "spin", autoplay: true },
      physics: { enabled: true, body: "dynamic", mass: 2 },
      occlusion: { enabled: true },
    },
    { id: "obj2", name: "Sign", kind: "text" },
  ],
  behaviors: [
    { id: "b1", trigger: "tap", action: "play_animation", targetId: "obj1" },
    { id: "b2", trigger: "proximity", action: "play_audio", targetId: "obj2", triggerParams: { radius: 3 } },
  ],
  audio: [{ id: "a1", clipUrl: "chime.mp3", radius: 4, volume: 0.5 }],
};

describe("ar legacy compute macros still work", () => {
  it("spatialMapping handles empty + populated anchors", () => {
    const empty = call("spatialMapping", ctxA, { data: { anchors: [] } }, {});
    assert.equal(empty.ok, true);
    const r = call("spatialMapping", ctxA, {
      data: { anchors: [{ id: "x", position: { x: 0, y: 0, z: 0 }, extent: { width: 1, height: 1, depth: 1 } }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.anchorCount, 1);
  });

  it("sceneGraph builds a hierarchy", () => {
    const r = call("sceneGraph", ctxA, { data: { nodes: [{ id: "root" }, { id: "child", parentId: "root" }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalNodes, 2);
  });
});

describe("ar.sceneSave / sceneList / sceneGet / sceneDelete", () => {
  it("creates a scene and normalises objects + behaviors", () => {
    const r = call("sceneSave", ctxA, {}, { scene: sampleScene });
    assert.equal(r.ok, true);
    assert.equal(r.result.saved, true);
    const s = r.result.scene;
    assert.ok(s.id.startsWith("arscene_"));
    assert.equal(s.objects.length, 2);
    assert.equal(s.behaviors.length, 2);
    assert.equal(s.objects[0].physics.body, "dynamic");
    assert.equal(s.objects[0].occlusion.enabled, true);
    assert.equal(s.version, 1);
  });

  it("rejects a scene with no name", () => {
    const r = call("sceneSave", ctxA, {}, { scene: { objects: [] } });
    assert.equal(r.ok, false);
    assert.match(r.error, /name/);
  });

  it("updates an existing scene and bumps version", () => {
    const created = call("sceneSave", ctxA, {}, { scene: sampleScene }).result.scene;
    const updated = call("sceneSave", ctxA, {}, {
      scene: { ...sampleScene, id: created.id, name: "Renamed" },
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.scene.version, 2);
    assert.equal(updated.result.scene.name, "Renamed");
  });

  it("lists only the caller's scenes", () => {
    call("sceneSave", ctxA, {}, { scene: sampleScene });
    call("sceneSave", ctxB, {}, { scene: { ...sampleScene, name: "B Scene" } });
    const listA = call("sceneList", ctxA, {}, {});
    assert.equal(listA.ok, true);
    assert.equal(listA.result.count, 1);
    assert.equal(listA.result.scenes[0].objectCount, 2);
  });

  it("gets a full scene and deletes it", () => {
    const id = call("sceneSave", ctxA, {}, { scene: sampleScene }).result.scene.id;
    const got = call("sceneGet", ctxA, {}, { sceneId: id });
    assert.equal(got.ok, true);
    assert.equal(got.result.scene.id, id);
    const del = call("sceneDelete", ctxA, {}, { sceneId: id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    assert.equal(call("sceneGet", ctxA, {}, { sceneId: id }).ok, false);
  });

  it("sceneGet errors on missing id", () => {
    assert.equal(call("sceneGet", ctxA, {}, {}).ok, false);
  });
});

describe("ar.behaviorValidate", () => {
  it("validates a clean behavior graph via inline objects", () => {
    const r = call("behaviorValidate", ctxA, {}, {
      objects: sampleScene.objects,
      behaviors: sampleScene.behaviors,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.valid, true);
    assert.equal(r.result.errorCount, 0);
    assert.equal(r.result.graph.length, 2);
    assert.equal(r.result.triggerCounts.tap, 1);
  });

  it("flags a behavior targeting a non-existent object", () => {
    const r = call("behaviorValidate", ctxA, {}, {
      objects: [{ id: "o1" }],
      behaviors: [{ id: "bX", trigger: "tap", action: "show", targetId: "ghost" }],
    });
    assert.equal(r.result.valid, false);
    assert.equal(r.result.errorCount, 1);
  });

  it("validates by sceneId", () => {
    const id = call("sceneSave", ctxA, {}, { scene: sampleScene }).result.scene.id;
    const r = call("behaviorValidate", ctxA, {}, { sceneId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.behaviorCount, 2);
  });
});

describe("ar.animationTimeline", () => {
  it("compiles tracks, computes duration + frame count", () => {
    const r = call("animationTimeline", ctxA, {}, {
      fps: 30,
      tracks: [
        { objectId: "obj1", property: "position", keyframes: [{ t: 0, value: 0 }, { t: 2, value: 10 }] },
        { objectId: "obj2", property: "opacity", keyframes: [{ t: 0, value: 1 }, { t: 1, value: 0 }] },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.duration, 2);
    assert.equal(r.result.frameCount, 60);
    assert.equal(r.result.trackCount, 2);
    assert.ok(r.result.sampledTrack.length > 0);
  });

  it("detects overlapping tracks on the same object+property", () => {
    const r = call("animationTimeline", ctxA, {}, {
      tracks: [
        { objectId: "o", property: "scale", keyframes: [{ t: 0, value: 1 }] },
        { objectId: "o", property: "scale", keyframes: [{ t: 1, value: 2 }] },
      ],
    });
    assert.equal(r.result.hasOverlaps, true);
  });

  it("handles empty tracks gracefully", () => {
    const r = call("animationTimeline", ctxA, {}, { tracks: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.duration, 0);
  });
});

describe("ar.imageTargetCompile / imageTargetList", () => {
  it("compiles an image into a scored target", () => {
    const r = call("imageTargetCompile", ctxA, {}, {
      name: "Poster", width: 2048, height: 1536, featurePoints: 2400, contrastScore: 0.8,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.target.trackabilityScore >= 0 && r.result.target.trackabilityScore <= 1);
    assert.ok(["poor", "fair", "good", "excellent"].includes(r.result.target.rating));
    assert.ok(r.result.target.physical.heightCm > 0);
  });

  it("warns on low-feature images", () => {
    const r = call("imageTargetCompile", ctxA, {}, {
      name: "Blank", width: 512, height: 512, featurePoints: 20, contrastScore: 0.2,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.target.warnings.length > 0);
  });

  it("rejects a target with no name", () => {
    assert.equal(call("imageTargetCompile", ctxA, {}, {}).ok, false);
  });

  it("lists compiled targets per user", () => {
    call("imageTargetCompile", ctxA, {}, { name: "T1", width: 1024, height: 1024 });
    const list = call("imageTargetList", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
  });
});

describe("ar.publishScene", () => {
  it("publishes a scene and returns a QR-encodable link", () => {
    const id = call("sceneSave", ctxA, {}, { scene: sampleScene }).result.scene.id;
    const r = call("publishScene", ctxA, {}, { sceneId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.publish.url.includes("/ar/view/"));
    assert.equal(r.result.publish.qrPayload, r.result.publish.url);
    assert.equal(r.result.publish.markerBased, false);
    assert.ok(r.result.publish.expiresAt > r.result.publish.publishedAt);
  });

  it("rejects publishing an unknown scene", () => {
    const r = call("publishScene", ctxA, {}, { sceneId: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("ar.webxrPreview", () => {
  it("produces a WebXR session plan with sorted draw list", () => {
    const r = call("webxrPreview", ctxA, {}, {
      objects: sampleScene.objects, anchor: "plane", settings: { planeDetection: true },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sessionMode, "immersive-ar");
    assert.ok(r.result.requiredFeatures.includes("plane-detection"));
    assert.ok(r.result.optionalFeatures.includes("depth-sensing")); // occlusion object present
    assert.equal(r.result.drawList.length, 2);
  });

  it("resolves a saved scene by id and adds image-tracking for image anchors", () => {
    const id = call("sceneSave", ctxA, {}, {
      scene: { ...sampleScene, anchor: "image" },
    }).result.scene.id;
    const r = call("webxrPreview", ctxA, {}, { sceneId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.optionalFeatures.includes("image-tracking"));
  });
});
