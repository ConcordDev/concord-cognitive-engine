import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerUP from "../domains/urbanplanning.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`urban-planning.${name}`);
  assert.ok(fn, `urban-planning.${name} missing`);
  return await fn(ctx, { id: null, domain: "urban-planning", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerUP(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };
describe("FIX-urban-planning-003 drive — parcel/scenario update", () => {
  it("a parcel edits in place", async () => {
    const p = (await call("parcel-add", u1, { apn: "123-45", address: "1 Main St", lotSizeSqFt: 4000 })).result.parcel;
    const upd = await call("parcel-update", u1, { id: p.id, address: "2 Main St", lotSizeSqFt: 6500 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.parcel.address, "2 Main St");
    assert.equal(upd.result.parcel.lotSizeSqFt, 6500);
    assert.equal(upd.result.parcel.apn, "123-45", "untouched fields keep their values");
  });
  it("a scenario edits in place and its impacts follow", async () => {
    const sc = (await call("scenario-create", u1, { name: "Plan A", lotSizeSqFt: 5000 })).result.scenario;
    const upd = await call("scenario-update", u1, { id: sc.id, name: "Plan A revised", lotSizeSqFt: 9000 });
    assert.equal(upd.ok, true);
    const list = await call("scenario-list", u1, {});
    assert.equal(list.result.scenarios[0].name, "Plan A revised");
    assert.equal(list.result.scenarios[0].lotSizeSqFt, 9000);
  });
});
