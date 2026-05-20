// Contract tests for the hr Workday + BambooHR 2026-parity HRIS macros
// (employees, org chart, time-off, onboarding, reviews, goals,
// recruiting). BLS / compute macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHRActions from "../domains/hr.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`hr.${name}`);
  assert.ok(fn, `hr.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHRActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newEmp(ctx = ctxA, over = {}) {
  return call("employee-add", ctx, {
    name: "Alex Doe", title: "Engineer", department: "Engineering", salary: 120000, ...over,
  }).result.employee;
}

describe("hr.employee-* directory", () => {
  it("add requires a name, scoped per workspace", () => {
    assert.equal(call("employee-add", ctxA, {}).ok, false);
    newEmp();
    assert.equal(call("employee-list", ctxA, {}).result.count, 1);
    assert.equal(call("employee-list", ctxB, {}).result.count, 0);
  });

  it("update, detail, offboard", () => {
    const e = newEmp();
    assert.equal(call("employee-update", ctxA, { id: e.id, salary: 130000 }).result.employee.salary, 130000);
    assert.equal(call("employee-detail", ctxA, { id: e.id }).ok, true);
    call("employee-offboard", ctxA, { id: e.id });
    assert.equal(call("employee-list", ctxA, {}).result.count, 0);
    assert.equal(call("employee-list", ctxA, { includeInactive: true }).result.count, 1);
  });
});

describe("hr.org-chart + headcount", () => {
  it("builds a reporting tree", () => {
    const ceo = newEmp(ctxA, { name: "CEO", title: "CEO" });
    newEmp(ctxA, { name: "Report", managerId: ceo.id });
    const chart = call("org-chart", ctxA, {});
    assert.equal(chart.result.chart.length, 1);
    assert.equal(chart.result.chart[0].reports.length, 1);
    assert.equal(chart.result.totalEmployees, 2);
  });

  it("headcount report sums payroll by type", () => {
    newEmp(ctxA, { salary: 100000 });
    newEmp(ctxA, { salary: 200000, employmentType: "contract" });
    const hc = call("headcount-report", ctxA, {});
    assert.equal(hc.result.active, 2);
    assert.equal(hc.result.annualPayroll, 300000);
    assert.equal(hc.result.avgSalary, 150000);
  });
});

describe("hr.timeoff-*", () => {
  it("request, approve, balance reflects approved days", () => {
    const e = newEmp();
    const year = new Date().getFullYear();
    const req = call("timeoff-request", ctxA, {
      employeeId: e.id, kind: "vacation", days: 5, startDate: `${year}-07-01`,
    }).result.request;
    assert.equal(call("timeoff-list", ctxA, {}).result.pending, 1);
    call("timeoff-approve", ctxA, { id: req.id });
    const bal = call("timeoff-balance", ctxA, { employeeId: e.id });
    const vac = bal.result.balances.find((b) => b.kind === "vacation");
    assert.equal(vac.used, 5);
    assert.equal(vac.remaining, 10);
  });

  it("rejects non-positive days", () => {
    const e = newEmp();
    assert.equal(call("timeoff-request", ctxA, { employeeId: e.id, days: 0 }).ok, false);
  });
});

describe("hr.onboarding + reviews + goals", () => {
  it("onboarding tasks track completion", () => {
    const e = newEmp();
    const t = call("onboarding-task-add", ctxA, { employeeId: e.id, task: "Sign NDA" }).result.task;
    call("onboarding-task-add", ctxA, { employeeId: e.id, task: "Setup laptop" });
    call("onboarding-complete", ctxA, { id: t.id });
    const list = call("onboarding-list", ctxA, { employeeId: e.id });
    assert.equal(list.result.total, 2);
    assert.equal(list.result.done, 1);
  });

  it("reviews average and goals progress", () => {
    const e = newEmp();
    call("review-create", ctxA, { employeeId: e.id, rating: 4, period: "2026 H1" });
    call("review-create", ctxA, { employeeId: e.id, rating: 5, period: "2026 H2" });
    assert.equal(call("review-list", ctxA, { employeeId: e.id }).result.averageRating, 4.5);
    const g = call("goal-set", ctxA, { employeeId: e.id, title: "Ship feature" }).result.goal;
    call("goal-update-progress", ctxA, { id: g.id, progress: 100 });
    assert.equal(call("goal-list", ctxA, { employeeId: e.id }).result.completed, 1);
    assert.equal(call("review-create", ctxA, { employeeId: e.id, rating: 9 }).ok, false);
  });
});

describe("hr.recruiting", () => {
  it("job post, applicants advance through stages", () => {
    const job = call("job-post", ctxA, { title: "Senior Engineer", department: "Engineering" }).result.job;
    const app = call("applicant-add", ctxA, { jobId: job.id, name: "Jamie Lee" }).result.applicant;
    assert.equal(app.stage, "applied");
    call("applicant-advance", ctxA, { id: app.id, stage: "interview" });
    const list = call("applicant-list", ctxA, { jobId: job.id });
    assert.equal(list.result.byStage.interview, 1);
    assert.equal(call("job-list", ctxA, {}).result.jobs[0].applicantCount, 1);
    assert.equal(call("applicant-advance", ctxA, { id: app.id, stage: "teleport" }).ok, false);
  });
});

describe("hr.documents + dashboard", () => {
  it("documents attach to an employee", () => {
    const e = newEmp();
    call("hr-document-add", ctxA, { employeeId: e.id, title: "Offer letter", kind: "offer" });
    assert.equal(call("hr-document-list", ctxA, { employeeId: e.id }).result.count, 1);
  });

  it("hr-dashboard aggregates the workspace", () => {
    const e = newEmp();
    call("timeoff-request", ctxA, { employeeId: e.id, kind: "sick", days: 1 });
    call("job-post", ctxA, { title: "Designer" });
    const d = call("hr-dashboard", ctxA, {});
    assert.equal(d.result.headcount, 1);
    assert.equal(d.result.pendingTimeoff, 1);
    assert.equal(d.result.openJobs, 1);
  });
});
