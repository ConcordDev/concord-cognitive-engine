// server/domains/mentorship.js
//
// Mentorship domain — pure-compute analytics (matchScore, progressTrack,
// feedbackSummary, developmentPlan) plus a full mentoring-platform surface:
// mentor directory/discovery, request→accept matching, session scheduling,
// session notes & action items, shared goal workspace, mentor reviews,
// program admin/cohort reporting, and mentor↔mentee messaging.
//
// Persistent per-user data lives in globalThis._concordSTATE Maps.

export default function registerMentorshipActions(registerLensAction) {
  // ─── Pure-compute analytics ──────────────────────────────────────────
  //
  // These four calculators are driven from BOTH frontend surfaces:
  //   1. MentorshipActionPanel (callMacro → /api/lens/run): the user pastes the
  //      EXPLICIT object shape — mentor:{skills,availability,experience},
  //      mentee:{goals,preferredSchedule}, feedback:[{rating,tags}],
  //      currentSkills/targetRole/skillGaps. The dispatch peels the redundant
  //      { artifact:{ data } } wrapper so artifact.data IS that object.
  //   2. The inline page panel (useRunArtifact → /api/lens/:domain/:id/run):
  //      runs against a STORED relation artifact whose data shape is
  //      { mentorName, menteeName, skills[], goals:string[], sessionsCompleted,
  //        rating, ... }. The explicit object keys are absent there.
  //
  // To keep BOTH surfaces honest (the inline panel previously rendered a dead
  // "undefined ↔ undefined · 0%" card because the calculators only read the
  // explicit shape), each calculator ALSO honors the stored-relation aliases.
  // Component path inputs are byte-identical — the alias fallbacks only fire
  // when the explicit field is absent.
  //
  // POISON HARDENING: numeric parsing is fail-CLOSED via finNum — a poisoned
  // "Infinity"/"1e999"/"NaN" collapses to a finite default so no computed
  // total (totalHours, avgRating) can emit Infinity/NaN.
  const finNum = (v, d = 0) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };
  const lc = (v) => String(v == null ? "" : v).toLowerCase();

  registerLensAction("mentorship", "matchScore", (ctx, artifact, _params) => {
    const data = artifact?.data || {};
    // explicit shape (component) OR relation aliases (inline panel)
    const mentor = data.mentor && typeof data.mentor === "object"
      ? data.mentor
      : { name: data.mentorName, skills: data.skills, availability: data.meetingFrequency, experience: (data.sessionsCompleted || 0) > 0 };
    const mentee = data.mentee && typeof data.mentee === "object"
      ? data.mentee
      : { name: data.menteeName, goals: data.goals, preferredSchedule: data.meetingFrequency };
    const mSkills = Array.isArray(mentor.skills) ? mentor.skills : [];
    const eGoals = Array.isArray(mentee.goals) ? mentee.goals : [];
    const skillOverlap = mSkills.filter((s) => eGoals.some((g) => lc(g).includes(lc(s)))).length;
    const availMatch = mentor.availability != null && mentor.availability === mentee.preferredSchedule ? 1 : 0.5;
    const score = Math.round((Math.min(skillOverlap / 3, 1) * 50 + availMatch * 30 + (mentor.experience ? 20 : 0)));
    return { ok: true, result: { mentor: mentor.name, mentee: mentee.name, matchScore: score, skillOverlap, compatibility: score >= 70 ? "excellent" : score >= 50 ? "good" : "fair" } };
  });

  registerLensAction("mentorship", "progressTrack", (ctx, artifact, _params) => {
    const data = artifact?.data || {};
    const goals = Array.isArray(data.goals) ? data.goals : [];
    // explicit sessions[] (component) OR a sessionsCompleted count (relation)
    const sessionsArr = Array.isArray(data.sessions) ? data.sessions : null;
    const completed = goals.filter((g) => g && typeof g === "object" && (g.completed || g.status === "done")).length;
    const sessionsCompleted = sessionsArr ? sessionsArr.length : Math.max(0, Math.round(finNum(data.sessionsCompleted)));
    const totalHours = sessionsArr
      ? sessionsArr.reduce((s, ses) => s + (finNum(ses && ses.duration, 1) || 1), 0)
      : sessionsCompleted; // 1h per recorded session when only a count is known
    return {
      ok: true,
      result: {
        totalGoals: goals.length,
        completed,
        inProgress: goals.length - completed,
        completionRate: goals.length > 0 ? Math.round((completed / goals.length) * 100) : 0,
        sessionsCompleted,
        totalHours,
        momentum: sessionsCompleted >= 4 ? "strong" : sessionsCompleted >= 2 ? "building" : "early-stage",
      },
    };
  });

  registerLensAction("mentorship", "feedbackSummary", (ctx, artifact, _params) => {
    const data = artifact?.data || {};
    const feedback = Array.isArray(data.feedback) ? data.feedback : [];
    if (feedback.length === 0) return { ok: true, result: { message: "Add session feedback to generate summary." } };
    const avgRaw = feedback.reduce((s, f) => s + finNum(f && f.rating, 3), 0) / feedback.length;
    const avg = Number.isFinite(avgRaw) ? avgRaw : 3;
    const themes = {};
    for (const f of feedback) { for (const t of ((f && f.tags) || [])) { const key = String(t); themes[key] = (themes[key] || 0) + 1; } }
    return {
      ok: true,
      result: {
        sessions: feedback.length,
        avgRating: Math.round(avg * 10) / 10,
        topThemes: Object.entries(themes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => ({ theme: t, count: c })),
        satisfaction: avg >= 4 ? "high" : avg >= 3 ? "moderate" : "needs-attention",
      },
    };
  });

  registerLensAction("mentorship", "developmentPlan", (ctx, artifact, _params) => {
    const data = artifact?.data || {};
    // explicit currentSkills (component) OR relation skills[]
    const currentSkills = Array.isArray(data.currentSkills) ? data.currentSkills : (Array.isArray(data.skills) ? data.skills : []);
    const targetRole = (data.targetRole != null && String(data.targetRole).trim()) ? String(data.targetRole) : "next level";
    const gaps = Array.isArray(data.skillGaps) ? data.skillGaps : [];
    return {
      ok: true,
      result: {
        currentSkillCount: currentSkills.length,
        targetRole,
        gaps: gaps.length > 0 ? gaps : ["Identify specific skill gaps to create plan"],
        milestones: [
          { phase: "Foundation", weeks: "1-4", focus: "Assessment and goal setting" },
          { phase: "Development", weeks: "5-12", focus: "Skill building and practice" },
          { phase: "Application", weeks: "13-20", focus: "Real-world projects" },
          { phase: "Mastery", weeks: "21-26", focus: "Teaching others and refinement" },
        ],
        timelineWeeks: 26,
      },
    };
  });

  // ─── Shared state helpers ─────────────────────────────────────────────
  function getMentorshipState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.mentorshipLens) STATE.mentorshipLens = {};
    const s = STATE.mentorshipLens;
    for (const k of ["mentors", "requests", "sessions", "goals", "reviews", "messages"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const mId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mNow = () => new Date().toISOString();
  const mAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const mNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const mList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const mArr = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);

  const REQUEST_STATUS = ["pending", "accepted", "declined", "withdrawn"];
  const SESSION_STATUS = ["scheduled", "completed", "cancelled"];
  const GOAL_STATUS = ["active", "done", "paused"];

  // ── 1. Mentor directory / discovery ───────────────────────────────────
  // Register a mentor profile (any user can list themselves as a mentor).
  registerLensAction("mentorship", "mentor-register", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const name = mClean(params.name, 80);
      if (!name) return { ok: false, error: "mentor name required" };
      const skills = mArr(params.skills).map((x) => mClean(x, 40)).filter(Boolean).slice(0, 20);
      const mentor = {
        id: userId,
        name,
        headline: mClean(params.headline, 140),
        bio: mClean(params.bio, 800),
        skills,
        experienceYears: Math.max(0, Math.round(mNum(params.experienceYears))),
        availability: mClean(params.availability, 40) || "flexible",
        capacity: Math.max(1, Math.round(mNum(params.capacity, 3))),
        hourlyFocus: mClean(params.hourlyFocus, 40) || "career",
        rating: 0,
        reviewCount: 0,
        menteeCount: 0,
        listed: params.listed !== false,
        createdAt: s.mentors.has(userId) ? s.mentors.get(userId).createdAt : mNow(),
        updatedAt: mNow(),
      };
      s.mentors.set(userId, mentor);
      saveState();
      return { ok: true, result: { mentor } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Browse / search the mentor directory.
  registerLensAction("mentorship", "mentor-directory", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const q = mClean(params.query, 60).toLowerCase();
      const skillFilter = mClean(params.skill, 40).toLowerCase();
      const minRating = mNum(params.minRating, 0);
      const sort = ["rating", "experience", "availability"].includes(params.sort) ? params.sort : "rating";
      let mentors = [...s.mentors.values()].filter((m) => m.listed);
      if (q) {mentors = mentors.filter((m) =>
        m.name.toLowerCase().includes(q) || m.headline.toLowerCase().includes(q) ||
        m.skills.some((sk) => sk.toLowerCase().includes(q)));}
      if (skillFilter) mentors = mentors.filter((m) => m.skills.some((sk) => sk.toLowerCase().includes(skillFilter)));
      if (minRating > 0) mentors = mentors.filter((m) => m.rating >= minRating);
      mentors.sort((a, b) => {
        if (sort === "experience") return b.experienceYears - a.experienceYears;
        if (sort === "availability") return (a.menteeCount / a.capacity) - (b.menteeCount / b.capacity);
        return b.rating - a.rating || b.reviewCount - a.reviewCount;
      });
      const allSkills = [...new Set([...s.mentors.values()].flatMap((m) => m.skills))].sort();
      return { ok: true, result: { mentors, count: mentors.length, skills: allSkills, sort } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Single mentor profile with reviews + open-slot count.
  registerLensAction("mentorship", "mentor-profile", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const id = mClean(params.mentorId, 64);
      const mentor = s.mentors.get(id);
      if (!mentor) return { ok: false, error: "mentor not found" };
      const reviews = mList(s.reviews, id);
      return {
        ok: true,
        result: {
          mentor,
          reviews: reviews.slice(-20).reverse(),
          openSlots: Math.max(0, mentor.capacity - mentor.menteeCount),
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── 2. Request → accept matching flow ─────────────────────────────────
  // Mentee sends a connection request to a mentor.
  registerLensAction("mentorship", "request-send", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const menteeId = mAid(ctx);
      const mentorId = mClean(params.mentorId, 64);
      if (!mentorId) return { ok: false, error: "mentorId required" };
      const mentor = s.mentors.get(mentorId);
      if (!mentor) return { ok: false, error: "mentor not found" };
      if (mentorId === menteeId) return { ok: false, error: "cannot mentor yourself" };
      const incoming = mList(s.requests, mentorId);
      if (incoming.some((r) => r.menteeId === menteeId && r.status === "pending"))
        {return { ok: false, error: "you already have a pending request to this mentor" };}
      const request = {
        id: mId("req"),
        mentorId,
        mentorName: mentor.name,
        menteeId,
        menteeName: mClean(params.menteeName, 80) || "Mentee",
        topic: mClean(params.topic, 120) || "General mentorship",
        message: mClean(params.message, 600),
        goals: mArr(params.goals).map((x) => mClean(x, 80)).filter(Boolean).slice(0, 8),
        status: "pending",
        createdAt: mNow(),
        respondedAt: null,
      };
      incoming.push(request);
      mList(s.requests, `out:${menteeId}`).push(request);
      saveState();
      return { ok: true, result: { request } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List requests — incoming (mentor view) and outgoing (mentee view).
  registerLensAction("mentorship", "request-list", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const incoming = mList(s.requests, userId);
      const outgoing = mList(s.requests, `out:${userId}`);
      const filt = (arr) => params.status && REQUEST_STATUS.includes(params.status)
        ? arr.filter((r) => r.status === params.status) : arr;
      return {
        ok: true,
        result: {
          incoming: filt(incoming).slice().reverse(),
          outgoing: filt(outgoing).slice().reverse(),
          pendingIncoming: incoming.filter((r) => r.status === "pending").length,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Mentor responds to a request: accept / decline.
  registerLensAction("mentorship", "request-respond", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const mentorId = mAid(ctx);
      const reqId = mClean(params.requestId, 64);
      const decision = params.decision === "accept" ? "accepted" : params.decision === "decline" ? "declined" : null;
      if (!decision) return { ok: false, error: "decision must be accept or decline" };
      const incoming = mList(s.requests, mentorId);
      const request = incoming.find((r) => r.id === reqId);
      if (!request) return { ok: false, error: "request not found" };
      if (request.status !== "pending") return { ok: false, error: `request already ${request.status}` };
      request.status = decision;
      request.respondedAt = mNow();
      if (decision === "accepted") {
        const mentor = s.mentors.get(mentorId);
        if (mentor) { mentor.menteeCount += 1; mentor.updatedAt = mNow(); }
      }
      saveState();
      return { ok: true, result: { request } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Mentee withdraws an outstanding request.
  registerLensAction("mentorship", "request-withdraw", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const menteeId = mAid(ctx);
      const reqId = mClean(params.requestId, 64);
      const outgoing = mList(s.requests, `out:${menteeId}`);
      const request = outgoing.find((r) => r.id === reqId);
      if (!request) return { ok: false, error: "request not found" };
      if (request.status !== "pending") return { ok: false, error: `cannot withdraw a ${request.status} request` };
      request.status = "withdrawn";
      request.respondedAt = mNow();
      saveState();
      return { ok: true, result: { request } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── 3. Session scheduling ─────────────────────────────────────────────
  registerLensAction("mentorship", "session-book", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const partnerId = mClean(params.partnerId, 64);
      const startAt = mClean(params.startAt, 40);
      if (!partnerId) return { ok: false, error: "partnerId required" };
      if (!startAt) return { ok: false, error: "startAt required" };
      const session = {
        id: mId("ses"),
        ownerId: userId,
        partnerId,
        partnerName: mClean(params.partnerName, 80) || "Partner",
        title: mClean(params.title, 120) || "Mentoring session",
        startAt,
        durationMin: Math.max(15, Math.round(mNum(params.durationMin, 45))),
        videoLink: mClean(params.videoLink, 300),
        agenda: mClean(params.agenda, 600),
        status: "scheduled",
        notes: "",
        actionItems: [],
        rating: 0,
        createdAt: mNow(),
      };
      mList(s.sessions, userId).push(session);
      // mirror onto partner so both parties see the booking
      mList(s.sessions, partnerId).push({ ...session, ownerId: partnerId, partnerId: userId });
      saveState();
      return { ok: true, result: { session } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List sessions for the caller, with optional upcoming/past filter + reminders.
  registerLensAction("mentorship", "session-list", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      let sessions = mList(s.sessions, userId).slice();
      const now = Date.now();
      if (params.filter === "upcoming") sessions = sessions.filter((x) => x.status === "scheduled" && new Date(x.startAt).getTime() >= now);
      else if (params.filter === "past") sessions = sessions.filter((x) => x.status !== "scheduled" || new Date(x.startAt).getTime() < now);
      sessions.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      const reminders = sessions.filter((x) => {
        const t = new Date(x.startAt).getTime() - now;
        return x.status === "scheduled" && t >= 0 && t <= 86400000;
      });
      return {
        ok: true,
        result: {
          sessions,
          count: sessions.length,
          upcoming: sessions.filter((x) => x.status === "scheduled" && new Date(x.startAt).getTime() >= now).length,
          completed: sessions.filter((x) => x.status === "completed").length,
          reminders,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Update a session's status (complete / cancel) and optional rating.
  registerLensAction("mentorship", "session-update", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const sesId = mClean(params.sessionId, 64);
      const session = mList(s.sessions, userId).find((x) => x.id === sesId);
      if (!session) return { ok: false, error: "session not found" };
      if (params.status && SESSION_STATUS.includes(params.status)) session.status = params.status;
      if (params.rating != null) session.rating = Math.min(5, Math.max(0, Math.round(mNum(params.rating))));
      if (params.startAt) session.startAt = mClean(params.startAt, 40);
      if (params.videoLink != null) session.videoLink = mClean(params.videoLink, 300);
      session.updatedAt = mNow();
      saveState();
      return { ok: true, result: { session } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── 4. Session notes & action items ───────────────────────────────────
  registerLensAction("mentorship", "session-note-save", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const sesId = mClean(params.sessionId, 64);
      const session = mList(s.sessions, userId).find((x) => x.id === sesId);
      if (!session) return { ok: false, error: "session not found" };
      if (params.notes != null) session.notes = mClean(params.notes, 4000);
      const newItem = mClean(params.actionItem, 240);
      if (newItem) {
        session.actionItems.push({ id: mId("ai"), text: newItem, done: false, createdAt: mNow() });
      }
      const toggleId = mClean(params.toggleItemId, 64);
      if (toggleId) {
        const item = session.actionItems.find((i) => i.id === toggleId);
        if (item) item.done = !item.done;
      }
      session.updatedAt = mNow();
      saveState();
      return { ok: true, result: { session, openActionItems: session.actionItems.filter((i) => !i.done).length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── 5. Goal tracking workspace ────────────────────────────────────────
  registerLensAction("mentorship", "goal-create", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const title = mClean(params.title, 160);
      if (!title) return { ok: false, error: "goal title required" };
      const goal = {
        id: mId("goal"),
        ownerId: userId,
        partnerId: mClean(params.partnerId, 64),
        title,
        detail: mClean(params.detail, 800),
        targetDate: mClean(params.targetDate, 20),
        progress: Math.min(100, Math.max(0, Math.round(mNum(params.progress)))),
        status: "active",
        checkIns: [],
        createdAt: mNow(),
        updatedAt: mNow(),
      };
      mList(s.goals, userId).push(goal);
      saveState();
      return { ok: true, result: { goal } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Add a progress check-in or update goal progress/status.
  registerLensAction("mentorship", "goal-checkin", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const goalId = mClean(params.goalId, 64);
      const goal = mList(s.goals, userId).find((g) => g.id === goalId);
      if (!goal) return { ok: false, error: "goal not found" };
      if (params.progress != null) goal.progress = Math.min(100, Math.max(0, Math.round(mNum(params.progress))));
      if (params.status && GOAL_STATUS.includes(params.status)) goal.status = params.status;
      const note = mClean(params.note, 600);
      if (note) {
        goal.checkIns.push({ id: mId("ci"), note, progress: goal.progress, at: mNow() });
      }
      if (goal.progress >= 100 && goal.status === "active") goal.status = "done";
      goal.updatedAt = mNow();
      saveState();
      return { ok: true, result: { goal } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List goals for the caller with a rollup.
  registerLensAction("mentorship", "goal-list", (ctx, _a, _params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const goals = mList(s.goals, userId).slice().reverse();
      const active = goals.filter((g) => g.status === "active");
      const avgProgress = goals.length
        ? Math.round(goals.reduce((acc, g) => acc + g.progress, 0) / goals.length) : 0;
      return {
        ok: true,
        result: {
          goals,
          count: goals.length,
          active: active.length,
          done: goals.filter((g) => g.status === "done").length,
          avgProgress,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── 6. Mentor reviews & ratings ───────────────────────────────────────
  registerLensAction("mentorship", "review-add", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const authorId = mAid(ctx);
      const mentorId = mClean(params.mentorId, 64);
      const rating = Math.min(5, Math.max(1, Math.round(mNum(params.rating))));
      if (!mentorId) return { ok: false, error: "mentorId required" };
      if (!params.rating) return { ok: false, error: "rating (1-5) required" };
      const mentor = s.mentors.get(mentorId);
      if (!mentor) return { ok: false, error: "mentor not found" };
      const review = {
        id: mId("rev"),
        mentorId,
        authorId,
        authorName: mClean(params.authorName, 80) || "Mentee",
        rating,
        comment: mClean(params.comment, 800),
        tags: mArr(params.tags).map((x) => mClean(x, 30)).filter(Boolean).slice(0, 6),
        createdAt: mNow(),
      };
      const reviews = mList(s.reviews, mentorId);
      reviews.push(review);
      mentor.reviewCount = reviews.length;
      mentor.rating = Math.round((reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length) * 10) / 10;
      mentor.updatedAt = mNow();
      saveState();
      return { ok: true, result: { review, mentorRating: mentor.rating, reviewCount: mentor.reviewCount } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List reviews for a mentor with a rating histogram.
  registerLensAction("mentorship", "review-list", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const mentorId = mClean(params.mentorId, 64);
      if (!mentorId) return { ok: false, error: "mentorId required" };
      const reviews = mList(s.reviews, mentorId).slice().reverse();
      const histogram = [1, 2, 3, 4, 5].map((star) => ({
        star, count: reviews.filter((r) => r.rating === star).length,
      }));
      const avg = reviews.length
        ? Math.round((reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length) * 10) / 10 : 0;
      return { ok: true, result: { reviews, count: reviews.length, avgRating: avg, histogram } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── 7. Program admin / cohort reporting ───────────────────────────────
  registerLensAction("mentorship", "program-report", (ctx, _a, _params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const mentors = [...s.mentors.values()];
      // aggregate every request across all mentor inboxes
      const allRequests = [];
      for (const [k, v] of s.requests.entries()) {
        if (!k.startsWith("out:")) allRequests.push(...v);
      }
      const accepted = allRequests.filter((r) => r.status === "accepted").length;
      const declined = allRequests.filter((r) => r.status === "declined").length;
      const pending = allRequests.filter((r) => r.status === "pending").length;
      const resolved = accepted + declined;
      // sessions: dedupe mirrored copies by id
      const sessIds = new Set();
      let totalSessions = 0, completedSessions = 0;
      const ratings = [];
      for (const list of s.sessions.values()) {
        for (const x of list) {
          if (sessIds.has(x.id)) continue;
          sessIds.add(x.id);
          totalSessions += 1;
          if (x.status === "completed") completedSessions += 1;
          if (x.rating > 0) ratings.push(x.rating);
        }
      }
      const goalIds = new Set();
      let totalGoals = 0, doneGoals = 0;
      for (const list of s.goals.values()) {
        for (const g of list) { if (goalIds.has(g.id)) continue; goalIds.add(g.id); totalGoals += 1; if (g.status === "done") doneGoals += 1; }
      }
      const ratedMentors = mentors.filter((m) => m.reviewCount > 0);
      const cohort = mentors.map((m) => ({
        mentorId: m.id, name: m.name, skills: m.skills.slice(0, 4),
        menteeCount: m.menteeCount, capacity: m.capacity,
        rating: m.rating, reviewCount: m.reviewCount,
        utilization: m.capacity > 0 ? Math.round((m.menteeCount / m.capacity) * 100) : 0,
      })).sort((a, b) => b.menteeCount - a.menteeCount);
      return {
        ok: true,
        result: {
          mentors: mentors.length,
          activeMatches: accepted,
          requests: { total: allRequests.length, accepted, declined, pending },
          matchAcceptanceRate: resolved > 0 ? Math.round((accepted / resolved) * 100) : 0,
          sessions: { total: totalSessions, completed: completedSessions },
          sessionCompletionRate: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0,
          goals: { total: totalGoals, done: doneGoals },
          goalCompletionRate: totalGoals > 0 ? Math.round((doneGoals / totalGoals) * 100) : 0,
          avgSessionRating: ratings.length
            ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0,
          avgMentorRating: ratedMentors.length
            ? Math.round((ratedMentors.reduce((a, m) => a + m.rating, 0) / ratedMentors.length) * 10) / 10 : 0,
          cohort,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── 8. Messaging between mentor & mentee ──────────────────────────────
  // Thread key is a sorted pair so both sides converge on the same thread.
  function threadKey(a, b) { return [a, b].sort().join("::"); }

  registerLensAction("mentorship", "message-send", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const fromId = mAid(ctx);
      const toId = mClean(params.toId, 64);
      const body = mClean(params.body, 2000);
      if (!toId) return { ok: false, error: "toId required" };
      if (!body) return { ok: false, error: "message body required" };
      const key = threadKey(fromId, toId);
      const thread = mList(s.messages, key);
      const message = {
        id: mId("msg"), fromId, toId,
        fromName: mClean(params.fromName, 80) || "User",
        body, at: mNow(),
      };
      thread.push(message);
      saveState();
      return { ok: true, result: { message, threadKey: key } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Fetch a conversation thread between caller and a partner.
  registerLensAction("mentorship", "message-thread", (ctx, _a, params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const partnerId = mClean(params.partnerId, 64);
      if (!partnerId) return { ok: false, error: "partnerId required" };
      const key = threadKey(userId, partnerId);
      const messages = mList(s.messages, key).slice();
      return { ok: true, result: { messages, count: messages.length, threadKey: key } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List all conversation threads the caller participates in.
  registerLensAction("mentorship", "message-inbox", (ctx, _a, _params = {}) => {
    try {
      const s = getMentorshipState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = mAid(ctx);
      const threads = [];
      for (const [key, msgs] of s.messages.entries()) {
        const parts = key.split("::");
        if (!parts.includes(userId) || msgs.length === 0) continue;
        const partnerId = parts.find((p) => p !== userId) || parts[0];
        const last = msgs[msgs.length - 1];
        threads.push({
          partnerId, threadKey: key,
          lastMessage: last.body, lastFrom: last.fromName, lastAt: last.at,
          messageCount: msgs.length,
        });
      }
      threads.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
      return { ok: true, result: { threads, count: threads.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
