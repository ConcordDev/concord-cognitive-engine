// Phase-2 gate macro tests for server/domains/classroom.js — the
// Google-Classroom-shaped workspace + Open Library book bench the
// /lenses/classroom surface drives.
//
// These pin the registerLensAction (LENS_ACTIONS) handler family the
// frontend reaches: ClassroomWorkspace.tsx (assignment/submission/grade/
// gradebook/stream/material/todo/quiz macros via lensRun → result peel) and
// OpenLibrarySearch.tsx + ClassroomActionPanel.tsx (ol-search/ol-subject/
// ol-work/ol-isbn via callMacro → { ok, result } peel).
//
// DISPATCH FIDELITY: the live server dispatch invokes a registerLensAction
// handler as handler(ctx, virtualArtifact, input) — the 3-ARG convention with
// virtualArtifact.data === input. `call()` below mirrors that EXACTLY, so a
// regression that confuses the param positions surfaces here.
//
// COMPONENT-EXACT INPUT: every drive uses the EXACT input field names the
// component sends (e.g. ClassroomWorkspace's create passes { cohortId, title,
// instructions, dueAt, points, topic }; OpenLibrarySearch passes { query,
// limit:24 }). Every assertion reads the EXACT output field the component
// renders (r.result.assignment.points, env.result.works[].coverImage, …).
//
// CORRECTNESS SCRUTINY: these are in-memory CRUD + pure-compute calculators
// (no wallet, no minting). The risk is fail-OPEN non-finite output, not
// minting. The poisoned-numeric block pins that grade percent / gradebook
// average / quiz percent stay FINITE under '1e999'/'Infinity'/'NaN' inputs and
// that malformed input is rejected fail-CLOSED rather than throwing.
//
// Network handlers (ol-*) are exercised with a MOCKED globalThis.fetch so the
// field-mapping (OL JSON → result shape the component renders) is pinned
// offline, plus a degrade-graceful path when fetch throws / 404s.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerClassroomActions from "../domains/classroom.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "classroom", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data === input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`classroom.${name} not registered`);
  const virtualArtifact = { id: null, domain: "classroom", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}
// Async variant for the ol-* network handlers.
async function callAsync(name, ctx, input = {}) {
  return call(name, ctx, input);
}

before(() => { registerClassroomActions(registerLensAction); });

let _fetchImpl = null;
beforeEach(() => {
  // Fresh per-user in-memory store each test so round-trips don't accumulate.
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  // Default: network DISABLED. Tests that exercise ol-* install their own mock.
  _fetchImpl = null;
  globalThis.fetch = async (...a) => {
    if (_fetchImpl) return _fetchImpl(...a);
    throw new Error("network disabled");
  };
});
function mockFetch(impl) { _fetchImpl = impl; }
function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ctxA = { actor: { userId: "teacher_a" }, userId: "teacher_a" };

// Every macro the classroom lens page + components reach.
const LENS_MACROS = [
  // workspace (ClassroomWorkspace.tsx)
  "assignment-create", "assignment-list", "assignment-delete",
  "submission-create", "submission-list",
  "grade-submission", "gradebook",
  "announce", "stream-list",
  "material-add", "material-list", "material-delete",
  "todo",
  "quiz-create", "quiz-list", "quiz-get", "quiz-submit", "quiz-attempts",
  // Open Library bench (OpenLibrarySearch.tsx + ClassroomActionPanel.tsx)
  "ol-search", "ol-subject", "ol-work", "ol-isbn",
];

