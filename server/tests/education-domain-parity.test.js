// Contract tests for the education-lens parity macros in server/domains/education.js.
// Covers: flashcards SM-2 lifecycle, decks CRUD, quiz-from-text + mint-deck,
// tutor-ask + lesson-plan-generate (LLM-mocked), preserving the analytical
// macros above.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerEducationActions from "../domains/education.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`education.${name}`);
  assert.ok(fn, `education.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerEducationActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map(), educationLens: { decks: new Map(), cards: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
});

const userA = "user_a";
const userB = "user_b";
const ctxA = { actor: { userId: userA }, userId: userA };
const ctxB = { actor: { userId: userB }, userId: userB };

describe("education.flashcards-* (decks + cards + SM-2 review)", () => {
  it("deck CRUD scoped per user", () => {
    const d1 = call("flashcards-deck-create", ctxA, { title: "French A1" });
    assert.equal(d1.ok, true);
    const list = call("flashcards-decks", ctxA, {});
    assert.equal(list.result.decks.length, 1);
    assert.equal(list.result.decks[0].title, "French A1");

    // Other user empty
    assert.equal(call("flashcards-decks", ctxB, {}).result.decks.length, 0);
  });

  it("rejects deck create with empty title", () => {
    assert.equal(call("flashcards-deck-create", ctxA, { title: "" }).ok, false);
  });

  it("card create + due queue (due immediately on creation)", () => {
    const d = call("flashcards-deck-create", ctxA, { title: "x" });
    const deckId = d.result.deck.id;
    call("flashcards-card-create", ctxA, { deckId, front: "hello", back: "bonjour" });
    call("flashcards-card-create", ctxA, { deckId, front: "thanks", back: "merci" });

    const due = call("flashcards-due", ctxA, { deckId, limit: 10 });
    assert.equal(due.result.cards.length, 2);
    assert.equal(due.result.total, 2);
  });

  it("rejects card create with missing fields", () => {
    assert.equal(call("flashcards-card-create", ctxA, { deckId: "x" }).ok, false);
    assert.equal(call("flashcards-card-create", ctxA, { front: "x", back: "y" }).ok, false);
  });

  it("SM-2 review: good rating advances interval, ease drifts, due moves to future", () => {
    const d = call("flashcards-deck-create", ctxA, { title: "x" });
    const c = call("flashcards-card-create", ctxA, { deckId: d.result.deck.id, front: "f", back: "b" });
    const id = c.result.card.id;

    // First good review
    const r1 = call("flashcards-review", ctxA, { cardId: id, quality: 4 });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.card.repetitions, 1);
    assert.equal(r1.result.card.interval, 1);
    assert.ok(r1.result.card.ease >= 2.4);
    assert.ok(new Date(r1.result.card.dueAt).getTime() > Date.now() + 1000);

    // Second good review
    const r2 = call("flashcards-review", ctxA, { cardId: id, quality: 4 });
    assert.equal(r2.result.card.repetitions, 2);
    assert.equal(r2.result.card.interval, 6);

    // Third good review → interval × ease
    const r3 = call("flashcards-review", ctxA, { cardId: id, quality: 5 });
    assert.equal(r3.result.card.repetitions, 3);
    assert.ok(r3.result.card.interval > 6);
  });

  it("SM-2 review: bad rating (q<3) resets repetitions + interval, schedules <1 day", () => {
    const d = call("flashcards-deck-create", ctxA, { title: "x" });
    const c = call("flashcards-card-create", ctxA, { deckId: d.result.deck.id, front: "f", back: "b" });
    const id = c.result.card.id;
    call("flashcards-review", ctxA, { cardId: id, quality: 4 });
    call("flashcards-review", ctxA, { cardId: id, quality: 4 });
    const fail = call("flashcards-review", ctxA, { cardId: id, quality: 1 });
    assert.equal(fail.result.card.repetitions, 0);
    assert.equal(fail.result.card.interval, 0);
    // Re-scheduled to <1 day later (minutes), not days
    const due = new Date(fail.result.card.dueAt).getTime();
    assert.ok(due - Date.now() < 86_400_000);
  });

  it("SM-2 review: ease floor at 1.3", () => {
    const d = call("flashcards-deck-create", ctxA, { title: "x" });
    const c = call("flashcards-card-create", ctxA, { deckId: d.result.deck.id, front: "f", back: "b" });
    const id = c.result.card.id;
    // Hammer with low quality to drive ease toward floor
    let lastReview;
    for (let i = 0; i < 20; i++) {
      lastReview = call("flashcards-review", ctxA, { cardId: id, quality: 0 });
    }
    assert.ok(lastReview.result.card.ease >= 1.3);
    assert.equal(lastReview.result.card.ease, 1.3);
  });

  it("review rejects unknown card id", () => {
    assert.equal(call("flashcards-review", ctxA, { cardId: "nope", quality: 3 }).ok, false);
  });
});

describe("education.tutor-ask (Socratic)", () => {
  it("returns graceful no-op text when llm unavailable", async () => {
    const r = await call("tutor-ask", ctxA, { subject: "algebra", history: [{ role: "student", content: "what's 2+2?" }] });
    assert.equal(r.ok, true);
    assert.match(r.result.text, /unavailable/);
  });

  it("constrains LLM via system prompt at hintLevel 1 (Socratic-only)", async () => {
    let capturedSys = "";
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async ({ messages }) => {
        capturedSys = messages?.[0]?.content || "";
        return { text: "What do you notice about both sides of the equation?" };
      }},
    };
    const r = await call("tutor-ask", ctx, {
      subject: "algebra", level: "8th grade", hintLevel: 1,
      history: [{ role: "student", content: "stuck on 2x+5=11" }],
    });
    assert.equal(r.ok, true);
    assert.match(r.result.text, /notice/i);
    assert.match(capturedSys, /Socratic|do not reveal/i);
    assert.equal(r.result.hintLevel, 1);
  });

  it("hintLevel 3 unlocks step-by-step walk-through", async () => {
    let capturedSys = "";
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async ({ messages }) => { capturedSys = messages?.[0]?.content || ""; return { text: "step" }; } },
    };
    await call("tutor-ask", ctx, { subject: "algebra", hintLevel: 3, history: [] });
    assert.match(capturedSys, /walk them through|next single step/i);
  });
});

describe("education.quiz-from-text + mint-deck", () => {
  it("rejects empty source + no DTU", async () => {
    const r = await call("quiz-from-text", { llm: { chat: async () => ({ text: "{}" }) } }, { source: "", count: 5 });
    assert.equal(r.ok, false);
  });

  it("generates N cards from text via utility brain (JSON output)", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({
        text: '```json\n{"cards":[{"front":"Q1?","back":"A1","difficulty":"easy"},{"front":"Q2?","back":"A2","difficulty":"medium"}]}\n```',
      }) },
    };
    const r = await call("quiz-from-text", ctx, { source: "Mitochondria are the powerhouse of the cell. ATP is the energy currency.", count: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.cards.length, 2);
    assert.equal(r.result.cards[0].front, "Q1?");
    assert.equal(r.result.cards[0].difficulty, "easy");
  });

  it("mint-deck creates deck + cards in one shot", () => {
    const r = call("quiz-mint-deck", ctxA, {
      title: "Bio basics",
      cards: [
        { front: "Q1", back: "A1" },
        { front: "Q2", back: "A2" },
        { front: "", back: "skipped" },  // dropped
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.added, 3);  // input count, not filtered
    const due = call("flashcards-due", ctxA, { deckId: r.result.deck.id });
    assert.equal(due.result.cards.length, 2);  // empty front dropped
  });

  it("mint-deck rejects empty cards array", () => {
    assert.equal(call("quiz-mint-deck", ctxA, { title: "x", cards: [] }).ok, false);
  });
});

describe("education.lesson-plan-generate", () => {
  it("rejects empty topic", async () => {
    const r = await call("lesson-plan-generate", { llm: { chat: async () => ({ text: "{}" }) } }, { topic: "" });
    assert.equal(r.ok, false);
  });

  it("parses LLM JSON output into structured plan", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({
        text: '{"plan":{"title":"Linear equations","subject":"Algebra I","grade":"8th","duration":"45 min","standards":["CCSS.8.EE.C.7"],"objectives":["solve 1-step","solve 2-step"],"materials":["whiteboard"],"warmUp":"3-min entry ticket","mainActivity":"think-pair-share on 2x+5=15","practice":"workbook 1.3","closure":"exit ticket","differentiation":{"struggling":"chips","grade_level":"as written","advanced":"systems"},"assessment":"quick quiz"}}',
      }) },
    };
    const r = await call("lesson-plan-generate", ctx, { subject: "Algebra I", grade: "8th", duration: "45 min", topic: "Linear equations" });
    assert.equal(r.ok, true);
    assert.equal(r.result.plan.title, "Linear equations");
    assert.equal(r.result.plan.objectives.length, 2);
    assert.ok(r.result.plan.differentiation.struggling);
    assert.ok(r.result.plan.assessment);
  });

  it("returns parse error on garbage LLM output", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: "I cannot help with that." }) },
    };
    const r = await call("lesson-plan-generate", ctx, { topic: "x" });
    assert.equal(r.ok, false);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("(carry on with at least one existing macro)", () => {
    // The pre-existing education domain registers complexityAnalysis-ish
    // analytical macros — just confirm registration count is plausible.
    assert.ok(ACTIONS.size > 12);
  });
});

// ── Full-app parity (Khan + Coursera 2026) ────────────────────────

describe("education.courses-* (CRUD + search)", () => {
  it("create / list / get / delete cycle, per-user scoped", () => {
    const a = call("courses-create", ctxA, { title: "Intro to ML", description: "fundamentals", category: "data", instructor: "Dr Sael" });
    assert.equal(a.ok, true);
    const id = a.result.course.id;
    assert.equal(call("courses-list", ctxA, {}).result.courses.length, 1);
    assert.equal(call("courses-list", ctxB, {}).result.courses.length, 0);
    assert.equal(call("courses-get", ctxA, { id }).result.course.title, "Intro to ML");
    assert.equal(call("courses-delete", ctxA, { id }).ok, true);
  });
  it("rejects empty title", () => {
    assert.equal(call("courses-create", ctxA, { title: "" }).ok, false);
  });
  it("search matches title / description / category / instructor", () => {
    call("courses-create", ctxA, { title: "Linear Algebra", category: "math" });
    call("courses-create", ctxA, { title: "Calculus II", category: "math" });
    call("courses-create", ctxA, { title: "Intro Biology", category: "science" });
    const r = call("courses-search", ctxA, { query: "math" });
    assert.equal(r.result.matches.length, 2);
  });
  it("list filters by category", () => {
    call("courses-create", ctxA, { title: "A", category: "math" });
    call("courses-create", ctxA, { title: "B", category: "science" });
    assert.equal(call("courses-list", ctxA, { category: "math" }).result.courses.length, 1);
  });
});

describe("education.lessons-* (within course)", () => {
  it("create + list + complete cycle, per-course", () => {
    const c = call("courses-create", ctxA, { title: "Course 1" });
    const cid = c.result.course.id;
    const l = call("lessons-create", ctxA, { courseId: cid, title: "Lesson 1", kind: "video", durationMin: 12 });
    assert.equal(l.ok, true);
    assert.equal(call("lessons-list", ctxA, { courseId: cid }).result.lessons.length, 1);
    const comp = call("lessons-complete", ctxA, { courseId: cid, lessonId: l.result.lesson.id });
    assert.equal(comp.ok, true);
    assert.equal(comp.result.pointsAwarded, 50);
  });
  it("rejects bad input", () => {
    assert.equal(call("lessons-create", ctxA, { courseId: "", title: "X" }).ok, false);
    assert.equal(call("lessons-list", ctxA, { courseId: "nope" }).ok, false);
  });
});

describe("education.enrollments-* (with progress calc)", () => {
  it("enroll / list / unenroll with progress %", () => {
    const c = call("courses-create", ctxA, { title: "C" });
    const cid = c.result.course.id;
    const l1 = call("lessons-create", ctxA, { courseId: cid, title: "L1" });
    const l2 = call("lessons-create", ctxA, { courseId: cid, title: "L2" });
    call("lessons-create", ctxA, { courseId: cid, title: "L3" });
    const e = call("enrollments-enroll", ctxA, { courseId: cid });
    assert.equal(e.ok, true);
    call("lessons-complete", ctxA, { courseId: cid, lessonId: l1.result.lesson.id });
    call("lessons-complete", ctxA, { courseId: cid, lessonId: l2.result.lesson.id });
    const list = call("enrollments-list", ctxA, {});
    assert.equal(list.result.enrollments[0].progressPct, 67);
    assert.equal(list.result.enrollments[0].completedLessons, 2);
    assert.equal(call("enrollments-unenroll", ctxA, { id: e.result.enrollment.id }).ok, true);
  });
  it("double-enroll rejected", () => {
    const c = call("courses-create", ctxA, { title: "C" });
    call("enrollments-enroll", ctxA, { courseId: c.result.course.id });
    assert.equal(call("enrollments-enroll", ctxA, { courseId: c.result.course.id }).ok, false);
  });
});

describe("education.skills-* (Khan-style mastery)", () => {
  it("practice success advances mastery: not_started -> attempted -> familiar -> proficient -> mastered", () => {
    const s = call("skills-create", ctxA, { name: "Pythagoras", subject: "math" });
    const id = s.result.skill.id;
    assert.equal(call("skills-practice", ctxA, { id, success: true }).result.skill.mastery, "attempted");
    assert.equal(call("skills-practice", ctxA, { id, success: true }).result.skill.mastery, "familiar");
    assert.equal(call("skills-practice", ctxA, { id, success: true }).result.skill.mastery, "proficient");
    const last = call("skills-practice", ctxA, { id, success: true });
    assert.equal(last.result.skill.mastery, "mastered");
    assert.equal(last.result.pointsAwarded, 200);
  });
  it("failed practice demotes one level (down to familiar)", () => {
    const s = call("skills-create", ctxA, { name: "X" });
    const id = s.result.skill.id;
    call("skills-practice", ctxA, { id, success: true });
    call("skills-practice", ctxA, { id, success: true });
    call("skills-practice", ctxA, { id, success: true });
    const fail = call("skills-practice", ctxA, { id, success: false });
    assert.equal(fail.result.skill.mastery, "familiar");
  });
  it("tree returns per-mastery-level counts", () => {
    call("skills-create", ctxA, { name: "A" });
    call("skills-create", ctxA, { name: "B" });
    const tree = call("skills-tree", ctxA, {});
    assert.equal(tree.result.counts.not_started, 2);
  });
});

describe("education.gamification-status (streaks + points + level)", () => {
  it("totals + streak + level from points/skills", () => {
    call("points-award", ctxA, { amount: 100, source: "test" });
    call("points-award", ctxA, { amount: 50, source: "test" });
    const s = call("skills-create", ctxA, { name: "X" });
    call("skills-practice", ctxA, { id: s.result.skill.id, success: true });
    call("skills-practice", ctxA, { id: s.result.skill.id, success: true });
    call("skills-practice", ctxA, { id: s.result.skill.id, success: true });
    const r = call("gamification-status", ctxA, {});
    assert.ok(r.result.totalPoints >= 150);
    assert.equal(r.result.streak, 1);
    assert.equal(r.result.level, 1);
    assert.equal(r.result.skillPoints, 1);
  });
});

describe("education.certificates-* (issue after course complete)", () => {
  it("blocks issue until all lessons completed", () => {
    const c = call("courses-create", ctxA, { title: "C", institution: "Concord U" });
    const cid = c.result.course.id;
    const l1 = call("lessons-create", ctxA, { courseId: cid, title: "L1" });
    call("lessons-create", ctxA, { courseId: cid, title: "L2" });
    const r1 = call("certificates-issue", ctxA, { courseId: cid });
    assert.equal(r1.ok, false);
    call("lessons-complete", ctxA, { courseId: cid, lessonId: l1.result.lesson.id });
    const r2 = call("certificates-issue", ctxA, { courseId: cid });
    assert.equal(r2.ok, false);
  });
  it("issues certificate with verification code when course complete", () => {
    const c = call("courses-create", ctxA, { title: "C" });
    const cid = c.result.course.id;
    const l = call("lessons-create", ctxA, { courseId: cid, title: "L1" });
    call("lessons-complete", ctxA, { courseId: cid, lessonId: l.result.lesson.id });
    const cert = call("certificates-issue", ctxA, { courseId: cid });
    assert.equal(cert.ok, true);
    assert.match(cert.result.certificate.verificationCode, /^CERT-/);
  });
});

describe("education.assignments-* (Coursera-style with peer review)", () => {
  it("create / submit / peer-review cycle", () => {
    const c = call("courses-create", ctxA, { title: "C" });
    const a = call("assignments-create", ctxA, { courseId: c.result.course.id, title: "A1", peerReviewCount: 3, maxPoints: 100 });
    assert.equal(a.ok, true);
    const sub = call("assignments-submit", ctxA, { assignmentId: a.result.assignment.id, text: "my answer" });
    assert.equal(sub.result.submission.status, "awaiting_peer_review");
    const review = call("assignments-peer-review", ctxA, { submissionId: sub.result.submission.id, score: 85, feedback: "good" });
    assert.equal(review.result.submission.peerReviews.length, 1);
    assert.equal(review.result.submission.peerReviews[0].score, 85);
  });
  it("rejects missing fields", () => {
    assert.equal(call("assignments-submit", ctxA, { assignmentId: "x", text: "" }).ok, false);
    assert.equal(call("assignments-peer-review", ctxA, { submissionId: "", feedback: "x" }).ok, false);
  });
});

describe("education.notes-* (per-lesson with video timestamp)", () => {
  it("save / list / delete cycle, scoped by lessonId", () => {
    const n = call("notes-save", ctxA, { lessonId: "less_1", text: "important", timestampSec: 142 });
    assert.equal(n.ok, true);
    assert.equal(n.result.note.videoTimestampSec, 142);
    assert.equal(call("notes-list", ctxA, { lessonId: "less_1" }).result.notes.length, 1);
    assert.equal(call("notes-list", ctxA, { lessonId: "less_2" }).result.notes.length, 0);
    assert.equal(call("notes-delete", ctxA, { id: n.result.note.id }).ok, true);
  });
});

describe("education.discussions-* (forums)", () => {
  it("post / list / upvote / reply", () => {
    const p = call("discussions-post", ctxA, { courseId: "c_1", text: "How does X work?" });
    assert.equal(p.ok, true);
    call("discussions-post", ctxA, { courseId: "c_1", text: "Like this!", replyTo: p.result.post.id });
    assert.equal(call("discussions-list", ctxA, { courseId: "c_1" }).result.discussions.length, 2);
    const up = call("discussions-upvote", ctxA, { id: p.result.post.id });
    assert.equal(up.result.upvotes, 1);
  });
});

describe("education.dashboard-summary (ClassroomShell data source)", () => {
  it("aggregates courses + enrollments + skills + certs + points", () => {
    const c = call("courses-create", ctxA, { title: "C" });
    const l = call("lessons-create", ctxA, { courseId: c.result.course.id, title: "L" });
    call("enrollments-enroll", ctxA, { courseId: c.result.course.id });
    call("lessons-complete", ctxA, { courseId: c.result.course.id, lessonId: l.result.lesson.id });
    const sk = call("skills-create", ctxA, { name: "S" });
    call("skills-practice", ctxA, { id: sk.result.skill.id, success: true });
    call("skills-practice", ctxA, { id: sk.result.skill.id, success: true });
    call("skills-practice", ctxA, { id: sk.result.skill.id, success: true });
    const r = call("dashboard-summary", ctxA, {});
    assert.equal(r.result.totalCourses, 1);
    assert.equal(r.result.enrolledCount, 1);
    assert.equal(r.result.completedLessons, 1);
    assert.equal(r.result.totalSkills, 1);
    assert.equal(r.result.proficientSkills, 1);
    assert.ok(r.result.totalPoints > 0);
    assert.equal(r.result.streak, 1);
  });
});

// ── Parity backlog — video / exercises / paths / cohorts / mastery / Q&A ──

describe("education.video-* (progress scrubbing + transcript)", () => {
  it("progress-save accrues watched seconds forward-only, scrub-back does not inflate", () => {
    call("video-progress-save", ctxA, { lessonId: "less_v", positionSec: 0, durationSec: 100 });
    const r1 = call("video-progress-save", ctxA, { lessonId: "less_v", positionSec: 20, durationSec: 100 });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.watchedSec, 20);
    // Scrub backward — watched does not increase
    const r2 = call("video-progress-save", ctxA, { lessonId: "less_v", positionSec: 5, durationSec: 100 });
    assert.equal(r2.result.watchedSec, 20);
    assert.equal(r2.result.positionSec, 5);
  });
  it("progress-get returns zeroed state for unknown lesson", () => {
    const r = call("video-progress-get", ctxA, { lessonId: "never" });
    assert.equal(r.ok, true);
    assert.equal(r.result.watchedSec, 0);
    assert.equal(r.result.completed, false);
  });
  it("transcript save (sorted) + get, rejects empty cues", () => {
    assert.equal(call("video-transcript-save", ctxA, { lessonId: "less_v", cues: [] }).ok, false);
    const save = call("video-transcript-save", ctxA, {
      lessonId: "less_v",
      cues: [{ sec: 30, text: "second" }, { sec: 5, text: "first" }],
    });
    assert.equal(save.ok, true);
    assert.equal(save.result.cueCount, 2);
    const get = call("video-transcript-get", ctxA, { lessonId: "less_v" });
    assert.equal(get.result.cues[0].text, "first");
    assert.equal(get.result.cues[1].sec, 30);
  });
  it("video macros require lessonId", () => {
    assert.equal(call("video-progress-save", ctxA, {}).ok, false);
    assert.equal(call("video-transcript-get", ctxA, {}).ok, false);
  });
});

describe("education.exercises-* (auto-grading + 3-tier hints + mastery loop)", () => {
  it("create rejects steps without prompt+answer", () => {
    assert.equal(call("exercises-create", ctxA, { title: "X", steps: [{ prompt: "", answer: "" }] }).ok, false);
  });
  it("exercises-list strips answer keys", () => {
    call("exercises-create", ctxA, {
      title: "Math drill",
      steps: [{ prompt: "2+2?", type: "numeric", answer: "4" }],
    });
    const list = call("exercises-list", ctxA, {});
    assert.equal(list.result.exercises.length, 1);
    assert.equal(list.result.exercises[0].answer, undefined);
    assert.equal(list.result.exercises[0].stepCount, 1);
  });
  it("auto-grades numeric with tolerance", () => {
    const e = call("exercises-create", ctxA, {
      title: "T", steps: [{ prompt: "pi?", type: "numeric", answer: "3.14", tolerance: 0.01 }],
    });
    const id = e.result.exercise.id;
    assert.equal(call("exercises-submit", ctxA, { exerciseId: id, stepId: "step_1", answer: "3.145" }).result.correct, true);
    assert.equal(call("exercises-submit", ctxA, { exerciseId: id, stepId: "step_1", answer: "3.5" }).result.correct, false);
  });
  it("auto-grades text accepting pipe-delimited alternatives, case-insensitive", () => {
    const e = call("exercises-create", ctxA, {
      title: "T", steps: [{ prompt: "color?", type: "text", answer: "red|crimson" }],
    });
    const id = e.result.exercise.id;
    assert.equal(call("exercises-submit", ctxA, { exerciseId: id, stepId: "step_1", answer: "CRIMSON" }).result.correct, true);
  });
  it("hint escalation never returns the answer", () => {
    const e = call("exercises-create", ctxA, {
      title: "T", steps: [{ prompt: "q", type: "text", answer: "secret", hints: ["nudge 1", "nudge 2"] }],
    });
    const id = e.result.exercise.id;
    const h0 = call("exercises-hint", ctxA, { exerciseId: id, stepId: "step_1", hintIndex: 0 });
    assert.equal(h0.result.hint, "nudge 1");
    assert.equal(h0.result.hintsRemaining, 1);
    const h1 = call("exercises-hint", ctxA, { exerciseId: id, stepId: "step_1", hintIndex: 1 });
    assert.equal(h1.result.hint, "nudge 2");
    assert.equal(h1.result.hintsRemaining, 0);
  });
  it("3 correct in a row bumps the linked skill mastery (Khan mastery loop)", () => {
    const sk = call("skills-create", ctxA, { name: "Linked" });
    const skillId = sk.result.skill.id;
    const e = call("exercises-create", ctxA, {
      title: "Drill", skillId,
      steps: [{ prompt: "q", type: "text", answer: "a" }],
    });
    const id = e.result.exercise.id;
    call("exercises-submit", ctxA, { exerciseId: id, stepId: "step_1", answer: "a" });
    call("exercises-submit", ctxA, { exerciseId: id, stepId: "step_1", answer: "a" });
    const third = call("exercises-submit", ctxA, { exerciseId: id, stepId: "step_1", answer: "a" });
    assert.equal(third.result.masteryBumped, true);
    assert.equal(third.result.streak, 3);
    const tree = call("skills-tree", ctxA, {});
    assert.equal(tree.result.skills.find(k => k.id === skillId).mastery, "attempted");
  });
  it("wrong answer resets the streak", () => {
    const e = call("exercises-create", ctxA, { title: "T", steps: [{ prompt: "q", type: "text", answer: "a" }] });
    const id = e.result.exercise.id;
    call("exercises-submit", ctxA, { exerciseId: id, stepId: "step_1", answer: "a" });
    const miss = call("exercises-submit", ctxA, { exerciseId: id, stepId: "step_1", answer: "wrong" });
    assert.equal(miss.result.correct, false);
    assert.equal(miss.result.streak, 0);
  });
});

describe("education.paths-* (prerequisite sequencing across courses)", () => {
  it("create rejects empty title or no courses", () => {
    assert.equal(call("paths-create", ctxA, { title: "", courseIds: ["c1"] }).ok, false);
    assert.equal(call("paths-create", ctxA, { title: "X", courseIds: [] }).ok, false);
  });
  it("steps unlock only when the prior course is fully complete", () => {
    const c1 = call("courses-create", ctxA, { title: "C1" });
    const c2 = call("courses-create", ctxA, { title: "C2" });
    const l1 = call("lessons-create", ctxA, { courseId: c1.result.course.id, title: "L1" });
    call("lessons-create", ctxA, { courseId: c2.result.course.id, title: "L2" });
    call("paths-create", ctxA, { title: "Track", courseIds: [c1.result.course.id, c2.result.course.id] });
    let p = call("paths-list", ctxA, {}).result.paths[0];
    assert.equal(p.steps[0].unlocked, true);
    assert.equal(p.steps[1].unlocked, false);
    // Complete course 1
    call("lessons-complete", ctxA, { courseId: c1.result.course.id, lessonId: l1.result.lesson.id });
    p = call("paths-list", ctxA, {}).result.paths[0];
    assert.equal(p.steps[0].courseComplete, true);
    assert.equal(p.steps[1].unlocked, true);
    assert.equal(p.completedSteps, 1);
  });
  it("reorder accepts only a permutation of the path's courses", () => {
    const c1 = call("courses-create", ctxA, { title: "C1" });
    const c2 = call("courses-create", ctxA, { title: "C2" });
    const created = call("paths-create", ctxA, { title: "T", courseIds: [c1.result.course.id, c2.result.course.id] });
    const id = created.result.path.id;
    const bad = call("paths-reorder", ctxA, { id, courseIds: ["nope", "alsono"] });
    assert.equal(bad.ok, false);
    const good = call("paths-reorder", ctxA, { id, courseIds: [c2.result.course.id, c1.result.course.id] });
    assert.equal(good.ok, true);
    assert.equal(good.result.path.courseIds[0], c2.result.course.id);
  });
  it("delete removes the path", () => {
    const c = call("courses-create", ctxA, { title: "C" });
    const p = call("paths-create", ctxA, { title: "T", courseIds: [c.result.course.id] });
    assert.equal(call("paths-delete", ctxA, { id: p.result.path.id }).ok, true);
    assert.equal(call("paths-list", ctxA, {}).result.paths.length, 0);
  });
});

describe("education.cohorts-* (live classroom sessions)", () => {
  it("create requires title + instructor", () => {
    assert.equal(call("cohorts-create", ctxA, { title: "X" }).ok, false);
    assert.equal(call("cohorts-create", ctxA, { instructor: "Y" }).ok, false);
  });
  it("join / leave roster with capacity enforcement", () => {
    const c = call("cohorts-create", ctxA, { title: "Live 1", instructor: "Dr X", capacity: 2 });
    const id = c.result.cohort.id;
    assert.equal(call("cohorts-join", ctxA, { id, learner: "alice" }).ok, true);
    assert.equal(call("cohorts-join", ctxA, { id, learner: "bob" }).ok, true);
    // Capacity reached
    assert.equal(call("cohorts-join", ctxA, { id, learner: "carol" }).ok, false);
    // Duplicate join rejected
    assert.equal(call("cohorts-join", ctxA, { id, learner: "alice" }).ok, false);
    const left = call("cohorts-leave", ctxA, { id, learner: "bob" });
    assert.equal(left.ok, true);
    assert.equal(left.result.cohort.roster.length, 1);
  });
  it("instructor transitions scheduled -> live -> ended", () => {
    const c = call("cohorts-create", ctxA, { title: "L", instructor: "I" });
    const id = c.result.cohort.id;
    assert.equal(call("cohorts-set-status", ctxA, { id, status: "live" }).result.cohort.status, "live");
    const ended = call("cohorts-set-status", ctxA, { id, status: "ended" });
    assert.equal(ended.result.cohort.status, "ended");
    assert.ok(ended.result.cohort.endedAt);
    // Can't join an ended cohort
    assert.equal(call("cohorts-join", ctxA, { id, learner: "z" }).ok, false);
  });
  it("rejects invalid status", () => {
    const c = call("cohorts-create", ctxA, { title: "L", instructor: "I" });
    assert.equal(call("cohorts-set-status", ctxA, { id: c.result.cohort.id, status: "bogus" }).ok, false);
  });
});

describe("education.mastery-dashboard (knowledge-state per skill)", () => {
  it("aggregates skill mastery, streak, videos, exercise streak", () => {
    const sk = call("skills-create", ctxA, { name: "Algebra", subject: "math" });
    call("skills-practice", ctxA, { id: sk.result.skill.id, success: true });
    call("skills-practice", ctxA, { id: sk.result.skill.id, success: true });
    call("video-progress-save", ctxA, { lessonId: "less_d", positionSec: 0, durationSec: 100 });
    call("video-progress-save", ctxA, { lessonId: "less_d", positionSec: 95, durationSec: 100 });
    const r = call("mastery-dashboard", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSkills, 1);
    assert.equal(r.result.skillStates[0].name, "Algebra");
    assert.ok(r.result.skillStates[0].masteryScore > 0);
    assert.equal(r.result.activity.length, 30);
    assert.equal(r.result.subjects[0].subject, "math");
  });
  it("returns zeroed report when no skills", () => {
    const r = call("mastery-dashboard", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSkills, 0);
    assert.equal(r.result.overallMastery, 0);
  });
});

describe("education.lesson-qa-* (timestamp-anchored Q&A)", () => {
  it("ask requires lessonId + text", () => {
    assert.equal(call("lesson-qa-ask", ctxA, { lessonId: "", text: "q" }).ok, false);
    assert.equal(call("lesson-qa-ask", ctxA, { lessonId: "l", text: "" }).ok, false);
  });
  it("ask anchors to a timestamp; list sorts by timestamp", () => {
    call("lesson-qa-ask", ctxA, { lessonId: "less_q", text: "later q", timestampSec: 120 });
    call("lesson-qa-ask", ctxA, { lessonId: "less_q", text: "early q", timestampSec: 10 });
    const list = call("lesson-qa-list", ctxA, { lessonId: "less_q" });
    assert.equal(list.result.threads.length, 2);
    assert.equal(list.result.threads[0].timestampSec, 10);
    assert.equal(list.result.threads[0].text, "early q");
  });
  it("answer + accept resolves the thread; one accepted answer", () => {
    const q = call("lesson-qa-ask", ctxA, { lessonId: "less_q", text: "how?", timestampSec: 5 });
    const threadId = q.result.thread.id;
    const a1 = call("lesson-qa-answer", ctxA, { threadId, text: "answer one" });
    call("lesson-qa-answer", ctxA, { threadId, text: "answer two" });
    const ansId = a1.result.thread.answers[0].id;
    const accepted = call("lesson-qa-accept", ctxA, { threadId, answerId: ansId });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.result.thread.resolved, true);
    const acceptedCount = accepted.result.thread.answers.filter(a => a.accepted).length;
    assert.equal(acceptedCount, 1);
  });
  it("upvote targets thread or a specific answer", () => {
    const q = call("lesson-qa-ask", ctxA, { lessonId: "less_q", text: "q", timestampSec: 0 });
    const threadId = q.result.thread.id;
    const a = call("lesson-qa-answer", ctxA, { threadId, text: "ans" });
    const tUp = call("lesson-qa-upvote", ctxA, { threadId });
    assert.equal(tUp.result.upvotes, 1);
    assert.equal(tUp.result.target, "thread");
    const aUp = call("lesson-qa-upvote", ctxA, { threadId, answerId: a.result.thread.answers[0].id });
    assert.equal(aUp.result.upvotes, 1);
    assert.equal(aUp.result.target, "answer");
  });
});
