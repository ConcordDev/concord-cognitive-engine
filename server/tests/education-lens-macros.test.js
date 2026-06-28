// Behavioral macro tests for the education lens — PHASE-2 LENS-DRIVEN GAP layer.
//
// The two real frontend compute channels:
//   • EducationActionPanel.tsx → callMacro(action, { artifact: { data } })
//        → apiHelpers.lens.runDomain('education', action, { input })
//        → POST /api/lens/run {input: {artifact:{data}}} → the dispatch
//          peelRedundantArtifactWrapper unwraps ONE redundant layer so
//          virtualArtifact.data === data → handler reads art.data.{students,
//          weightScheme,requirements,completions}.
//   • app/lenses/education/page.tsx Domain-Actions bar → handleAction(action)
//        → runAction.mutateAsync → the inline page panel reads the SAME
//          handler fields (studentsGraded / classStats / overallCompletionPct
//          / completedRequirements / remainingRequirements / conflictsFound).
//
// This file drives each deterministic calculator with the EXACT inner-data
// object the component sends (post-peel) and asserts the EXACT fields the
// component + inline page panel render — with real computed values (weighted
// grade, GPA, completion %). It does NOT duplicate any shape/round-trip
// coverage; it pins the component-exact contract, validation-rejection,
// degrade-graceful, and FAIL-CLOSED poisoned-numeric behaviour.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch +
// the peelRedundantArtifactWrapper unwrap. No server boot, no network, no
// LLM, no DB. Runs in <1s.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerEducationActions from "../domains/education.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "education", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data = rest;
// 3rd `params` arg = rest. So calc macros (read art.data) and trade macros
// (read params) BOTH see the unwrapped input. `wrap` lets a test pass the
// EXACT { artifact: { data } } envelope the component ships and proves the
// dispatch unwrap makes the handler see the real data.
function call(name, ctx, rawInput = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`education.${name} not registered`);
  const input = peelRedundantArtifactWrapper(rawInput);
  const virtualArtifact = { id: null, domain: "education", type: "domain_action", data: input, meta: {} };
  return fn(ctx, virtualArtifact, input);
}
// component-exact envelope (what EducationActionPanel.callMacro sends)
const wrap = (data) => ({ artifact: { data } });

before(() => {
  registerEducationActions(register);
});

const ctxA = { actor: { userId: "user_a", id: "user_a" }, userId: "user_a" };

/* ───────── registration: every calculator the two channels drive ───────── */

