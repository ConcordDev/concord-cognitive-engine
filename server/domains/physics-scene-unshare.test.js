// physics-scene-unshare.test.js
// FIX-physics-007 (GB-1521 slice B6) — scene-share minted a code in one
// click with no confirmation and no way back: no unshare action existed.
// scene-unshare now revokes the owner's code (the shares entry is deleted,
// so the code stops loading) and clears the scene's shareCode.
//
// Run: node --test server/domains/physics-scene-unshare.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerPhysicsActions from "./physics.js";

const actions = new Map();
registerPhysicsActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const ctx = { actor: { userId: "test" }, userId: "test" };
const other = { actor: { userId: "someone-else" }, userId: "someone-else" };

let sceneId;
let code;

before(() => {
  globalThis._concordSTATE = {};
  const save = actions.get("physics:scene-save");
  const r = save(ctx, null, { name: "Orbit demo", bodies: [], constraints: [] });
  assert.equal(r.ok, true);
  sceneId = r.result.scene.id;
});

describe("physics-007 — share codes can be revoked", () => {
  it("registers scene-unshare", () => {
    assert.equal(typeof actions.get("physics:scene-unshare"), "function");
  });

  it("share mints a code that loads for another user", () => {
    const share = actions.get("physics:scene-share");
    const r = share(ctx, null, { id: sceneId });
    assert.equal(r.ok, true);
    code = r.result.shareCode;
    assert.ok(code);
    const load = actions.get("physics:scene-load-shared");
    assert.equal(load(other, null, { shareCode: code }).ok, true);
  });

  it("unshare revokes: the code stops loading and the scene clears it", () => {
    const unshare = actions.get("physics:scene-unshare");
    const r = unshare(ctx, null, { id: sceneId });
    assert.equal(r.ok, true);
    assert.equal(r.result.revoked, true);
    const load = actions.get("physics:scene-load-shared");
    const after = load(other, null, { shareCode: code });
    assert.equal(after.ok, false);
    const get = actions.get("physics:scene-get");
    assert.equal(get(ctx, null, { id: sceneId }).result.scene.shareCode, null);
  });

  it("unshare is owner-scoped and idempotent", () => {
    const share = actions.get("physics:scene-share");
    share(ctx, null, { id: sceneId });
    const unshare = actions.get("physics:scene-unshare");
    assert.equal(unshare(other, null, { id: sceneId }).ok, false);
    assert.equal(unshare(ctx, null, { id: sceneId }).result.revoked, true);
    assert.equal(unshare(ctx, null, { id: sceneId }).result.revoked, false);
  });
});
