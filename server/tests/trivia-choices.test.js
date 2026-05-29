/**
 * T1.2 — trivia is now a playable multiple-choice quiz. getAnswerChoices returns
 * the correct answer DTU plus distractor DTUs (by title), so the kiosk shows
 * pickable options instead of asking the player to type a raw DTU id (which was
 * unwinnable). Correctness is still cited_dtu_id === answer_dtu_id.
 *
 * Run: node --test tests/trivia-choices.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { authorQuestion, getAnswerChoices, listQuestions, submitAnswer, startSession } from "../lib/trivia.js";
import { up as upTrivia } from "../migrations/249_trivia.js";

function freshDb() {
  const db = new Database(":memory:");
  upTrivia(db);
  // minimal dtus table (id + title) — the choices generator reads titles here
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT);`);
  return db;
}

function seedAnswerDtus(db, n) {
  for (let i = 0; i < n; i++) db.prepare(`INSERT INTO dtus (id, title) VALUES (?, ?)`).run(`dtu_${i}`, `Answer Title ${i}`);
}

describe("T1.2 — getAnswerChoices", () => {
  it("includes the correct answer and fills up to count", () => {
    const db = freshDb();
    seedAnswerDtus(db, 6);
    // 6 questions whose answers are the 6 dtus → plausible distractors exist
    for (let i = 0; i < 6; i++) authorQuestion(db, { dtuId: `dtu_${i}`, questionText: `Q${i}?`, answerDtuId: `dtu_${i}`, difficulty: 2, createdBy: "u1" });
    const q = listQuestions(db, { limit: 1 })[0];
    const choices = getAnswerChoices(db, q.id, { count: 4 });
    assert.equal(choices.length, 4);
    assert.ok(choices.some((c) => c.dtuId === q.dtu_id || c.dtuId), "choices carry dtu ids");
    // the correct answer for this question must be present
    const answerId = db.prepare(`SELECT answer_dtu_id FROM trivia_questions WHERE id = ?`).get(q.id).answer_dtu_id;
    assert.ok(choices.some((c) => c.dtuId === answerId), "the correct answer is among the choices");
    // each choice has a title
    assert.ok(choices.every((c) => typeof c.title === "string" && c.title.length > 0));
  });

  it("is deterministic across calls (stable layout)", () => {
    const db = freshDb();
    seedAnswerDtus(db, 6);
    for (let i = 0; i < 6; i++) authorQuestion(db, { dtuId: `dtu_${i}`, questionText: `Q${i}?`, answerDtuId: `dtu_${i}`, difficulty: 2, createdBy: "u1" });
    const q = listQuestions(db, { limit: 1 })[0];
    assert.deepEqual(getAnswerChoices(db, q.id), getAnswerChoices(db, q.id));
  });

  it("listQuestions attaches choices by default", () => {
    const db = freshDb();
    seedAnswerDtus(db, 4);
    for (let i = 0; i < 4; i++) authorQuestion(db, { dtuId: `dtu_${i}`, questionText: `Q${i}?`, answerDtuId: `dtu_${i}`, difficulty: 1, createdBy: "u1" });
    const qs = listQuestions(db, { limit: 10 });
    assert.ok(qs.every((q) => Array.isArray(q.choices) && q.choices.length >= 1));
  });

  it("picking the answer choice scores correct end-to-end", () => {
    const db = freshDb();
    seedAnswerDtus(db, 4);
    for (let i = 0; i < 4; i++) authorQuestion(db, { dtuId: `dtu_${i}`, questionText: `Q${i}?`, answerDtuId: `dtu_${i}`, difficulty: 1, createdBy: "u1" });
    const q = listQuestions(db, { limit: 1 })[0];
    const answerId = db.prepare(`SELECT answer_dtu_id FROM trivia_questions WHERE id = ?`).get(q.id).answer_dtu_id;
    const sess = startSession(db, "u1", { worldId: "w", questionIds: [q.id] });
    const correctChoice = q.choices.find((c) => c.dtuId === answerId);
    const res = submitAnswer(db, sess.sessionId, "u1", { questionId: q.id, citedDtuId: correctChoice.dtuId });
    assert.equal(res.isCorrect, true);
  });

  it("degrades gracefully when no dtus table exists (guarded)", () => {
    const db = new Database(":memory:");
    upTrivia(db); // no dtus table
    authorQuestion(db, { dtuId: "a", questionText: "?", answerDtuId: "a", difficulty: 1, createdBy: "u1" });
    const q = listQuestions(db, { limit: 1 })[0];
    const choices = getAnswerChoices(db, q.id);
    // at least the answer itself, with a fallback title
    assert.ok(choices.length >= 1);
    assert.equal(choices[0].dtuId, "a");
  });
});
