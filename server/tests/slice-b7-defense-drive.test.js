import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDefense from "../domains/defense.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`defense.${name}`);
  assert.ok(fn, `defense.${name} missing`);
  return await fn(ctx, { id: null, domain: "defense", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerDefense(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };
describe("defense-002 drive", () => {
  it("add -> delete -> plan no longer lists the task", async () => {
    const a = await call("mission-task-add", u1, { name: "qa-zt2-missions", phase: "shaping" });
    assert.equal(a.ok, true);
    const id = a.result.task.id;
    let plan = await call("mission-plan", u1, {});
    assert.equal(plan.result.tasks.length, 1);
    const d = await call("mission-task-delete", u1, { id });
    assert.equal(d.ok, true);
    plan = await call("mission-plan", u1, {});
    assert.equal(plan.result.tasks.length, 0);
  });
});
