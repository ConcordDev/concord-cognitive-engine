// Behaviour tests for the Projects activity stream (Review 4,
// projects.md F15, slice S11): the global Activity surface read "No
// activity yet" forever because activity-list hard-required a
// taskId — a call without one filtered on taskId === "undefined" and
// matched nothing, while per-issue feeds filled from the same store.
// Now: no taskId returns the account's stream enriched with each
// issue's ref/title/project (receipts a global surface can render),
// projectId scopes it, the per-issue call is unchanged, and other
// accounts' activity never leaks in.

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

describe("projects activity stream (F15)", () => {
  it("a call with no taskId returns the stream, enriched — one edit shows up", () => {
    const p = call("project-create", ctxA, { name: "Stream", key: "STR" }).result.project;
    const t = call("task-create", ctxA, { projectId: p.id, title: "Edited issue" }).result.task;
    call("task-update", ctxA, { id: t.id, title: "Edited issue v2" });
    call("task-move-status", ctxA, { id: t.id, status: "in_progress" });
    const stream = call("activity-list", ctxA, {});
    assert.equal(stream.ok, true);
    assert.ok(stream.result.count >= 2, `stream has the events (got ${stream.result.count})`);
    const statusRow = stream.result.activity.find((a) => a.action === "status");
    assert.ok(statusRow, "the status change is in the stream");
    assert.equal(statusRow.taskRef, t.ref);
    assert.equal(statusRow.taskTitle, "Edited issue v2");
    assert.equal(statusRow.projectId, p.id);
    const times = stream.result.activity.map((a) => a.at);
    assert.deepEqual(times, [...times].sort().reverse(), "newest first");
  });

  it("projectId scopes the stream; the per-issue call is unchanged", () => {
    const p1 = call("project-create", ctxA, { name: "One", key: "ONE" }).result.project;
    const p2 = call("project-create", ctxA, { name: "Two", key: "TWO" }).result.project;
    const t1 = call("task-create", ctxA, { projectId: p1.id, title: "In one" }).result.task;
    call("task-create", ctxA, { projectId: p2.id, title: "In two" });
    call("task-move-status", ctxA, { id: t1.id, status: "done" });
    const scoped = call("activity-list", ctxA, { projectId: p1.id });
    assert.ok(scoped.result.activity.every((a) => a.projectId === p1.id));
    assert.ok(scoped.result.activity.some((a) => a.taskId === t1.id));
    const perIssue = call("activity-list", ctxA, { taskId: t1.id });
    assert.ok(perIssue.result.count >= 1);
    assert.ok(perIssue.result.activity.every((a) => a.taskId === t1.id));
    assert.equal(perIssue.result.activity[0].taskRef, undefined,
      "the per-issue shape is the original one — enrichment is stream-only");
  });

  it("another account's stream is empty — no cross-user leakage", () => {
    const p = call("project-create", ctxA, { name: "Private", key: "PRV" }).result.project;
    const t = call("task-create", ctxA, { projectId: p.id, title: "Secret work" }).result.task;
    call("task-move-status", ctxA, { id: t.id, status: "done" });
    assert.equal(call("activity-list", ctxB, {}).result.count, 0);
  });
});