describe("classroom — registration (every lens-driven macro present)", () => {
  it("registers every macro the page + components call", () => {
    for (const m of LENS_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing classroom.${m}`);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Assignments tab — ClassroomWorkspace AssignmentsTab.create() sends
 *   { cohortId, title, instructions, dueAt, points, topic }
 * and renders a.points / a.dueAt / a.topic / a.submissionCount / a.gradedCount.
 * ──────────────────────────────────────────────────────────────────────── */
describe("classroom.assignment-create / -list — exact rendered fields", () => {
  it("create returns assignment with the EXACT fields the card renders", () => {
    const r = call("assignment-create", ctxA, {
      cohortId: 7, title: "Essay 1", instructions: "Write 500 words",
      dueAt: "2999-01-01T00:00", points: 80, topic: "Week 1",
    });
    assert.equal(r.ok, true);
    const a = r.result.assignment;          // component reads r.result.assignment
    assert.equal(a.title, "Essay 1");
    assert.equal(a.cohortId, 7);
    assert.equal(a.points, 80);             // rendered: "{a.points} pts"
    assert.equal(a.topic, "Week 1");        // rendered: "#{a.topic}"
    assert.equal(a.instructions, "Write 500 words");
    assert.equal(a.status, "published");
    assert.equal(typeof a.id, "string");
  });

  it("assignment-list enriches with submissionCount + gradedCount (component renders both)", () => {
    const ctx = { actor: { userId: "t_enrich" }, userId: "t_enrich" };
    const a = call("assignment-create", ctx, { cohortId: 1, title: "HW", points: 100 });
    const aid = a.result.assignment.id;
    call("submission-create", ctx, { assignmentId: aid, studentId: "stu1", content: "x" });
    const sub2 = call("submission-create", ctx, { assignmentId: aid, studentId: "stu2", content: "y" });
    call("grade-submission", ctx, { submissionId: sub2.result.submission.id, score: 50 });

    const list = call("assignment-list", ctx, { cohortId: 1 });
    const row = list.result.assignments.find((x) => x.id === aid);
    assert.equal(row.submissionCount, 2);   // rendered: "{a.submissionCount} submitted"
    assert.equal(row.gradedCount, 1);       // rendered: "{a.gradedCount} graded"
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Gradebook tab — GradebookTab refresh() sends { cohortId } and renders
 *   r.studentCount / r.classAverage / r.assignments.length / rows[].average / cells[].score
 * ──────────────────────────────────────────────────────────────────────── */
describe("classroom.grade-submission / gradebook — exact computed values", () => {
  it("grade percent = round(score/maxPoints*100), maxPoints from the assignment", () => {
    const ctx = { actor: { userId: "t_grade" }, userId: "t_grade" };
    const a = call("assignment-create", ctx, { cohortId: 1, title: "E", points: 80 });
    const sub = call("submission-create", ctx, { assignmentId: a.result.assignment.id, studentId: "stuA", content: "z" });
    const g = call("grade-submission", ctx, { submissionId: sub.result.submission.id, score: 60, feedback: "good", returned: true });
    assert.equal(g.ok, true);
    assert.equal(g.result.grade.maxPoints, 80);
    assert.equal(g.result.grade.score, 60);
    assert.equal(g.result.grade.percent, 75);    // round(60/80*100)
    assert.equal(g.result.grade.feedback, "good");
  });

  it("gradebook computes per-student totals + class average across graded cells", () => {
    const ctx = { actor: { userId: "t_gb" }, userId: "t_gb" };
    const a1 = call("assignment-create", ctx, { cohortId: 7, title: "A1", points: 100 });
    const a2 = call("assignment-create", ctx, { cohortId: 7, title: "A2", points: 50 });
    // alice: 80/100 + 40/50 → 120/150 = 80%
    const sa1 = call("submission-create", ctx, { assignmentId: a1.result.assignment.id, studentId: "alice", content: "1" });
    const sa2 = call("submission-create", ctx, { assignmentId: a2.result.assignment.id, studentId: "alice", content: "2" });
    call("grade-submission", ctx, { submissionId: sa1.result.submission.id, score: 80 });
    call("grade-submission", ctx, { submissionId: sa2.result.submission.id, score: 40 });
    // bob: 50/100 → 50%
    const sb1 = call("submission-create", ctx, { assignmentId: a1.result.assignment.id, studentId: "bob", content: "3" });
    call("grade-submission", ctx, { submissionId: sb1.result.submission.id, score: 50 });

    const gb = call("gradebook", ctx, { cohortId: 7 });
    assert.equal(gb.ok, true);
    assert.equal(gb.result.studentCount, 2);
    assert.equal(gb.result.classAverage, 65);    // round((80+50)/2)
    const alice = gb.result.rows.find((r) => r.studentId === "alice");
    assert.equal(alice.totalEarned, 120);
    assert.equal(alice.totalPossible, 150);
    assert.equal(alice.average, 80);
    // cell score is rendered "{c.score}/{c.maxPoints}"
    const aliceCell = alice.cells.find((c) => c.assignmentId === a1.result.assignment.id);
    assert.equal(aliceCell.score, 80);
    assert.equal(aliceCell.maxPoints, 100);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Quizzes tab — QuizzesTab.create() sends { cohortId, title, questions:[{kind,
 * prompt, options, correctAnswer, points}] }; take()→quiz-get; submitQuiz()→
 * quiz-submit { quizId, answers }; renders result.score/totalPoints/percent +
 * breakdown[].correct/awarded/correctAnswer.
 * ──────────────────────────────────────────────────────────────────────── */
describe("classroom.quiz-create / -get / -submit — auto-grade + answer-stripping", () => {
  it("quiz-create totalPoints = sum(points) and correctAnswer is stripped from the returned copy", () => {
    const ctx = { actor: { userId: "t_qz" }, userId: "t_qz" };
    const qz = call("quiz-create", ctx, {
      cohortId: 3, title: "Bio",
      questions: [
        { kind: "multiple_choice", prompt: "Powerhouse?", options: ["Nucleus", "Mitochondria"], correctAnswer: "Mitochondria", points: 3 },
        { kind: "true_false", prompt: "Water is H2O", correctAnswer: "True", points: 2 },
      ],
    });
    assert.equal(qz.ok, true);
    assert.equal(qz.result.quiz.totalPoints, 5);
    assert.ok(qz.result.quiz.questions.every((q) => !("correctAnswer" in q)));  // never leaks
    const tf = qz.result.quiz.questions.find((q) => q.kind === "true_false");
    assert.deepEqual(tf.options, ["True", "False"]);  // forced
  });

  it("quiz-get returns the student-facing (answer-stripped) copy the take() flow renders", () => {
    const ctx = { actor: { userId: "t_qg" }, userId: "t_qg" };
    const qz = call("quiz-create", ctx, {
      cohortId: 1, title: "G",
      questions: [{ kind: "short_answer", prompt: "Capital of France?", correctAnswer: "Paris", points: 5 }],
    });
    const got = call("quiz-get", ctx, { quizId: qz.result.quiz.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.quiz.questions[0].prompt, "Capital of France?");
    assert.ok(!("correctAnswer" in got.result.quiz.questions[0]));
  });

  it("quiz-submit case-insensitive auto-grade — exact earned/percent + breakdown the result panel renders", () => {
    const ctx = { actor: { userId: "t_qs" }, userId: "t_qs" };
    const qz = call("quiz-create", ctx, {
      cohortId: 4, title: "GradeMe",
      questions: [
        { kind: "short_answer", prompt: "Capital of France?", correctAnswer: "Paris", points: 5 },
        { kind: "short_answer", prompt: "2+2?", correctAnswer: "4", points: 5 },
      ],
    });
    const [q1, q2] = qz.result.quiz.questions;
    const att = call("quiz-submit", ctx, { quizId: qz.result.quiz.id, answers: { [q1.id]: "  paRIS ", [q2.id]: "5" } });
    assert.equal(att.ok, true);
    assert.equal(att.result.attempt.score, 5);
    assert.equal(att.result.attempt.totalPoints, 10);
    assert.equal(att.result.attempt.percent, 50);     // round(5/10*100)
    const b1 = att.result.attempt.breakdown.find((b) => b.questionId === q1.id);
    assert.equal(b1.correct, true);
    assert.equal(b1.awarded, 5);
    const b2 = att.result.attempt.breakdown.find((b) => b.questionId === q2.id);
    assert.equal(b2.correct, false);
    assert.equal(b2.awarded, 0);
    assert.equal(b2.correctAnswer, "4");              // rendered "(→ {b.correctAnswer})"
  });

  it("quiz-list + quiz-attempts surface questionCount/attemptCount + averagePercent the UI renders", () => {
    const ctx = { actor: { userId: "t_ql" }, userId: "t_ql" };
    const qz = call("quiz-create", ctx, {
      cohortId: 9, title: "Avg",
      questions: [{ kind: "short_answer", prompt: "X?", correctAnswer: "yes", points: 10 }],
    });
    const qid = qz.result.quiz.questions[0].id;
    call("quiz-submit", ctx, { quizId: qz.result.quiz.id, answers: { [qid]: "yes" } });  // 100%
    call("quiz-submit", ctx, { quizId: qz.result.quiz.id, answers: { [qid]: "no" } });   // 0%

    const list = call("quiz-list", ctx, { cohortId: 9 });
    const row = list.result.quizzes.find((q) => q.id === qz.result.quiz.id);
    assert.equal(row.questionCount, 1);
    assert.equal(row.attemptCount, 2);
    assert.ok(row.questions.every((q) => !("correctAnswer" in q)));  // list copy stripped too

    const att = call("quiz-attempts", ctx, { quizId: qz.result.quiz.id });
    assert.equal(att.result.count, 2);
    assert.equal(att.result.averagePercent, 50);       // round((100+0)/2)
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Stream / materials / todo tabs.
 * ──────────────────────────────────────────────────────────────────────── */
describe("classroom.announce / stream-list — filtered timeline the StreamTab renders", () => {
  it("announce → stream-list reads back filtered by cohort, kind 'announcement'", () => {
    const ctx = { actor: { userId: "t_st" }, userId: "t_st" };
    call("announce", ctx, { text: "Welcome to cohort 42", cohortId: 42 });
    const s = call("stream-list", ctx, { cohortId: 42 });
    assert.ok(s.result.stream.some((e) => e.kind === "announcement" && e.text.includes("cohort 42")));
    // a different cohort filter does NOT show it
    const other = call("stream-list", ctx, { cohortId: 99 });
    assert.ok(!other.result.stream.some((e) => e.text.includes("cohort 42")));
  });
});

describe("classroom.material-* — round-trip + topic grouping the MaterialsTab renders", () => {
  it("material-add → material-list (byTopic) → material-delete", () => {
    const ctx = { actor: { userId: "t_mat" }, userId: "t_mat" };
    const add = call("material-add", ctx, { cohortId: 2, title: "Syllabus", kind: "link", url: "https://example.test/s", topic: "Intro" });
    assert.equal(add.ok, true);
    const id = add.result.material.id;
    const list = call("material-list", ctx, { cohortId: 2 });
    assert.ok(list.result.byTopic.Intro.some((m) => m.id === id));   // MaterialsTab renders byTopic
    const del = call("material-delete", ctx, { materialId: id });
    assert.equal(del.result.deleted, id);
    const after = call("material-list", ctx, { cohortId: 2 });
    assert.ok(!after.result.materials.some((m) => m.id === id));     // really gone
  });
});

describe("classroom.todo — exact upcoming/missing/done buckets the TodoTab renders", () => {
  it("past-due unsubmitted → missing, future → upcoming, graded → done", () => {
    const ctx = { actor: { userId: "t_td" }, userId: "t_td" };
    const aMissing = call("assignment-create", ctx, { cohortId: 5, title: "Late", points: 10, dueAt: "2000-01-01T00:00:00.000Z" });
    const aUpcoming = call("assignment-create", ctx, { cohortId: 5, title: "Soon", points: 10, dueAt: "2999-01-01T00:00:00.000Z" });
    const aDone = call("assignment-create", ctx, { cohortId: 5, title: "Done", points: 10, dueAt: "2999-01-01T00:00:00.000Z" });
    const sub = call("submission-create", ctx, { assignmentId: aDone.result.assignment.id, studentId: "stuT", content: "d" });
    call("grade-submission", ctx, { submissionId: sub.result.submission.id, score: 10 });

    const todo = call("todo", ctx, { cohortId: 5, studentId: "stuT" });
    assert.equal(todo.ok, true);
    assert.equal(todo.result.counts.missing, 1);
    assert.equal(todo.result.counts.upcoming, 1);
    assert.equal(todo.result.counts.done, 1);
    assert.ok(todo.result.missing.some((i) => i.assignmentId === aMissing.result.assignment.id));
    assert.ok(todo.result.upcoming.some((i) => i.assignmentId === aUpcoming.result.assignment.id));
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Open Library bench — OpenLibrarySearch + ClassroomActionPanel.
 * MOCKED fetch pins the OL-JSON → result-shape field mapping the grid/detail
 * card render. The components peel { ok, result } and read result.works /
 * result.* directly.
 * ──────────────────────────────────────────────────────────────────────── */
describe("classroom.ol-search — field mapping the cover grid renders (mocked OL)", () => {
  it("maps docs → works with coverImage/readUrl/totalResults the grid + status read", async () => {
    mockFetch(async (url) => {
      assert.match(String(url), /\/search\.json\?/);
      assert.match(String(url), /q=clean\+code/);   // component sends { query }
      assert.match(String(url), /limit=24/);        // OpenLibrarySearch passes limit:24
      return jsonResponse({
        numFound: 137,
        docs: [{
          key: "/works/OL1W", title: "Clean Code", author_name: ["Robert C. Martin"],
          first_publish_year: 2008, edition_count: 5, cover_i: 12345,
          ia: ["cleancode00mart"], ebook_access: "borrowable",
        }],
      });
    });
    const r = await callAsync("ol-search", ctxA, { query: "clean code", limit: 24 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.totalResults, 137);       // status: "{count} of {totalResults}"
    const w = r.result.works[0];
    assert.equal(w.workId, "/works/OL1W");
    assert.equal(w.title, "Clean Code");
    assert.equal(w.authors[0], "Robert C. Martin");  // grid: w.authors?.[0]
    assert.equal(w.firstPublishYear, 2008);          // grid: w.firstPublishYear
    assert.equal(w.coverImage, "https://covers.openlibrary.org/b/id/12345-M.jpg");  // grid <img src>
    assert.equal(w.readUrl, "https://archive.org/details/cleancode00mart");          // detail: Read link
  });

  it("validation: no query/author/title/subject is rejected (component guards but handler must too)", async () => {
    const r = await callAsync("ol-search", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /at least one of/);
  });

  it("degrade-graceful: fetch throwing surfaces ok:false with an error string, never throws", async () => {
    mockFetch(async () => { throw new Error("ECONNREFUSED"); });
    const r = await callAsync("ol-search", ctxA, { query: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /openlibrary unreachable/);
  });
});

describe("classroom.ol-subject — field mapping the subject chips render (mocked OL)", () => {
  it("maps works[] (subject endpoint shape) → workId stripped of /works/", async () => {
    mockFetch(async (url) => {
      assert.match(String(url), /\/subjects\/computer_science\.json/);
      return jsonResponse({
        name: "Computer Science", work_count: 50,
        works: [{ key: "/works/OL9W", title: "SICP", authors: [{ name: "Abelson" }], first_publish_year: 1985, cover_id: 7 }],
      });
    });
    const r = await callAsync("ol-subject", ctxA, { subject: "computer science", ebooks: true, limit: 24 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.works[0].workId, "OL9W");          // ActionPanel: setWorkId(w.workId.replace('/works/',''))
    assert.equal(r.result.works[0].authors[0], "Abelson");   // subjResult: w.authors?.[0]
    assert.equal(r.result.works[0].coverImage, "https://covers.openlibrary.org/b/id/7-M.jpg");
  });

  it("validation: empty subject is rejected", async () => {
    const r = await callAsync("ol-subject", ctxA, { subject: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /subject required/);
  });
});

describe("classroom.ol-work — field mapping the work detail card renders (mocked OL)", () => {
  it("maps work → title/description/firstPublishDate/subjects the purple card reads", async () => {
    mockFetch(async (url) => {
      assert.match(String(url), /\/works\/OL45883W\.json/);   // ActionPanel sends { workId }
      return jsonResponse({
        title: "Fahrenheit 451",
        description: { value: "A dystopian novel." },          // OL nested-description shape
        subjects: ["Censorship", "Dystopias"],
        first_publish_date: "1953",
        covers: [99],
      });
    });
    const r = await callAsync("ol-work", ctxA, { workId: "OL45883W" });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "Fahrenheit 451");
    assert.equal(r.result.description, "A dystopian novel.");   // nested .value unwrapped
    assert.equal(r.result.firstPublishDate, "1953");
    assert.deepEqual(r.result.subjects, ["Censorship", "Dystopias"]);
  });

  it("validation: a non-OL...W workId is rejected before any fetch", async () => {
    mockFetch(async () => { throw new Error("should not be called"); });
    const r = await callAsync("ol-work", ctxA, { workId: "not-a-work" });
    assert.equal(r.ok, false);
    assert.match(r.error, /workId required/);
  });
});

describe("classroom.ol-isbn — field mapping the ISBN card renders (mocked OL)", () => {
  // Phase-2 field-alignment fix: the component was rendering isbnResult.publisher
  // (singular) + isbnResult.authors, but the handler returns `publishers` (array)
  // and `authorKeys`. The component was realigned to `publishers`; this pins the
  // real handler contract so the realignment can't silently drift back.
  it("returns publishers (array) + publishDate/pages/coverImage the amber card renders", async () => {
    mockFetch(async (url) => {
      assert.match(String(url), /\/isbn\/9780132350884\.json/);  // component strips non-isbn chars
      return jsonResponse({
        title: "Clean Code", subtitle: "A Handbook",
        publishers: ["Prentice Hall"], publish_date: "2008",
        number_of_pages: 464, covers: [555],
        authors: [{ key: "/authors/OL1A" }],
      });
    });
    const r = await callAsync("ol-isbn", ctxA, { isbn: "978-0-13-235088-4" });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "Clean Code");
    assert.equal(r.result.subtitle, "A Handbook");
    assert.deepEqual(r.result.publishers, ["Prentice Hall"]);   // card: publishers.join(', ')
    assert.equal(r.result.publishDate, "2008");                 // card: " · {publishDate}"
    assert.equal(r.result.pages, 464);                          // card: "{pages} pages"
    assert.equal(r.result.coverImage, "https://covers.openlibrary.org/b/id/555-L.jpg");
    // the handler does NOT fabricate author NAMES — it honestly exposes keys only
    assert.deepEqual(r.result.authorKeys, ["/authors/OL1A"]);
    assert.ok(!("authors" in r.result));    // no fabricated authors field
    assert.ok(!("publisher" in r.result));  // no singular publisher
  });

  it("validation: an isbn that isn't 10 or 13 digits is rejected before any fetch", async () => {
    mockFetch(async () => { throw new Error("should not be called"); });
    const r = await callAsync("ol-isbn", ctxA, { isbn: "12345" });
    assert.equal(r.ok, false);
    assert.match(r.error, /isbn must be 10 or 13/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Validation-rejection + fail-CLOSED poisoned input.
 * ──────────────────────────────────────────────────────────────────────── */
describe("classroom — validation rejections (fail-closed on bad input)", () => {
  it("assignment-create with no title is rejected", () => {
    const r = call("assignment-create", ctxA, { cohortId: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /title required/);
  });
  it("assignment-create with no cohortId is rejected", () => {
    const r = call("assignment-create", ctxA, { title: "Orphan" });
    assert.equal(r.ok, false);
    assert.match(r.error, /cohortId required/);
  });
  it("material-add with a non-finite cohortId is rejected (Number.isFinite guard)", () => {
    const r = call("material-add", ctxA, { title: "M", cohortId: "not-a-number" });
    assert.equal(r.ok, false);
    assert.match(r.error, /cohortId required/);
  });
  it("quiz-create with zero questions is rejected", () => {
    const r = call("quiz-create", ctxA, { cohortId: 1, title: "Empty", questions: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least one question/);
  });
  it("quiz-create rejects a multiple_choice question with < 2 options", () => {
    const r = call("quiz-create", ctxA, {
      cohortId: 1, title: "Bad",
      questions: [{ kind: "multiple_choice", prompt: "Pick", options: ["only"], correctAnswer: "only", points: 1 }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /needs >=2 options/);
  });
  it("grade-submission on a missing submission is rejected", () => {
    const r = call("grade-submission", ctxA, { submissionId: "nope", score: 5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /submission not found/);
  });
  it("quiz-submit on a missing quiz is rejected", () => {
    const r = call("quiz-submit", ctxA, { quizId: "nope", answers: {} });
    assert.equal(r.ok, false);
    assert.match(r.error, /quiz not found/);
  });
});

describe("classroom — poisoned-numeric inputs stay FINITE (no fail-open)", () => {
  it("grade-submission with '1e999'/'Infinity'/'NaN' score → finite clamped score + finite percent", () => {
    const ctx = { actor: { userId: "t_poison" }, userId: "t_poison" };
    const a = call("assignment-create", ctx, { cohortId: 1, title: "P", points: 100 });
    for (const poison of ["1e999", "Infinity", "NaN", Infinity, -Infinity, NaN]) {
      const sub = call("submission-create", ctx, { assignmentId: a.result.assignment.id, studentId: `s_${String(poison)}`, content: "x" });
      const g = call("grade-submission", ctx, { submissionId: sub.result.submission.id, score: poison });
      assert.equal(g.ok, true);
      assert.ok(Number.isFinite(g.result.grade.score), `score finite for ${String(poison)}`);
      assert.ok(g.result.grade.score >= 0 && g.result.grade.score <= 100, `score in [0,100] for ${String(poison)}`);
      assert.ok(Number.isFinite(g.result.grade.percent), `percent finite for ${String(poison)}`);
    }
  });

  it("assignment-create with poisoned points clamps to [0,1000], stays finite", () => {
    const ctx = { actor: { userId: "t_pts" }, userId: "t_pts" };
    for (const [poison, expected] of [["1e999", 1000], ["Infinity", 1000], ["NaN", 100], [-7, 0], [5000, 1000]]) {
      const a = call("assignment-create", ctx, { cohortId: 1, title: "X", points: poison });
      assert.ok(Number.isFinite(a.result.assignment.points));
      assert.equal(a.result.assignment.points, expected, `points for ${String(poison)}`);
    }
  });

  it("quiz-create with poisoned per-question points clamps to [1,100]; totalPoints stays finite", () => {
    const ctx = { actor: { userId: "t_qp" }, userId: "t_qp" };
    const qz = call("quiz-create", ctx, {
      cohortId: 1, title: "PP",
      questions: [
        { kind: "short_answer", prompt: "a", correctAnswer: "a", points: "1e999" },
        { kind: "short_answer", prompt: "b", correctAnswer: "b", points: "NaN" },
      ],
    });
    assert.equal(qz.ok, true);
    assert.ok(Number.isFinite(qz.result.quiz.totalPoints));
    assert.equal(qz.result.quiz.totalPoints, 101);   // clamp(1e999)=100 + (NaN→1)=1
  });

  it("quiz-submit with a poisoned (non-object) answers bag does not throw; score stays finite 0", () => {
    const ctx = { actor: { userId: "t_qsb" }, userId: "t_qsb" };
    const qz = call("quiz-create", ctx, {
      cohortId: 1, title: "PB",
      questions: [{ kind: "short_answer", prompt: "x", correctAnswer: "y", points: 5 }],
    });
    const att = call("quiz-submit", ctx, { quizId: qz.result.quiz.id, answers: "not-an-object" });
    assert.equal(att.ok, true);
    assert.ok(Number.isFinite(att.result.attempt.score));
    assert.equal(att.result.attempt.score, 0);       // no answers matched → 0
    assert.ok(Number.isFinite(att.result.attempt.percent));
  });
});
