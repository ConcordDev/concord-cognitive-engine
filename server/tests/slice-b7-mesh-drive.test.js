import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMesh from "../domains/mesh.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`mesh.${name}`);
  assert.ok(fn, `mesh.${name} missing`);
  return await fn(ctx, { id: null, domain: "mesh", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerMesh(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };
describe("FIX-mesh-003 drive — deleteMessage", () => {
  it("deletes from the caller's log only and drops the queued frame", async () => {
    const sent = await call("sendMessage", u1, { to: "node-offline-1", body: "hello mesh" });
    assert.equal(sent.ok, true);
    const id = sent.result.message.id;
    assert.equal(sent.result.queued, true, "offline target queues a frame");
    const del = await call("deleteMessage", u1, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.removedFrames, 1);
    const conv = await call("conversation", u1, {});
    assert.equal((conv.result.messages || []).some((m) => m.id === id), false);
    const again = await call("deleteMessage", u1, { id });
    assert.equal(again.ok, false);
  });
});
