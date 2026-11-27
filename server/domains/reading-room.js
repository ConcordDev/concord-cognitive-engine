// server/domains/reading-room.js
//
// Education — the Reading Room. Anyone can publish a course (free, or sold
// in Concord Coin through dtu.create → marketplace.list →
// marketplace.purchaseWithRoyalties) and anyone can take one. Lessons hold
// a reading, a video and a check; checks are graded on the server; a
// lesson is done only when its check passes (or, without a check, once it
// was opened); a certificate needs every lesson done and anyone can verify
// it from its code. The creator sees their learners' progress, scores and
// reviews. Rules live in lib/reading-room.js, shared with the older
// education actions.

import {
  getCourse, saveCourse, cleanLesson, checkForLearner, mayRead, isEnrolled, enroll, progressOf, markOpened,
  submitCheck, completeLesson, issueCertificate, verifyCertificate, LIMITS,
} from "../lib/reading-room.js";
import { displayName } from "../lib/media-release-shop.js";
import { getMediaDTU, setMediaPrivacy, grantMediaEntitlement } from "../lib/media-dtu.js";

const STATE = () => globalThis._concordSTATE;
const persistDtu = (d) => { try { globalThis._concordUpsertDTU?.(d); } catch { /* in-memory copy still serves */ } };
// eslint-disable-next-line no-control-regex -- strips control characters from user text on purpose
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, n);
const r2 = (n) => Math.round(n * 100) / 100;
const LEVELS = ["beginner", "intermediate", "advanced"];

