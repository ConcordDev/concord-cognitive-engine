// The Reading Room's rules (Education): what a lesson holds, who may read
// it, how a check is graded, when a lesson counts as done and when a
// certificate is earned. Shared by the Reading Room actions and the older
// education actions, so there is one answer to "is this done?" everywhere.
//
// A lesson can carry a reading (markdown), a video (a link or an uploaded
// media id) and a check (questions graded here, on the server; answers and
// explanations never go to the browser before a learner has submitted).
// A lesson with a check is done when a check attempt passes; a lesson
// without one is done once the learner has opened it and marks it done.
// A certificate needs every lesson done, and it can be verified by anyone
// from its code.

import crypto from "node:crypto";

export const LIMITS = { body: 60_000, questions: 25, options: 8, lessons: 200, title: 160 };
// eslint-disable-next-line no-control-regex -- strips control characters from user text on purpose
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, n);
const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
const now = () => Math.floor(Date.now() / 1000);

// ── Courses (edu_courses, migration 363 + 517) ───────────────────────
export function getCourse(db, id) {
  if (!db || typeof id !== "string" || !id) return null;
  const r = db.prepare("SELECT * FROM edu_courses WHERE id = ?").get(id);
  if (!r) return null;
  return {
    id: r.id, authorId: r.author_id, title: r.title, description: r.description || "", category: r.category || "general",
    level: r.level || "beginner", status: r.status || "published", lessons: parse(r.lessons_json, []) || [],
    enrollmentCount: r.enrollment_count || 0, createdAt: r.created_at, extra: parse(r.extra_json, {}) || {},
    durationHours: r.duration_hours || 0,
  };
}
export function saveCourse(db, c) {
  db.prepare(`UPDATE edu_courses SET title = ?, description = ?, category = ?, level = ?, status = ?, lessons_json = ?, extra_json = ?,
              enrollment_count = ?, duration_hours = ? WHERE id = ?`)
    .run(c.title, c.description || "", c.category || "general", c.level || "beginner", c.status, JSON.stringify(c.lessons || []), JSON.stringify(c.extra || {}),
      c.enrollmentCount || 0, Number(c.durationHours) || 0, c.id);
}

