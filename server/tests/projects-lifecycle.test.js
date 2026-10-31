// Behaviour tests for the Projects lens lifecycle (Review 4, projects.md
// F1/F14, slice S1): a project can be archived, restored and deleted —
// from either state — and deleting one takes everything it owns with it.
//
// The substrate macros (project-archive with archived:false,
// project-delete) predate the surface; these tests pin the lifecycle
// contract the reworked frontend drives, including the cascade the
// original project-delete missed (task-scoped stores + the lazily
// created project-scoped stores).

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

function newProject(ctx = ctxA, name = "Apollo", key = "APO") {
  const r = call("project-create", ctx, { name, key });
  assert.equal(r.ok, true);
  return r.result.project.id;
}

describe("projects lifecycle — archive / restore", () => {
  it("archive hides the project from the default list but not from includeArchived or Portfolio", () => {
    const pid = newProject();
    const r = call("project-archive", ctxA, { id: pid, archived: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.archived, true);
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
    const incl = call("project-list", ctxA, { includeArchived: true });
    assert.equal(incl.result.count, 1);
    assert.equal(incl.result.projects[0].archived, true);
    const pf = call("portfolio", ctxA, {});
    assert.equal(pf.result.projects.length, 1);
    assert.equal(pf.result.projects[0].archived, true);
    assert.equal(pf.result.active, 0);
  });

  it("archiving an already-archived project reports unchanged, and restore returns it as active", () => {
    const pid = newProject();
    call("project-archive", ctxA, { id: pid, archived: true });
    const again = call("project-archive", ctxA, { id: pid, archived: true });
    assert.equal(again.ok, true);
    assert.equal(again.unchanged, true);
    const back = call("project-archive", ctxA, { id: pid, archived: false });
    assert.equal(back.ok, true);
    assert.equal(back.result.archived, false);
    const list = call("project-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.projects[0].archived, false);
    assert.equal(call("portfolio", ctxA, {}).result.active, 1);
  });

  it("archive and restore of an unknown project fail honestly", () => {
    assert.equal(call("project-archive", ctxA, { id: "nope", archived: true }).ok, false);
    assert.equal(call("project-archive", ctxA, { id: "nope", archived: false }).ok, false);
  });
});

describe("projects lifecycle — delete", () => {
  it("deletes an active project and an archived project alike", () => {
    const a = newProject(ctxA, "Active", "ACT");
    const b = newProject(ctxA, "Archived", "ARC");
    call("project-archive", ctxA, { id: b, archived: true });
    assert.equal(call("project-delete", ctxA, { id: a }).ok, true);
    assert.equal(call("project-delete", ctxA, { id: b }).ok, true);
    assert.equal(call("project-list", ctxA, { includeArchived: true }).result.count, 0);
    assert.equal(call("portfolio", ctxA, {}).result.projects.length, 0);
    assert.equal(call("project-get", ctxA, { id: a }).ok, false);
  });

  it("deleting an unknown project fails honestly", () => {
    const r = call("project-delete", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("cascade removes the project's tasks and every task-scoped record", () => {
    const pid = newProject();
    const t1 = call("task-create", ctxA, { projectId: pid, title: "One" }).result.task;
    const t2 = call("task-create", ctxA, { projectId: pid, title: "Two" }).result.task;
    call("task-comment-add", ctxA, { taskId: t1.id, body: "note", author: "Sam" });
    call("attachment-add", ctxA, { taskId: t1.id, name: "Spec", url: "https://example.com/spec" });
    call("relation-add", ctxA, { fromTaskId: t1.id, toTaskId: t2.id, kind: "blocks" });
    assert.equal(call("task-comments", ctxA, { taskId: t1.id }).result.count, 1);
    assert.equal(call("attachment-list", ctxA, { taskId: t1.id }).result.count, 1);
    assert.equal(call("relation-list", ctxA, { taskId: t1.id }).result.count, 1);
    assert.ok(call("activity-list", ctxA, { taskId: t1.id }).result.count > 0);

    call("project-delete", ctxA, { id: pid });
    assert.equal(call("task-list", ctxA, { projectId: pid }).result.count, 0);
    assert.equal(call("task-comments", ctxA, { taskId: t1.id }).result.count, 0);
    assert.equal(call("attachment-list", ctxA, { taskId: t1.id }).result.count, 0);
    assert.equal(call("relation-list", ctxA, { taskId: t1.id }).result.count, 0);
    assert.equal(call("activity-list", ctxA, { taskId: t1.id }).result.count, 0);
  });

  it("cascade removes project-scoped integrations, SLA policies and notifications", () => {
    const pid = newProject();
    call("integration-connect", ctxA, { projectId: pid, kind: "github", target: "org/repo" });
    call("sla-policy-set", ctxA, { projectId: pid, priority: "high", responseDays: 3 });
    call("triage-submit", ctxA, { projectId: pid, title: "Triage me" });
    assert.equal(call("integration-list", ctxA, { projectId: pid }).result.count, 1);
    assert.equal(call("sla-policy-list", ctxA, { projectId: pid }).result.count, 1);
    const before = call("notifications-list", ctxA, {}).result.notifications
      .filter((n) => n.projectId === pid);
    assert.ok(before.length > 0);

    call("project-delete", ctxA, { id: pid });
    assert.equal(call("integration-list", ctxA, { projectId: pid }).result.count, 0);
    assert.equal(call("sla-policy-list", ctxA, { projectId: pid }).result.count, 0);
    const after = call("notifications-list", ctxA, {}).result.notifications
      .filter((n) => n.projectId === pid);
    assert.equal(after.length, 0);
  });

  it("deleting one project leaves a sibling project and its records untouched", () => {
    const a = newProject(ctxA, "Doomed", "DOO");
    const b = newProject(ctxA, "Keeper", "KEE");
    const tb = call("task-create", ctxA, { projectId: b, title: "Stay" }).result.task;
    call("task-comment-add", ctxA, { taskId: tb.id, body: "keep me", author: "Sam" });
    call("project-delete", ctxA, { id: a });
    const list = call("project-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.projects[0].id, b);
    assert.equal(call("task-comments", ctxA, { taskId: tb.id }).result.count, 1);
  });

  it("another user cannot archive, restore or delete someone else's project", () => {
    const pid = newProject(ctxA);
    assert.equal(call("project-archive", ctxB, { id: pid, archived: true }).ok, false);
    assert.equal(call("project-delete", ctxB, { id: pid }).ok, false);
    call("project-archive", ctxA, { id: pid, archived: true });
    assert.equal(call("project-archive", ctxB, { id: pid, archived: false }).ok, false);
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
    assert.equal(call("project-list", ctxA, { includeArchived: true }).result.count, 1);
  });
});
