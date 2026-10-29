// Behaviour tests for Projects identity (Review 4, projects.md F5,
// slice S2): a project's name, description and dates are editable
// (project-update, read back through the switcher and Portfolio), and
// Duplicate — a macro that did not exist before this slice — makes a
// structural copy under a new id and key that cites its source, with
// task hierarchy, sprint/milestone/assignee links and relations
// remapped onto the copies. History (comments, activity) is the
// original's receipts and is NOT copied; the source is untouched.

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

function fixture(ctx = ctxA) {
  const p = call("project-create", ctx, { name: "PR4 Rename Test", key: "PRN" }).result.project;
  const member = call("member-add", ctx, { projectId: p.id, name: "Ada" }).result.member;
  const sprint = call("sprint-create", ctx, { projectId: p.id, name: "Sprint 1" }).result.sprint;
  const parent = call("task-create", ctx, {
    projectId: p.id, title: "Parent", assigneeId: member.id, sprintId: sprint.id,
  }).result.task;
  const child = call("task-create", ctx, {
    projectId: p.id, title: "Child", parentId: parent.id,
  }).result.task;
  call("task-comment-add", ctx, { taskId: parent.id, body: "history that stays with the original", author: "Sam" });
  call("relation-add", ctx, { fromTaskId: parent.id, toTaskId: child.id, kind: "blocks" });
  return { p, member, sprint, parent, child };
}

describe("projects identity — project-update (F5)", () => {
  it("rename, description and dates land and read back in the switcher list and Portfolio", () => {
    const { p } = fixture();
    const upd = call("project-update", ctxA, {
      id: p.id, name: "PR4 Renamed", description: "Renamed for the re-pass",
      startDate: "2026-11-02", targetDate: "2026-12-18",
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.project.name, "PR4 Renamed");
    assert.equal(upd.result.project.description, "Renamed for the re-pass");
    assert.equal(upd.result.project.startDate, "2026-11-02");
    assert.equal(upd.result.project.targetDate, "2026-12-18");
    const row = call("project-list", ctxA, {}).result.projects.find((x) => x.id === p.id);
    assert.equal(row.name, "PR4 Renamed");
    const pf = call("portfolio", ctxA, {});
    assert.equal(pf.result.projects.find((x) => x.id === p.id).name, "PR4 Renamed");
  });
});

describe("projects identity — project-duplicate (F5)", () => {
  it("copies structure with remapped links, new refs, and a citation to the source", () => {
    const { p, member, sprint, parent } = fixture();
    const dup = call("project-duplicate", ctxA, { id: p.id });
    assert.equal(dup.ok, true);
    const copy = dup.result.project;
    assert.notEqual(copy.id, p.id);
    assert.notEqual(copy.key, p.key, "the copy gets its own key");
    assert.equal(copy.name, "PR4 Rename Test (copy)");
    assert.equal(copy.archived, false);
    assert.equal(copy.duplicatedFrom.projectId, p.id, "the copy cites the original");
    assert.equal(copy.duplicatedFrom.key, "PRN");
    assert.equal(dup.result.copied.tasks, 2);
    assert.equal(dup.result.copied.relations, 1);

    const tasks = call("task-list", ctxA, { projectId: copy.id }).result.tasks;
    assert.equal(tasks.length, 2);
    const cParent = tasks.find((x) => x.title === "Parent");
    const cChild = tasks.find((x) => x.title === "Child");
    assert.ok(cParent.ref.startsWith(`${copy.key}-`), "refs re-sequenced under the new key");
    assert.notEqual(cParent.id, parent.id);
    assert.equal(cChild.parentId, cParent.id, "hierarchy points at the copied parent");
    assert.notEqual(cParent.assigneeId, member.id, "assignee is the copied member");
    const members = call("member-list", ctxA, { projectId: copy.id }).result.members;
    assert.deepEqual(members.map((m) => m.id), [cParent.assigneeId]);
    assert.equal(members[0].name, "Ada");
    const sprints = call("sprint-list", ctxA, { projectId: copy.id }).result.sprints;
    assert.equal(sprints.length, 1);
    assert.equal(cParent.sprintId, sprints[0].id, "sprint link remapped");
    assert.notEqual(sprints[0].id, sprint.id);

    const detail = call("task-detail", ctxA, { id: cParent.id });
    assert.equal(detail.result.relations.length, 1, "the relation survives, remapped");
    assert.equal(detail.result.relations[0].task.id, cChild.id);
    assert.equal(detail.result.comments.length, 0, "history is not copied — the copy starts clean");
    assert.equal(detail.result.activity.length, 0);
  });

  it("honours an explicit name and key; duplicating an archived project yields an active copy", () => {
    const { p } = fixture();
    call("project-archive", ctxA, { id: p.id, archived: true });
    const dup = call("project-duplicate", ctxA, { id: p.id, name: "Template A", key: "TMPA" });
    assert.equal(dup.ok, true);
    assert.equal(dup.result.project.name, "Template A");
    assert.equal(dup.result.project.key, "TMPA");
    assert.equal(dup.result.project.archived, false);
    assert.ok(call("project-list", ctxA, {}).result.projects.some((x) => x.id === dup.result.project.id));
  });

  it("fails honestly for unknown and other users' projects, and leaves the source untouched", () => {
    const { p } = fixture();
    assert.equal(call("project-duplicate", ctxA, { id: "nope" }).ok, false);
    assert.equal(call("project-duplicate", ctxB, { id: p.id }).ok, false);
    const src = call("project-get", ctxA, { id: p.id }).result.project;
    assert.equal(src.duplicatedFrom, undefined);
    assert.equal(call("task-list", ctxA, { projectId: p.id }).result.tasks.length, 2);
  });
});
