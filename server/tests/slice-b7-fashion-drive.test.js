import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFashion from "../domains/fashion.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`fashion.${name}`);
  assert.ok(fn, `fashion.${name} missing`);
  return await fn(ctx, { id: null, domain: "fashion", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerFashion(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };
describe("FIX-fashion-002/003 drive", () => {
  it("wear logs delete singly; item delete cascades its logs and the month count follows", async () => {
    const item = (await call("item-add", u1, { name: "qa coat" })).result.item;
    await call("item-wear", u1, { id: item.id, date: "2026-11-10" });
    await call("item-wear", u1, { id: item.id, date: "2026-11-11" });
    let view = await call("calendar-view", u1, { month: "2026-11" });
    assert.equal(view.result.entries.length, 2);
    assert.ok(view.result.entries[0].id, "entries carry their log id");
    const delOne = await call("calendar-delete", u1, { id: view.result.entries[0].id });
    assert.equal(delOne.ok, true);
    view = await call("calendar-view", u1, { month: "2026-11" });
    assert.equal(view.result.entries.length, 1);
    const dash = await call("fashion-dashboard", u1, {});
    assert.equal(dash.result.wornThisMonth >= 0, true);
    const delItem = await call("item-delete", u1, { id: item.id });
    assert.equal(delItem.ok, true);
    assert.equal(delItem.result.removedWearLogs, 1, "the surviving log went with the item");
    view = await call("calendar-view", u1, { month: "2026-11" });
    assert.equal(view.result.entries.length, 0);
  });
  it("packing lists delete whole", async () => {
    const list = (await call("packing-create", u1, { name: "trip" })).result.packingList;
    const del = await call("packing-delete", u1, { id: list.id });
    assert.equal(del.ok, true);
    const lists = await call("packing-list", u1, {});
    assert.equal(lists.result.packingLists.length, 0);
  });
});