// ── Lessons ──────────────────────────────────────────────────────────
const QTYPES = new Set(["choice", "multi", "numeric", "text"]);
/** A clean lesson from an author's input; { error } when it can't be used. */
export function cleanLesson(raw = {}, prev = {}) {
  const title = clean(raw.title ?? prev.title, LIMITS.title);
  if (!title) return { error: "a lesson needs a title" };
  const body = raw.body !== undefined ? clean(raw.body, LIMITS.body) : prev.body || "";
  let video = prev.video || null;
  if (raw.video !== undefined) {
    const v = raw.video || {};
    if (v && v.mediaId) video = { mediaId: clean(v.mediaId, 120) };
    else if (v && v.url) {
      const url = clean(v.url, 1000);
      if (!/^https:\/\/[^\s]+$/i.test(url)) return { error: "a video link must start with https://" };
      video = { url };
    } else video = null;
  }
  let check = prev.check || null;
  if (raw.check !== undefined) {
    if (!raw.check || !Array.isArray(raw.check.questions) || !raw.check.questions.length) check = null;
    else {
      const questions = [];
      for (const [i, q] of raw.check.questions.slice(0, LIMITS.questions).entries()) {
        const type = QTYPES.has(q?.type) ? q.type : "choice";
        const prompt = clean(q?.prompt, 1000);
        if (!prompt) return { error: `question ${i + 1} needs a prompt` };
        const out = { id: clean(q?.id, 40) || `q${i + 1}`, type, prompt, explain: clean(q?.explain, 1500) };
        if (type === "choice" || type === "multi") {
          const options = (Array.isArray(q.options) ? q.options : []).slice(0, LIMITS.options).map((o) => clean(o, 300)).filter(Boolean);
          if (options.length < 2) return { error: `question ${i + 1} needs at least two options` };
          out.options = options;
          if (type === "choice") {
            const a = Number(q.answer);
            if (!Number.isInteger(a) || a < 0 || a >= options.length) return { error: `question ${i + 1}: choose which option is right` };
            out.answer = a;
          } else {
            const a = [...new Set((Array.isArray(q.answer) ? q.answer : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n < options.length).sort((x, y) => x - y);
            if (!a.length) return { error: `question ${i + 1}: tick the right options` };
            out.answer = a;
          }
        } else if (type === "numeric") {
          const a = Number(q.answer);
          if (!Number.isFinite(a)) return { error: `question ${i + 1} needs a numeric answer` };
          out.answer = a;
          out.tolerance = Math.max(0, Math.min(1e9, Number(q.tolerance) || 0));
        } else {
          const accepts = (Array.isArray(q.answer) ? q.answer : [q.answer]).map((x) => clean(x, 200)).filter(Boolean).slice(0, 10);
          if (!accepts.length) return { error: `question ${i + 1} needs an accepted answer` };
          out.answer = accepts;
        }
        questions.push(out);
      }
      const passMark = Math.max(0.5, Math.min(1, Number(raw.check.passMark) || prev.check?.passMark || 0.7));
      check = { questions, passMark };
    }
  }
  if (!body && !video && !check) return { error: "a lesson needs a reading, a video or a check" };
  const durationMin = Math.max(0, Math.min(600, Math.round(Number(raw.durationMin ?? prev.durationMin) || 0)));
  const kind = check && !body && !video ? "check" : video ? "video" : "reading";
  return { lesson: { ...prev, title, body, video, check, durationMin, kind, preview: raw.preview !== undefined ? !!raw.preview : !!prev.preview, updatedAt: new Date().toISOString() } };
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s.,;:!?'"`]+/g, " ").trim();
/** Grade a check. answers: { [questionId]: number | number[] | string }. */
export function gradeCheck(check, answers = {}) {
  const results = [];
  let right = 0;
  for (const q of check?.questions || []) {
    const given = answers?.[q.id];
    let correct = false;
    if (q.type === "choice") correct = Number(given) === q.answer;
    else if (q.type === "multi") {
      const g = [...new Set((Array.isArray(given) ? given : []).map(Number))].sort((a, b) => a - b);
      correct = g.length === q.answer.length && g.every((x, i) => x === q.answer[i]);
    } else if (q.type === "numeric") {
      const g = Number(String(given ?? "").replace(/,/g, ""));
      correct = given !== "" && given != null && Number.isFinite(g) && Math.abs(g - q.answer) <= (q.tolerance || 0) + 1e-9;
    } else correct = q.answer.some((a) => norm(a) === norm(given));
    if (correct) right++;
    results.push({ id: q.id, correct });
  }
  const total = (check?.questions || []).length;
  const score = total ? right / total : 0;
  return { score, right, total, passed: total > 0 && score >= (check.passMark ?? 0.7) - 1e-9, results };
}

/** What a learner may see of a check: never the answers. */
export function checkForLearner(check) {
  if (!check) return null;
  return { passMark: check.passMark, questions: check.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, ...(q.options ? { options: q.options } : {}) })) };
}

// ── Enrollment, entitlement, progress ────────────────────────────────
export const isEnrolled = (db, courseId, userId) => !!userId && !!db.prepare("SELECT 1 FROM edu_enrollments WHERE course_id = ? AND user_id = ?").get(courseId, userId);
export function enroll(db, courseId, userId, paid = 0) {
  db.prepare("INSERT OR IGNORE INTO edu_enrollments (course_id, user_id, paid_cc) VALUES (?, ?, ?)").run(courseId, userId, paid);
}
/** May this person read this lesson in full? */
export function mayRead(db, course, lesson, userId) {
  if (!course || !lesson) return false;
  if (userId && course.authorId === userId) return true;
  if (course.status !== "published") return false;
  if (lesson.preview) return true;
  return isEnrolled(db, course.id, userId);
}
export function progressOf(db, courseId, userId) {
  const rows = db.prepare("SELECT lesson_id, opened_at, completed_at, best_score FROM edu_lesson_progress WHERE course_id = ? AND user_id = ?").all(courseId, userId || "");
  return new Map(rows.map((r) => [r.lesson_id, r]));
}
export function markOpened(db, courseId, lessonId, userId) {
  db.prepare(`INSERT INTO edu_lesson_progress (course_id, lesson_id, user_id, opened_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(course_id, lesson_id, user_id) DO UPDATE SET opened_at = COALESCE(opened_at, excluded.opened_at)`).run(courseId, lessonId, userId, now());
}

