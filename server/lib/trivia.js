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
    const rows = db.prepare(`
      SELECT id, dtu_id, question_text, difficulty, created_by, created_at
      FROM trivia_questions ${filter}
      ORDER BY created_at DESC LIMIT ?
    `).all(...args);
    // T1.2 — attach answer CHOICES so the kiosk is a playable multiple-choice
    // quiz instead of asking the player to type a raw DTU id (which no human
    // could know). Correctness is still cited_dtu_id === answer_dtu_id.
    if (opts.withChoices !== false) {
      for (const q of rows) q.choices = getAnswerChoices(db, q.id, { count: opts.choiceCount || 4 });
    }
    return rows;
  } catch { return []; }
}

/**
 * T1.2 — build a multiple-choice set for a question: the correct answer DTU
 * plus distractor DTUs (preferring other trivia answers so every option reads
 * like a plausible answer), each { dtuId, title }. Deterministically ordered by
 * the question id so the layout is stable across reloads. Returns [] if the
 * answer DTU can't be resolved.
 */
export function getAnswerChoices(db, questionId, { count = 4 } = {}) {
  if (!db || !questionId) return [];
  let q;
  try { q = db.prepare(`SELECT answer_dtu_id FROM trivia_questions WHERE id = ?`).get(questionId); }
  catch { return []; }
  if (!q?.answer_dtu_id) return [];

  const titleOf = (id) => {
    try { return db.prepare(`SELECT title FROM dtus WHERE id = ?`).get(id)?.title || null; } catch { return null; }
  };
  const answerTitle = titleOf(q.answer_dtu_id) || `Answer ${String(q.answer_dtu_id).slice(0, 8)}`;
  const choices = [{ dtuId: q.answer_dtu_id, title: answerTitle }];

  // Distractors: other trivia answer DTUs with titles, then any titled DTU.
  let distractors = [];
  try {
    distractors = db.prepare(`
      SELECT DISTINCT d.id AS dtuId, d.title AS title
      FROM trivia_questions tq JOIN dtus d ON d.id = tq.answer_dtu_id
      WHERE tq.answer_dtu_id != ? AND d.title IS NOT NULL AND d.title != ''
      LIMIT 40
    `).all(q.answer_dtu_id);
  } catch { distractors = []; }
  if (distractors.length < count - 1) {
    try {
      const more = db.prepare(`
        SELECT id AS dtuId, title FROM dtus
        WHERE id != ? AND title IS NOT NULL AND title != ''
        LIMIT 40
      `).all(q.answer_dtu_id);
      const seen = new Set(distractors.map((d) => d.dtuId));
      for (const m of more) if (!seen.has(m.dtuId)) { distractors.push(m); seen.add(m.dtuId); }
    } catch { /* dtus optional */ }
  }

  // Deterministic pick + shuffle keyed by the question id.
  const seed = crypto.createHash("sha1").update(questionId).digest();
  distractors.sort((a, b) => String(a.dtuId).localeCompare(String(b.dtuId)));
  let cursor = seed[0];
  while (choices.length < count && distractors.length > 0) {
    const idx = cursor % distractors.length;
    const d = distractors.splice(idx, 1)[0];
    choices.push({ dtuId: d.dtuId, title: d.title });
    cursor = (cursor * 31 + 7) & 0xff;
  }

  // Deterministic order so the answer isn't always first.
  for (let i = choices.length - 1; i > 0; i--) {
    const j = seed[(i + 3) % seed.length] % (i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}
