// Projects → Thread handoff, on the real domain pair.
//
// The Projects domain computes a project's real numbers (dashboard, velocity,
// cycle time, risks, milestones). The status menu saves those numbers as a
// private DTU, reads that DTU back, and hands it to Thread as a draft that
// cites it. Nothing is published: Thread stores a draft.
//
// This test pins the part that only the backend can be honest about — a draft
// may not cite a DTU that does not exist or that belongs to somebody else.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerProjectsActions from "../domains/projects.js";
import registerThreadActions from "../domains/thread.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return fn(ctx, { id: null, domain, type: "domain_action", data: params, meta: {} }, params);
}

before(() => {
  registerProjectsActions(register);
  registerThreadActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

/** A project with real tasks, a sprint and a risk, so the reports have facts. */
function seedProject(ctx, name) {
  const created = call("projects", "project-create", ctx, { name, key: "NS" });
  assert.equal(created.ok, true);
  const project = created.result.project;

  const sprint = call("projects", "sprint-create", ctx, {
    projectId: project.id, name: "Sprint 1", startDate: "2026-10-01", endDate: "2026-10-14",
  });
  assert.equal(sprint.ok, true);

  for (const [title, status, points] of [["Ship the ingest", "done", 3], ["Write the spec", "done", 5], ["Fix the race", "todo", 2]]) {
    const t = call("projects", "task-create", ctx, {
      projectId: project.id, sprintId: sprint.result.sprint.id, title, status, points,
    });
    assert.equal(t.ok, true);
  }

  // Velocity only counts a completed sprint, so close it the way a team would.
  // The unfinished task carries back to the backlog — the domain's own rollover.
  const closed = call("projects", "sprint-complete", ctx, { id: sprint.result.sprint.id });
  assert.equal(closed.ok, true);

  const risk = call("projects", "risk-add", ctx, { projectId: project.id, name: "Flaky ingest", likelihood: 4, impact: 4 });
  assert.equal(risk.ok, true);

  return { project, sprintId: sprint.result.sprint.id };
}

/** Everything the status menu reads, straight from the macros. */
function readFacts(ctx, project) {
  const dash = call("projects", "project-dashboard", ctx, { projectId: project.id });
  const velocity = call("projects", "report-velocity", ctx, { projectId: project.id });
  const cycle = call("projects", "report-cycle-time", ctx, { projectId: project.id });
  const risks = call("projects", "risk-list", ctx, { projectId: project.id });
  const milestones = call("projects", "milestone-list", ctx, { projectId: project.id });
  for (const r of [dash, velocity, cycle, risks, milestones]) assert.equal(r.ok, true, "a report refused");
  return { dash: dash.result, velocity: velocity.result, cycle: cycle.result, risks: risks.result.risks, milestones: milestones.result.milestones };
}

/** Save a report as a DTU in the real store, the way dtu.create persists one. */
function saveReportDtu(userId, project, facts) {
  const id = `dtu_status_${project.id}`;
  globalThis._concordSTATE.dtus.set(id, {
    id,
    tier: "regular",
    machine: {
      kind: "project_status_report",
      projectId: project.id,
      tasks: { total: facts.dash.totalTasks, done: facts.dash.done, overdue: facts.dash.overdue },
    },
    creator_id: userId,
    source: "projects-lens:status-report",
  });
  return id;
}

describe("projects status report to a thread draft", () => {
  it("reports real numbers the project actually has", () => {
    const { project } = seedProject(ctxA, "North Star");
    const facts = readFacts(ctxA, project);
    assert.equal(facts.dash.totalTasks, 3);
    assert.equal(facts.dash.done, 2);
    assert.equal(facts.velocity.completedSprints, 1, "one sprint was completed");
    assert.equal(facts.velocity.avgVelocity, 8, "3 + 5 points landed in the completed sprint");
    assert.equal(facts.risks.length, 1);
    assert.equal(facts.risks[0].name, "Flaky ingest");
    assert.equal(facts.risks[0].severity, "critical", "a 4x4 risk scores 16, which the domain calls critical");
  });

  it("drafts in Thread citing the saved report, and stays unpublished", () => {
    const { project } = seedProject(ctxA, "North Star");
    const facts = readFacts(ctxA, project);
    const dtuId = saveReportDtu("user_a", project, facts);

    const drafted = call("thread", "thread-draft", ctxA, {
      title: project.name,
      content: "North Star: 2 of 3 tasks done.",
      citedDtuId: dtuId,
    });
    assert.equal(drafted.ok, true);
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft");
    assert.equal(draft.citedDtuId, dtuId);

    // Thread stored it: a reload finds the same draft with the same cite.
    const listed = call("thread", "draft-list", ctxA, {});
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.drafts[0].id, draft.id);
    const detail = call("thread", "draft-detail", ctxA, { id: draft.id });
    assert.equal(detail.result.draft.citedDtuId, dtuId);
    assert.equal(detail.result.draft.status, "draft");
  });

  it("lists the cited report on the draft so a reader can verify it", () => {
    const { project } = seedProject(ctxA, "North Star");
    const facts = readFacts(ctxA, project);
    const dtuId = saveReportDtu(ctxA.actor.userId, project, facts);
    const drafted = call("thread", "thread-draft", ctxA, { content: "Sprint 1 closed at 8 pts.", citedDtuId: dtuId });
    assert.equal(drafted.ok, true);

    const list = call("thread", "draft-list", ctxA, {});
    assert.equal(list.ok, true);
    const row = list.result.drafts.find((d) => d.id === drafted.result.draft.id);
    assert.ok(row, "the draft must appear in the drafts list");
    assert.equal(row.citedDtuId, dtuId, "the list must name the report this draft cites");
    assert.equal(row.status, "draft", "saving a draft must not publish it");
  });

  it("refuses a draft that cites a DTU which does not exist", () => {
    const before = call("thread", "draft-list", ctxA, {}).result.count;
    const r = call("thread", "thread-draft", ctxA, {
      content: "status", citedDtuId: "dtu_never_existed",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cited DTU not found: dtu_never_existed");
    assert.equal(call("thread", "draft-list", ctxA, {}).result.count, before, "a refused draft must not be stored");
  });

  it("refuses a draft that cites another user's report", () => {
    const { project } = seedProject(ctxA, "North Star");
    const facts = readFacts(ctxA, project);
    const dtuId = saveReportDtu("user_a", project, facts);

    const r = call("thread", "thread-draft", ctxB, { content: "borrowed", citedDtuId: dtuId });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cited DTU not owned by caller");
  });

  it("leaves a hand-written draft with no cite alone", () => {
    const r = call("thread", "thread-draft", ctxA, { content: "just a thought", citedDtuId: "not an id" });
    assert.equal(r.ok, true);
    assert.equal(r.result.draft.citedDtuId, null);
  });
});
