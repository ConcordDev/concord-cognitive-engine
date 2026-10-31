// S1/S7 backend (Review 5 F1) — agent goals and system proposals are
// deletable: a deleteGoal core in server.js's GOAL SYSTEM CORE, a
// "delete" macro (NOT public), and DELETE /api/goals/:goalId in
// routes/domain.js. server.js cannot be imported standalone, so this
// suite extracts the exact shipped deleteGoal bytes and behaviour-
// tests them against a stub STATE, and pins the wiring textually.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, "..", "server.js"), "utf8");
const routesSrc = readFileSync(join(here, "..", "routes", "domain.js"), "utf8");

const i = serverSrc.indexOf("function deleteGoal");
assert.ok(i >= 0, "deleteGoal must exist in server.js");
const j = serverSrc.indexOf("\n}\n", i) + 3;
const deleteGoalSrc = serverSrc.slice(i, j);

function makeWorld() {
  const STATE = {
    goals: {
      registry: new Map([
        ["goal_a", { id: "goal_a", title: "A", state: "active" }],
        ["goal_b", { id: "goal_b", title: "B", state: "proposed" }],
        ["goal_c", { id: "goal_c", title: "C", state: "completed" }],
      ]),
      active: new Set(["goal_a"]),
      completed: [{ id: "goal_c", title: "C" }],
    },
    queues: { goalProposals: [{ id: "goal_b", createdAt: "t" }, { id: "goal_z", createdAt: "t" }] },
  };
  let saves = 0;
  const deleteGoal = new Function("STATE", "ensureGoalSystem", "saveStateDebounced",
    deleteGoalSrc + "; return deleteGoal;")(STATE, () => {}, () => { saves++; });
  return { STATE, deleteGoal, saves: () => saves };
}

test("wiring: macro registered non-public, REST route present, public allowlist untouched", () => {
  assert.ok(serverSrc.includes('register("goals", "delete"'));
  assert.ok(routesSrc.includes('app.delete("/api/goals/:goalId"'));
  assert.ok(routesSrc.includes('runMacro("goals", "delete"'));
  // The anonymous/public macro allowlist must NOT gain "delete".
  assert.ok(serverSrc.includes('goals: new Set(["list", "get", "status", "config", "complete"])'));
});

test("delete removes registry, active set, proposal queue and completed history", () => {
  const { STATE, deleteGoal, saves } = makeWorld();
  const r = deleteGoal("goal_a");
  assert.equal(r.ok, true);
  assert.equal(r.deleted, true);
  assert.equal(r.goal.title, "A"); // the deletion names what it removed
  assert.equal(STATE.goals.registry.has("goal_a"), false);
  assert.equal(STATE.goals.active.has("goal_a"), false);
  const rb = deleteGoal("goal_b");
  assert.equal(rb.ok, true);
  assert.deepEqual(STATE.queues.goalProposals.map((p) => p.id), ["goal_z"]);
  const rc = deleteGoal("goal_c");
  assert.equal(rc.ok, true);
  assert.equal(STATE.goals.completed.length, 0);
  assert.equal(saves(), 3);
});

test("deleting a missing goal refuses and touches nothing", () => {
  const { STATE, deleteGoal, saves } = makeWorld();
  const r = deleteGoal("goal_nope");
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/i);
  assert.equal(STATE.goals.registry.size, 3);
  assert.equal(saves(), 0);
});
