// FIX-ar-015 — a user can delete their own compiled image targets.
// Pins for ar.imageTargetDelete, mirroring the captureDelete shape:
//  1. Compile then delete: the target leaves the caller's list.
//  2. Another user cannot delete it (their store doesn't hold it).
//  3. An unknown id is honestly refused.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArActions from "../domains/ar.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ar.${name}`);
  assert.ok(fn, `ar.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerArActions(register); });
beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.arLens;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("ar.imageTargetDelete", () => {
  it("deletes the caller's target; the list empties", () => {
    const t = call("imageTargetCompile", ctxA, { name: "Poster", width: 1024, height: 1024 }).result.target;
    const del = call("imageTargetDelete", ctxA, { targetId: t.id });
    assert.equal(del.ok, true);
    assert.equal(call("imageTargetList", ctxA, {}).result.count, 0);
  });

  it("cannot delete another user's target", () => {
    const t = call("imageTargetCompile", ctxA, { name: "Poster", width: 1024, height: 1024 }).result.target;
    const del = call("imageTargetDelete", ctxB, { targetId: t.id });
    assert.equal(del.ok, false);
    assert.equal(call("imageTargetList", ctxA, {}).result.count, 1);
  });

  it("refuses an unknown id", () => {
    const del = call("imageTargetDelete", ctxA, { targetId: "imgt_nope" });
    assert.equal(del.ok, false);
    assert.match(del.error, /not found/);
  });
});
