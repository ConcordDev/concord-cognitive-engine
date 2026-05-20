// server/domains/answers.js
//
// Stack Overflow / Quora 2026-parity Q&A backend. A per-user Q&A
// workspace: ask questions, post answers, vote, accept, comment,
// tag, run bounties, and accrue reputation.
//
// Per-user STATE model (consistent with music / message / whiteboard
// lens domains) — questions, answers, votes and reputation are all
// scoped to the acting user.

export default function registerAnswersActions(registerLensAction) {
  function getAnswersState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.answersLens) STATE.answersLens = {};
    const s = STATE.answersLens;
    if (!(s.questions instanceof Map)) s.questions = new Map();   // userId -> Array<question>
    if (!(s.reputation instanceof Map)) s.reputation = new Map(); // userId -> number
    if (!(s.voteLog instanceof Map)) s.voteLog = new Map();       // userId -> Set("type:id")
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const aId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const aNow = () => new Date().toISOString();
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const clean = (v, max = 280) => String(v == null ? "" : v).trim().slice(0, max);
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const list = (s, userId) => { if (!s.questions.has(userId)) s.questions.set(userId, []); return s.questions.get(userId); };
  const rep = (s, userId) => s.reputation.get(userId) || 0;
  function addRep(s, userId, delta) { s.reputation.set(userId, Math.max(0, rep(s, userId) + delta)); }
  function parseTags(raw) {
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === "string") arr = raw.split(/[,\s]+/);
    return [...new Set(arr.map((t) => clean(t, 35).toLowerCase().replace(/[^a-z0-9.+#-]/g, "")).filter(Boolean))].slice(0, 5);
  }

  // ── Questions ──────────────────────────────────────────────────────
  registerLensAction("answers", "question-ask", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = clean(params.title, 200);
    if (title.length < 8) return { ok: false, error: "title must be at least 8 characters" };
    const body = clean(params.body, 8000);
    if (body.length < 15) return { ok: false, error: "body must be at least 15 characters" };
    const q = {
      id: aId("q"),
      title,
      body,
      tags: parseTags(params.tags),
      authorId: actor(ctx),
      answers: [],
      comments: [],
      votes: 0,
      views: 0,
      acceptedAnswerId: null,
      bounty: 0,
      closed: false,
      createdAt: aNow(),
      updatedAt: aNow(),
    };
    list(s, actor(ctx)).push(q);
    save();
    return { ok: true, result: { question: q } };
  });

  registerLensAction("answers", "question-list", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let qs = [...list(s, actor(ctx))];
    if (params.tag) {
      const t = clean(params.tag, 35).toLowerCase();
      qs = qs.filter((q) => q.tags.includes(t));
    }
    const query = clean(params.query, 120).toLowerCase();
    if (query) qs = qs.filter((q) => q.title.toLowerCase().includes(query) || q.body.toLowerCase().includes(query));
    if (params.filter === "unanswered") qs = qs.filter((q) => q.answers.length === 0);
    else if (params.filter === "accepted") qs = qs.filter((q) => q.acceptedAnswerId);
    else if (params.filter === "bountied") qs = qs.filter((q) => q.bounty > 0);
    const sort = params.sort || "newest";
    if (sort === "votes") qs.sort((a, b) => b.votes - a.votes);
    else if (sort === "active") qs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else if (sort === "answers") qs.sort((a, b) => b.answers.length - a.answers.length);
    else qs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const summary = qs.map((q) => ({
      id: q.id, title: q.title, tags: q.tags, votes: q.votes, views: q.views,
      answerCount: q.answers.length, hasAccepted: !!q.acceptedAnswerId, bounty: q.bounty,
      excerpt: q.body.slice(0, 160), createdAt: q.createdAt,
    }));
    return { ok: true, result: { questions: summary, count: summary.length } };
  });

  registerLensAction("answers", "question-detail", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = list(s, actor(ctx)).find((x) => x.id === params.id);
    if (!q) return { ok: false, error: "question not found" };
    q.views += 1;
    save();
    const answers = [...q.answers].sort((a, b) => {
      if (a.id === q.acceptedAnswerId) return -1;
      if (b.id === q.acceptedAnswerId) return 1;
      return b.votes - a.votes;
    });
    return { ok: true, result: { question: { ...q, answers } } };
  });

  registerLensAction("answers", "question-delete", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = list(s, actor(ctx));
    const i = arr.findIndex((q) => q.id === params.id);
    if (i < 0) return { ok: false, error: "question not found" };
    arr.splice(i, 1);
    save();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Answers ────────────────────────────────────────────────────────
  registerLensAction("answers", "answer-post", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = list(s, actor(ctx)).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    if (q.closed) return { ok: false, error: "question is closed" };
    const body = clean(params.body, 8000);
    if (body.length < 15) return { ok: false, error: "answer must be at least 15 characters" };
    const ans = {
      id: aId("a"),
      body,
      authorId: actor(ctx),
      votes: 0,
      accepted: false,
      comments: [],
      createdAt: aNow(),
    };
    q.answers.push(ans);
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { answer: ans, answerCount: q.answers.length } };
  });

  registerLensAction("answers", "answer-delete", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = list(s, actor(ctx)).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    const i = q.answers.findIndex((x) => x.id === params.answerId);
    if (i < 0) return { ok: false, error: "answer not found" };
    if (q.acceptedAnswerId === params.answerId) q.acceptedAnswerId = null;
    q.answers.splice(i, 1);
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { deleted: params.answerId } };
  });

  registerLensAction("answers", "answer-accept", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    if (q.authorId !== userId) return { ok: false, error: "only the question author can accept an answer" };
    const ans = q.answers.find((x) => x.id === params.answerId);
    if (!ans) return { ok: false, error: "answer not found" };
    // toggle: if already accepted, un-accept
    if (q.acceptedAnswerId === ans.id) {
      q.acceptedAnswerId = null;
      ans.accepted = false;
      addRep(s, ans.authorId, -15);
    } else {
      if (q.acceptedAnswerId) {
        const prev = q.answers.find((x) => x.id === q.acceptedAnswerId);
        if (prev) { prev.accepted = false; addRep(s, prev.authorId, -15); }
      }
      q.acceptedAnswerId = ans.id;
      ans.accepted = true;
      addRep(s, ans.authorId, 15);
      // award an active bounty
      if (q.bounty > 0) { addRep(s, ans.authorId, q.bounty); q.bounty = 0; }
    }
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { acceptedAnswerId: q.acceptedAnswerId, reputation: rep(s, ans.authorId) } };
  });

  // ── Voting (reputation-bearing) ────────────────────────────────────
  registerLensAction("answers", "vote", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const targetType = params.targetType === "answer" ? "answer" : "question";
    const dir = params.direction === "down" ? -1 : 1;
    const q = list(s, userId).find((x) => x.id === params.questionId || x.id === params.targetId);
    if (!q) return { ok: false, error: "question not found" };
    let target = q;
    if (targetType === "answer") {
      target = q.answers.find((x) => x.id === params.targetId);
      if (!target) return { ok: false, error: "answer not found" };
    }
    if (!s.voteLog.has(userId)) s.voteLog.set(userId, new Set());
    const voteSet = s.voteLog.get(userId);
    const key = `${targetType}:${target.id}`;
    if (voteSet.has(`${key}:${dir}`)) {
      // undo
      voteSet.delete(`${key}:${dir}`);
      target.votes -= dir;
      addRep(s, target.authorId, dir > 0 ? (targetType === "answer" ? -10 : -5) : 2);
    } else {
      voteSet.delete(`${key}:${-dir}`); // clear opposite
      target.votes += dir;
      addRep(s, target.authorId, dir > 0 ? (targetType === "answer" ? 10 : 5) : -2);
      voteSet.add(`${key}:${dir}`);
    }
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { targetId: target.id, votes: target.votes, reputation: rep(s, target.authorId) } };
  });

  // ── Comments ───────────────────────────────────────────────────────
  registerLensAction("answers", "comment-add", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    const body = clean(params.body, 600);
    if (!body) return { ok: false, error: "comment body required" };
    const comment = { id: aId("c"), body, authorId: userId, createdAt: aNow() };
    if (params.targetType === "answer") {
      const ans = q.answers.find((x) => x.id === params.targetId);
      if (!ans) return { ok: false, error: "answer not found" };
      ans.comments.push(comment);
    } else {
      q.comments.push(comment);
    }
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { comment } };
  });

  // ── Tags ───────────────────────────────────────────────────────────
  registerLensAction("answers", "tag-list", (ctx, _a, _params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const counts = {};
    for (const q of list(s, actor(ctx))) {
      for (const t of q.tags) {
        if (!counts[t]) counts[t] = { tag: t, questionCount: 0, answeredCount: 0 };
        counts[t].questionCount += 1;
        if (q.acceptedAnswerId) counts[t].answeredCount += 1;
      }
    }
    const tags = Object.values(counts).sort((a, b) => b.questionCount - a.questionCount);
    return { ok: true, result: { tags, count: tags.length } };
  });

  // ── Bounties ───────────────────────────────────────────────────────
  registerLensAction("answers", "bounty-start", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    const amount = Math.max(50, Math.min(500, Math.round(num(params.amount, 50) / 50) * 50));
    if (rep(s, userId) < amount) return { ok: false, error: `need ${amount} reputation to start this bounty` };
    addRep(s, userId, -amount);
    q.bounty += amount;
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { questionId: q.id, bounty: q.bounty, reputation: rep(s, userId) } };
  });

  // ── Search & dashboard ─────────────────────────────────────────────
  registerLensAction("answers", "search", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const query = clean(params.query, 120).toLowerCase();
    if (!query) return { ok: false, error: "query required" };
    const results = list(s, actor(ctx))
      .map((q) => {
        let score = 0;
        if (q.title.toLowerCase().includes(query)) score += 5;
        if (q.body.toLowerCase().includes(query)) score += 2;
        if (q.tags.some((t) => t.includes(query))) score += 3;
        for (const a of q.answers) if (a.body.toLowerCase().includes(query)) score += 1;
        return { q, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.q.votes - a.q.votes)
      .slice(0, 25)
      .map((r) => ({
        id: r.q.id, title: r.q.title, tags: r.q.tags, votes: r.q.votes,
        answerCount: r.q.answers.length, hasAccepted: !!r.q.acceptedAnswerId, score: r.score,
      }));
    return { ok: true, result: { results, count: results.length } };
  });

  registerLensAction("answers", "user-reputation", (ctx, _a, _params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const qs = list(s, userId);
    const answersPosted = qs.reduce((n, q) => n + q.answers.filter((a) => a.authorId === userId).length, 0);
    const accepted = qs.reduce((n, q) => n + q.answers.filter((a) => a.authorId === userId && a.accepted).length, 0);
    const reputation = rep(s, userId);
    const badge = reputation >= 1000 ? "trusted" : reputation >= 200 ? "established" : reputation >= 50 ? "contributor" : "newcomer";
    return {
      ok: true,
      result: { reputation, badge, questionsAsked: qs.length, answersPosted, acceptedAnswers: accepted },
    };
  });

  registerLensAction("answers", "dashboard", (ctx, _a, _params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const qs = list(s, userId);
    return {
      ok: true,
      result: {
        questions: qs.length,
        unanswered: qs.filter((q) => q.answers.length === 0).length,
        answered: qs.filter((q) => q.acceptedAnswerId).length,
        totalAnswers: qs.reduce((n, q) => n + q.answers.length, 0),
        totalViews: qs.reduce((n, q) => n + q.views, 0),
        openBounties: qs.filter((q) => q.bounty > 0).length,
        reputation: rep(s, userId),
      },
    };
  });

  function decodeHtml(str) {
    return String(str)
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
  }

  // feed — ingest hot Stack Overflow questions (Stack Exchange API) as DTUs.
  registerLensAction("answers", "feed", async (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    const site = String(params.site || "stackoverflow").replace(/[^a-z.]/g, "") || "stackoverflow";
    try {
      const r = await fetch(`https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&pagesize=${limit}&site=${site}`);
      if (!r.ok) return { ok: false, error: `stack exchange ${r.status}` };
      const data = await r.json();
      const questions = data.items || [];
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const q of questions) {
        if (s.feedSeen.has(String(q.question_id))) { skipped++; continue; }
        const title = decodeHtml(q.title || "Untitled question");
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nScore: ${q.score} · Answers: ${q.answer_count}${q.is_answered ? " (answered)" : ""}\nTags: ${(q.tags || []).join(", ")}\n${q.link || ""}`,
          tags: ["answers", "feed", "stackoverflow", ...(q.tags || []).slice(0, 4)],
          source: "stack-exchange-feed",
          meta: { questionId: q.question_id, score: q.score, answerCount: q.answer_count, isAnswered: q.is_answered, link: q.link, site },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(String(q.question_id)); }
      }
      save();
      return { ok: true, result: { ingested, skipped, source: "stack-exchange", dtuIds } };
    } catch (e) {
      return { ok: false, error: `stack exchange unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
