// Contract tests for the projects Linear + Asana + Jira 2026-parity
// project management lens (projects, issue board, sprints + burndown,
// milestones, members, comments).

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
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newProject(ctx = ctxA) {
  const r = call("project-create", ctx, { name: "Apollo", key: "APO" });
  assert.equal(r.ok, true);
  return r.result.project.id;
}

describe("projects.project-*", () => {
  it("creates, lists with task rollups, updates and deletes with cascade", () => {
    const pid = newProject();
    call("task-create", ctxA, { projectId: pid, title: "First" });
    const list = call("project-list", ctxA, {});
    assert.equal(list.result.projects[0].taskCount, 1);
    call("project-update", ctxA, { id: pid, name: "Apollo 2" });
    assert.equal(call("project-get", ctxA, { id: pid }).result.project.name, "Apollo 2");
    call("project-delete", ctxA, { id: pid });
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
    assert.equal(call("task-list", ctxA, { projectId: pid }).result.count, 0);
  });

  it("isolates projects per user", () => {
    newProject(ctxA);
    assert.equal(call("project-list", ctxB, {}).result.count, 0);
  });
});

describe("projects tasks & board", () => {
  it("creates tasks with sequential refs and a status workflow", () => {
    const pid = newProject();
    const t1 = call("task-create", ctxA, { projectId: pid, title: "Build" }).result.task;
    const t2 = call("task-create", ctxA, { projectId: pid, title: "Test" }).result.task;
    assert.equal(t1.ref, "APO-1");
    assert.equal(t2.ref, "APO-2");
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const board = call("board", ctxA, { projectId: pid });
    const doneCol = board.result.columns.find((c) => c.status === "done");
    assert.equal(doneCol.tasks.length, 1);
    assert.ok(doneCol.tasks[0].completedAt);
  });

  it("filters tasks by status and updates fields", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "X", priority: "low" }).result.task;
    call("task-update", ctxA, { id: t.id, priority: "urgent", points: 5, labels: ["bug", "bug"] });
    const got = call("task-list", ctxA, { projectId: pid }).result.tasks[0];
    assert.equal(got.priority, "urgent");
    assert.equal(got.points, 5);
    assert.deepEqual(got.labels, ["bug"]);
  });

  it("threads comments on a task", () => {
    const pid = newProject();
    const t = call("task-create", ctxA, { projectId: pid, title: "Discuss" }).result.task;
    call("task-comment-add", ctxA, { taskId: t.id, body: "Looks good", author: "Sam" });
    const cs = call("task-comments", ctxA, { taskId: t.id });
    assert.equal(cs.result.count, 1);
    assert.equal(cs.result.comments[0].author, "Sam");
  });

  it("rejects an empty task title", () => {
    const pid = newProject();
    assert.equal(call("task-create", ctxA, { projectId: pid, title: "" }).ok, false);
  });
});

describe("projects sprints & burndown", () => {
  it("creates a sprint, assigns tasks and computes burndown", () => {
    const pid = newProject();
    const sprint = call("sprint-create", ctxA, {
      projectId: pid, name: "Cycle 1", startDate: "2026-05-01", endDate: "2026-05-11",
    }).result.sprint;
    const t1 = call("task-create", ctxA, { projectId: pid, title: "A", sprintId: sprint.id, points: 3 }).result.task;
    call("task-create", ctxA, { projectId: pid, title: "B", sprintId: sprint.id, points: 5 });
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const bd = call("sprint-burndown", ctxA, { id: sprint.id });
    assert.equal(bd.result.totalPoints, 8);
    assert.equal(bd.result.donePoints, 3);
    assert.ok(bd.result.series.length > 1);
    assert.equal(bd.result.series[0].remaining, 8);
  });

  it("sprint-complete carries unfinished tasks back to the backlog", () => {
    const pid = newProject();
    const sprint = call("sprint-create", ctxA, { projectId: pid, name: "C" }).result.sprint;
    const t = call("task-create", ctxA, { projectId: pid, title: "Unfinished", sprintId: sprint.id }).result.task;
    const r = call("sprint-complete", ctxA, { id: sprint.id });
    assert.equal(r.result.carriedOver, 1);
    const got = call("task-list", ctxA, { projectId: pid }).result.tasks.find((x) => x.id === t.id);
    assert.equal(got.sprintId, null);
  });
});

describe("projects members & milestones", () => {
  it("adds members and assigns tasks to them", () => {
    const pid = newProject();
    const m = call("member-add", ctxA, { projectId: pid, name: "Dev One", role: "engineer" }).result.member;
    call("task-create", ctxA, { projectId: pid, title: "Assigned", assigneeId: m.id });
    const members = call("member-list", ctxA, { projectId: pid });
    assert.equal(members.result.members[0].assigned, 1);
  });

  it("tracks milestone progress", () => {
    const pid = newProject();
    const mil = call("milestone-create", ctxA, { projectId: pid, name: "v1.0" }).result.milestone;
    const t1 = call("task-create", ctxA, { projectId: pid, title: "A", milestoneId: mil.id }).result.task;
    call("task-create", ctxA, { projectId: pid, title: "B", milestoneId: mil.id });
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const list = call("milestone-list", ctxA, { projectId: pid });
    assert.equal(list.result.milestones[0].progressPct, 50);
  });
});

describe("projects.project-dashboard", () => {
  it("rolls up status, priority and completion", () => {
    const pid = newProject();
    const t1 = call("task-create", ctxA, { projectId: pid, title: "A", priority: "high" }).result.task;
    call("task-create", ctxA, { projectId: pid, title: "B" });
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const d = call("project-dashboard", ctxA, { projectId: pid });
    assert.equal(d.result.totalTasks, 2);
    assert.equal(d.result.done, 1);
    assert.equal(d.result.completionPct, 50);
    assert.equal(d.result.byPriority.high, 1);
  });
});