/** Submit a check: graded here, recorded, and the lesson completes on a pass. */
export function submitCheck(db, course, lessonId, userId, answers) {
  const lesson = (course.lessons || []).find((l) => l.id === lessonId);
  if (!lesson) return { ok: false, error: "lesson not found" };
  if (!lesson.check) return { ok: false, error: "this lesson has no check" };
  if (course.authorId !== userId && !isEnrolled(db, course.id, userId)) return { ok: false, error: "enroll in the course to take its checks" };
  const g = gradeCheck(lesson.check, answers);
  db.prepare("INSERT INTO edu_check_attempts (course_id, lesson_id, user_id, score, passed, answers_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(course.id, lessonId, userId, g.score, g.passed ? 1 : 0, JSON.stringify(answers || {}).slice(0, 20000));
  db.prepare(`INSERT INTO edu_lesson_progress (course_id, lesson_id, user_id, opened_at, completed_at, best_score) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(course_id, lesson_id, user_id) DO UPDATE SET best_score = MAX(COALESCE(best_score, 0), excluded.best_score),
              completed_at = COALESCE(completed_at, excluded.completed_at), opened_at = COALESCE(opened_at, excluded.opened_at)`)
    .run(course.id, lessonId, userId, now(), g.passed ? now() : null, g.score);
  const byId = new Map(lesson.check.questions.map((q) => [q.id, q]));
  // Explanations always come back after a submit; the right answers only once passed.
  const results = g.results.map((r) => {
    const q = byId.get(r.id);
    return { ...r, explain: q.explain || null, ...(g.passed ? { answer: q.answer } : {}) };
  });
  const attempts = db.prepare("SELECT COUNT(*) c FROM edu_check_attempts WHERE course_id = ? AND lesson_id = ? AND user_id = ?").get(course.id, lessonId, userId).c;
  return { ok: true, score: Math.round(g.score * 1000) / 1000, right: g.right, total: g.total, passed: g.passed, passMark: lesson.check.passMark, results, attempts };
}

/** Mark a lesson done: only one without a check, only once it was opened. */
export function completeLesson(db, course, lessonId, userId) {
  const lesson = (course.lessons || []).find((l) => l.id === lessonId);
  if (!lesson) return { ok: false, error: "lesson not found" };
  if (course.authorId !== userId && !isEnrolled(db, course.id, userId)) return { ok: false, error: "enroll in the course first" };
  const p = progressOf(db, course.id, userId).get(lessonId);
  if (lesson.check) return p?.completed_at ? { ok: true, alreadyCompleted: true } : { ok: false, error: `pass this lesson's check (${Math.round(lesson.check.passMark * 100)}%) to complete it` };
  if (!p?.opened_at) return { ok: false, error: "open the lesson before marking it done" };
  if (p.completed_at) return { ok: true, alreadyCompleted: true };
  db.prepare("UPDATE edu_lesson_progress SET completed_at = ? WHERE course_id = ? AND lesson_id = ? AND user_id = ?").run(now(), course.id, lessonId, userId);
  return { ok: true, alreadyCompleted: false };
}

// ── Certificates ─────────────────────────────────────────────────────
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  const b = crypto.randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return `RR-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}
export function issueCertificate(db, course, userId) {
  if (!userId) return { ok: false, error: "sign in" };
  if (course.authorId === userId) return { ok: false, error: "a course's own creator doesn't get its certificate" };
  if (!isEnrolled(db, course.id, userId)) return { ok: false, error: "enroll in the course first" };
  const existing = db.prepare("SELECT code FROM edu_certificates WHERE user_id = ? AND course_id = ?").get(userId, course.id);
  if (existing) return { ok: true, code: existing.code, already: true };
  const lessons = course.lessons || [];
  if (!lessons.length) return { ok: false, error: "this course has no lessons" };
  const prog = progressOf(db, course.id, userId);
  const left = lessons.filter((l) => !prog.get(l.id)?.completed_at);
  if (left.length) return { ok: false, error: `${left.length} lesson${left.length === 1 ? "" : "s"} still to finish`, remaining: left.map((l) => l.title) };
  const scores = lessons.filter((l) => l.check).map((l) => prog.get(l.id)?.best_score).filter((x) => Number.isFinite(x));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const code = newCode();
  db.prepare("INSERT INTO edu_certificates (code, user_id, course_id, course_title, creator_id, lessons, avg_score) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(code, userId, course.id, course.title, course.authorId, lessons.length, avg);
  return { ok: true, code, already: false };
}
/** Public: what a certificate code proves. */
export function verifyCertificate(db, code, nameOf) {
  const c = typeof code === "string" && /^RR-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code.trim().toUpperCase())
    ? db.prepare("SELECT * FROM edu_certificates WHERE code = ?").get(code.trim().toUpperCase()) : null;
  if (!c) return { ok: false, error: "no certificate has that code" };
  return {
    ok: true,
    certificate: {
      code: c.code, learner: nameOf(c.user_id) || "A learner", course: c.course_title, courseId: c.course_id,
      creator: nameOf(c.creator_id) || "A creator", lessons: c.lessons, averageScore: c.avg_score == null ? null : Math.round(c.avg_score * 100),
      issuedAt: new Date(c.issued_at * 1000).toISOString(),
    },
  };
}
