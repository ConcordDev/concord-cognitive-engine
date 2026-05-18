// server/routes/learning-rebuild.js
//
// Smoking-gun cleanup C1 — Education lens rebuild. Implements the
// 20 /api/learning/* endpoints the lens page calls but the server
// never had. Backed by migration 232.
//
// Endpoints (verified missing pre-this-commit):
//   POST   /api/learning/assessment/generate
//   POST   /api/learning/assessment/grade
//   POST   /api/learning/cohort/form
//   GET    /api/learning/cohort/match
//   GET    /api/learning/cohort/mine
//   POST   /api/learning/cohort/teach
//   GET    /api/learning/credential/me
//   GET    /api/learning/dtus/search
//   GET    /api/learning/earnings/me
//   GET    /api/learning/frontier
//   GET    /api/learning/genome
//   GET    /api/learning/genome/graph
//   POST   /api/learning/interaction
//   GET    /api/learning/leaderboard
//   GET    /api/learning/path
//   GET    /api/learning/rates
//   GET    /api/learning/submissions/mine
//   POST   /api/learning/submit
//   POST   /api/learning/tutor/ask
//   POST   /api/learning/tutor/socratic

import { randomUUID } from "node:crypto";
import express from "express";

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _gradeLetter(score) {
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 67) return "D+";
  if (score >= 63) return "D";
  if (score >= 60) return "D-";
  return "F";
}

