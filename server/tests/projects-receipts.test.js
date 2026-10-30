// Behaviour tests for the sprint-completion Receipt (Review 4,
// projects.md D1 + the E-PJ-1 "Settled in full." egg, slice D-batch):
// completing a sprint used to be a silent label change. Now the
// completion computes the settlement (issues and points, done of
// total — the same numbers report-velocity reconciles from), returns
// it as a receipt, and keeps it: one "sprint_receipt" entry on every
// settled issue's activity feed, so it is in the project Activity
// stream and survives reload. A sprint whose every point is done is
// flagged settledInFull. Re-completing changes nothing and writes no
// second receipt.

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

function sprintWith(work) {
  const p = call("project-create", ctxA, { name: "Receipts", key: "RCP" }).result.project;
  const sp = call("sprint-create", ctxA, { projectId: p.id, name: "Sprint 1", startDate: "2026-10-05", endDate: "2026-10-16" }).result.sprint;
  const tasks = work.map(([title, points, status]) => {
    const t = call("task-create", ctxA, { projectId: p.id, title, points, sprintId: sp.id }).result.task;
    if (status) call("task-move-status", ctxA, { id: t.id, status });
    return t;
  });
  return { p, sp, tasks };
}

describe("projects sprint receipt (D1)", () => {
  it("settles with real numbers, carries the unfinished over, and keeps the receipt in Activity", () => {
    const { p, sp, tasks } = sprintWith([
      ["Done A", 3, "done"], ["Done B", 2, "done"], ["Open C", 4, "in_progress"],
    ]);
    const r = call("sprint-complete", ctxA, { id: sp.id });
    assert.equal(r.ok, true);
    const rc = r.result.receipt;
    assert.equal(rc.issuesDone, 2);
    assert.equal(rc.issuesTotal, 3);
    assert.equal(rc.pointsDone, 5);
    assert.equal(rc.pointsTotal, 9);
    assert.equal(rc.settledInFull, false);
    assert.equal(rc.carriedOver, 1);
    assert.equal(call("task-detail", ctxA, { id: tasks[2].id }).result.task.sprintId, null,
      "the unfinished issue rolled back to the backlog");
    const stream = call("activity-list", ctxA, { projectId: p.id });
    const receipts = stream.result.activity.filter((a) => a.action === "sprint_receipt");
    assert.equal(receipts.length, 2, "one kept receipt per settled issue");
    assert.match(receipts[0].detail, /Sprint "Sprint 1" settled: 2\/3 issues, 5\/9 points/);
    // The same numbers report-velocity reconciles from:
    const vel = call("report-velocity", ctxA, { projectId: p.id });
    assert.equal(vel.ok, true);
  });

  it("a clean sprint is Settled in full; re-completing writes no second receipt", () => {
    const { p, sp } = sprintWith([["Only", 3, "done"]]);
    const r = call("sprint-complete", ctxA, { id: sp.id });
    assert.equal(r.result.receipt.settledInFull, true);
    const before = call("activity-list", ctxA, { projectId: p.id }).result.activity
      .filter((a) => a.action === "sprint_receipt").length;
    const again = call("sprint-complete", ctxA, { id: sp.id });
    assert.equal(again.unchanged, true);
    const after = call("activity-list", ctxA, { projectId: p.id }).result.activity
      .filter((a) => a.action === "sprint_receipt").length;
    assert.equal(after, before, "no duplicate receipts");
  });
});
