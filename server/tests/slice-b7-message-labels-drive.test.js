import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMessage from "../domains/message.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`message.${name}`);
  assert.ok(fn, `message.${name} missing`);
  return await fn(ctx, { id: null, domain: "message", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerMessage(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };
describe("FIX-message-006 drive — labels-delete", () => {
  it("deletes the label and strips it from every message it was applied to", async () => {
    const c = await call("labels-create", u1, { name: "Receipts" });
    assert.equal(c.ok, true);
    const lbl = c.result.label.id;
    await call("labels-apply", u1, { messageId: "m1", labelId: lbl });
    await call("labels-apply", u1, { messageId: "m2", labelId: lbl });
    let forMsg = await call("labels-for-message", u1, { messageId: "m1" });
    assert.equal(forMsg.result.labels.length, 1);

    const del = await call("labels-delete", u1, { labelId: lbl });
    assert.equal(del.ok, true);
    const list = await call("labels-list", u1, {});
    assert.equal(list.result.labels.length, 0);
    forMsg = await call("labels-for-message", u1, { messageId: "m1" });
    assert.equal(forMsg.result.labels.length, 0, "no dangling label id on m1");
    const again = await call("labels-delete", u1, { labelId: lbl });
    assert.equal(again.ok, false);
    assert.equal(again.error, "label not found");
  });
});
