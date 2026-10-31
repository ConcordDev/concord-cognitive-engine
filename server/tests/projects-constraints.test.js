// Behaviour tests for Projects constraints (Review 4, projects.md
// F10/F11, slice S8): WIP limits and blocked-by relations used to be
// display-only — a column could read 2/1 and a blocked issue could be
// completed. Now the domain enforces both at every status-write path
// (create, update, board move, bulk, triage-accept): a WIP refusal
// names the limit and column; a blocked move is refused naming the
// blocker, or proceeds with overrideBlocked and leaves an "override"
// receipt in the issue's Activity. Completing the blocker makes the
// move clean.

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

function project() {
  return call("project-create", ctxA, { name: "Constraints", key: "CON" }).result.project;
}
function task(pid, title, status) {
  return call("task-create", ctxA, { projectId: pid, title, status }).result.task;
}

describe("projects constraints — WIP limits (F10)", () => {
  it("refuses a create and a move that would exceed the limit, naming it", () => {
    const p = project();
    call("wip-set", ctxA, { projectId: p.id, status: "backlog", limit: 1 });
    task(p.id, "One");
    const second = call("task-create", ctxA, { projectId: p.id, title: "Two" });
    assert.equal(second.ok, false);
    assert.match(second.error, /WIP limit of 1/);
    const t3 = task(p.id, "Three", "todo");
    const move = call("task-move-status", ctxA, { id: t3.id, status: "backlog" });
    assert.equal(move.ok, false);
    assert.match(move.error, /backlog is at its WIP limit of 1/);
    assert.equal(call("task-detail", ctxA, { id: t3.id }).result.task.status, "todo",
      "the refused move changed nothing");
  });

  it("a zero/absent limit does not constrain, and freeing the column admits the next task", () => {
    const p = project();
    const a = task(p.id, "A");
    const b = task(p.id, "B");
    call("wip-set", ctxA, { projectId: p.id, status: "backlog", limit: 1 });
    assert.equal(call("task-create", ctxA, { projectId: p.id, title: "C" }).ok, false,
      "an over-limit column refuses new entries (existing tasks are grandfathered, not deleted)");
    call("task-move-status", ctxA, { id: a.id, status: "done" });
    call("task-move-status", ctxA, { id: b.id, status: "done" });
    assert.equal(call("task-create", ctxA, { projectId: p.id, title: "C" }).ok, true,
      "once slots free, creation succeeds again");
  });

  it("a bulk move into a full column is refused as a group and applies nothing", () => {
    const p = project();
    call("wip-set", ctxA, { projectId: p.id, status: "in_progress", limit: 1 });
    const a = task(p.id, "A", "todo");
    const b = task(p.id, "B", "todo");
    const r = call("task-bulk-update", ctxA, { ids: [a.id, b.id], patch: { status: "in_progress" } });
    assert.equal(r.ok, false);
    assert.match(r.error, /WIP limit of 1/);
    assert.equal(call("task-detail", ctxA, { id: a.id }).result.task.status, "todo");
    assert.equal(call("task-detail", ctxA, { id: b.id }).result.task.status, "todo");
  });
});

describe("projects constraints — blocked-by (F11)", () => {
  function blockedPair() {
    const p = project();
    const blocker = task(p.id, "Blocker", "todo");
    const blocked = task(p.id, "Blocked", "todo");
    call("relation-add", ctxA, { fromTaskId: blocker.id, toTaskId: blocked.id, kind: "blocks" });
    return { p, blocker, blocked };
  }

  it("refuses In Progress and Done while the blocker is incomplete, naming it", () => {
    const { blocker, blocked } = blockedPair();
    const r1 = call("task-move-status", ctxA, { id: blocked.id, status: "in_progress" });
    assert.equal(r1.ok, false);
    assert.match(r1.error, new RegExp(`blocked by ${blocker.ref}`));
    const r2 = call("task-update", ctxA, { id: blocked.id, status: "done" });
    assert.equal(r2.ok, false);
    // Moves that do not start/complete work are not gated.
    assert.equal(call("task-move-status", ctxA, { id: blocked.id, status: "backlog" }).ok, true);
  });

  it("an override moves the issue and leaves a receipt in its Activity", () => {
    const { blocker, blocked } = blockedPair();
    const r = call("task-update", ctxA, { id: blocked.id, status: "done", overrideBlocked: true });
    assert.equal(r.ok, true);
    const detail = call("task-detail", ctxA, { id: blocked.id });
    assert.equal(detail.result.task.status, "done");
    const receipt = detail.result.activity.find((a) => a.action === "override");
    assert.ok(receipt, "the override is recorded in Activity");
    assert.match(receipt.detail, new RegExp(blocker.ref));
  });

  it("completing the blocker first makes the move clean", () => {
    const { blocker, blocked } = blockedPair();
    call("task-move-status", ctxA, { id: blocker.id, status: "done" });
    assert.equal(call("task-move-status", ctxA, { id: blocked.id, status: "done" }).ok, true);
    const detail = call("task-detail", ctxA, { id: blocked.id });
    assert.equal(detail.result.activity.some((a) => a.action === "override"), false,
      "no override was needed or recorded");
  });
});
