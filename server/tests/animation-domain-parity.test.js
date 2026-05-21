// Contract tests for the animation FlipaClip + Pencil2D 2026-parity
// frame-by-frame animator (projects, frames, exposure, stroke loop,
// playback expansion, easing curves).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnimationActions from "../domains/animation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`animation.${name}`);
  assert.ok(fn, `animation.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAnimationActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const STROKE = { tool: "ink", color: "#101820", size: 5, opacity: 1, points: [[5, 5], [15, 20]] };

function newAnim(ctx = ctxA) {
  const r = call("anim-create", ctx, { title: "Bounce", width: 640, height: 360, fps: 12 });
  assert.equal(r.ok, true);
  return r.result.animation;
}

describe("animation.anim-*", () => {
  it("creates with one frame, lists, renames, deletes", () => {
    const a = newAnim();
    assert.equal(a.frames.length, 1);
    assert.equal(call("anim-list", ctxA, {}).result.count, 1);
    call("anim-rename", ctxA, { id: a.id, title: "Bounce Final" });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.title, "Bounce Final");
    call("anim-delete", ctxA, { id: a.id });
    assert.equal(call("anim-list", ctxA, {}).result.count, 0);
  });

  it("updates fps and isolates per user", () => {
    const a = newAnim();
    call("anim-update-settings", ctxA, { id: a.id, fps: 24 });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.fps, 24);
    assert.equal(call("anim-list", ctxB, {}).result.count, 0);
  });
});

describe("animation frames", () => {
  it("adds, duplicates, reorders and deletes frames", () => {
    const a = newAnim();
    const f1 = a.frames[0].id;
    call("anim-stroke-commit", ctxA, { animId: a.id, frameId: f1, stroke: STROKE });
    const dup = call("frame-duplicate", ctxA, { animId: a.id, frameId: f1 });
    assert.equal(dup.result.frame.layers[0].strokes.length, 1);
    call("frame-add", ctxA, { animId: a.id });
    let anim = call("anim-get", ctxA, { id: a.id }).result.animation;
    assert.equal(anim.frames.length, 3);
    call("frame-reorder", ctxA, { animId: a.id, frameId: f1, direction: "right" });
    anim = call("anim-get", ctxA, { id: a.id }).result.animation;
    assert.equal(anim.frames[1].id, f1);
    call("frame-delete", ctxA, { animId: a.id, frameId: f1 });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames.length, 2);
  });

  it("refuses to delete the last frame", () => {
    const a = newAnim();
    assert.equal(call("frame-delete", ctxA, { animId: a.id, frameId: a.frames[0].id }).ok, false);
  });

  it("sets per-frame exposure", () => {
    const a = newAnim();
    call("frame-set-exposure", ctxA, { animId: a.id, frameId: a.frames[0].id, exposure: 4 });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].exposure, 4);
  });
});

describe("animation stroke loop", () => {
  it("commits, batches and undoes strokes on a frame", () => {
    const a = newAnim();
    const fid = a.frames[0].id;
    call("anim-stroke-commit", ctxA, { animId: a.id, frameId: fid, stroke: STROKE });
    const batch = call("anim-stroke-batch", ctxA, { animId: a.id, frameId: fid, strokes: [STROKE, STROKE] });
    assert.equal(batch.result.strokeCount, 3);
    call("anim-stroke-undo", ctxA, { animId: a.id, frameId: fid });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].layers[0].strokes.length, 2);
    call("frame-clear", ctxA, { animId: a.id, frameId: fid });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].layers[0].strokes.length, 0);
  });

  it("rejects a stroke with no points", () => {
    const a = newAnim();
    const r = call("anim-stroke-commit", ctxA, { animId: a.id, frameId: a.frames[0].id, stroke: { tool: "ink", points: [] } });
    assert.equal(r.ok, false);
  });
});

describe("animation playback & easing", () => {
  it("playback-frames expands frames by exposure", () => {
    const a = newAnim();
    call("frame-set-exposure", ctxA, { animId: a.id, frameId: a.frames[0].id, exposure: 3 });
    call("frame-add", ctxA, { animId: a.id });
    const pb = call("playback-frames", ctxA, { id: a.id });
    // frame 1 held 3 + frame 2 held 1 = 4 playback frames
    assert.equal(pb.result.totalFrames, 4);
    assert.equal(pb.result.fps, 12);
  });

  it("easing-curve samples a known curve monotonically", () => {
    const r = call("easing-curve", ctxA, { type: "ease-in", steps: 5 });
    assert.equal(r.result.samples.length, 5);
    assert.equal(r.result.samples[0].value, 0);
    assert.equal(r.result.samples[4].value, 1);
    assert.ok(r.result.easings.includes("bounce-out"));
  });

  it("dashboard rolls up animations and frames", () => {
    const a = newAnim();
    call("frame-add", ctxA, { animId: a.id });
    const d = call("anim-dashboard", ctxA, {});
    assert.equal(d.result.animations, 1);
    assert.equal(d.result.totalFrames, 2);
  });
});

describe("animation per-frame layers", () => {
  it("adds, updates and deletes layers on a frame; strokes target a layer", () => {
    const a = newAnim();
    const fid = a.frames[0].id;
    const l2 = call("frame-layer-add", ctxA, { animId: a.id, frameId: fid, name: "Ink" }).result.layer;
    call("anim-stroke-commit", ctxA, { animId: a.id, frameId: fid, layerId: l2.id, stroke: STROKE });
    const frame = call("anim-get", ctxA, { id: a.id }).result.animation.frames[0];
    assert.equal(frame.layers.length, 2);
    assert.equal(frame.layers[1].strokes.length, 1);
    call("frame-layer-update", ctxA, { animId: a.id, frameId: fid, layerId: l2.id, visible: false });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].layers[1].visible, false);
    call("frame-layer-delete", ctxA, { animId: a.id, frameId: fid, layerId: l2.id });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].layers.length, 1);
  });

  it("refuses to delete the last layer of a frame", () => {
    const a = newAnim();
    const fid = a.frames[0].id;
    const only = call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].layers[0].id;
    assert.equal(call("frame-layer-delete", ctxA, { animId: a.id, frameId: fid, layerId: only }).ok, false);
  });
});

describe("animation audio tracks", () => {
  it("adds, lists and removes audio tracks", () => {
    const a = newAnim();
    const t = call("audio-track-add", ctxA, { animId: a.id, name: "Theme", url: "https://example.com/x.mp3", startSec: 2 }).result.track;
    assert.equal(call("audio-track-list", ctxA, { animId: a.id }).result.count, 1);
    assert.equal(t.startSec, 2);
    call("audio-track-remove", ctxA, { animId: a.id, id: t.id });
    assert.equal(call("audio-track-list", ctxA, { animId: a.id }).result.count, 0);
  });

  it("rejects an unnamed audio track", () => {
    const a = newAnim();
    assert.equal(call("audio-track-add", ctxA, { animId: a.id, name: "" }).ok, false);
  });
});

// ════════════════════════════════════════════════════════════════════
// FlipaClip / Pencil2D 2026 feature-parity backlog
// ════════════════════════════════════════════════════════════════════

describe("animation video export", () => {
  it("export-manifest walks the exposure-expanded sequence", () => {
    const a = newAnim();
    call("frame-set-exposure", ctxA, { animId: a.id, frameId: a.frames[0].id, exposure: 3 });
    call("frame-add", ctxA, { animId: a.id });
    const r = call("export-manifest", ctxA, { id: a.id, format: "mp4", scale: 0.5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "mp4");
    assert.equal(r.result.frameCount, 4);
    assert.equal(r.result.width, 320);
  });

  it("export-record + export-list round-trip an export job", () => {
    const a = newAnim();
    const rec = call("export-record", ctxA, {
      animId: a.id, format: "gif", frameCount: 12, fileSizeBytes: 4096, durationSec: 1,
    });
    assert.equal(rec.ok, true);
    assert.equal(rec.result.export.format, "gif");
    const list = call("export-list", ctxA, { animId: a.id });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.exports[0].id, rec.result.export.id);
  });
});

describe("animation audio waveform sync", () => {
  it("audio-waveform-set stores peaks and audio-sync-map maps to frames", () => {
    const a = newAnim();
    const t = call("audio-track-add", ctxA, { animId: a.id, name: "Score", startSec: 1 }).result.track;
    const ws = call("audio-waveform-set", ctxA, {
      animId: a.id, trackId: t.id, peaks: [0.1, 0.9, 0.4, 1], durationSec: 2,
    });
    assert.equal(ws.ok, true);
    assert.equal(ws.result.peakCount, 4);
    const sync = call("audio-sync-map", ctxA, { id: a.id });
    assert.equal(sync.result.tracks.length, 1);
    assert.equal(sync.result.tracks[0].startFrame, 12); // 1s * 12fps
    assert.equal(sync.result.tracks[0].waveform.length, 4);
  });

  it("audio-waveform-set rejects an empty peaks array", () => {
    const a = newAnim();
    const t = call("audio-track-add", ctxA, { animId: a.id, name: "X" }).result.track;
    assert.equal(call("audio-waveform-set", ctxA, { animId: a.id, trackId: t.id, peaks: [] }).ok, false);
  });
});

describe("animation shape tweening", () => {
  it("tween-shapes interpolates a path between two keyframes", () => {
    const a = newAnim();
    const r = call("tween-shapes", ctxA, {
      animId: a.id, fromPath: [[0, 0], [10, 10]], toPath: [[100, 100], [110, 110]],
      easing: "linear", steps: 4,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.frames.length, 5);
    assert.deepEqual(r.result.frames[0].path[0], [0, 0]);
    assert.deepEqual(r.result.frames[4].path[0], [100, 100]);
  });

  it("tween-to-frames inserts tweened frames into the project", () => {
    const a = newAnim();
    const before = call("anim-get", ctxA, { id: a.id }).result.animation.frames.length;
    const r = call("tween-to-frames", ctxA, {
      animId: a.id, fromPath: [[0, 0], [10, 10]], toPath: [[50, 50], [60, 60]], steps: 4,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 5);
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames.length, before + 5);
  });

  it("tween-shapes rejects mismatched path lengths", () => {
    const a = newAnim();
    assert.equal(call("tween-shapes", ctxA, {
      animId: a.id, fromPath: [[0, 0], [1, 1]], toPath: [[2, 2]],
    }).ok, false);
  });
});

describe("animation canvas presets + guides", () => {
  it("canvas-presets returns size and fps presets", () => {
    const r = call("canvas-presets", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.presets.length > 0);
    assert.ok(r.result.fpsPresets.includes(24));
  });

  it("set-canvas-guides persists grid and symmetry settings", () => {
    const a = newAnim();
    const r = call("set-canvas-guides", ctxA, {
      animId: a.id, grid: true, gridSize: 48, thirds: true, symmetry: "vertical",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.guides.grid, true);
    assert.equal(r.result.guides.gridSize, 48);
    assert.equal(r.result.guides.symmetry, "vertical");
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.guides.thirds, true);
  });
});

describe("animation rigging / bone armature", () => {
  it("rig-bone-add builds a hierarchy and rig-resolve-pose runs forward kinematics", () => {
    const a = newAnim();
    const fid = a.frames[0].id;
    const root = call("rig-bone-add", ctxA, {
      animId: a.id, name: "Root", x: 100, y: 100, length: 50, angle: 0,
    }).result.bone;
    const child = call("rig-bone-add", ctxA, {
      animId: a.id, name: "Arm", parentId: root.id, length: 40, angle: 0,
    }).result.bone;
    assert.ok(child.parentId === root.id);
    call("rig-pose-set", ctxA, { animId: a.id, frameId: fid, boneId: root.id, angle: 0 });
    const res = call("rig-resolve-pose", ctxA, { animId: a.id, frameId: fid });
    assert.equal(res.ok, true);
    assert.equal(res.result.segments.length, 2);
    assert.equal(res.result.segments[0].tipX, 150); // root origin 100 + length 50 at angle 0
  });

  it("rig-bone-delete removes a bone and its descendants", () => {
    const a = newAnim();
    const root = call("rig-bone-add", ctxA, { animId: a.id, name: "Root" }).result.bone;
    call("rig-bone-add", ctxA, { animId: a.id, name: "Child", parentId: root.id });
    const r = call("rig-bone-delete", ctxA, { animId: a.id, boneId: root.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.boneCount, 0);
  });
});

describe("animation pressure brushes", () => {
  it("brush-save + brush-list round-trip a custom brush with pressure dynamics", () => {
    const r = call("brush-save", ctxA, {
      name: "Soft Ink", tool: "ink", size: 9, pressureSize: 0.8, pressureOpacity: 0.4,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.brush.pressureSize, 0.8);
    const list = call("brush-list", ctxA, {});
    assert.equal(list.result.count, 1);
    call("brush-delete", ctxA, { id: r.result.brush.id });
    assert.equal(call("brush-list", ctxA, {}).result.count, 0);
  });

  it("stroke-commit-pressure expands per-point pressure into width samples", () => {
    const a = newAnim();
    const fid = a.frames[0].id;
    const r = call("stroke-commit-pressure", ctxA, {
      animId: a.id, frameId: fid,
      stroke: { tool: "ink", size: 10, pressureSize: 1, points: [[5, 5, 0], [15, 15, 1]] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.widthSamples, 2);
    const stroke = call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].layers[0].strokes[0];
    assert.equal(stroke.widths[0], 0);  // pressure 0 -> width shrinks to 0
    assert.equal(stroke.widths[1], 10); // pressure 1 -> full base size
  });
});

describe("animation templates", () => {
  it("template-list returns structural starting points", () => {
    const r = call("template-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
    assert.ok(r.result.templates.every((t) => Array.isArray(t.layers)));
  });

  it("anim-from-template seeds a project with the template's frames and layers", () => {
    const tpl = call("template-list", ctxA, {}).result.templates
      .find((t) => t.id === "walk-cycle");
    const r = call("anim-from-template", ctxA, { templateId: tpl.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.animation.frames.length, tpl.frames);
    assert.equal(r.result.animation.frames[0].layers.length, tpl.layers.length);
  });
});

describe("animation shareable links", () => {
  it("share-create + share-get + share-revoke manage a public link", () => {
    const a = newAnim();
    const sc = call("share-create", ctxA, { animId: a.id, allowDownload: true });
    assert.equal(sc.ok, true);
    const token = sc.result.share.token;
    const sg = call("share-get", ctxB, { token });
    assert.equal(sg.ok, true);
    assert.equal(sg.result.animation.id, a.id);
    assert.equal(sg.result.share.views, 1);
    const sr = call("share-revoke", ctxA, { token });
    assert.equal(sr.ok, true);
    assert.equal(call("share-get", ctxB, { token }).ok, false);
  });

  it("share-create reuses one live share per animation", () => {
    const a = newAnim();
    const t1 = call("share-create", ctxA, { animId: a.id }).result.share.token;
    const t2 = call("share-create", ctxA, { animId: a.id }).result.share.token;
    assert.equal(t1, t2);
  });
});
