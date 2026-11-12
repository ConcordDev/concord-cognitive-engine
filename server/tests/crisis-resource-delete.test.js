// FIX-crisis-ops-004 — a QA/resource asset can be deleted by its owner.
// Pins for crisis.resource_delete (the store is the per-user
// globalThis map the parity harness uses):
//  1. Upsert then delete: the asset leaves the owner's inventory.
//  2. An asset with units deployed is refused (resource_deployed) until
//     the units are recalled.
//  3. Another user's asset is invisible (resource_not_found), and an
//     unknown id is refused the same way.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCrisisMacros from "../domains/crisis.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`crisis.${name}`);
  assert.ok(fn, `crisis.${name} not registered`);
  return fn(ctx, params);
}

before(() => { registerCrisisMacros(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("crisis.resource_delete", () => {
  it("deletes the owner's asset", async () => {
    const up = await call("resource_upsert", ctxA, { name: "QA boat", category: "vehicles", quantity: 2, unit: "boats" });
    const id = up.result.resource.id;
    const del = await call("resource_delete", ctxA, { resourceId: id });
    assert.equal(del.ok, true);
    const list = await call("resources", ctxA, {});
    assert.equal(list.result.resources.length, 0);
  });

  it("refuses while units are deployed; recalling frees the delete", async () => {
    const up = await call("resource_upsert", ctxA, { name: "QA tent", category: "supplies", quantity: 3, unit: "tents" });
    const id = up.result.resource.id;
    await call("resource_deploy", ctxA, { resourceId: id, amount: 1 });
    const blocked = await call("resource_delete", ctxA, { resourceId: id });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "resource_deployed");
    await call("resource_deploy", ctxA, { resourceId: id, amount: -1 });
    const del = await call("resource_delete", ctxA, { resourceId: id });
    assert.equal(del.ok, true);
  });

  it("cannot see or delete another user's asset", async () => {
    const up = await call("resource_upsert", ctxA, { name: "QA radio", category: "equipment", quantity: 1, unit: "radios" });
    const del = await call("resource_delete", ctxB, { resourceId: up.result.resource.id });
    assert.equal(del.ok, false);
    assert.equal(del.error, "resource_not_found");
    assert.equal((await call("resource_delete", ctxA, { resourceId: "nope" })).error, "resource_not_found");
  });
});
