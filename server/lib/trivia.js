// server/lib/trivia.js
//
// Phase CB5 — DTU-native trivia.
//
// Questions are DTUs. The DTU's claim IS the answer; the question is
// the prompt. submitAnswer accepts a cited DTU id; correctness =
// (cited_dtu_id === answer_dtu_id). The royalty cascade fires
// naturally when the player cites the answer (existing path).

import crypto from "node:crypto";
import logger from "../logger.js";

export function authorQuestion(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { dtuId, questionText, answerDtuId, difficulty = 1, createdBy } = opts;
  if (!dtuId || !questionText || !answerDtuId || !createdBy) {
    return { ok: false, error: "missing_inputs" };
  }
  try {
    const id = `trq_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO trivia_questions
        (id, dtu_id, question_text, answer_dtu_id, difficulty, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, dtuId, questionText, answerDtuId,
      Math.max(1, Math.min(5, Math.floor(Number(difficulty) || 1))), createdBy);
    return { ok: true, questionId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function startSession(db, hostUserId, opts = {}) {
  if (!db || !hostUserId) return { ok: false, error: "missing_inputs" };
  const { worldId, questionIds = [] } = opts;
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    return { ok: false, error: "no_questions" };
  }
  try {
    const id = `trs_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO trivia_sessions (id, host_user_id, world_id, question_ids)
      VALUES (?, ?, ?, ?)
    `).run(id, hostUserId, worldId || null, JSON.stringify(questionIds));
    return { ok: true, sessionId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function submitAnswer(db, sessionId, userId, opts = {}) {
  if (!db || !sessionId || !userId) return { ok: false, error: "missing_inputs" };
  const { questionId, citedDtuId } = opts;
  if (!questionId || !citedDtuId) return { ok: false, error: "missing_inputs" };

  try {
    const session = db.prepare(`SELECT ended_at, question_ids FROM trivia_sessions WHERE id = ?`).get(sessionId);
    if (!session) return { ok: false, error: "no_session" };
    if (session.ended_at) return { ok: false, error: "session_ended" };

    const q = db.prepare(`SELECT answer_dtu_id, difficulty FROM trivia_questions WHERE id = ?`).get(questionId);
    if (!q) return { ok: false, error: "no_question" };

    const isCorrect = citedDtuId === q.answer_dtu_id;
    try {
      db.prepare(`
        INSERT INTO trivia_submissions
          (session_id, question_id, user_id, cited_dtu_id, is_correct)
        VALUES (?, ?, ?, ?, ?)
      `).run(sessionId, questionId, userId, citedDtuId, isCorrect ? 1 : 0);
    } catch (err) {
      if (String(err?.message || "").includes("UNIQUE")) {
        return { ok: false, error: "already_submitted" };
      }
      throw err;
    }
    return { ok: true, isCorrect, points: isCorrect ? q.difficulty : 0 };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function tallySession(db, sessionId) {
  if (!db || !sessionId) return null;
  try {
    const session = db.prepare(`SELECT * FROM trivia_sessions WHERE id = ?`).get(sessionId);
    if (!session) return null;
    const subs = db.prepare(`
      SELECT s.user_id, s.is_correct, q.difficulty
      FROM trivia_submissions s JOIN trivia_questions q ON q.id = s.question_id
      WHERE s.session_id = ?
    `).all(sessionId);
    const scoreboard = {};
    for (const s of subs) {
      if (!scoreboard[s.user_id]) scoreboard[s.user_id] = 0;
      if (s.is_correct) scoreboard[s.user_id] += (q => q.difficulty)(s);
    }
    // Persist + close session.
    try {
      db.prepare(`
        UPDATE trivia_sessions SET ended_at = unixepoch(), score_board = ?
        WHERE id = ?
      `).run(JSON.stringify(scoreboard), sessionId);
    } catch { /* best-effort */ }
    return { sessionId, scoreboard, submissions: subs.length };
  } catch (err) {
    logger.warn?.("trivia", "tally_failed", { error: err?.message });
    return null;
  }
}

export function listQuestions(db, opts = {}) {
  if (!db) return [];
  try {
    const limit = Math.max(1, Math.min(200, opts.limit || 50));
    const filter = opts.difficulty ? `WHERE difficulty = ?` : ``;
    const args = opts.difficulty ? [opts.difficulty, limit] : [limit];
    return db.prepare(`
      SELECT id, dtu_id, question_text, difficulty, created_by, created_at
      FROM trivia_questions ${filter}
      ORDER BY created_at DESC LIMIT ?
    `).all(...args);
  } catch { return []; }
}
