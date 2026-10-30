// Behaviour tests for Projects date integrity (Review 4, projects.md
// F7, slice S6): a provided date must be a real calendar date with a
// four-digit year, or the write is rejected with a named error — never
// silently stored corrupted (the year-0002 bug) and never silently
// replaced with a default. Sprint ranges validate: end before start
// creates nothing and says why. Absent dates keep their old defaults.

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
  return call("project-create", ctxA, { name: "Dates", key: "DAT" }).result.project;
}

describe("projects dates — task dates (F7)", () => {
  it("stores a real four-digit-year date exactly, on create and on update", () => {
    const p = project();
    const t1 = call("task-create", ctxA, { projectId: p.id, title: "Dated", dueDate: "2026-11-15" });
    assert.equal(t1.ok, true);
    assert.equal(t1.result.task.dueDate, "2026-11-15");
    const upd = call("task-update", ctxA, { id: t1.result.task.id, dueDate: "2026-12-24" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.task.dueDate, "2026-12-24");
  });

  it("rejects a year-0002 date instead of storing it, on create and on update", () => {
    const p = project();
    const bad = call("task-create", ctxA, { projectId: p.id, title: "Corrupt", dueDate: "0002-11-15" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /due date/);
    assert.equal(call("task-list", ctxA, { projectId: p.id }).result.tasks.length, 0, "nothing was created");
    const t1 = call("task-create", ctxA, { projectId: p.id, title: "Good", dueDate: "2026-11-15" }).result.task;
    const badUpd = call("task-update", ctxA, { id: t1.id, dueDate: "0002-11-15" });
    assert.equal(badUpd.ok, false);
    const after = call("task-detail", ctxA, { id: t1.id });
    assert.equal(after.result.task.dueDate, "2026-11-15", "the stored date is untouched");
  });

  it("rejects impossible calendar dates (Feb 31) rather than normalising them", () => {
    const p = project();
    const bad = call("task-create", ctxA, { projectId: p.id, title: "Impossible", startDate: "2026-02-31" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /start date/);
  });
});

describe("projects dates — sprint ranges (F7)", () => {
  it("rejects end-before-start with a named message and creates nothing", () => {
    const p = project();
    const r = call("sprint-create", ctxA, {
      projectId: p.id, name: "Reversed", startDate: "2026-11-20", endDate: "2026-11-10",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /end date is before its start date/);
    assert.equal(call("sprint-list", ctxA, { projectId: p.id }).result.sprints.length, 0,
      "no sprint was created with substituted dates");
  });

  it("stores a valid range exactly, and still defaults when dates are absent", () => {
    const p = project();
    const ok = call("sprint-create", ctxA, {
      projectId: p.id, name: "Dated", startDate: "2026-11-02", endDate: "2026-11-13",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.sprint.startDate, "2026-11-02");
    assert.equal(ok.result.sprint.endDate, "2026-11-13");
    const dflt = call("sprint-create", ctxA, { projectId: p.id, name: "Undated" });
    assert.equal(dflt.ok, true);
    assert.ok(dflt.result.sprint.startDate && dflt.result.sprint.endDate, "absent dates still default");
    const bad = call("sprint-create", ctxA, {
      projectId: p.id, name: "Corrupt", startDate: "0002-11-02", endDate: "2026-11-13",
    });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /start date/);
  });
});

describe("projects dates — milestone and project dates (F7)", () => {
  it("rejects corrupt dates on milestone-create and project-update", () => {
    const p = project();
    const m = call("milestone-create", ctxA, { projectId: p.id, name: "M1", dueDate: "0002-01-01" });
    assert.equal(m.ok, false);
    const upd = call("project-update", ctxA, { id: p.id, targetDate: "0002-12-18" });
    assert.equal(upd.ok, false);
    const good = call("project-update", ctxA, { id: p.id, targetDate: "2026-12-18" });
    assert.equal(good.ok, true);
    assert.equal(good.result.project.targetDate, "2026-12-18");
  });
});