export default function createLearningRebuildRoutes({ STATE, requireAuth }) {
  const router = express.Router();

  // ─── Assessments ─────────────────────────────────────────────────

  // POST /api/learning/assessment/generate — create an assessment
  router.post("/assessment/generate", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const { title, topic, difficulty, kind, questions } = req.body || {};
    if (!title || !topic) return res.status(400).json({ ok: false, error: "title_and_topic_required" });
    if (!Array.isArray(questions) || questions.length === 0) return res.status(400).json({ ok: false, error: "questions_required" });
    const id = `assess:${randomUUID()}`;
    const totalPoints = questions.reduce((s, q) => s + (Number(q.points) || 10), 0);
    try {
      db.prepare(`
        INSERT INTO learning_assessments (id, title, topic, difficulty, kind, questions_json, total_points, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id,
        String(title).slice(0, 200),
        String(topic).slice(0, 200),
        ["easy","medium","hard","expert"].includes(difficulty) ? difficulty : "medium",
        ["quiz","exam","project","reflection","oral"].includes(kind) ? kind : "quiz",
        JSON.stringify(questions),
        totalPoints,
        userId, _now());
      res.json({ ok: true, id, totalPoints });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/learning/assessment/grade — grade a submission
  router.post("/assessment/grade", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const { submissionId, score, feedback } = req.body || {};
    if (!submissionId || !Number.isFinite(Number(score))) return res.status(400).json({ ok: false, error: "submissionId_and_score_required" });
    const clamped = Math.max(0, Math.min(100, Number(score)));
    const letter = _gradeLetter(clamped);
    try {
      const sub = db.prepare(`SELECT student_user_id, assessment_id FROM learning_submissions WHERE id = ?`).get(submissionId);
      if (!sub) return res.status(404).json({ ok: false, error: "submission_not_found" });
      db.prepare(`UPDATE learning_submissions SET score = ?, grade_letter = ?, feedback = ?, graded_at = ? WHERE id = ?`)
        .run(clamped, letter, feedback || null, _now(), submissionId);
      // Earnings for grader
      db.prepare(`INSERT INTO learning_earnings (user_id, source, amount, ref_id) VALUES (?, 'assessment_grade', ?, ?)`)
        .run(userId, 0.5, submissionId);
      res.json({ ok: true, score: clamped, letter });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/learning/submit — submit answers
  router.post("/submit", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const { assessmentId, answers, cohortId } = req.body || {};
    if (!assessmentId || !answers) return res.status(400).json({ ok: false, error: "assessmentId_and_answers_required" });
    const assess = db.prepare(`SELECT id, questions_json, total_points FROM learning_assessments WHERE id = ?`).get(assessmentId);
    if (!assess) return res.status(404).json({ ok: false, error: "assessment_not_found" });
    const id = `sub:${randomUUID()}`;
    // Auto-grade objective questions if possible
    let autoScore = null;
    try {
      const qs = _safeJson(assess.questions_json, []);
      const correctable = qs.filter((q) => q.correct !== undefined);
      if (correctable.length > 0 && typeof answers === "object") {
        let earned = 0, possible = 0;
        for (let i = 0; i < qs.length; i++) {
          const q = qs[i];
          if (q.correct === undefined) continue;
          possible += Number(q.points) || 10;
          const given = answers[i] ?? answers[`q${i}`];
          if (given !== undefined && String(given) === String(q.correct)) earned += Number(q.points) || 10;
        }
        if (possible > 0) autoScore = (earned / possible) * 100;
      }
    } catch { /* ignore */ }
    try {
      db.prepare(`
        INSERT INTO learning_submissions (id, assessment_id, student_user_id, cohort_id, answers_json, score, grade_letter, submitted_at, graded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, assessmentId, userId, cohortId || null,
        JSON.stringify(answers),
        autoScore, autoScore != null ? _gradeLetter(autoScore) : null,
        _now(), autoScore != null ? _now() : null);
      // Log interaction
      db.prepare(`INSERT INTO learning_interactions (user_id, kind, subject_id) VALUES (?, 'assessment_complete', ?)`).run(userId, id);
      res.json({ ok: true, id, autoScore, autoGraded: autoScore != null });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // GET /api/learning/submissions/mine — list my submissions
  router.get("/submissions/mine", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 500);
    try {
      const rows = db.prepare(`
        SELECT s.id, s.assessment_id, s.cohort_id, s.score, s.grade_letter, s.feedback, s.submitted_at, s.graded_at,
               a.title AS assessment_title
        FROM learning_submissions s
        INNER JOIN learning_assessments a ON a.id = s.assessment_id
        WHERE s.student_user_id = ?
        ORDER BY s.submitted_at DESC LIMIT ?
      `).all(userId, limit);
      res.json({ ok: true, submissions: rows, count: rows.length });
    } catch (err) {
      res.json({ ok: true, submissions: [], count: 0, reason: "unavailable", note: err?.message });
    }
  });

  // ─── Cohorts ─────────────────────────────────────────────────────

  // POST /api/learning/cohort/form — peer-led study cohort
  router.post("/cohort/form", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const { name, description, topic, maxSize, visibility } = req.body || {};
    if (!name || !topic) return res.status(400).json({ ok: false, error: "name_and_topic_required" });
    const id = `cohort:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO learning_cohorts (id, name, description, topic, kind, max_size, current_size, visibility, created_by, created_at)
          VALUES (?, ?, ?, ?, 'study', ?, 1, ?, ?, ?)
        `).run(id, name, description || null, topic,
          Math.max(2, Math.min(100, Number(maxSize) || 12)),
          ["private","workspace","public"].includes(visibility) ? visibility : "public",
          userId, _now());
        db.prepare(`INSERT INTO learning_cohort_members (cohort_id, user_id, role) VALUES (?, ?, 'student')`).run(id, userId);
      });
      tx();
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/learning/cohort/teach — teacher-led cohort
  router.post("/cohort/teach", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const { name, description, topic, maxSize, visibility } = req.body || {};
    if (!name || !topic) return res.status(400).json({ ok: false, error: "name_and_topic_required" });
    const id = `cohort:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO learning_cohorts (id, name, description, topic, kind, teacher_user_id, max_size, current_size, visibility, created_by, created_at)
          VALUES (?, ?, ?, ?, 'teach', ?, ?, 1, ?, ?, ?)
        `).run(id, name, description || null, topic, userId,
          Math.max(2, Math.min(100, Number(maxSize) || 30)),
          ["private","workspace","public"].includes(visibility) ? visibility : "public",
          userId, _now());
        db.prepare(`INSERT INTO learning_cohort_members (cohort_id, user_id, role) VALUES (?, ?, 'teacher')`).run(id, userId);
      });
      tx();
      // Earnings (small flat fee for opening a cohort)
      try { db.prepare(`INSERT INTO learning_earnings (user_id, source, amount, ref_id) VALUES (?, 'cohort_teach', ?, ?)`).run(userId, 1.0, id); } catch { /* ok */ }
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // GET /api/learning/cohort/match — recommend cohorts by topic
  router.get("/cohort/match", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const topic = req.query.topic ? String(req.query.topic) : null;
    const kind = ["study","teach","research","tutor"].includes(req.query.kind) ? req.query.kind : null;
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    try {
      const filters = ["closed_at IS NULL", "current_size < max_size", "visibility IN ('public','workspace')"];
      const args = [];
      if (topic) { filters.push("topic LIKE ?"); args.push(`%${topic}%`); }
      if (kind) { filters.push("kind = ?"); args.push(kind); }
      args.push(limit);
      const rows = db.prepare(`
        SELECT id, name, description, topic, kind, teacher_user_id, max_size, current_size, created_at
        FROM learning_cohorts
        WHERE ${filters.join(" AND ")}
        ORDER BY (max_size - current_size) DESC, created_at DESC
        LIMIT ?
      `).all(...args);
      res.json({ ok: true, cohorts: rows, count: rows.length });
    } catch (err) {
      res.json({ ok: true, cohorts: [], count: 0, reason: "unavailable", note: err?.message });
    }
  });

  // GET /api/learning/cohort/mine — my cohorts (member)
  router.get("/cohort/mine", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    try {
      const rows = db.prepare(`
        SELECT c.id, c.name, c.topic, c.kind, c.current_size, c.max_size, c.teacher_user_id, m.role, m.joined_at
        FROM learning_cohort_members m
        INNER JOIN learning_cohorts c ON c.id = m.cohort_id
        WHERE m.user_id = ? AND m.left_at IS NULL
        ORDER BY m.joined_at DESC
      `).all(userId);
      res.json({ ok: true, cohorts: rows, count: rows.length });
    } catch (err) {
      res.json({ ok: true, cohorts: [], count: 0, reason: "unavailable", note: err?.message });
    }
  });

  // ─── Credentials + earnings + leaderboard ───────────────────────

  // GET /api/learning/credential/me — my credentials
  router.get("/credential/me", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    try {
      const rows = db.prepare(`
        SELECT id, kind, title, topic, score, issued_by, issued_at, expires_at, evidence_json
        FROM learning_credentials
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY issued_at DESC
      `).all(userId);
      res.json({ ok: true, credentials: rows.map((r) => ({ ...r, evidence: _safeJson(r.evidence_json, {}) })), count: rows.length });
    } catch (err) {
      res.json({ ok: true, credentials: [], count: 0, reason: "unavailable", note: err?.message });
    }
  });

  // GET /api/learning/earnings/me — earnings ledger
  router.get("/earnings/me", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    try {
      const rows = db.prepare(`
        SELECT id, source, amount, currency, ref_id, earned_at
        FROM learning_earnings WHERE user_id = ?
        ORDER BY earned_at DESC LIMIT 500
      `).all(userId);
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const byKind = rows.reduce((acc, r) => { acc[r.source] = (acc[r.source] || 0) + r.amount; return acc; }, {});
      res.json({ ok: true, earnings: rows, total, byKind });
    } catch (err) {
      res.json({ ok: true, earnings: [], total: 0, byKind: {}, reason: "unavailable", note: err?.message });
    }
  });

  // GET /api/learning/leaderboard — top learners by total earnings + credentials
  router.get("/leaderboard", (req, res) => {
    const db = STATE?.db;
    if (!db) return res.json({ ok: true, leaderboard: [] });
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 100);
    try {
      const rows = db.prepare(`
        SELECT user_id,
               SUM(amount) AS total_earned,
               COUNT(*) AS earn_count
        FROM learning_earnings
        GROUP BY user_id
        ORDER BY total_earned DESC
        LIMIT ?
      `).all(limit);
      // Enrich with credential count
      const enriched = rows.map((r) => {
        const credRow = db.prepare(`SELECT COUNT(*) AS n FROM learning_credentials WHERE user_id = ? AND revoked_at IS NULL`).get(r.user_id);
        return { ...r, credentials: credRow?.n || 0 };
      });
      res.json({ ok: true, leaderboard: enriched, count: enriched.length });
    } catch (err) {
      res.json({ ok: true, leaderboard: [], count: 0, reason: "unavailable", note: err?.message });
    }
  });

  // GET /api/learning/rates — current platform earnings rates (rate card)
  router.get("/rates", (_req, res) => {
    res.json({
      ok: true,
      rates: {
        cohort_teach: { amount: 1.0, unit: "per_cohort_opened", description: "Open a teacher-led cohort" },
        tutor_session: { amount: 0.25, unit: "per_session", description: "Run an AI tutor session" },
        assessment_grade: { amount: 0.5, unit: "per_submission_graded", description: "Grade a student submission" },
        path_authorship: { amount: 5.0, unit: "per_path_published", description: "Author + publish a learning path" },
        citation_royalty: { amount: 0.05, unit: "per_dtu_cited", description: "Your published learning DTU was cited" },
      },
      currency: "concord_coin",
    });
  });

  // ─── Paths ───────────────────────────────────────────────────────

  // GET /api/learning/path — list paths (filterable by topic / level)
  router.get("/path", (req, res) => {
    const db = STATE?.db;
    if (!db) return res.json({ ok: true, paths: [] });
    const topic = req.query.topic ? String(req.query.topic) : null;
    const level = ["beginner","intermediate","advanced","expert"].includes(req.query.level) ? req.query.level : null;
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
    try {
      const filters = ["visibility IN ('public','published')"];
      const args = [];
      if (topic) { filters.push("topic LIKE ?"); args.push(`%${topic}%`); }
      if (level) { filters.push("level = ?"); args.push(level); }
      args.push(limit);
      const rows = db.prepare(`
        SELECT id, title, topic, description, level, author_user_id, step_count, enrolled_count, created_at
        FROM learning_paths WHERE ${filters.join(" AND ")}
        ORDER BY enrolled_count DESC, created_at DESC LIMIT ?
      `).all(...args);
      res.json({ ok: true, paths: rows, count: rows.length });
    } catch (err) {
      res.json({ ok: true, paths: [], count: 0, reason: "unavailable", note: err?.message });
    }
  });

  // ─── Knowledge surfaces ─────────────────────────────────────────

  // GET /api/learning/dtus/search — find learning-relevant DTUs by topic
  router.get("/dtus/search", (req, res) => {
    const db = STATE?.db;
    if (!db) return res.json({ ok: true, results: [] });
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ ok: true, results: [], reason: "query_too_short" });
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 100);
    try {
      const rows = db.prepare(`
        SELECT id, kind, title, creator_id, created_at
        FROM dtus WHERE title LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(`%${q}%`, limit);
      res.json({ ok: true, results: rows, count: rows.length });
    } catch (err) {
      res.json({ ok: true, results: [], count: 0, reason: "unavailable", note: err?.message });
    }
  });

  // GET /api/learning/frontier — what's the user NOT yet mastered?
  router.get("/frontier", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    try {
      // Topics the user has touched but not credentialed yet
      const interacted = db.prepare(`
        SELECT DISTINCT meta_json FROM learning_interactions
        WHERE user_id = ? AND kind IN ('dtu_view','question_ask')
        ORDER BY created_at DESC LIMIT 100
      `).all(userId);
      const credentialedTopics = new Set(db.prepare(`SELECT DISTINCT topic FROM learning_credentials WHERE user_id = ? AND revoked_at IS NULL AND topic IS NOT NULL`).all(userId).map((r) => r.topic));
      const seenTopics = new Set();
      for (const r of interacted) {
        const meta = _safeJson(r.meta_json, {});
        if (meta.topic) seenTopics.add(meta.topic);
      }
      const frontier = [...seenTopics].filter((t) => !credentialedTopics.has(t));
      res.json({ ok: true, frontier, mastered: [...credentialedTopics], count: frontier.length });
    } catch (err) {
      res.json({ ok: true, frontier: [], mastered: [], count: 0, reason: "unavailable", note: err?.message });
    }
  });

  // GET /api/learning/genome — user's learning genome summary
  router.get("/genome", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    try {
      const subs = db.prepare(`SELECT COUNT(*) AS n FROM learning_submissions WHERE student_user_id = ?`).get(userId);
      const credCount = db.prepare(`SELECT COUNT(*) AS n FROM learning_credentials WHERE user_id = ? AND revoked_at IS NULL`).get(userId);
      const earnTotal = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM learning_earnings WHERE user_id = ?`).get(userId);
      const cohorts = db.prepare(`SELECT COUNT(*) AS n FROM learning_cohort_members WHERE user_id = ? AND left_at IS NULL`).get(userId);
      const sessions = db.prepare(`SELECT COUNT(*) AS n FROM learning_tutor_sessions WHERE user_id = ?`).get(userId);
      res.json({
        ok: true,
        genome: {
          submissions: subs?.n || 0,
          credentials: credCount?.n || 0,
          earnings: earnTotal?.s || 0,
          cohorts: cohorts?.n || 0,
          tutorSessions: sessions?.n || 0,
        },
      });
    } catch (err) {
      res.json({ ok: true, genome: {}, reason: "unavailable", note: err?.message });
    }
  });

  // GET /api/learning/genome/graph — relationship graph (topics ↔ credentials ↔ paths)
  router.get("/genome/graph", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    try {
      const creds = db.prepare(`SELECT id, topic, title FROM learning_credentials WHERE user_id = ? AND revoked_at IS NULL`).all(userId);
      const enrollments = db.prepare(`
        SELECT e.path_id, p.title, p.topic, e.current_step
        FROM learning_path_enrollments e
        INNER JOIN learning_paths p ON p.id = e.path_id
        WHERE e.user_id = ?
      `).all(userId);
      const nodes = [];
      const edges = [];
      const topicSet = new Set();
      for (const c of creds) {
        nodes.push({ id: c.id, kind: "credential", label: c.title, topic: c.topic });
        if (c.topic) {
          topicSet.add(c.topic);
          edges.push({ from: c.id, to: `topic:${c.topic}`, kind: "credentials" });
        }
      }
      for (const e of enrollments) {
        nodes.push({ id: e.path_id, kind: "path", label: e.title, currentStep: e.current_step });
        if (e.topic) {
          topicSet.add(e.topic);
          edges.push({ from: e.path_id, to: `topic:${e.topic}`, kind: "covers" });
        }
      }
      for (const t of topicSet) nodes.push({ id: `topic:${t}`, kind: "topic", label: t });
      res.json({ ok: true, nodes, edges });
    } catch (err) {
      res.json({ ok: true, nodes: [], edges: [], reason: "unavailable", note: err?.message });
    }
  });

  // POST /api/learning/interaction — log a learner interaction
  router.post("/interaction", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const { kind, subjectId, meta } = req.body || {};
    const allowed = ["dtu_view","dtu_cite","question_ask","tutor_msg","path_advance","assessment_complete"];
    if (!allowed.includes(kind)) return res.status(400).json({ ok: false, error: "invalid_kind" });
    try {
      db.prepare(`INSERT INTO learning_interactions (user_id, kind, subject_id, meta_json) VALUES (?, ?, ?, ?)`)
        .run(userId, kind, subjectId || null, meta ? JSON.stringify(meta) : null);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ─── Tutor ──────────────────────────────────────────────────────

  // POST /api/learning/tutor/ask — open or continue a tutor session
  router.post("/tutor/ask", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const { sessionId, topic, message } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });
    const id = sessionId || `tutor:${randomUUID()}`;
    try {
      const existing = db.prepare(`SELECT messages_json FROM learning_tutor_sessions WHERE id = ? AND user_id = ?`).get(id, userId);
      const messages = existing ? _safeJson(existing.messages_json, []) : [];
      messages.push({ role: "user", content: String(message).slice(0, 4000), at: _now() });
      // Deterministic fallback reply (LLM enhancement can land later)
      const reply = `Good question on ${topic || "this topic"}. Here's how I'd think about it: ${String(message).split(/\s+/).slice(0, 3).join(" ")}... [Detailed answer would go here — connect an LLM via CONCORD_LEARNING_TUTOR_LLM=true]`;
      messages.push({ role: "assistant", content: reply, at: _now() });
      if (existing) {
        db.prepare(`UPDATE learning_tutor_sessions SET messages_json = ? WHERE id = ?`).run(JSON.stringify(messages), id);
      } else {
        db.prepare(`INSERT INTO learning_tutor_sessions (id, user_id, kind, topic, messages_json) VALUES (?, ?, 'ask', ?, ?)`)
          .run(id, userId, topic || null, JSON.stringify(messages));
        // Earnings (small per-session opener payment to user; in real impl
        // this would be to the tutor's account)
        try { db.prepare(`INSERT INTO learning_earnings (user_id, source, amount, ref_id) VALUES (?, 'tutor_session', ?, ?)`).run(userId, 0.25, id); } catch { /* ok */ }
      }
      db.prepare(`INSERT INTO learning_interactions (user_id, kind, subject_id) VALUES (?, 'tutor_msg', ?)`).run(userId, id);
      res.json({ ok: true, sessionId: id, reply, messages });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/learning/tutor/socratic — Socratic mode (questions back)
  router.post("/tutor/socratic", requireAuth(), (req, res) => {
    const db = STATE?.db;
    const userId = req.user?.id;
    if (!db || !userId) return res.status(401).json({ ok: false, reason: "auth_required" });
    const { sessionId, topic, message } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });
    const id = sessionId || `socratic:${randomUUID()}`;
    try {
      const existing = db.prepare(`SELECT messages_json FROM learning_tutor_sessions WHERE id = ? AND user_id = ?`).get(id, userId);
      const messages = existing ? _safeJson(existing.messages_json, []) : [];
      messages.push({ role: "user", content: String(message).slice(0, 4000), at: _now() });
      // Socratic deterministic reply — always returns a question
      const probe = `What if the opposite were true? How would you know if you were wrong about ${topic || "this"}?`;
      messages.push({ role: "assistant", content: probe, at: _now() });
      if (existing) {
        db.prepare(`UPDATE learning_tutor_sessions SET messages_json = ? WHERE id = ?`).run(JSON.stringify(messages), id);
      } else {
        db.prepare(`INSERT INTO learning_tutor_sessions (id, user_id, kind, topic, messages_json) VALUES (?, ?, 'socratic', ?, ?)`)
          .run(id, userId, topic || null, JSON.stringify(messages));
      }
      res.json({ ok: true, sessionId: id, reply: probe, messages });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}
