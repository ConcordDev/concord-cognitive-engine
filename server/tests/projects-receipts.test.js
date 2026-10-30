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
    assert.equal(receipts.filter((a) => a.taskId).length, 2, "one kept receipt per settled issue");
    assert.equal(receipts.filter((a) => !a.taskId).length, 1, "plus the one project-level receipt record (D1 remainder)");
    assert.match(receipts[0].detail, /Sprint "Sprint 1" settled: 2\/3 issues, 5\/9 points/);
    // The same numbers report-velocity reconciles from:
    const vel = call("report-velocity", ctxA, { projectId: p.id });
    assert.equal(vel.ok, true);
  });

  it("the Activity stream carries ONE project-level receipt record with the settlement in meta (D1 remainder)", () => {
    const { p, sp } = sprintWith([["Done A", 3, "done"], ["Done B", 2, "done"], ["Open C", 5, null]]);
    call("sprint-complete", ctxA, { id: sp.id });
    const stream = call("activity-list", ctxA, { projectId: p.id }).result.activity;
    const summaries = stream.filter((a) => a.action === "sprint_receipt" && !a.taskId);
    assert.equal(summaries.length, 1, "exactly one project-level receipt record");
    const m = summaries[0].meta;
    assert.ok(m, "the record carries structured settlement meta");
    assert.equal(m.sprintName, "Sprint 1");
    assert.equal(m.issuesDone, 2); assert.equal(m.issuesTotal, 3);
    assert.equal(m.pointsDone, 5); assert.equal(m.pointsTotal, 10);
    assert.equal(m.carriedOver, 1); assert.equal(m.settledInFull, false);
    assert.equal(summaries[0].projectId, p.id, "the record resolves to its project in the stream");
    // A zero-done sprint still leaves its receipt record.
    const p2 = call("project-create", ctxA, { name: "Empty", key: "EMP" }).result.project;
    const sp2 = call("sprint-create", ctxA, { projectId: p2.id, name: "Empty Sprint" }).result.sprint;
    call("task-create", ctxA, { projectId: p2.id, title: "Undone", sprintId: sp2.id });
    call("sprint-complete", ctxA, { id: sp2.id });
    const stream2 = call("activity-list", ctxA, { projectId: p2.id }).result.activity;
    const summaries2 = stream2.filter((a) => a.action === "sprint_receipt" && !a.taskId);
    assert.equal(summaries2.length, 1, "zero-done completion still writes the receipt record");
    assert.equal(summaries2[0].meta.issuesDone, 0);
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

  it("the #1844 S4 assignment identity still holds beside the receipt: non-members and non-accounts are rejected", async () => {
    const { p, sp } = sprintWith([["Done A", 3, "done"]]);
    call("sprint-complete", ctxA, { id: sp.id });
    const bad = call("task-create", ctxA, { projectId: p.id, title: "Assigned to a stranger", assigneeId: "user_stranger" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not a member of this project/);
    const free = call("task-create", ctxA, { projectId: p.id, title: "Assigned to a free-text name", assigneeId: "mbr_made_up_name" });
    assert.equal(free.ok, false);
    const own = call("task-create", ctxA, { projectId: p.id, title: "Assigned to the owner", assigneeId: "user_a" });
    assert.equal(own.ok, true, "the owner is always a member");
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../domains/projects.js", import.meta.url), "utf8");
    for (const sym of ["createArtifactAcl", "registerArtifactOwnerResolver", "lookupUserIdentity", "pjMigrateLegacyMembers", "pjAssigneeSet"]) assert.ok(src.includes(sym), sym + " must stay");
  });
});