describe("education lens — registration of the driven calculators", () => {
  it("registers gradeCalculation / progressTrack / attendanceReport / scheduleConflict / generateReportCard", () => {
    for (const m of ["gradeCalculation", "progressTrack", "attendanceReport", "scheduleConflict", "generateReportCard"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing education.${m}`);
    }
  });
});

/* ───── gradeCalculation: the EXACT class-report fields the panel renders ───── */

describe("education lens — gradeCalculation (weighted class report)", () => {
  // The component renders: studentsGraded, classStats.{average,median,high,low},
  // students[].{studentId,name,weightedPct,letterGrade,categoryBreakdown}.
  // The dispatch unwrap is exercised: the component ships {artifact:{data}}.
  it("computes the real weighted % + letter grade from the component's exact envelope", () => {
    // One student, two categories. exams weight 60, homework weight 40.
    //   exams: 90/100 = 90% ; homework: 80/100 = 80%
    //   weighted = 90×0.6 + 80×0.4 = 54 + 32 = 86 → "B"
    const r = call("gradeCalculation", ctxA, wrap({
      students: [
        { studentId: "s1", name: "Ada", grades: [
          { category: "exams", name: "Midterm", score: 90, maxScore: 100 },
          { category: "homework", name: "HW1", score: 80, maxScore: 100 },
        ] },
      ],
      weightScheme: [
        { category: "exams", weight: 60 },
        { category: "homework", weight: 40 },
      ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.result.studentsGraded, 1);
    const s = r.result.students[0];
    assert.equal(s.studentId, "s1");
    assert.equal(s.name, "Ada");
    assert.equal(s.weightedPct, 86);           // real weighting, not equal-weight 85
    assert.equal(s.letterGrade, "B");
    assert.equal(s.totalAssignments, 2);
    // categoryBreakdown the per-category bar reads
    const exams = s.categoryBreakdown.find((c) => c.category === "exams");
    assert.equal(exams.categoryPct, 90);
    assert.equal(exams.weight, 60);
    assert.equal(exams.earnedPoints, 90);
    assert.equal(exams.possiblePoints, 100);
    // classStats the inline page panel reads (single student → avg=high=low=median)
    assert.equal(r.result.classStats.average, 86);
    assert.equal(r.result.classStats.high, 86);
    assert.equal(r.result.classStats.low, 86);
    assert.equal(r.result.classStats.median, 86);
  });

  it("ranks the class and computes a real median across multiple students", () => {
    // equal-weight default (no weightScheme): each student one assignment.
    //   Ada 100, Bo 70, Cy 40 → median 70, avg 70, high 100, low 40
    const r = call("gradeCalculation", ctxA, wrap({
      students: [
        { studentId: "a", name: "Ada", grades: [{ category: "q", score: 100, maxScore: 100 }] },
        { studentId: "b", name: "Bo", grades: [{ category: "q", score: 70, maxScore: 100 }] },
        { studentId: "c", name: "Cy", grades: [{ category: "q", score: 40, maxScore: 100 }] },
      ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.result.studentsGraded, 3);
    // students sorted by weightedPct desc — the panel renders the ranking
    assert.deepEqual(r.result.students.map((s) => s.name), ["Ada", "Bo", "Cy"]);
    assert.equal(r.result.classStats.high, 100);
    assert.equal(r.result.classStats.low, 40);
    assert.equal(r.result.classStats.median, 70);
    assert.equal(r.result.classStats.average, 70);
  });

  it("empty students returns an honest zeroed report (no fabricated grades)", () => {
    const r = call("gradeCalculation", ctxA, wrap({ students: [] }));
    assert.equal(r.ok, true);
    assert.equal(r.result.studentsGraded, 0);
    assert.deepEqual(r.result.students, []);
    assert.equal(r.result.classStats.average, 0);
  });
});

/* ───── progressTrack: the EXACT completion fields the panel renders ───── */

describe("education lens — progressTrack (program/cert completion)", () => {
  // The component renders: overallCompletionPct, totalRequirements,
  // completedRequirements, remainingRequirements, details[].{name,completionPct,complete}.
  it("computes the real overall completion % from required vs completed units", () => {
    // Req A needs 10 units (8 done → 80%), Req B needs 10 units (10 done → 100%, complete).
    //   total required 20, total completed 18 → overall 90%
    const r = call("progressTrack", ctxA, wrap({
      requirements: [
        { requirementId: "A", name: "Core hours", type: "core", requiredUnits: 10 },
        { requirementId: "B", name: "Electives", type: "elective", requiredUnits: 10 },
      ],
      completions: [
        { requirementId: "A", completedUnits: 8 },
        { requirementId: "B", completedUnits: 10 },
      ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.result.overallCompletionPct, 90);
    assert.equal(r.result.totalRequirements, 2);
    assert.equal(r.result.completedRequirements, 1);   // only B is complete
    assert.equal(r.result.remainingRequirements, 1);
    const a = r.result.details.find((d) => d.requirementId === "A");
    assert.equal(a.completionPct, 80);
    assert.equal(a.complete, false);
    assert.equal(a.remainingUnits, 2);
    const b = r.result.details.find((d) => d.requirementId === "B");
    assert.equal(b.complete, true);
  });

  it("caps over-completion at 100% per requirement (no >100 leak in the bar)", () => {
    // 15 units logged against a 10-unit requirement → completed clamped to 10, 100%.
    const r = call("progressTrack", ctxA, wrap({
      requirements: [{ requirementId: "A", name: "X", requiredUnits: 10 }],
      completions: [{ requirementId: "A", completedUnits: 15 }],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.result.overallCompletionPct, 100);
    assert.equal(r.result.details[0].completionPct, 100);
    assert.equal(r.result.details[0].completedUnits, 10);
    assert.equal(r.result.details[0].remainingUnits, 0);
  });

  it("empty requirements returns 0% (not NaN, not a fabricated 100%)", () => {
    const r = call("progressTrack", ctxA, wrap({ requirements: [], completions: [] }));
    assert.equal(r.ok, true);
    assert.equal(r.result.overallCompletionPct, 0);
    assert.equal(r.result.totalRequirements, 0);
  });
});

/* ───── scheduleConflict: the conflict tally the inline page panel reads ───── */

describe("education lens — scheduleConflict (the page Domain-Actions panel)", () => {
  it("detects overlapping same-day entries + names the conflict type", () => {
    const r = call("scheduleConflict", ctxA, wrap({
      schedules: [
        { id: "x", title: "Algebra", day: "Mon", startTime: "09:00", endTime: "10:00", room: "101", instructor: "Lee" },
        { id: "y", title: "Geometry", day: "Mon", startTime: "09:30", endTime: "10:30", room: "101", instructor: "Park" },
      ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.result.conflictsFound, 1);
    assert.equal(r.result.totalEntries, 2);
    assert.equal(r.result.conflictFree, false);
    assert.ok(r.result.conflicts[0].conflictType.includes("room"));
    assert.equal(r.result.conflicts[0].overlapMinutes, 30);
  });

  it("non-overlapping entries report conflictFree:true", () => {
    const r = call("scheduleConflict", ctxA, wrap({
      schedules: [
        { id: "x", title: "A", day: "Mon", startTime: "09:00", endTime: "10:00" },
        { id: "y", title: "B", day: "Mon", startTime: "10:00", endTime: "11:00" },
      ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.result.conflictsFound, 0);
    assert.equal(r.result.conflictFree, true);
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/crash ───── */

describe("education lens — fail-closed on poisoned numeric inputs", () => {
  it("gradeCalculation: NaN/Infinity/string scores never produce a NaN weightedPct", () => {
    const r = call("gradeCalculation", ctxA, wrap({
      students: [
        { studentId: "s1", name: "Bad", grades: [
          { category: "exams", score: "not-a-number", maxScore: Infinity },
          { category: "homework", score: NaN, maxScore: "oops" },
        ] },
      ],
      weightScheme: [{ category: "exams", weight: "abc" }, { category: "homework", weight: -50 }],
    }));
    assert.equal(r.ok, true);
    const s = r.result.students[0];
    assert.ok(Number.isFinite(s.weightedPct), `weightedPct must be finite, got ${s.weightedPct}`);
    assert.ok(Number.isFinite(r.result.classStats.average), "classStats.average finite");
    assert.ok(Number.isFinite(r.result.classStats.median), "classStats.median finite");
    for (const c of s.categoryBreakdown) {
      assert.ok(Number.isFinite(c.categoryPct), `categoryPct finite for ${c.category}`);
      assert.ok(Number.isFinite(c.earnedPoints) && Number.isFinite(c.possiblePoints));
    }
  });

  it("progressTrack: NaN/Infinity/negative units never produce a NaN overall %", () => {
    const r = call("progressTrack", ctxA, wrap({
      requirements: [
        { requirementId: "A", name: "X", requiredUnits: NaN },
        { requirementId: "B", name: "Y", requiredUnits: "ten" },
      ],
      completions: [
        { requirementId: "A", completedUnits: Infinity },
        { requirementId: "B", completedUnits: -5 },
      ],
    }));
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.overallCompletionPct), `overall finite, got ${r.result.overallCompletionPct}`);
    for (const d of r.result.details) {
      assert.ok(Number.isFinite(d.completionPct), `completionPct finite for ${d.requirementId}`);
      assert.ok(Number.isFinite(d.completedUnits) && Number.isFinite(d.remainingUnits));
    }
  });

  it("scheduleConflict: garbage HH:MM times never crash + never emit NaN overlaps", () => {
    const r = call("scheduleConflict", ctxA, wrap({
      schedules: [
        { id: "x", day: "Mon", startTime: "not:time", endTime: undefined },
        { id: "y", day: "Mon", startTime: null, endTime: "??:??" },
      ],
    }));
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.conflictsFound));
    for (const c of r.result.conflicts) {
      assert.ok(Number.isFinite(c.overlapMinutes), "overlapMinutes finite");
    }
  });
});

/* ───── DEGRADE-GRACEFUL: a thrown handler returns {ok:false}, never crashes ───── */

describe("education lens — degrade-graceful (never throws)", () => {
  it("gradeCalculation with a non-array students poisoning the map returns {ok:false}, no throw", () => {
    // students:123 → `.filter` / `.map` would throw; the try/catch must catch it.
    let r;
    assert.doesNotThrow(() => { r = call("gradeCalculation", ctxA, wrap({ students: 123 })); });
    assert.equal(r.ok, false);
    assert.equal(r.error, "handler_error");
  });

  it("progressTrack with a non-array requirements returns {ok:false}, no throw", () => {
    let r;
    assert.doesNotThrow(() => { r = call("progressTrack", ctxA, wrap({ requirements: "nope", completions: 7 })); });
    assert.equal(r.ok, false);
    assert.equal(r.error, "handler_error");
  });

  it("scheduleConflict with a non-array schedules returns {ok:false}, no throw", () => {
    let r;
    assert.doesNotThrow(() => { r = call("scheduleConflict", ctxA, wrap({ schedules: 42 })); });
    assert.equal(r.ok, false);
    assert.equal(r.error, "handler_error");
  });
});

/* ───── generateReportCard: GPA the StudentProgress dashboard surfaces ───── */

describe("education lens — generateReportCard (cumulative GPA + honor roll)", () => {
  it("computes a real credit-weighted GPA + honor-roll band", () => {
    // Math (3 credits): 95/100 = 95% → A → 4.0 ; English (1 credit): 85% → B → 3.0
    //   GPA = (4.0×3 + 3.0×1) / 4 = 15/4 = 3.75 → honor-roll (≥3.5, <3.8)
    const r = call("generateReportCard", ctxA, wrap({
      studentName: "Ada",
      grades: [
        { subject: "Math", assignment: "Final", score: 95, maxScore: 100, credits: 3 },
        { subject: "English", assignment: "Essay", score: 85, maxScore: 100, credits: 1 },
      ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.result.studentName, "Ada");
    assert.equal(r.result.cumulativeGpa, 3.75);
    assert.equal(r.result.honorRoll, "honor-roll");
    assert.equal(r.result.totalSubjects, 2);
    const math = r.result.subjects.find((s) => s.subject === "Math");
    assert.equal(math.letterGrade, "A");
    assert.equal(math.gpa, 4.0);
    assert.equal(math.credits, 3);
  });
});
