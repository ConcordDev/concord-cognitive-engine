// Phase CB5 — trivia tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  authorQuestion, startSession, submitAnswer, tallySession, listQuestions,
} from "../lib/trivia.js";
import { up as upTrivia } from "../migrations/249_trivia.js";

function freshDb() { const db = new Database(":memory:"); upTrivia(db); return db; }

describe("Phase CB5 — trivia (DTU-native)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("authorQuestion stores DTU + answer references", () => {
    const r = authorQuestion(db, {
      dtuId: "dtu-q1",
      questionText: "Who founded tunya?",
      answerDtuId: "dtu-asha-founder",
      difficulty: 3,
      createdBy: "u1",
    });
    assert.equal(r.ok, true);
    const list = listQuestions(db);
    assert.equal(list.length, 1);
    assert.equal(list[0].difficulty, 3);
  });

  it("missing inputs rejected", () => {
    const r = authorQuestion(db, { dtuId: "x", questionText: "?" });
    assert.equal(r.ok, false);
  });

  it("submitAnswer correct cite → isCorrect:true + difficulty points", () => {
    authorQuestion(db, {
      dtuId: "dtu-q1", questionText: "Q?", answerDtuId: "dtu-a1",
      difficulty: 2, createdBy: "u1",
    });
    const qId = listQuestions(db)[0].id;
    const session = startSession(db, "u1", { questionIds: [qId] });
    const sub = submitAnswer(db, session.sessionId, "u2", {
      questionId: qId, citedDtuId: "dtu-a1",
    });
    assert.equal(sub.isCorrect, true);
    assert.equal(sub.points, 2);
  });

  it("wrong cite → isCorrect:false + zero points", () => {
    authorQuestion(db, {
      dtuId: "dtu-q1", questionText: "Q?", answerDtuId: "dtu-a1",
      difficulty: 3, createdBy: "u1",
    });
    const qId = listQuestions(db)[0].id;
    const session = startSession(db, "u1", { questionIds: [qId] });
    const sub = submitAnswer(db, session.sessionId, "u2", {
      questionId: qId, citedDtuId: "dtu-wrong",
    });
    assert.equal(sub.isCorrect, false);
    assert.equal(sub.points, 0);
  });

  it("re-submit same (session, question, user) rejected", () => {
    authorQuestion(db, {
      dtuId: "dtu-q1", questionText: "Q?", answerDtuId: "dtu-a1",
      difficulty: 1, createdBy: "u1",
    });
    const qId = listQuestions(db)[0].id;
    const session = startSession(db, "u1", { questionIds: [qId] });
    submitAnswer(db, session.sessionId, "u2", { questionId: qId, citedDtuId: "dtu-a1" });
    const second = submitAnswer(db, session.sessionId, "u2", { questionId: qId, citedDtuId: "dtu-a1" });
    assert.equal(second.ok, false);
    assert.equal(second.error, "already_submitted");
  });

  it("tallySession sums per-user difficulty across correct subs", () => {
    authorQuestion(db, { dtuId: "q1", questionText: "?", answerDtuId: "a1", difficulty: 3, createdBy: "u1" });
    authorQuestion(db, { dtuId: "q2", questionText: "?", answerDtuId: "a2", difficulty: 5, createdBy: "u1" });
    const qIds = listQuestions(db).map(q => q.id);
    const session = startSession(db, "u1", { questionIds: qIds });
    submitAnswer(db, session.sessionId, "u2", { questionId: qIds[0], citedDtuId: "a1" });  // +3
    submitAnswer(db, session.sessionId, "u2", { questionId: qIds[1], citedDtuId: "a2" });  // +5
    submitAnswer(db, session.sessionId, "u3", { questionId: qIds[0], citedDtuId: "wrong" }); // 0
    const tally = tallySession(db, session.sessionId);
    assert.equal(tally.scoreboard.u2, 8);
    assert.equal(tally.scoreboard.u3 || 0, 0);
  });
});
