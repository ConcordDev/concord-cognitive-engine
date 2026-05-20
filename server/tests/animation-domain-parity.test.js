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
    assert.equal(dup.result.frame.strokes.length, 1);
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
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].strokes.length, 2);
    call("frame-clear", ctxA, { animId: a.id, frameId: fid });
    assert.equal(call("anim-get", ctxA, { id: a.id }).result.animation.frames[0].strokes.length, 0);
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
