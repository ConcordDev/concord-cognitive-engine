// FIX-animation-003 — the animation gallery (anim-list) must not present
// the tz walk harness's seeded fixture animations as the user's work.
// Fixtures carry the harness seed shape ("tz<digits>gt title harness
// value", anim-create defaults: 1 frame, 12 fps, no thumbnail). Real
// user animations — including a title that merely starts with "tz" —
// stay listed, on both list legs (in-memory projects + animation_shots
// rows). Hermetic: node:sqlite stands in for the db handle (same
// prepare/get/all/run surface the domain uses).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import registerAnimationActions from "../domains/animation.js";
import { up } from "../migrations/454_animation_shots.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`animation.${name}`);
  assert.ok(fn, `animation.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerAnimationActions(register); });
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  up(db);
  globalThis._concordSTATE = { db, animationLens: { projects: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
});
const ctx = { actor: { userId: "user_gallery" }, userId: "user_gallery", db: null };
// ctx.db must point at the per-test db — resolve lazily via a getter-like shim:
function C() { return { actor: { userId: "user_gallery" }, userId: "user_gallery", db }; }

describe("FIX-animation-003 harness fixtures hidden from anim-list", () => {
  it("hides a harness fixture, keeps real animations", () => {
    const fix = call("anim-create", C(), { title: "tz1017155101gt title harness value" });
    assert.equal(fix.ok, true);
    const real = call("anim-create", C(), { title: "Door slam" });
    assert.equal(real.ok, true);
    const list = call("anim-list", C(), {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.animations[0].title, "Door slam");
  });

  it("a title merely starting with tz is NOT a fixture", () => {
    call("anim-create", C(), { title: "tzatziki recipe storyboard" });
    call("anim-create", C(), { title: "tz9gt my real short" });
    const list = call("anim-list", C(), {});
    assert.equal(list.result.count, 2);
  });

  it("the shot-row leg is filtered too (in-memory projects wiped)", () => {
    call("anim-create", C(), { title: "tz1017155101gt title harness value" });
    call("anim-create", C(), { title: "Real shot" });
    globalThis._concordSTATE = { db, animationLens: { projects: new Map() } };
    const list = call("anim-list", C(), {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.animations[0].title, "Real shot");
  });

  it("an all-fixture gallery lists zero (the honest empty state input)", () => {
    call("anim-create", C(), { title: "tz1017155101gt title harness value" });
    call("anim-create", C(), { title: "tz1017155102gt title harness value" });
    const list = call("anim-list", C(), {});
    assert.equal(list.result.count, 0);
    assert.deepEqual(list.result.animations, []);
  });

  it("another user's fixtures never leak into this list", () => {
    const other = { actor: { userId: "user_other" }, userId: "user_other", db };
    call("anim-create", other, { title: "tz1017155101gt title harness value" });
    call("anim-create", other, { title: "Other real" });
    const list = call("anim-list", C(), {});
    assert.equal(list.result.count, 0);
  });
});
