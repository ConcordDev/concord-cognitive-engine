// SECURITY (PR #1809 review): goals.delete permanently removes a goal from the
// global registry, so it must refuse non-owner/admin/founder callers. server.js
// cannot be imported standalone, so this extracts the exact shipped macro and
// deleteGoal bytes and behaviour-tests them against a stub STATE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "server.js"), "utf8");

const fnStart = src.indexOf("function deleteGoal");
assert.ok(fnStart >= 0, "deleteGoal must exist in server.js");
const deleteGoalSrc = src.slice(fnStart, src.indexOf("\n}\n", fnStart) + 3);

const mStart = src.indexOf('register("goals", "delete", ');
assert.ok(mStart >= 0, 'register("goals", "delete") must exist');
const mEnd = src.indexOf("}, { public: false });", mStart);
assert.ok(mEnd > mStart, "goals.delete must stay public:false");
const macroSrc = src.slice(mStart, mEnd + "}, { public: false });".length);

function makeWorld() {
  const STATE = {
    goals: {
      registry: new Map([["goal_a", { id: "goal_a", title: "A", state: "active" }]]),
      active: new Set(["goal_a"]),
      completed: [],
    },
    queues: { goalProposals: [] },
  };
  let handler;
  const register = (d, n, fn) => { handler = fn; };
  new Function("STATE", "register", "ensureGoalSystem", "saveStateDebounced", "enforceEthosInvariant",
    deleteGoalSrc + ";" + macroSrc)(STATE, register, () => {}, () => {}, () => {});
  return { STATE, handler };
}

for (const role of ["member", "user", undefined, "viewer"]) {
  test(`role ${role} cannot delete a goal; it stays in the registry`, () => {
    const { STATE, handler } = makeWorld();
    const r = handler({ actor: { userId: "u1", role } }, { goalId: "goal_a" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "Goal deletion requires owner/admin role");
    assert.ok(STATE.goals.registry.has("goal_a"));
    assert.ok(STATE.goals.active.has("goal_a"));
  });
}

test("missing actor is refused", () => {
  const { STATE, handler } = makeWorld();
  assert.equal(handler({}, { goalId: "goal_a" }).ok, false);
  assert.ok(STATE.goals.registry.has("goal_a"));
});

for (const role of ["owner", "admin", "founder"]) {
  test(`role ${role} can delete`, () => {
    const { STATE, handler } = makeWorld();
    const r = handler({ actor: { userId: "u1", role } }, { goalId: "goal_a" });
    assert.equal(r.ok, true);
    assert.ok(!STATE.goals.registry.has("goal_a"));
  });
}
