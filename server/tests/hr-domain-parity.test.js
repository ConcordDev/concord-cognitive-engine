// Tier-2 contract tests for hr lens parity macros
// (payroll / benefits enrollment / time clock / LMS / compliance ack /
// self-service portal / workforce analytics).
// Pins per-user scoping, real arithmetic, and validation guards.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHRActions from "../domains/hr.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`hr.${name}`);
  if (!fn) throw new Error(`hr.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerHRActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => {
    throw new Error("network disabled");
  };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function seedEmployee(ctx, overrides = {}) {
  const r = call("employee-add", ctx, {
    name: overrides.name || "Test Person",
    title: overrides.title || "Engineer",
    department: overrides.department || "Engineering",
    salary: overrides.salary != null ? overrides.salary : 100000,
    hireDate: overrides.hireDate || "2022-01-01",
    employmentType: overrides.employmentType || "full_time",
  });
  assert.equal(r.ok, true);
  return r.result.employee;
}

describe("hr — payroll run", () => {
  it("payroll-run computes real gross/net from salary on record", () => {
    seedEmployee(ctxA, { salary: 104000 });
    const r = call("payroll-run", ctxA, { frequency: "biweekly", periodLabel: "PP-01" });
    assert.equal(r.ok, true);
    assert.equal(r.result.run.headcount, 1);
    const stub = r.result.run.stubs[0];
    // 104000 / 26 periods = 4000 gross.
    assert.equal(stub.grossPay, 4000);
    assert.ok(stub.netPay < stub.grossPay, "net is gross minus deductions");
    assert.ok(stub.federalTax > 0 && stub.socialSecurity > 0 && stub.medicare > 0);
    assert.equal(
      Math.round((stub.netPay + stub.totalDeductions) * 100) / 100,
      stub.grossPay,
    );
  });

  it("payroll-run rejects when there are no active employees", () => {
    const r = call("payroll-run", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /no active employees/);
  });

  it("payroll-list and payroll-stub round-trip", () => {
    const emp = seedEmployee(ctxA, { salary: 78000 });
    const run = call("payroll-run", ctxA, {}).result.run;
    const list = call("payroll-list", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.ok(list.result.ytdPaid > 0);
    const stub = call("payroll-stub", ctxA, { runId: run.id, employeeId: emp.id });
    assert.equal(stub.ok, true);
    assert.equal(stub.result.stub.employeeId, emp.id);
  });

  it("payroll-stub rejects unknown run", () => {
    const r = call("payroll-stub", ctxA, { runId: "nope", employeeId: "x" });
    assert.equal(r.ok, false);
  });
});

describe("hr — benefits enrollment", () => {
  it("benefit-plan-add then benefit-enroll computes cost split", () => {
    const emp = seedEmployee(ctxA);
    const plan = call("benefit-plan-add", ctxA, {
      name: "Gold PPO", category: "medical", monthlyCost: 500, employerContribution: 80,
    }).result.plan;
    const r = call("benefit-enroll", ctxA, {
      employeeId: emp.id, planId: plan.id, coverageTier: "family",
    });
    assert.equal(r.ok, true);
    // family tier 2.4x = 1200 gross; employee pays 20% = 240.
    assert.equal(r.result.enrollment.employeeMonthlyCost, 240);
    assert.equal(r.result.enrollment.employerMonthlyCost, 960);
  });

  it("benefit-enroll rejects duplicate active enrollment", () => {
    const emp = seedEmployee(ctxA);
    const plan = call("benefit-plan-add", ctxA, { name: "Dental", category: "dental", monthlyCost: 40 }).result.plan;
    call("benefit-enroll", ctxA, { employeeId: emp.id, planId: plan.id });
    const dup = call("benefit-enroll", ctxA, { employeeId: emp.id, planId: plan.id });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /already enrolled/);
  });

  it("benefit-waive flips status and benefit-enrollment-list totals exclude it", () => {
    const emp = seedEmployee(ctxA);
    const plan = call("benefit-plan-add", ctxA, { name: "Vision", category: "vision", monthlyCost: 20 }).result.plan;
    const enr = call("benefit-enroll", ctxA, { employeeId: emp.id, planId: plan.id }).result.enrollment;
    call("benefit-waive", ctxA, { id: enr.id });
    const list = call("benefit-enrollment-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.enrolledCount, 0);
    assert.equal(list.result.totalEmployeeCost, 0);
  });
});

describe("hr — time / attendance clock", () => {
  it("clock-in then clock-out records hours", () => {
    const emp = seedEmployee(ctxA);
    const inR = call("clock-in", ctxA, { employeeId: emp.id });
    assert.equal(inR.ok, true);
    assert.equal(inR.result.entry.clockOut, null);
    const outR = call("clock-out", ctxA, { employeeId: emp.id });
    assert.equal(outR.ok, true);
    assert.ok(outR.result.entry.clockOut);
    assert.ok(outR.result.entry.hours >= 0);
  });

  it("clock-in rejects double clock-in", () => {
    const emp = seedEmployee(ctxA);
    call("clock-in", ctxA, { employeeId: emp.id });
    const dup = call("clock-in", ctxA, { employeeId: emp.id });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /already clocked in/);
  });

  it("timeclock-list reports open shifts and totals", () => {
    const emp = seedEmployee(ctxA);
    call("clock-in", ctxA, { employeeId: emp.id });
    const list = call("timeclock-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.openShifts, 1);
  });
});

describe("hr — learning management", () => {
  it("course-add then course-assign and course-progress to completion", () => {
    const emp = seedEmployee(ctxA);
    const course = call("course-add", ctxA, {
      title: "Security Basics", category: "security", durationHours: 2, mandatory: true,
    }).result.course;
    const asg = call("course-assign", ctxA, { employeeId: emp.id, courseId: course.id }).result.assignment;
    assert.equal(asg.status, "assigned");
    const prog = call("course-progress", ctxA, { id: asg.id, progress: 100 });
    assert.equal(prog.ok, true);
    assert.equal(prog.result.assignment.status, "completed");
    assert.ok(prog.result.assignment.completedAt);
  });

  it("course-list rolls up assigned/completed counts", () => {
    const emp = seedEmployee(ctxA);
    const course = call("course-add", ctxA, { title: "Onboarding 101" }).result.course;
    call("course-assign", ctxA, { employeeId: emp.id, courseId: course.id });
    const list = call("course-list", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.courses[0].assignedCount, 1);
    assert.equal(list.result.courses[0].completedCount, 0);
  });

  it("course-assign rejects duplicate assignment", () => {
    const emp = seedEmployee(ctxA);
    const course = call("course-add", ctxA, { title: "Ethics" }).result.course;
    call("course-assign", ctxA, { employeeId: emp.id, courseId: course.id });
    const dup = call("course-assign", ctxA, { employeeId: emp.id, courseId: course.id });
    assert.equal(dup.ok, false);
  });

  it("course-assignment-list filters by employee", () => {
    const emp = seedEmployee(ctxA);
    const course = call("course-add", ctxA, { title: "Compliance Refresher" }).result.course;
    call("course-assign", ctxA, { employeeId: emp.id, courseId: course.id });
    const list = call("course-assignment-list", ctxA, { employeeId: emp.id });
    assert.equal(list.ok, true);
    assert.equal(list.result.assignments.length, 1);
  });
});

describe("hr — compliance acknowledgement", () => {
  it("compliance-doc-add then compliance-acknowledge records ack", () => {
    const emp = seedEmployee(ctxA);
    const doc = call("compliance-doc-add", ctxA, {
      title: "Code of Conduct", category: "policy", version: "2.0",
    }).result.document;
    const ack = call("compliance-acknowledge", ctxA, { employeeId: emp.id, docId: doc.id });
    assert.equal(ack.ok, true);
    assert.equal(ack.result.acknowledgement.version, "2.0");
  });

  it("compliance-acknowledge rejects duplicate ack of same version", () => {
    const emp = seedEmployee(ctxA);
    const doc = call("compliance-doc-add", ctxA, { title: "Handbook" }).result.document;
    call("compliance-acknowledge", ctxA, { employeeId: emp.id, docId: doc.id });
    const dup = call("compliance-acknowledge", ctxA, { employeeId: emp.id, docId: doc.id });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /already acknowledged/);
  });

  it("compliance-doc-list reports acknowledged rate", () => {
    const emp = seedEmployee(ctxA);
    const doc = call("compliance-doc-add", ctxA, { title: "Safety Policy" }).result.document;
    call("compliance-acknowledge", ctxA, { employeeId: emp.id, docId: doc.id });
    const list = call("compliance-doc-list", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.documents[0].acknowledgedCount, 1);
    assert.equal(list.result.documents[0].acknowledgedRate, 100);
  });

  it("compliance-status per-employee lists outstanding docs", () => {
    const emp = seedEmployee(ctxA);
    call("compliance-doc-add", ctxA, { title: "Unread Policy" });
    const st = call("compliance-status", ctxA, { employeeId: emp.id });
    assert.equal(st.ok, true);
    assert.equal(st.result.outstanding, 1);
  });

  it("compliance-status org-wide computes compliance percentage", () => {
    const emp = seedEmployee(ctxA);
    const doc = call("compliance-doc-add", ctxA, { title: "Org Policy" }).result.document;
    call("compliance-acknowledge", ctxA, { employeeId: emp.id, docId: doc.id });
    const st = call("compliance-status", ctxA, {});
    assert.equal(st.ok, true);
    assert.equal(st.result.compliancePct, 100);
  });
});

describe("hr — self-service portal", () => {
  it("self-service-summary consolidates real records for one employee", () => {
    const emp = seedEmployee(ctxA, { salary: 90000 });
    const plan = call("benefit-plan-add", ctxA, { name: "HMO", category: "medical", monthlyCost: 300 }).result.plan;
    call("benefit-enroll", ctxA, { employeeId: emp.id, planId: plan.id });
    call("payroll-run", ctxA, {});
    const r = call("self-service-summary", ctxA, { employeeId: emp.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.profile.id, emp.id);
    assert.equal(r.result.benefits.length, 1);
    assert.equal(r.result.paystubs.length, 1);
    assert.equal(r.result.timeoffBalances.length, 3);
  });

  it("self-service-update only edits contact fields", () => {
    const emp = seedEmployee(ctxA, { salary: 90000 });
    const r = call("self-service-update", ctxA, {
      employeeId: emp.id, email: "new@example.com", phone: "555-1234",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.profile.email, "new@example.com");
    assert.equal(r.result.profile.phone, "555-1234");
    // Salary stays untouched (not editable via self-service).
    const detail = call("employee-detail", ctxA, { id: emp.id });
    assert.equal(detail.result.employee.salary, 90000);
  });

  it("self-service-summary rejects unknown employee", () => {
    const r = call("self-service-summary", ctxA, { employeeId: "ghost" });
    assert.equal(r.ok, false);
  });
});

describe("hr — workforce analytics", () => {
  it("workforce-analytics computes tenure, comp bands, departments", () => {
    seedEmployee(ctxA, { salary: 80000, department: "Engineering", hireDate: "2020-01-01" });
    seedEmployee(ctxA, { salary: 120000, department: "Sales", hireDate: "2024-01-01" });
    const r = call("workforce-analytics", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.headcount, 2);
    assert.ok(r.result.avgTenureYears > 0);
    assert.equal(r.result.compensation.min, 80000);
    assert.equal(r.result.compensation.max, 120000);
    assert.equal(r.result.departments.length, 2);
    assert.equal(r.result.annualPayroll, 200000);
  });

  it("workforce-analytics handles empty workforce", () => {
    const r = call("workforce-analytics", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.headcount, 0);
    assert.equal(r.result.annualPayroll, 0);
  });
});

describe("hr — per-user isolation", () => {
  it("INVARIANT: payroll/benefits/courses scoped per-user", () => {
    const empA = seedEmployee(ctxA, { salary: 60000 });
    call("payroll-run", ctxA, {});
    call("course-add", ctxA, { title: "A-only course" });
    const bRuns = call("payroll-list", ctxB);
    const bCourses = call("course-list", ctxB);
    assert.equal(bRuns.result.count, 0);
    assert.equal(bCourses.result.count, 0);
    // user_b cannot enroll user_a's employee
    const plan = call("benefit-plan-add", ctxB, { name: "B plan", monthlyCost: 10 }).result.plan;
    const cross = call("benefit-enroll", ctxB, { employeeId: empA.id, planId: plan.id });
    assert.equal(cross.ok, false);
  });
});
