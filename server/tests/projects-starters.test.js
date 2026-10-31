// Behaviour tests for Projects first-run starters (Review 4,
// projects.md F20, slice S13): the fresh-account landing taught
// nothing ("Nothing in the substrate…"). Now a project created with
// a starter template contains its starter issues from the same call,
// and project-create-sample materialises the labelled worked example
// exactly once per account — a real project with real issues across
// the loop (one already Done, so goals and progress have something
// true to count).

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
const tasksOf = (pid) => call("task-list", ctxA, { projectId: pid }).result.tasks;

describe("projects first-run — starters + sample (F20)", () => {
  it("a project created from a starter contains its starter issues, refs sequenced", () => {
    const r = call("project-create", ctxA, { name: "Launch", key: "LCH", template: "launch" });
    assert.equal(r.ok, true);
    assert.equal(r.result.seeded, 4);
    const tasks = tasksOf(r.result.project.id);
    assert.equal(tasks.length, 4);
    assert.deepEqual(tasks.map((t) => t.ref).sort(), ["LCH-1", "LCH-2", "LCH-3", "LCH-4"]);
    assert.equal(tasks.filter((t) => t.status === "done").length, 1,
      "one starter is already Done — the loop is visible from minute one");
    const g = call("goal-create", ctxA, { projectId: r.result.project.id, name: "Ship", metric: "Tasks done", target: 4 }).result.goal;
    assert.equal(call("goal-list", ctxA, { projectId: r.result.project.id }).result.goals[0].current, 1,
      "and the done starter is already counted by a system goal");
    void g;
  });

  it("no template (or an unknown one) seeds nothing", () => {
    const a = call("project-create", ctxA, { name: "Blank", key: "BLK" });
    assert.equal(a.result.seeded, 0);
    const b = call("project-create", ctxA, { name: "Nope", key: "NOP", template: "does-not-exist" });
    assert.equal(b.result.seeded, 0);
    assert.equal(tasksOf(b.result.project.id).length, 0);
  });

  it("the sample is created once, labelled, and is a real editable project", () => {
    const first = call("project-create-sample", ctxA, {});
    assert.equal(first.result.created, true);
    assert.equal(first.result.project.sample, true);
    assert.match(first.result.project.name, /Sample/);
    const tasks = tasksOf(first.result.project.id);
    assert.equal(tasks.length, 4);
    assert.ok(tasks.some((t) => t.status === "done"));
    const second = call("project-create-sample", ctxA, {});
    assert.equal(second.result.created, false);
    assert.equal(second.result.project.id, first.result.project.id, "idempotent — no duplicate samples");
    // It behaves like any project: deleting it works, and a fresh
    // sample can be created afterwards.
    assert.equal(call("project-delete", ctxA, { id: first.result.project.id }).ok, true);
    assert.equal(call("project-create-sample", ctxA, {}).result.created, true);
  });
});
