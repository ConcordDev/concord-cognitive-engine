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

describe("hr — I-9 / E-Verify employment eligibility", () => {
  it("i9-add creates a pending record for a real document type", () => {
    const emp = seedEmployee(ctxA);
    const r = call("i9-add", ctxA, {
      employeeId: emp.id, documentType: "us_passport", documentIdentifier: "X1234567",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.record.status, "pending");
    assert.equal(r.result.record.documentType, "us_passport");
    assert.equal(r.result.record.everifyStatus, "not_submitted");
  });

  it("i9-add rejects an unknown employee", () => {
    const r = call("i9-add", ctxA, { employeeId: "emp_ghost", documentType: "us_passport" });
    assert.equal(r.ok, false);
    assert.match(r.error, /employee not found/);
  });

  it("i9-add rejects an invalid document type instead of silently defaulting", () => {
    const emp = seedEmployee(ctxA);
    const r = call("i9-add", ctxA, { employeeId: emp.id, documentType: "napkin" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid document type/);
  });

  it("i9-add requires an expirationDate for a document type that always expires", () => {
    const emp = seedEmployee(ctxA);
    const noExp = call("i9-add", ctxA, { employeeId: emp.id, documentType: "employment_authorization_document" });
    assert.equal(noExp.ok, false);
    assert.match(noExp.error, /expirationDate/);
    const withExp = call("i9-add", ctxA, {
      employeeId: emp.id, documentType: "employment_authorization_document", expirationDate: "2099-01-01",
    });
    assert.equal(withExp.ok, true);
    assert.equal(withExp.result.record.expirationDate, "2099-01-01");
  });

  it("i9-verify transitions pending -> verified and rejects verifying a rejected record", () => {
    const emp = seedEmployee(ctxA);
    const rec = call("i9-add", ctxA, { employeeId: emp.id, documentType: "permanent_resident_card", expirationDate: "2099-01-01" }).result.record;
    const verified = call("i9-verify", ctxA, { id: rec.id });
    assert.equal(verified.ok, true);
    assert.equal(verified.result.record.status, "verified");
    assert.ok(verified.result.record.verifiedAt);

    const rec2 = call("i9-add", ctxA, { employeeId: emp.id, documentType: "us_passport" }).result.record;
    call("i9-reject", ctxA, { id: rec2.id, reason: "expired at intake" });
    const reverify = call("i9-verify", ctxA, { id: rec2.id });
    assert.equal(reverify.ok, false);
    assert.match(reverify.error, /cannot verify a rejected/);
  });

  it("i9-reject records a reason and rejects double-reject", () => {
    const emp = seedEmployee(ctxA);
    const rec = call("i9-add", ctxA, { employeeId: emp.id, documentType: "us_passport" }).result.record;
    const rejected = call("i9-reject", ctxA, { id: rec.id, reason: "document appears altered" });
    assert.equal(rejected.ok, true);
    assert.equal(rejected.result.record.status, "rejected");
    assert.equal(rejected.result.record.rejectionReason, "document appears altered");
    const dup = call("i9-reject", ctxA, { id: rec.id, reason: "again" });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /already rejected/);
  });

  it("i9-list surfaces daysUntilExpiration and auto-expires past-due records", () => {
    const emp = seedEmployee(ctxA);
    const rec = call("i9-add", ctxA, {
      employeeId: emp.id, documentType: "employment_authorization_document", expirationDate: "2000-01-01",
    }).result.record;
    call("i9-verify", ctxA, { id: rec.id, expirationDate: "2000-01-01" });
    const list = call("i9-list", ctxA, { employeeId: emp.id });
    assert.equal(list.ok, true);
    assert.equal(list.result.records[0].status, "expired");
    assert.ok(list.result.records[0].daysUntilExpiration < 0);
  });

  it("i9-everify-submit rejects an invalid status enum", () => {
    const emp = seedEmployee(ctxA);
    const rec = call("i9-add", ctxA, { employeeId: emp.id, documentType: "us_passport" }).result.record;
    const r = call("i9-everify-submit", ctxA, { id: rec.id, caseNumber: "E123", status: "vibes-good" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid E-Verify status/);
  });

  it("i9-everify-submit final_nonconfirmation cascades the I-9 record to rejected", () => {
    const emp = seedEmployee(ctxA);
    const rec = call("i9-add", ctxA, { employeeId: emp.id, documentType: "us_passport" }).result.record;
    call("i9-verify", ctxA, { id: rec.id });
    const submitted = call("i9-everify-submit", ctxA, {
      id: rec.id, caseNumber: "E-2026-000123", status: "final_nonconfirmation",
    });
    assert.equal(submitted.ok, true);
    assert.equal(submitted.result.record.everifyStatus, "final_nonconfirmation");
    assert.equal(submitted.result.record.status, "rejected");
    assert.equal(submitted.result.record.rejectionReason, "E-Verify Final Nonconfirmation");
  });

  it("i9-document-attach reuses the hr-document store and links the doc id", () => {
    const emp = seedEmployee(ctxA);
    const rec = call("i9-add", ctxA, { employeeId: emp.id, documentType: "us_passport" }).result.record;
    const attached = call("i9-document-attach", ctxA, { id: rec.id, title: "Passport scan" });
    assert.equal(attached.ok, true);
    assert.equal(attached.result.record.attachedDocumentIds.length, 1);
    const docs = call("hr-document-list", ctxA, { employeeId: emp.id });
    assert.equal(docs.result.count, 1);
    assert.equal(docs.result.documents[0].kind, "i9_support");
  });

  it("i9-status org-wide reports compliancePct, missing, and overdue (>3 days, no record)", () => {
    seedEmployee(ctxA, { hireDate: "2020-01-01" }); // overdue: hired long ago, no I-9
    const emp2 = seedEmployee(ctxA, { hireDate: "2022-01-01" });
    call("i9-add", ctxA, { employeeId: emp2.id, documentType: "us_passport" });
    call("i9-verify", ctxA, { id: call("i9-list", ctxA, { employeeId: emp2.id }).result.records[0].id });
    const st = call("i9-status", ctxA, {});
    assert.equal(st.ok, true);
    assert.equal(st.result.activeEmployees, 2);
    assert.equal(st.result.verified, 1);
    assert.equal(st.result.missing, 1);
    assert.equal(st.result.overdue, 1);
    assert.equal(st.result.compliancePct, 50);
  });

  it("i9-status per-employee returns that employee's records only", () => {
    const emp = seedEmployee(ctxA);
    const other = seedEmployee(ctxA, { name: "Other" });
    call("i9-add", ctxA, { employeeId: emp.id, documentType: "us_passport" });
    call("i9-add", ctxA, { employeeId: other.id, documentType: "us_passport" });
    const st = call("i9-status", ctxA, { employeeId: emp.id });
    assert.equal(st.ok, true);
    assert.equal(st.result.records.length, 1);
    assert.equal(st.result.records[0].employeeId, emp.id);
  });

  it("INVARIANT: I-9 records are scoped per-user workspace", () => {
    const empA = seedEmployee(ctxA);
    call("i9-add", ctxA, { employeeId: empA.id, documentType: "us_passport" });
    const listB = call("i9-list", ctxB, {});
    assert.equal(listB.ok, true);
    assert.equal(listB.result.count, 0);
  });
});