export default function registerReadingRoom(registerLensAction) {
  const me = (ctx) => { const id = ctx?.actor?.userId || ctx?.userId; return id && id !== "anon" ? String(id) : null; };
  const dbOf = (ctx) => ctx?.db || STATE()?.db || null;
  const nameOf = (id) => (id ? displayName(id) : null);
  const act = (needUser, fn) => async (ctx, _a, params = {}) => {
    const db = dbOf(ctx); if (!db) return { ok: false, error: "the course store is unavailable" };
    const uid = me(ctx);
    if (needUser && !uid) return { ok: false, error: "sign in to do that" };
    try { return await fn(db, uid, params || {}, ctx); }
    catch (err) { return { ok: false, error: String(err?.message || err).slice(0, 200) }; }
  };
  const ok = (result) => ({ ok: true, result });

  function stats(db, courseId) {
    const r = db.prepare("SELECT COUNT(*) n, AVG(stars) avg FROM edu_reviews WHERE course_id = ?").get(courseId);
    const learners = db.prepare("SELECT COUNT(*) n FROM edu_enrollments WHERE course_id = ?").get(courseId).n;
    return { reviews: r.n, rating: r.avg == null ? null : Math.round(r.avg * 10) / 10, learners };
  }
  function card(db, c, uid) {
    const minutes = (c.lessons || []).reduce((s, l) => s + (Number(l.durationMin) || 0), 0);
    return {
      id: c.id, title: c.title, summary: c.extra?.summary || c.description.slice(0, 200), category: c.category, level: c.level,
      priceCC: Number(c.extra?.priceCC) || 0, lessons: (c.lessons || []).length, minutes, status: c.status,
      creator: { name: nameOf(c.authorId) || "A creator", isMe: c.authorId === uid }, publishedAt: c.extra?.publishedAt || null,
      enrolled: !!uid && isEnrolled(db, c.id, uid), cover: c.extra?.cover || null, ...stats(db, c.id),
    };
  }
  const outlineOf = (c, prog, uid, db) => (c.lessons || []).map((l, i) => {
    const p = prog?.get(l.id);
    return {
      id: l.id, n: i + 1, title: l.title, kind: l.kind || (l.check ? "check" : l.video ? "video" : "reading"), durationMin: l.durationMin || 0,
      preview: !!l.preview, hasVideo: !!(l.video || l.videoUrl), hasReading: !!l.body, checkQuestions: l.check?.questions?.length || 0,
      done: !!p?.completed_at, opened: !!p?.opened_at, bestScore: p?.best_score ?? null, readable: mayRead(db, c, l, uid),
    };
  });
  const mediaUrl = (id) => `/api/media/${encodeURIComponent(id)}/stream`;

  // ── Browsing ──
  registerLensAction("education", "rr-catalog", act(false, (db, uid, p) => {
    const q = clean(p.q, 80).toLowerCase();
    let rows = db.prepare("SELECT id FROM edu_courses WHERE status = 'published' ORDER BY rowid DESC LIMIT 1000").all().map((r) => getCourse(db, r.id)).filter(Boolean);
    rows = rows.filter((c) => (c.lessons || []).length > 0);
    if (q) rows = rows.filter((c) => `${c.title} ${c.description} ${c.category} ${c.extra?.summary || ""} ${nameOf(c.authorId) || ""}`.toLowerCase().includes(q));
    if (p.category) rows = rows.filter((c) => c.category === String(p.category));
    if (LEVELS.includes(p.level)) rows = rows.filter((c) => c.level === p.level);
    if (p.price === "free") rows = rows.filter((c) => !(Number(c.extra?.priceCC) > 0));
    if (p.price === "paid") rows = rows.filter((c) => Number(c.extra?.priceCC) > 0);
    let cards = rows.map((c) => card(db, c, uid));
    if (p.sort === "rating") cards.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviews - a.reviews);
    else if (p.sort === "popular") cards.sort((a, b) => b.learners - a.learners);
    const categories = [...new Set(rows.map((c) => c.category))].sort();
    return ok({ courses: cards.slice(0, 300), total: cards.length, categories });
  }));

  registerLensAction("education", "rr-course", act(false, (db, uid, p) => {
    const c = getCourse(db, String(p.id || ""));
    if (!c || (c.status !== "published" && c.authorId !== uid)) return { ok: false, error: "course not found" };
    const prog = uid ? progressOf(db, c.id, uid) : null;
    const outline = outlineOf(c, prog, uid, db);
    const cert = uid ? db.prepare("SELECT code FROM edu_certificates WHERE user_id = ? AND course_id = ?").get(uid, c.id) : null;
    const reviews = db.prepare("SELECT user_id, stars, text, created_at FROM edu_reviews WHERE course_id = ? ORDER BY created_at DESC LIMIT 50").all(c.id)
      .map((r) => ({ name: nameOf(r.user_id) || "A learner", stars: r.stars, text: r.text || "", at: r.created_at, mine: r.user_id === uid }));
    const done = outline.filter((l) => l.done).length;
    return ok({
      course: { ...card(db, c, uid), description: c.description, outcomes: c.extra?.outcomes || [], passMark: null },
      outline, reviews, isCreator: c.authorId === uid,
      progress: { done, total: outline.length, next: outline.find((l) => !l.done)?.id || null }, certificate: cert?.code || null,
    });
  }));

  registerLensAction("education", "rr-lesson", act(false, (db, uid, p) => {
    const c = getCourse(db, String(p.courseId || ""));
    if (!c || (c.status !== "published" && c.authorId !== uid)) return { ok: false, error: "course not found" };
    const i = (c.lessons || []).findIndex((l) => l.id === p.lessonId);
    if (i < 0) return { ok: false, error: "lesson not found" };
    const l = c.lessons[i];
    const base = { id: l.id, n: i + 1, of: c.lessons.length, title: l.title, durationMin: l.durationMin || 0, preview: !!l.preview, prevId: c.lessons[i - 1]?.id || null, nextId: c.lessons[i + 1]?.id || null };
    if (!mayRead(db, c, l, uid)) {
      return ok({ lesson: { ...base, locked: true }, reason: Number(c.extra?.priceCC) > 0 ? `This lesson is part of the course (${c.extra.priceCC} CC).` : "Enroll (free) to read this lesson." });
    }
    if (uid && (isEnrolled(db, c.id, uid) || c.authorId === uid)) markOpened(db, c.id, l.id, uid);
    const p2 = uid ? progressOf(db, c.id, uid).get(l.id) : null;
    const video = l.video?.mediaId ? { src: mediaUrl(l.video.mediaId), kind: "file" } : l.video?.url ? { src: l.video.url, kind: "link" } : l.videoUrl ? { src: l.videoUrl, kind: "link" } : null;
    const last = uid ? db.prepare("SELECT score, passed, created_at FROM edu_check_attempts WHERE course_id = ? AND lesson_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1").get(c.id, l.id, uid) : null;
    return ok({
      lesson: { ...base, locked: false, body: l.body || "", video, check: checkForLearner(l.check) },
      progress: { opened: !!p2?.opened_at, done: !!p2?.completed_at, bestScore: p2?.best_score ?? null },
      lastAttempt: last ? { score: last.score, passed: !!last.passed, at: last.created_at } : null,
      enrolled: !!uid && isEnrolled(db, c.id, uid), isCreator: c.authorId === uid,
    });
  }));

  // ── Learning ──
  registerLensAction("education", "rr-enroll", act(true, async (db, uid, p, ctx) => {
    const c = getCourse(db, String(p.courseId || ""));
    if (!c || c.status !== "published") return { ok: false, error: "course not found" };
    if (c.authorId === uid) return { ok: false, error: "this is your own course" };
    if (isEnrolled(db, c.id, uid)) return { ok: false, error: "you're already enrolled" };
    const price = Number(c.extra?.priceCC) || 0;
    if (price > 0) {
      if (!c.extra?.dtuId) return { ok: false, error: "this course isn't on sale right now" };
      if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
      const paid = await ctx.macro.run("marketplace", "purchaseWithRoyalties", { dtuId: c.extra.dtuId });
      if (!paid?.ok) {
        if (paid?.error === "insufficient_balance") return { ok: false, error: `not enough Concord Coin: this course is ${price} CC and you have ${r2(Number(paid.balance) || 0)} CC`, reason: "insufficient_balance" };
        return { ok: false, error: paid?.error || "the purchase did not go through" };
      }
      for (const l of c.lessons) if (l.video?.mediaId && !l.preview) { try { grantMediaEntitlement(STATE(), l.video.mediaId, uid); } catch { /* the stream route re-checks */ } }
    }
    enroll(db, c.id, uid, price);
    c.enrollmentCount = db.prepare("SELECT COUNT(*) n FROM edu_enrollments WHERE course_id = ?").get(c.id).n;
    saveCourse(db, c);
    // the older enrollment list follows along
    try { const s = STATE()?.educationLens; if (s) { if (!(s.enrollments instanceof Map)) s.enrollments = new Map(); const arr = s.enrollments.get(uid) || []; if (!arr.some((e) => e.courseId === c.id)) arr.push({ id: `enr_${Date.now().toString(36)}`, courseId: c.id, enrolledAt: new Date().toISOString(), status: "in_progress" }); s.enrollments.set(uid, arr); } } catch { /* optional */ }
    return ok({ enrolled: true, paid: price, firstLessonId: c.lessons[0]?.id || null });
  }));

  registerLensAction("education", "rr-check", act(true, (db, uid, p) => {
    const c = getCourse(db, String(p.courseId || ""));
    if (!c || (c.status !== "published" && c.authorId !== uid)) return { ok: false, error: "course not found" };
    const r = submitCheck(db, c, String(p.lessonId || ""), uid, p.answers && typeof p.answers === "object" ? p.answers : {});
    if (!r.ok) return r;
    const { ok: _o, ...rest } = r;
    return ok(rest);
  }));

  registerLensAction("education", "rr-complete", act(true, (db, uid, p) => {
    const c = getCourse(db, String(p.courseId || ""));
    if (!c || (c.status !== "published" && c.authorId !== uid)) return { ok: false, error: "course not found" };
    const r = completeLesson(db, c, String(p.lessonId || ""), uid);
    if (!r.ok) return r;
    const prog = progressOf(db, c.id, uid);
    return ok({ ...r, done: c.lessons.filter((l) => prog.get(l.id)?.completed_at).length, total: c.lessons.length });
  }));

  registerLensAction("education", "rr-certificate", act(true, (db, uid, p) => {
    const c = getCourse(db, String(p.courseId || ""));
    if (!c) return { ok: false, error: "course not found" };
    const r = issueCertificate(db, c, uid);
    if (!r.ok) return r;
    return ok({ code: r.code, already: r.already, certificate: verifyCertificate(db, r.code, nameOf).certificate });
  }));

  registerLensAction("education", "rr-verify", act(false, (db, _uid, p) => {
    const r = verifyCertificate(db, String(p.code || ""), nameOf);
    return r.ok ? ok(r) : r;
  }));

  registerLensAction("education", "rr-review", act(true, (db, uid, p) => {
    const c = getCourse(db, String(p.courseId || ""));
    if (!c || c.status !== "published") return { ok: false, error: "course not found" };
    if (c.authorId === uid) return { ok: false, error: "you can't review your own course" };
    if (!isEnrolled(db, c.id, uid)) return { ok: false, error: "only learners on the course can review it" };
    const done = [...progressOf(db, c.id, uid).values()].filter((x) => x.completed_at).length;
    if (!done) return { ok: false, error: "finish at least one lesson before reviewing" };
    const stars = Math.round(Number(p.stars));
    if (!(stars >= 1 && stars <= 5)) return { ok: false, error: "stars are 1 to 5" };
    db.prepare(`INSERT INTO edu_reviews (course_id, user_id, stars, text) VALUES (?, ?, ?, ?)
                ON CONFLICT(course_id, user_id) DO UPDATE SET stars = excluded.stars, text = excluded.text, created_at = unixepoch()`).run(c.id, uid, stars, clean(p.text, 2000) || null);
    const st = stats(db, c.id);
    db.prepare("UPDATE edu_courses SET rating = ? WHERE id = ?").run(st.rating || 0, c.id);
    return ok(st);
  }));

  registerLensAction("education", "rr-my-learning", act(true, (db, uid) => {
    const rows = db.prepare("SELECT course_id, enrolled_at FROM edu_enrollments WHERE user_id = ? ORDER BY enrolled_at DESC").all(uid);
    const courses = rows.map((r) => {
      const c = getCourse(db, r.course_id); if (!c) return null;
      const prog = progressOf(db, c.id, uid);
      const done = c.lessons.filter((l) => prog.get(l.id)?.completed_at).length;
      const next = c.lessons.find((l) => !prog.get(l.id)?.completed_at);
      const cert = db.prepare("SELECT code FROM edu_certificates WHERE user_id = ? AND course_id = ?").get(uid, c.id);
      return { ...card(db, c, uid), done, total: c.lessons.length, nextLessonId: next?.id || null, nextLessonTitle: next?.title || null, certificate: cert?.code || null, enrolledAt: r.enrolled_at };
    }).filter(Boolean);
    const certificates = db.prepare("SELECT code, course_title, issued_at FROM edu_certificates WHERE user_id = ? ORDER BY issued_at DESC").all(uid).map((x) => ({ code: x.code, course: x.course_title, issuedAt: new Date(x.issued_at * 1000).toISOString() }));
    const teaching = db.prepare("SELECT id FROM edu_courses WHERE author_id = ? ORDER BY rowid DESC").all(uid).map((r) => card(db, getCourse(db, r.id), uid));
    return ok({ courses, certificates, teaching });
  }));

  // ── Teaching (the course studio) ──
  const mine = (db, uid, id) => { const c = getCourse(db, String(id || "")); return c && c.authorId === uid ? c : null; };

  registerLensAction("education", "rr-course-save", act(true, (db, uid, p) => {
    const title = clean(p.title, LIMITS.title);
    let c = p.id ? mine(db, uid, p.id) : null;
    if (p.id && !c) return { ok: false, error: "course not found" };
    if (!c) {
      if (!title) return { ok: false, error: "a course needs a title" };
      const id = `course_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`INSERT INTO edu_courses (id, author_id, title, description, category, level, duration_hours, instructor, institution, kind, status, enrollment_count, rating, lessons_json, created_at, extra_json)
                  VALUES (?, ?, ?, '', 'general', 'beginner', 0, '', '', 'course', 'draft', 0, 0, '[]', ?, '{}')`).run(id, uid, title, new Date().toISOString());
      c = getCourse(db, id);
    }
    if (title) c.title = title;
    if (p.description !== undefined) c.description = clean(p.description, 8000);
    if (p.summary !== undefined) c.extra.summary = clean(p.summary, 300);
    if (p.category !== undefined) c.category = clean(p.category, 40).toLowerCase() || "general";
    if (p.level !== undefined) { if (!LEVELS.includes(p.level)) return { ok: false, error: "level is beginner, intermediate or advanced" }; c.level = p.level; }
    if (p.outcomes !== undefined) c.extra.outcomes = (Array.isArray(p.outcomes) ? p.outcomes : []).map((o) => clean(o, 200)).filter(Boolean).slice(0, 12);
    if (p.priceCC !== undefined) {
      const v = Number(p.priceCC);
      if (typeof p.priceCC !== "number" || !Number.isFinite(v) || v < 0 || v > 1000 || r2(v) !== v || (v > 0 && v < 0.5)) return { ok: false, error: "priceCC is 0 (free) or from 0.5 to 1000 CC, in cents" };
      if (c.status === "published" && (Number(c.extra.priceCC) > 0) !== (v > 0)) return { ok: false, error: "unpublish the course to switch it between free and paid" };
      c.extra.priceCC = v;
      const dtu = c.extra.dtuId ? STATE()?.dtus?.get?.(c.extra.dtuId) : null;
      if (dtu?.marketplace && v > 0) { dtu.marketplace.price = v; persistDtu(dtu); }
    }
    saveCourse(db, c);
    return ok({ course: card(db, c, uid), description: c.description, outcomes: c.extra.outcomes || [] });
  }));

  registerLensAction("education", "rr-studio", act(true, (db, uid, p) => {
    const c = mine(db, uid, p.id);
    if (!c) return { ok: false, error: "course not found" };
    return ok({ course: { ...card(db, c, uid), description: c.description, outcomes: c.extra.outcomes || [] }, lessons: c.lessons });
  }));

  registerLensAction("education", "rr-lesson-save", act(true, (db, uid, p) => {
    const c = mine(db, uid, p.courseId);
    if (!c) return { ok: false, error: "course not found" };
    const i = p.lessonId ? c.lessons.findIndex((l) => l.id === p.lessonId) : -1;
    if (p.lessonId && i < 0) return { ok: false, error: "lesson not found" };
    if (i < 0 && c.lessons.length >= LIMITS.lessons) return { ok: false, error: `a course holds ${LIMITS.lessons} lessons` };
    if (p.video?.mediaId) {
      const md = getMediaDTU(STATE(), String(p.video.mediaId))?.mediaDTU;
      if (!md || md.author !== uid || md.mediaType !== "video") return { ok: false, error: "the video must be one you uploaded" };
    }
    const r = cleanLesson(p, i >= 0 ? c.lessons[i] : {});
    if (r.error) return { ok: false, error: r.error };
    if (i >= 0) c.lessons[i] = r.lesson;
    else c.lessons.push({ ...r.lesson, id: `less_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString() });
    c.durationHours = Math.round(c.lessons.reduce((s, l) => s + (l.durationMin || 0), 0) / 6) / 10;
    saveCourse(db, c);
    if (c.status === "published") openMedia(c);
    return ok({ lesson: i >= 0 ? c.lessons[i] : c.lessons[c.lessons.length - 1], lessons: c.lessons.length });
  }));

  registerLensAction("education", "rr-lesson-delete", act(true, (db, uid, p) => {
    const c = mine(db, uid, p.courseId);
    if (!c) return { ok: false, error: "course not found" };
    const i = c.lessons.findIndex((l) => l.id === p.lessonId);
    if (i < 0) return { ok: false, error: "lesson not found" };
    if (c.status === "published" && c.lessons.length === 1) return { ok: false, error: "a published course keeps at least one lesson" };
    c.lessons.splice(i, 1);
    saveCourse(db, c);
    return ok({ lessons: c.lessons.length });
  }));

  registerLensAction("education", "rr-lesson-move", act(true, (db, uid, p) => {
    const c = mine(db, uid, p.courseId);
    if (!c) return { ok: false, error: "course not found" };
    const i = c.lessons.findIndex((l) => l.id === p.lessonId);
    if (i < 0) return { ok: false, error: "lesson not found" };
    const to = Math.max(0, Math.min(c.lessons.length - 1, Math.round(Number(p.toIndex))));
    const [l] = c.lessons.splice(i, 1);
    c.lessons.splice(to, 0, l);
    saveCourse(db, c);
    return ok({ order: c.lessons.map((x) => x.id) });
  }));

  function openMedia(c) {
    const free = !(Number(c.extra?.priceCC) > 0);
    for (const l of c.lessons) if (l.video?.mediaId) { try { setMediaPrivacy(STATE(), l.video.mediaId, free || l.preview ? "public" : "private"); } catch { /* best effort */ } }
  }

  registerLensAction("education", "rr-publish", act(true, async (db, uid, p, ctx) => {
    const c = mine(db, uid, p.id);
    if (!c) return { ok: false, error: "course not found" };
    if (p.publish === false) {
      c.status = "draft";
      if (c.extra.dtuId) { const dtu = STATE()?.dtus?.get?.(c.extra.dtuId); if (dtu?.marketplace) { dtu.marketplace.listed = false; persistDtu(dtu); } }
      saveCourse(db, c);
      return ok({ status: "draft" });
    }
    if (!c.lessons.length) return { ok: false, error: "add at least one lesson first" };
    if (!(c.extra.summary || c.description)) return { ok: false, error: "say what the course is about first" };
    const price = Number(c.extra.priceCC) || 0;
    if (price > 0) {
      if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
      const existing = c.extra.dtuId ? STATE()?.dtus?.get?.(c.extra.dtuId) : null;
      if (existing?.marketplace) { existing.marketplace.listed = true; existing.marketplace.price = price; persistDtu(existing); }
      else {
        const created = await ctx.macro.run("dtu", "create", {
          title: `${c.title} — course · ${c.id.slice(-6)}`, domain: "education", source: "reading-room", tags: ["course"],
          human: { summary: c.extra.summary || c.description.slice(0, 300) || c.title },
          core: { definitions: [], claims: [], examples: [], invariants: [], nextActions: [] },
          meta: { type: "course", courseId: c.id, lessons: c.lessons.length },
        });
        if (!created?.ok || !created.dtu) return { ok: false, error: created?.error || "could not mint the course's DTU" };
        const dtu = STATE()?.dtus?.get?.(created.dtu.id) || created.dtu;
        dtu.scope = "personal";
        dtu.license = { ...(dtu.license || {}), scopes: ["private", "marketplace_sale"] };
        const listed = await ctx.macro.run("marketplace", "list", { dtuId: dtu.id, price, currency: "CC", contentType: "course", title: c.title, description: (c.extra.summary || c.description).slice(0, 500), tags: ["course"] });
        if (!listed?.ok) return { ok: false, error: listed?.error || "could not list the course" };
        persistDtu(dtu);
        c.extra.dtuId = dtu.id;
      }
    }
    c.status = "published";
    c.extra.publishedAt = c.extra.publishedAt || new Date().toISOString();
    saveCourse(db, c);
    openMedia(c);
    return ok({ status: "published", course: card(db, c, uid) });
  }));

  /** The creator's view of their learners: the funnel, the checks, the money, the reviews. */
  registerLensAction("education", "rr-learners", act(true, (db, uid, p) => {
    const c = mine(db, uid, p.courseId);
    if (!c) return { ok: false, error: "course not found" };
    const enrolled = db.prepare("SELECT user_id, enrolled_at, paid_cc FROM edu_enrollments WHERE course_id = ?").all(c.id);
    const progress = db.prepare("SELECT lesson_id, user_id, opened_at, completed_at, best_score FROM edu_lesson_progress WHERE course_id = ?").all(c.id);
    const attempts = db.prepare("SELECT lesson_id, COUNT(*) n, SUM(passed) passed, AVG(score) avg FROM edu_check_attempts WHERE course_id = ? AND user_id != ? GROUP BY lesson_id").all(c.id, uid);
    const lessons = c.lessons.map((l) => {
      const rows = progress.filter((x) => x.lesson_id === l.id && x.user_id !== uid);
      const a = attempts.find((x) => x.lesson_id === l.id);
      return { id: l.id, title: l.title, opened: rows.filter((x) => x.opened_at).length, done: rows.filter((x) => x.completed_at).length,
        check: l.check ? { attempts: a?.n || 0, passRate: a?.n ? Math.round(((a.passed || 0) / a.n) * 100) : null, avgScore: a?.avg == null ? null : Math.round(a.avg * 100) } : null };
    });
    const certs = db.prepare("SELECT COUNT(*) n FROM edu_certificates WHERE course_id = ?").get(c.id).n;
    const people = enrolled.map((e) => {
      const mineRows = progress.filter((x) => x.user_id === e.user_id && x.completed_at);
      return { name: nameOf(e.user_id) || "A learner", done: mineRows.length, total: c.lessons.length, enrolledAt: e.enrolled_at };
    }).sort((a, b) => b.done - a.done);
    return ok({ learners: enrolled.length, revenueCC: r2(enrolled.reduce((s, e) => s + (e.paid_cc || 0), 0)), certificates: certs, lessons, people: people.slice(0, 200), ...stats(db, c.id) });
  }));

  /** The tutor in the margin: the lesson's own text is its context; honest when no model runs. */
  registerLensAction("education", "rr-tutor", act(true, async (db, uid, p, ctx) => {
    const c = getCourse(db, String(p.courseId || ""));
    const l = c?.lessons?.find((x) => x.id === p.lessonId);
    if (!c || !l || !mayRead(db, c, l, uid)) return { ok: false, error: "lesson not found" };
    const question = clean(p.question, 2000);
    if (!question) return { ok: false, error: "ask a question" };
    if (!ctx?.llm?.chat || ctx.llm.enabled === false) return { ok: false, error: "the tutor isn't available right now (no language model is running)" };
    const history = (Array.isArray(p.history) ? p.history : []).slice(-10).map((h) => ({ role: h.role === "tutor" ? "assistant" : "user", content: clean(h.content, 2000) }));
    const sys = `You are a patient Socratic tutor for the lesson "${l.title}" in the course "${c.title}". Help the learner understand; never give away the answers to the lesson's check. Prefer a guiding question or a small next step. Be short and concrete (at most 4 sentences).\n\nLesson text:\n${(l.body || "(this lesson is a video without text)").slice(0, 12000)}`;
    try {
      const r = await ctx.llm.chat({ messages: [{ role: "system", content: sys }, ...history, { role: "user", content: question }], temperature: 0.4, maxTokens: 320, slot: "conscious" });
      const text = String(r?.content || r?.text || r?.message?.content || "").trim();
      if (!text) return { ok: false, error: "the tutor didn't answer; try again" };
      return ok({ text });
    } catch (err) { return { ok: false, error: `the tutor isn't available right now (${String(err?.message || err).slice(0, 80)})` }; }
  }));
}
