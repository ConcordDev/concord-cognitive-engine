// HR retain + label (Group B B10) — pins for the founder ruling
// (decision walk #1 item 4: A — RETAIN + LABEL, excluded from active
// counts), generalising the F4 statistics rule to every surface:
//   · a former employee's records are RETAINED entire and LABELLED
//     (employeeStatus rides every cross-employee row);
//   · every current/active figure on a workspace read runs over
//     CURRENT active employees only — the ruling's named defect was
//     a terminated employee's goal counting in OPEN GOALS;
//   · a read scoped to ONE employee is that person's own record —
//     its figures describe them, whatever their status.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerHRActions from "../domains/hr.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`hr.${name}`);
  if (!fn) throw new Error(`hr.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHRActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
afterEach(() => { delete globalThis.__concordLensActions; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// Ann stays active; Fred is offboarded AFTER accumulating a record on
// every surface the ruling names.
function seedWorld() {
  const ann = call("employee-add", ctxA, { name: "Active Ann", salary: 60000, hireDate: "2020-01-01" }).result.employee;
  const fred = call("employee-add", ctxA, { name: "Former Fred", salary: 50000, hireDate: "2019-01-01" }).result.employee;
  call("goal-set", ctxA, { employeeId: ann.id, title: "Ann open goal" });
  const fredOpen = call("goal-set", ctxA, { employeeId: fred.id, title: "Fred open goal" }).result.goal;
  const fredDone = call("goal-set", ctxA, { employeeId: fred.id, title: "Fred done goal" }).result.goal;
  call("goal-update-progress", ctxA, { id: fredDone.id, progress: 100 });
  call("review-create", ctxA, { employeeId: ann.id, rating: 4 });
  call("review-create", ctxA, { employeeId: fred.id, rating: 2 });
  const plan = call("benefit-plan-add", ctxA, { name: "Health", monthlyCost: 100, employerContribution: 50 }).result.plan;
  call("benefit-enroll", ctxA, { employeeId: fred.id, planId: plan.id });
  const course = call("course-add", ctxA, { title: "Safety" }).result.course;
  call("course-assign", ctxA, { employeeId: fred.id, courseId: course.id, dueDate: "2020-01-01" });
  call("timeoff-request", ctxA, { employeeId: fred.id, kind: "vacation", days: 2, startDate: "2027-01-04", endDate: "2027-01-05" });
  const doneTask = call("onboarding-task-add", ctxA, { employeeId: fred.id, task: "Sign handbook" }).result.task;
  call("onboarding-complete", ctxA, { id: doneTask.id });
  call("onboarding-task-add", ctxA, { employeeId: fred.id, task: "Laptop return" });
  call("clock-in", ctxA, { employeeId: fred.id });
  call("employee-offboard", ctxA, { id: fred.id });
  return { ann, fred, fredOpen };
}

describe("hr retain+label — the dashboard counts the current team only", () => {
  it("openGoals / pendingTimeoff / openOnboarding exclude the former employee (headcount already did)", () => {
    const { ann } = seedWorld();
    const d = call("hr-dashboard", ctxA).result;
    assert.equal(d.headcount, 1);
    assert.equal(d.openGoals, 1, "only Ann's open goal is current work");
    assert.equal(d.pendingTimeoff, 0, "Fred's pending request is his record, not an actionable queue figure");
    assert.equal(d.openOnboarding, 0, "Fred's unfinished onboarding is not open work");
    void ann;
  });
});

describe("hr retain+label — records retained entire, and labelled", () => {
  it("goal-list keeps the former employee's goals, labelled; workspace completed excludes them", () => {
    const { fred } = seedWorld();
    const all = call("goal-list", ctxA).result;
    assert.equal(all.goals.length, 3, "nothing is deleted or hidden");
    const fredGoals = all.goals.filter((g) => g.employeeId === fred.id);
    assert.equal(fredGoals.length, 2);
    assert.ok(fredGoals.every((g) => g.employeeStatus === "terminated"), "every former row carries the label");
    assert.equal(all.completed, 0, "Fred's completed goal is not a current-team figure");
  });

  it("a per-employee goal read is the person's own record, whole", () => {
    const { fred } = seedWorld();
    const mine = call("goal-list", ctxA, { employeeId: fred.id }).result;
    assert.equal(mine.goals.length, 2);
    assert.equal(mine.completed, 1, "his own completed count still describes him");
  });

  it("review-list: the workspace average is the current team's; rows retained + labelled; his own average stands", () => {
    const { fred } = seedWorld();
    const all = call("review-list", ctxA).result;
    assert.equal(all.reviews.length, 2);
    assert.equal(all.averageRating, 4, "Ann's 4 is the current-team average; Fred's 2 is history");
    assert.equal(all.reviews.find((r) => r.employeeId === fred.id).employeeStatus, "terminated");
    const mine = call("review-list", ctxA, { employeeId: fred.id }).result;
    assert.equal(mine.averageRating, 2, "scoped to Fred, the average describes Fred");
  });

  it("benefit-enrollment-list: current cost figures exclude the former employee; the enrollment is retained + labelled", () => {
    const { fred } = seedWorld();
    const all = call("benefit-enrollment-list", ctxA).result;
    assert.equal(all.enrollments.length, 1, "the enrollment record is retained");
    assert.equal(all.enrollments[0].employeeStatus, "terminated");
    assert.equal(all.enrolledCount, 0);
    assert.equal(all.totalEmployeeCost, 0);
    assert.equal(all.totalEmployerCost, 0);
    const mine = call("benefit-enrollment-list", ctxA, { employeeId: fred.id }).result;
    assert.equal(mine.enrolledCount, 1, "scoped to Fred, his enrollment still counts for his record");
    assert.equal(mine.totalEmployeeCost, 50);
  });

  it("courses: workspace counts exclude the former employee; the assignment is retained + labelled", () => {
    seedWorld();
    const courses = call("course-list", ctxA).result.courses;
    assert.equal(courses[0].assignedCount, 0, "Fred's assignment is not current training load");
    const assigns = call("course-assignment-list", ctxA).result;
    assert.equal(assigns.assignments.length, 1);
    assert.equal(assigns.assignments[0].employeeStatus, "terminated");
    assert.equal(assigns.overdue, 0, "his overdue course is not the current team's overdue figure");
  });

  it("timeoff + timeclock: pending/open figures exclude the former employee; rows retained + labelled", () => {
    const { fred } = seedWorld();
    const to = call("timeoff-list", ctxA).result;
    assert.equal(to.requests.length, 1);
    assert.equal(to.requests[0].employeeStatus, "terminated");
    assert.equal(to.pending, 0);
    assert.equal(call("timeoff-list", ctxA, { employeeId: fred.id }).result.pending, 1);
    const tc = call("timeclock-list", ctxA).result;
    assert.equal(tc.entries.length, 1);
    assert.equal(tc.entries[0].employeeStatus, "terminated");
    assert.equal(tc.openShifts, 0, "his unclosed shift is not a currently-open shift");
    assert.equal(call("timeclock-list", ctxA, { employeeId: fred.id }).result.openShifts, 1);
  });

  it("onboarding: the former employee's done tasks leave the workspace figure, not the record", () => {
    const { fred } = seedWorld();
    const all = call("onboarding-list", ctxA).result;
    assert.equal(all.tasks.length, 2, "both of Fred's tasks are retained");
    assert.ok(all.tasks.every((t) => t.employeeStatus === "terminated"));
    assert.equal(all.done, 0);
    assert.equal(call("onboarding-list", ctxA, { employeeId: fred.id }).result.done, 1);
  });

  it("the Former view itself is untouched: the person reads whole through it", () => {
    const { fred } = seedWorld();
    const listed = call("employee-list", ctxA, { includeInactive: true }).result.employees;
    assert.equal(listed.find((e) => e.id === fred.id).status, "terminated");
    const detail = call("employee-detail", ctxA, { id: fred.id }).result;
    assert.equal(detail.openGoals, 1, "his own rollup still counts his open goal — it is his record");
    assert.equal(detail.reviews, 1);
  });
});
