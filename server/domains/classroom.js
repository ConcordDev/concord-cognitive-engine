// server/domains/classroom.js
//
// Real educational-material lookups via Open Library (~30M books,
// no key required, https://openlibrary.org/developers/api) and the
// Internet Archive Scholar / OER bibliographic surfaces.
//
// Open Library is part of the Internet Archive (501(c)(3)) and exposes
// search/works/subjects endpoints with no auth and a sane public ToS.

const OL_BASE = "https://openlibrary.org";

export default function registerClassroomActions(registerLensAction) {
  /**
   * ol-search — Open Library book/work search (~30M records).
   * params: { query?: string, author?: string, title?: string,
   *           subject?: string, page?: 1+, limit?: 1-100 }
   */
  registerLensAction("classroom", "ol-search", async (_ctx, _artifact, params = {}) => {
    const qp = new URLSearchParams();
    if (params.query) qp.set("q", String(params.query).slice(0, 200));
    if (params.author) qp.set("author", String(params.author));
    if (params.title) qp.set("title", String(params.title));
    if (params.subject) qp.set("subject", String(params.subject));
    if (!qp.toString()) return { ok: false, error: "at least one of query/author/title/subject required" };
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    qp.set("limit", String(limit));
    const page = Math.max(1, Number(params.page) || 1);
    if (page > 1) qp.set("page", String(page));
    try {
      const r = await fetch(`${OL_BASE}/search.json?${qp.toString()}`);
      if (!r.ok) throw new Error(`openlibrary ${r.status}`);
      const json = await r.json();
      const works = (json.docs || []).map((d) => ({
        workId: d.key,
        title: d.title,
        authors: d.author_name || [],
        firstPublishYear: d.first_publish_year,
        editionCount: d.edition_count,
        languages: d.language || [],
        subjects: (d.subject || []).slice(0, 10),
        isbn: d.isbn?.[0],
        coverId: d.cover_i,
        coverImage: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
        ebookAccess: d.ebook_access,
        iaIdentifier: d.ia?.[0],
        readUrl: d.ia?.[0] ? `https://archive.org/details/${d.ia[0]}` : null,
      }));
      return {
        ok: true,
        result: {
          query: params.query, works, count: works.length,
          totalResults: json.numFound,
          page,
          source: "open-library",
        },
      };
    } catch (e) {
      return { ok: false, error: `openlibrary unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * ol-work — Detailed work record by Open Library work id (e.g. "OL45883W").
   */
  registerLensAction("classroom", "ol-work", async (_ctx, _artifact, params = {}) => {
    const raw = String(params.workId || "").trim();
    if (!/^OL\d+W$/.test(raw)) return { ok: false, error: "workId required (e.g. 'OL45883W')" };
    try {
      const r = await fetch(`${OL_BASE}/works/${raw}.json`);
      if (r.status === 404) return { ok: false, error: `work not found: ${raw}` };
      if (!r.ok) throw new Error(`openlibrary ${r.status}`);
      const w = await r.json();
      return {
        ok: true,
        result: {
          workId: raw,
          title: w.title,
          description: typeof w.description === "string" ? w.description : w.description?.value,
          subjects: w.subjects || [],
          subjectPlaces: w.subject_places || [],
          subjectPeople: w.subject_people || [],
          subjectTimes: w.subject_times || [],
          firstPublishDate: w.first_publish_date,
          covers: (w.covers || []).map((id) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`),
          authorKeys: (w.authors || []).map((a) => a.author?.key),
          source: "open-library",
        },
      };
    } catch (e) {
      return { ok: false, error: `openlibrary unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * ol-subject — Books filed under a subject heading (textbooks, biology,
   * mathematics, computer-science, etc.).
   * params: { subject: string, ebooks?: boolean, limit?: 1-100 }
   */
  registerLensAction("classroom", "ol-subject", async (_ctx, _artifact, params = {}) => {
    const subj = String(params.subject || "").trim().toLowerCase().replace(/[^a-z0-9_\-\s]/g, "").replace(/\s+/g, "_");
    if (!subj) return { ok: false, error: "subject required (e.g. 'biology', 'computer_science', 'world_history')" };
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
    const qp = new URLSearchParams({ limit: String(limit) });
    if (params.ebooks) qp.set("ebooks", "true");
    try {
      const r = await fetch(`${OL_BASE}/subjects/${subj}.json?${qp.toString()}`);
      if (r.status === 404) return { ok: false, error: `subject not found: ${subj}` };
      if (!r.ok) throw new Error(`openlibrary ${r.status}`);
      const json = await r.json();
      const works = (json.works || []).map((w) => ({
        workId: w.key?.replace("/works/", ""),
        title: w.title,
        authors: (w.authors || []).map((a) => a.name),
        firstPublishYear: w.first_publish_year,
        editionCount: w.edition_count,
        coverId: w.cover_id,
        coverImage: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : null,
        hasFulltext: w.has_fulltext,
        iaIdentifier: w.ia,
        readUrl: w.ia ? `https://archive.org/details/${w.ia}` : null,
      }));
      return {
        ok: true,
        result: {
          subject: json.name || subj,
          works, count: works.length,
          totalWorks: json.work_count,
          source: "open-library",
        },
      };
    } catch (e) {
      return { ok: false, error: `openlibrary unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * ol-isbn — Look up a book by ISBN-10 or ISBN-13.
   */
  registerLensAction("classroom", "ol-isbn", async (_ctx, _artifact, params = {}) => {
    const isbn = String(params.isbn || "").replace(/[^0-9X]/gi, "");
    if (!(isbn.length === 10 || isbn.length === 13)) return { ok: false, error: "isbn must be 10 or 13 digits" };
    try {
      const r = await fetch(`${OL_BASE}/isbn/${isbn}.json`);
      if (r.status === 404) return { ok: false, error: `book not found: ${isbn}` };
      if (!r.ok) throw new Error(`openlibrary ${r.status}`);
      const e = await r.json();
      return {
        ok: true,
        result: {
          isbn,
          title: e.title,
          subtitle: e.subtitle,
          publishers: e.publishers || [],
          publishDate: e.publish_date,
          pages: e.number_of_pages,
          languages: (e.languages || []).map((l) => l.key?.replace("/languages/", "")),
          subjects: e.subjects || [],
          coverImage: e.covers?.[0] ? `https://covers.openlibrary.org/b/id/${e.covers[0]}-L.jpg` : null,
          workKey: e.works?.[0]?.key,
          authorKeys: (e.authors || []).map((a) => a.key),
          source: "open-library",
        },
      };
    } catch (err) {
      return { ok: false, error: `openlibrary unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // ─── Classroom workspace: assignments, gradebook, stream, materials,
  //     to-do, quizzes. Persistent per-user data lives in
  //     globalThis._concordSTATE.classroomLens (Maps keyed by userId).
  //     Every handler is wrapped in try/catch and returns { ok, ... }. ──

  function getClassState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.classroomLens) STATE.classroomLens = {};
    const s = STATE.classroomLens;
    for (const k of [
      "assignments", "submissions", "grades", "stream",
      "materials", "quizzes", "quizAttempts",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveClassState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function uid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function rid(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
  function pushTo(map, key, item) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  function logStream(state, userId, entry) {
    pushTo(state.stream, userId, {
      id: rid("ev"), createdAt: new Date().toISOString(), ...entry,
    });
  }

  // ── Assignment creation (instructions, attachments, due dates, points) ──
  registerLensAction("classroom", "assignment-create", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const title = String(params.title || "").trim();
      const cohortId = Number(params.cohortId);
      if (!title) return { ok: false, error: "title required" };
      if (!Number.isFinite(cohortId)) return { ok: false, error: "cohortId required" };
      const assignment = {
        id: rid("asg"),
        cohortId,
        title,
        instructions: String(params.instructions || "").slice(0, 4000),
        attachments: Array.isArray(params.attachments)
          ? params.attachments.slice(0, 20).map((a) => String(a).slice(0, 300))
          : [],
        dueAt: params.dueAt ? String(params.dueAt) : null,
        points: Math.max(0, Math.min(1000, Number(params.points) || 100)),
        topic: String(params.topic || "").slice(0, 80) || null,
        status: "published",
        createdAt: new Date().toISOString(),
      };
      pushTo(state.assignments, userId, assignment);
      logStream(state, userId, { kind: "assignment", refId: assignment.id, text: `Assignment posted: ${title}`, cohortId });
      saveClassState();
      return { ok: true, result: { assignment } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "assignment-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      let list = state.assignments.get(userId) || [];
      if (params.cohortId !== undefined && params.cohortId !== null && params.cohortId !== "") {
        const c = Number(params.cohortId);
        list = list.filter((a) => a.cohortId === c);
      }
      const subs = state.submissions.get(userId) || [];
      const grades = state.grades.get(userId) || [];
      const enriched = list.map((a) => {
        const subCount = subs.filter((s) => s.assignmentId === a.id).length;
        const gradedCount = grades.filter((g) => g.assignmentId === a.id).length;
        return { ...a, submissionCount: subCount, gradedCount };
      });
      return { ok: true, result: { assignments: [...enriched].reverse() } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "assignment-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const id = String(params.assignmentId || "");
      const list = state.assignments.get(userId) || [];
      const next = list.filter((a) => a.id !== id);
      if (next.length === list.length) return { ok: false, error: "assignment not found" };
      state.assignments.set(userId, next);
      saveClassState();
      return { ok: true, result: { deleted: id } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Submission against an assignment ──
  registerLensAction("classroom", "submission-create", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const assignmentId = String(params.assignmentId || "");
      if (!assignmentId) return { ok: false, error: "assignmentId required" };
      const studentId = String(params.studentId || userId);
      const submission = {
        id: rid("sub"),
        assignmentId,
        studentId,
        content: String(params.content || "").slice(0, 8000),
        dtuId: params.dtuId ? String(params.dtuId) : null,
        attachments: Array.isArray(params.attachments)
          ? params.attachments.slice(0, 20).map((a) => String(a).slice(0, 300))
          : [],
        status: "submitted",
        submittedAt: new Date().toISOString(),
      };
      pushTo(state.submissions, userId, submission);
      saveClassState();
      return { ok: true, result: { submission } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "submission-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      let list = state.submissions.get(userId) || [];
      if (params.assignmentId) {
        const a = String(params.assignmentId);
        list = list.filter((s) => s.assignmentId === a);
      }
      const grades = state.grades.get(userId) || [];
      const enriched = list.map((s) => {
        const g = grades.find((x) => x.submissionId === s.id);
        return { ...s, grade: g || null };
      });
      return { ok: true, result: { submissions: [...enriched].reverse() } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Gradebook: grade a submission, return graded work with feedback ──
  registerLensAction("classroom", "grade-submission", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const submissionId = String(params.submissionId || "");
      if (!submissionId) return { ok: false, error: "submissionId required" };
      const subs = state.submissions.get(userId) || [];
      const sub = subs.find((s) => s.id === submissionId);
      if (!sub) return { ok: false, error: "submission not found" };
      const assignments = state.assignments.get(userId) || [];
      const asg = assignments.find((a) => a.id === sub.assignmentId);
      const maxPoints = asg ? asg.points : Math.max(0, Number(params.maxPoints) || 100);
      const score = Math.max(0, Math.min(maxPoints, Number(params.score) || 0));
      // rubricScores: optional [{ criterion, points, max }]
      const rubricScores = Array.isArray(params.rubricScores)
        ? params.rubricScores.map((r) => ({
            criterion: String(r.criterion || "").slice(0, 120),
            points: Math.max(0, Number(r.points) || 0),
            max: Math.max(0, Number(r.max) || 0),
          }))
        : [];
      const grade = {
        id: rid("grd"),
        submissionId,
        assignmentId: sub.assignmentId,
        studentId: sub.studentId,
        score,
        maxPoints,
        percent: maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0,
        feedback: String(params.feedback || "").slice(0, 4000),
        rubricScores,
        returned: params.returned !== false,
        gradedAt: new Date().toISOString(),
      };
      const existing = state.grades.get(userId) || [];
      const filtered = existing.filter((g) => g.submissionId !== submissionId);
      filtered.push(grade);
      state.grades.set(userId, filtered);
      sub.status = grade.returned ? "returned" : "graded";
      logStream(state, userId, {
        kind: "grade", refId: grade.id,
        text: `Graded submission ${submissionId.slice(0, 12)} — ${score}/${maxPoints}`,
        cohortId: asg ? asg.cohortId : null,
      });
      saveClassState();
      return { ok: true, result: { grade } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "gradebook", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      let assignments = state.assignments.get(userId) || [];
      if (params.cohortId !== undefined && params.cohortId !== null && params.cohortId !== "") {
        const c = Number(params.cohortId);
        assignments = assignments.filter((a) => a.cohortId === c);
      }
      const asgIds = new Set(assignments.map((a) => a.id));
      const subs = (state.submissions.get(userId) || []).filter((s) => asgIds.has(s.assignmentId));
      const grades = (state.grades.get(userId) || []).filter((g) => asgIds.has(g.assignmentId));
      const studentIds = [...new Set(subs.map((s) => s.studentId))];
      // rows: one per student, columns per assignment
      const rows = studentIds.map((studentId) => {
        const cells = assignments.map((a) => {
          const sub = subs.find((s) => s.studentId === studentId && s.assignmentId === a.id);
          const grade = sub ? grades.find((g) => g.submissionId === sub.id) : null;
          return {
            assignmentId: a.id,
            assignmentTitle: a.title,
            submitted: !!sub,
            score: grade ? grade.score : null,
            maxPoints: a.points,
            percent: grade ? grade.percent : null,
          };
        });
        const scored = cells.filter((c) => c.score !== null);
        const earned = scored.reduce((s, c) => s + c.score, 0);
        const possible = scored.reduce((s, c) => s + c.maxPoints, 0);
        return {
          studentId,
          cells,
          totalEarned: earned,
          totalPossible: possible,
          average: possible > 0 ? Math.round((earned / possible) * 100) : null,
        };
      });
      const classAvg = (() => {
        const avgs = rows.map((r) => r.average).filter((a) => a !== null);
        return avgs.length ? Math.round(avgs.reduce((s, a) => s + a, 0) / avgs.length) : null;
      })();
      return {
        ok: true,
        result: {
          assignments: assignments.map((a) => ({ id: a.id, title: a.title, points: a.points })),
          rows,
          studentCount: studentIds.length,
          classAverage: classAvg,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Class stream / announcements feed ──
  registerLensAction("classroom", "announce", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const text = String(params.text || "").trim();
      if (!text) return { ok: false, error: "text required" };
      const entry = {
        id: rid("ev"),
        kind: "announcement",
        text: text.slice(0, 4000),
        cohortId: params.cohortId !== undefined && params.cohortId !== null && params.cohortId !== ""
          ? Number(params.cohortId) : null,
        createdAt: new Date().toISOString(),
      };
      pushTo(state.stream, userId, entry);
      saveClassState();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "stream-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      let list = state.stream.get(userId) || [];
      if (params.cohortId !== undefined && params.cohortId !== null && params.cohortId !== "") {
        const c = Number(params.cohortId);
        list = list.filter((e) => e.cohortId === c);
      }
      const limit = Math.max(1, Math.min(200, Number(params.limit) || 50));
      return { ok: true, result: { stream: [...list].reverse().slice(0, limit) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Materials / resources tab per cohort ──
  registerLensAction("classroom", "material-add", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const title = String(params.title || "").trim();
      const cohortId = Number(params.cohortId);
      if (!title) return { ok: false, error: "title required" };
      if (!Number.isFinite(cohortId)) return { ok: false, error: "cohortId required" };
      const material = {
        id: rid("mat"),
        cohortId,
        title,
        kind: ["link", "book", "dtu", "file", "note"].includes(params.kind) ? params.kind : "link",
        url: String(params.url || "").slice(0, 500) || null,
        dtuId: params.dtuId ? String(params.dtuId) : null,
        topic: String(params.topic || "").slice(0, 80) || null,
        notes: String(params.notes || "").slice(0, 2000),
        createdAt: new Date().toISOString(),
      };
      pushTo(state.materials, userId, material);
      logStream(state, userId, { kind: "material", refId: material.id, text: `Material added: ${title}`, cohortId });
      saveClassState();
      return { ok: true, result: { material } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "material-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      let list = state.materials.get(userId) || [];
      if (params.cohortId !== undefined && params.cohortId !== null && params.cohortId !== "") {
        const c = Number(params.cohortId);
        list = list.filter((m) => m.cohortId === c);
      }
      // group by topic for a tabbed materials view
      const byTopic = {};
      for (const m of list) {
        const t = m.topic || "General";
        if (!byTopic[t]) byTopic[t] = [];
        byTopic[t].push(m);
      }
      return { ok: true, result: { materials: [...list].reverse(), byTopic } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "material-delete", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const id = String(params.materialId || "");
      const list = state.materials.get(userId) || [];
      const next = list.filter((m) => m.id !== id);
      if (next.length === list.length) return { ok: false, error: "material not found" };
      state.materials.set(userId, next);
      saveClassState();
      return { ok: true, result: { deleted: id } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Student-facing to-do list of upcoming / missing work ──
  registerLensAction("classroom", "todo", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const studentId = String(params.studentId || userId);
      let assignments = state.assignments.get(userId) || [];
      if (params.cohortId !== undefined && params.cohortId !== null && params.cohortId !== "") {
        const c = Number(params.cohortId);
        assignments = assignments.filter((a) => a.cohortId === c);
      }
      const subs = state.submissions.get(userId) || [];
      const grades = state.grades.get(userId) || [];
      const now = Date.now();
      const upcoming = [];
      const missing = [];
      const done = [];
      for (const a of assignments) {
        const sub = subs.find((s) => s.assignmentId === a.id && s.studentId === studentId);
        const grade = sub ? grades.find((g) => g.submissionId === sub.id) : null;
        const dueMs = a.dueAt ? Date.parse(a.dueAt) : NaN;
        const item = {
          assignmentId: a.id,
          title: a.title,
          cohortId: a.cohortId,
          points: a.points,
          dueAt: a.dueAt,
          submitted: !!sub,
          status: grade ? "graded" : sub ? "submitted" : "todo",
          score: grade ? grade.score : null,
        };
        if (grade) {
          done.push(item);
        } else if (!sub && Number.isFinite(dueMs) && dueMs < now) {
          item.status = "missing";
          missing.push(item);
        } else if (!sub) {
          upcoming.push(item);
        } else {
          done.push(item);
        }
      }
      upcoming.sort((x, y) => (Date.parse(x.dueAt || "") || Infinity) - (Date.parse(y.dueAt || "") || Infinity));
      return {
        ok: true,
        result: {
          studentId,
          upcoming, missing, done,
          counts: { upcoming: upcoming.length, missing: missing.length, done: done.length },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Quiz / auto-graded assessment builder ──
  registerLensAction("classroom", "quiz-create", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const title = String(params.title || "").trim();
      const cohortId = Number(params.cohortId);
      if (!title) return { ok: false, error: "title required" };
      if (!Number.isFinite(cohortId)) return { ok: false, error: "cohortId required" };
      const rawQuestions = Array.isArray(params.questions) ? params.questions : [];
      if (rawQuestions.length === 0) return { ok: false, error: "at least one question required" };
      const questions = [];
      for (let i = 0; i < rawQuestions.length && i < 100; i++) {
        const q = rawQuestions[i] || {};
        const kind = ["multiple_choice", "true_false", "short_answer"].includes(q.kind)
          ? q.kind : "multiple_choice";
        const prompt = String(q.prompt || "").slice(0, 1000);
        if (!prompt) return { ok: false, error: `question ${i + 1}: prompt required` };
        const options = Array.isArray(q.options)
          ? q.options.slice(0, 12).map((o) => String(o).slice(0, 300))
          : [];
        if (kind === "multiple_choice" && options.length < 2) {
          return { ok: false, error: `question ${i + 1}: multiple_choice needs >=2 options` };
        }
        questions.push({
          id: rid("q"),
          kind,
          prompt,
          options: kind === "true_false" ? ["True", "False"] : options,
          // correctAnswer stored server-side, never returned to students
          correctAnswer: String(q.correctAnswer ?? "").slice(0, 300),
          points: Math.max(1, Math.min(100, Number(q.points) || 1)),
        });
      }
      const quiz = {
        id: rid("qz"),
        cohortId,
        title,
        description: String(params.description || "").slice(0, 2000),
        dueAt: params.dueAt ? String(params.dueAt) : null,
        questions,
        totalPoints: questions.reduce((s, q) => s + q.points, 0),
        createdAt: new Date().toISOString(),
      };
      pushTo(state.quizzes, userId, quiz);
      logStream(state, userId, { kind: "quiz", refId: quiz.id, text: `Quiz posted: ${title}`, cohortId });
      saveClassState();
      // strip answers from the returned copy
      return { ok: true, result: { quiz: stripQuizAnswers(quiz) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  function stripQuizAnswers(quiz) {
    return {
      ...quiz,
      questions: quiz.questions.map((q) => ({
        id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, points: q.points,
      })),
    };
  }

  registerLensAction("classroom", "quiz-list", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      let list = state.quizzes.get(userId) || [];
      if (params.cohortId !== undefined && params.cohortId !== null && params.cohortId !== "") {
        const c = Number(params.cohortId);
        list = list.filter((q) => q.cohortId === c);
      }
      const attempts = state.quizAttempts.get(userId) || [];
      const enriched = list.map((q) => ({
        ...stripQuizAnswers(q),
        questionCount: q.questions.length,
        attemptCount: attempts.filter((a) => a.quizId === q.id).length,
      }));
      return { ok: true, result: { quizzes: [...enriched].reverse() } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "quiz-get", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const id = String(params.quizId || "");
      const quiz = (state.quizzes.get(userId) || []).find((q) => q.id === id);
      if (!quiz) return { ok: false, error: "quiz not found" };
      return { ok: true, result: { quiz: stripQuizAnswers(quiz) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Auto-graded quiz submission ──
  registerLensAction("classroom", "quiz-submit", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      const quizId = String(params.quizId || "");
      const quiz = (state.quizzes.get(userId) || []).find((q) => q.id === quizId);
      if (!quiz) return { ok: false, error: "quiz not found" };
      const studentId = String(params.studentId || userId);
      // answers: { [questionId]: answerString }
      const answers = (params.answers && typeof params.answers === "object") ? params.answers : {};
      let earned = 0;
      const breakdown = quiz.questions.map((q) => {
        const given = String(answers[q.id] ?? "").trim();
        const correct = String(q.correctAnswer ?? "").trim();
        const isCorrect = given.length > 0
          && given.toLowerCase() === correct.toLowerCase();
        if (isCorrect) earned += q.points;
        return {
          questionId: q.id,
          prompt: q.prompt,
          given,
          correctAnswer: correct,
          correct: isCorrect,
          points: q.points,
          awarded: isCorrect ? q.points : 0,
        };
      });
      const attempt = {
        id: rid("qa"),
        quizId,
        cohortId: quiz.cohortId,
        studentId,
        score: earned,
        totalPoints: quiz.totalPoints,
        percent: quiz.totalPoints > 0 ? Math.round((earned / quiz.totalPoints) * 100) : 0,
        breakdown,
        submittedAt: new Date().toISOString(),
      };
      pushTo(state.quizAttempts, userId, attempt);
      logStream(state, userId, {
        kind: "quiz_attempt", refId: attempt.id,
        text: `Quiz "${quiz.title}" attempted — ${earned}/${quiz.totalPoints}`,
        cohortId: quiz.cohortId,
      });
      saveClassState();
      return { ok: true, result: { attempt } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("classroom", "quiz-attempts", (ctx, _artifact, params = {}) => {
    try {
      const state = getClassState();
      if (!state) return { ok: false, error: "STATE unavailable" };
      const userId = uid(ctx);
      let list = state.quizAttempts.get(userId) || [];
      if (params.quizId) {
        const q = String(params.quizId);
        list = list.filter((a) => a.quizId === q);
      }
      const scores = list.map((a) => a.percent);
      const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
      return {
        ok: true,
        result: {
          attempts: [...list].reverse(),
          count: list.length,
          averagePercent: avg,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
