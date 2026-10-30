// Behaviour tests for Projects goal reconciliation (Review 4,
// projects.md F12, slice S9): a goal whose metric names a system
// measure ("Tasks done", points, issues closed) used to be a manual
// spinbutton that read 0 while the work it claimed to measure was
// already done. Now goal-list computes system metrics live from
// project state and returns the exact issue refs counted (the
// receipts); typing a value into a system goal is refused with the
// reason; manual metrics keep their stored value and are flagged
// systemMetric: null so the surface can label them manual.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerProjectsActions from "../domains/projects.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`projects.${name}`);
  assert.ok(fn, `projects.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerProjectsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function setup() {
  const p = call("project-create", ctxA, { name: "Goals", key: "GLS" }).result.project;
  const t1 = call("task-create", ctxA, { projectId: p.id, title: "One", points: 3 }).result.task;
  const t2 = call("task-create", ctxA, { projectId: p.id, title: "Two", points: 2 }).result.task;
  const t3 = call("task-create", ctxA, { projectId: p.id, title: "Three", points: 5 }).result.task;
  return { p, t1, t2, t3 };
}
const listGoals = (pid) => call("goal-list", ctxA, { projectId: pid }).result.goals;

describe("projects goals — system metrics reconcile live (F12)", () => {
  it("a 'Tasks done' goal counts completed issues and names them", () => {
    const { p, t1, t2 } = setup();
    const g = call("goal-create", ctxA, { projectId: p.id, name: "Ship two", metric: "Tasks done", target: 2 }).result.goal;
    assert.equal(listGoals(p.id)[0].current, 0);
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    call("task-move-status", ctxA, { id: t2.id, status: "done" });
    const after = listGoals(p.id)[0];
    assert.equal(after.id, g.id);
    assert.equal(after.current, 2, "the goal moved without anyone touching the spinbutton");
    assert.equal(after.progressPct, 100);
    assert.equal(after.systemMetric, "tasks_done");
    assert.deepEqual(after.countedRefs.sort(), [t1.ref, t2.ref].sort(),
      "the receipts: exactly the issues counted");
  });

  it("a points goal sums the points of done issues only", () => {
    const { p, t1, t3 } = setup();
    call("goal-create", ctxA, { projectId: p.id, name: "Points", metric: "points", target: 10 });
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    call("task-move-status", ctxA, { id: t3.id, status: "in_progress" });
    const g = listGoals(p.id)[0];
    assert.equal(g.current, 3);
    assert.equal(g.systemMetric, "points_done");
    assert.deepEqual(g.countedRefs, [t1.ref]);
  });

  it("typing a value into a system goal is refused; target edits still work", () => {
    const { p } = setup();
    const g = call("goal-create", ctxA, { projectId: p.id, name: "Ship", metric: "Tasks done", target: 2 }).result.goal;
    const r = call("goal-update-progress", ctxA, { id: g.id, current: 99 });
    assert.equal(r.ok, false);
    assert.match(r.error, /cannot be typed/);
    assert.equal(call("goal-update-progress", ctxA, { id: g.id, target: 4 }).ok, true);
    assert.equal(listGoals(p.id)[0].target, 4);
    assert.equal(listGoals(p.id)[0].current, 0, "the refused write stored nothing");
  });

  it("a manual metric keeps its typed value and is flagged manual", () => {
    const { p, t1 } = setup();
    const g = call("goal-create", ctxA, { projectId: p.id, name: "NPS", metric: "NPS score", target: 50 }).result.goal;
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    assert.equal(call("goal-update-progress", ctxA, { id: g.id, current: 42 }).ok, true);
    const after = listGoals(p.id)[0];
    assert.equal(after.current, 42);
    assert.equal(after.systemMetric, null, "the surface labels this one manual");
    assert.deepEqual(after.countedRefs, []);
  });
});
