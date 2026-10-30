// Behaviour tests for Projects command search (Review 4, projects.md
// F6, slice S5): the ⌘K palette's substrate contract. command-search
// predates the slice; what S5 changes is the call (the palette now
// searches unscoped, as its label promises — "projects & issues", not
// "this project's issues") and the results' actionability. These tests
// pin the unscoped contract the reworked palette depends on: issues
// findable by ref across projects, projects by name/key, archived
// projects excluded, and no other user's content, ever.

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
  const main = call("project-create", ctx, { name: "PR4 Projects Review", key: "PR4" }).result.project;
  const other = call("project-create", ctx, { name: "Apollo", key: "APO" }).result.project;
  const t1 = call("task-create", ctx, { projectId: main.id, title: "First issue" }).result.task;
  call("task-create", ctx, { projectId: other.id, title: "Apollo task" });
  return { main, other, t1 };
}

describe("projects command-search — unscoped (F6)", () => {
  it("finds an issue by ref across projects and a project by name fragment", () => {
    const { main, t1 } = fixture();
    const byRef = call("command-search", ctxA, { query: t1.ref });
    const hit = byRef.result.results.find((r) => r.kind === "task");
    assert.ok(hit, "the issue is listed");
    assert.equal(hit.id, t1.id);
    assert.equal(hit.projectId, main.id, "the result carries its project for the jump");
    const byName = call("command-search", ctxA, { query: "Projects Review" });
    assert.ok(byName.result.results.some((r) => r.kind === "project" && r.id === main.id),
      "the project is listed");
    assert.ok(byName.result.commands.some((c) => c.action === "task-create"),
      "create intents ride along");
  });

  it("excludes archived projects and never returns another user's content", () => {
    const { other } = fixture();
    call("project-archive", ctxA, { id: other.id, archived: true });
    const r = call("command-search", ctxA, { query: "Apollo" });
    assert.equal(r.result.results.filter((x) => x.kind === "project").length, 0,
      "the archived project is not a jump target");
    const foreign = call("command-search", ctxB, { query: "PR4" });
    assert.equal(foreign.result.results.length, 0, "user B sees none of user A's content");
  });

  it("still honours the scoped call the triage-era callers used", () => {
    const { main, other } = fixture();
    const scoped = call("command-search", ctxA, { query: "task", projectId: other.id });
    const tasks = scoped.result.results.filter((r) => r.kind === "task");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].projectId, other.id);
    assert.ok(main.id !== other.id);
  });
});
