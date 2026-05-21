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
    if (!(s.notifications instanceof Map)) s.notifications = new Map(); // userId -> Array<notification>
    if (!(s.watchedTags instanceof Map)) s.watchedTags = new Map();    // userId -> Set(tag)
    if (!(s.subscriptions instanceof Map)) s.subscriptions = new Map(); // userId -> Set(questionId)
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

  // ── Privilege tiers (Stack Overflow-style reputation gates) ──────────
  const PRIVILEGES = [
    { id: "ask", label: "Ask & answer", threshold: 0 },
    { id: "comment", label: "Comment anywhere", threshold: 15 },
    { id: "flag", label: "Flag posts", threshold: 25 },
    { id: "vote_up", label: "Vote up", threshold: 50 },
    { id: "vote_down", label: "Vote down", threshold: 125 },
    { id: "edit", label: "Edit any post", threshold: 300 },
    { id: "close_vote", label: "Cast close votes", threshold: 500 },
    { id: "bounty", label: "Start bounties", threshold: 75 },
    { id: "moderate", label: "Access moderation queue", threshold: 1000 },
  ];
  function hasPrivilege(s, userId, privId) {
    const p = PRIVILEGES.find((x) => x.id === privId);
    if (!p) return true;
    return rep(s, userId) >= p.threshold;
  }

  // ── Lightweight bag-of-words similarity (no external embeddings) ────
  const STOPWORDS = new Set("the a an and or but is are was how do does did i you we to of in on for with my it this that not".split(" "));
  function tokenize(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  }
  function termVector(tokens) {
    const v = new Map();
    for (const t of tokens) v.set(t, (v.get(t) || 0) + 1);
    return v;
  }
  function cosineSim(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (const [, w] of a) na += w * w;
    for (const [, w] of b) nb += w * w;
    for (const [t, w] of a) { const wb = b.get(t); if (wb) dot += w * wb; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  function questionVector(q) {
    return termVector([...tokenize(q.title), ...tokenize(q.title), ...tokenize(q.body), ...q.tags]);
  }

  function pushNotification(s, userId, n) {
    if (!s.notifications.has(userId)) s.notifications.set(userId, []);
    const arr = s.notifications.get(userId);
    arr.unshift({ id: aId("n"), read: false, createdAt: aNow(), ...n });
    if (arr.length > 100) arr.length = 100;
  }
  // ── Word-level revision diff ────────────────────────────────────────
  function diffWords(oldText, newText) {
    const o = String(oldText || "").split(/(\s+)/);
    const n = String(newText || "").split(/(\s+)/);
    const m = o.length, k = n.length;
    const lcs = Array.from({ length: m + 1 }, () => new Int32Array(k + 1));
    for (let i = m - 1; i >= 0; i--)
      for (let j = k - 1; j >= 0; j--)
        lcs[i][j] = o[i] === n[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < m && j < k) {
      if (o[i] === n[j]) { ops.push({ t: "eq", v: o[i] }); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ t: "del", v: o[i] }); i++; }
      else { ops.push({ t: "add", v: n[j] }); j++; }
    }
    while (i < m) ops.push({ t: "del", v: o[i++] });
    while (j < k) ops.push({ t: "add", v: n[j++] });
    return ops;
  }
  function recordRevision(target, field, oldValue, editorId) {
    if (!Array.isArray(target.revisions)) target.revisions = [];
    target.revisions.push({
      id: aId("rev"), field, previous: oldValue, editorId, editedAt: aNow(),
    });
    if (target.revisions.length > 50) target.revisions.shift();
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
      bodyFormat: params.bodyFormat === "markdown" ? "markdown" : "plain",
      tags: parseTags(params.tags),
      authorId: actor(ctx),
      answers: [],
      comments: [],
      votes: 0,
      views: 0,
      acceptedAnswerId: null,
      bounty: 0,
      closed: false,
      closeReason: null,
      closeVotes: [],
      flags: [],
      duplicateOf: null,
      revisions: [],
      createdAt: aNow(),
      updatedAt: aNow(),
    };
    list(s, actor(ctx)).push(q);
    // Notify watchers of any of this question's tags.
    const me = actor(ctx);
    for (const [uid, set] of s.watchedTags) {
      if (uid === me) continue;
      if (q.tags.some((t) => set.has(t))) {
        pushNotification(s, uid, { kind: "tag-watch", questionId: q.id, title: q.title, message: `New question in a tag you watch: "${q.title}"` });
      }
    }
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
      bodyFormat: params.bodyFormat === "markdown" ? "markdown" : "plain",
      authorId: actor(ctx),
      votes: 0,
      accepted: false,
      comments: [],
      flags: [],
      revisions: [],
      createdAt: aNow(),
    };
    q.answers.push(ans);
    q.updatedAt = aNow();
    // Notify the question author + subscribers (other than the answerer).
    const me = actor(ctx);
    if (q.authorId !== me) {
      pushNotification(s, q.authorId, { kind: "answer", questionId: q.id, title: q.title, message: `New answer to your question: "${q.title}"` });
    }
    for (const [uid, set] of s.subscriptions) {
      if (uid === me || uid === q.authorId) continue;
      if (set.has(q.id)) {
        pushNotification(s, uid, { kind: "subscription", questionId: q.id, title: q.title, message: `New answer on a question you follow: "${q.title}"` });
      }
    }
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

  // ── Edit history + revision diff ────────────────────────────────────
  registerLensAction("answers", "question-edit", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const q = list(s, userId).find((x) => x.id === params.id);
    if (!q) return { ok: false, error: "question not found" };
    if (q.authorId !== userId && !hasPrivilege(s, userId, "edit")) {
      return { ok: false, error: "need 300 reputation to edit another author's post" };
    }
    let changed = false;
    if (params.title != null) {
      const title = clean(params.title, 200);
      if (title.length < 8) return { ok: false, error: "title must be at least 8 characters" };
      if (title !== q.title) { recordRevision(q, "title", q.title, userId); q.title = title; changed = true; }
    }
    if (params.body != null) {
      const body = clean(params.body, 8000);
      if (body.length < 15) return { ok: false, error: "body must be at least 15 characters" };
      if (body !== q.body) { recordRevision(q, "body", q.body, userId); q.body = body; changed = true; }
    }
    if (params.tags != null) {
      const tags = parseTags(params.tags);
      if (JSON.stringify(tags) !== JSON.stringify(q.tags)) {
        recordRevision(q, "tags", q.tags.join(", "), userId); q.tags = tags; changed = true;
      }
    }
    if (params.bodyFormat === "markdown" || params.bodyFormat === "plain") q.bodyFormat = params.bodyFormat;
    if (!changed) return { ok: false, error: "no changes to apply" };
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { question: q, revisionCount: q.revisions.length } };
  });

  registerLensAction("answers", "answer-edit", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    const ans = q.answers.find((x) => x.id === params.answerId);
    if (!ans) return { ok: false, error: "answer not found" };
    if (ans.authorId !== userId && !hasPrivilege(s, userId, "edit")) {
      return { ok: false, error: "need 300 reputation to edit another author's post" };
    }
    const body = clean(params.body, 8000);
    if (body.length < 15) return { ok: false, error: "answer must be at least 15 characters" };
    if (body === ans.body) return { ok: false, error: "no changes to apply" };
    recordRevision(ans, "body", ans.body, userId);
    ans.body = body;
    if (params.bodyFormat === "markdown" || params.bodyFormat === "plain") ans.bodyFormat = params.bodyFormat;
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { answer: ans, revisionCount: ans.revisions.length } };
  });

  registerLensAction("answers", "revisions", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = list(s, actor(ctx)).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    let target = q;
    let currentBody = q.body;
    if (params.answerId) {
      target = q.answers.find((x) => x.id === params.answerId);
      if (!target) return { ok: false, error: "answer not found" };
      currentBody = target.body;
    }
    const revs = [...(target.revisions || [])];
    // Build a diff for each body revision against the value that superseded it.
    let nextBody = currentBody;
    const enriched = [];
    for (let i = revs.length - 1; i >= 0; i--) {
      const r = revs[i];
      const entry = { ...r };
      if (r.field === "body") {
        entry.diff = diffWords(r.previous, nextBody);
        nextBody = r.previous;
      }
      enriched.unshift(entry);
    }
    return { ok: true, result: { revisions: enriched, count: enriched.length, currentBody } };
  });

  // ── Duplicate-question detection + linking ──────────────────────────
  registerLensAction("answers", "find-duplicates", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const qs = list(s, actor(ctx));
    let probeVec, excludeId = null;
    if (params.questionId) {
      const q = qs.find((x) => x.id === params.questionId);
      if (!q) return { ok: false, error: "question not found" };
      probeVec = questionVector(q);
      excludeId = q.id;
    } else {
      const title = clean(params.title, 200);
      const body = clean(params.body, 8000);
      if (title.length < 4) return { ok: false, error: "title or questionId required" };
      probeVec = termVector([...tokenize(title), ...tokenize(title), ...tokenize(body)]);
    }
    const threshold = Math.max(0.1, Math.min(0.95, num(params.threshold, 0.3)));
    const matches = qs
      .filter((q) => q.id !== excludeId)
      .map((q) => ({ q, similarity: cosineSim(probeVec, questionVector(q)) }))
      .filter((m) => m.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 8)
      .map((m) => ({
        id: m.q.id, title: m.q.title, tags: m.q.tags, votes: m.q.votes,
        answerCount: m.q.answers.length, hasAccepted: !!m.q.acceptedAnswerId,
        similarity: Math.round(m.similarity * 1000) / 1000,
      }));
    return { ok: true, result: { matches, count: matches.length, threshold } };
  });

  registerLensAction("answers", "link-duplicate", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const qs = list(s, actor(ctx));
    const q = qs.find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    if (params.duplicateOf === null || params.duplicateOf === "") {
      q.duplicateOf = null;
      q.updatedAt = aNow();
      save();
      return { ok: true, result: { questionId: q.id, duplicateOf: null } };
    }
    const target = qs.find((x) => x.id === params.duplicateOf);
    if (!target) return { ok: false, error: "target question not found" };
    if (target.id === q.id) return { ok: false, error: "a question cannot duplicate itself" };
    q.duplicateOf = { id: target.id, title: target.title };
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { questionId: q.id, duplicateOf: q.duplicateOf } };
  });

  // ── Privilege tiers ─────────────────────────────────────────────────
  registerLensAction("answers", "privileges", (ctx, _a, _params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const reputation = rep(s, userId);
    const tiers = PRIVILEGES.map((p) => ({
      ...p, unlocked: reputation >= p.threshold,
      remaining: Math.max(0, p.threshold - reputation),
    })).sort((a, b) => a.threshold - b.threshold);
    const next = tiers.find((t) => !t.unlocked) || null;
    return { ok: true, result: { reputation, tiers, nextUnlock: next, unlockedCount: tiers.filter((t) => t.unlocked).length } };
  });

  // ── Tag-watch / question subscription / notifications ───────────────
  registerLensAction("answers", "tag-watch", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    if (!s.watchedTags.has(userId)) s.watchedTags.set(userId, new Set());
    const set = s.watchedTags.get(userId);
    if (params.tag != null) {
      const tag = clean(params.tag, 35).toLowerCase().replace(/[^a-z0-9.+#-]/g, "");
      if (!tag) return { ok: false, error: "tag required" };
      if (set.has(tag)) set.delete(tag); else set.add(tag);
    }
    save();
    return { ok: true, result: { watchedTags: [...set].sort() } };
  });

  registerLensAction("answers", "question-subscribe", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    if (!s.subscriptions.has(userId)) s.subscriptions.set(userId, new Set());
    const set = s.subscriptions.get(userId);
    let subscribed;
    if (set.has(q.id)) { set.delete(q.id); subscribed = false; }
    else { set.add(q.id); subscribed = true; }
    save();
    return { ok: true, result: { questionId: q.id, subscribed } };
  });

  registerLensAction("answers", "notifications", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const all = s.notifications.get(userId) || [];
    const items = params.unreadOnly ? all.filter((n) => !n.read) : all;
    return { ok: true, result: { notifications: items, count: items.length, unread: all.filter((n) => !n.read).length } };
  });

  registerLensAction("answers", "notifications-mark", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const all = s.notifications.get(userId) || [];
    if (params.id) {
      const n = all.find((x) => x.id === params.id);
      if (n) n.read = true;
    } else if (params.clear) {
      s.notifications.set(userId, []);
    } else {
      for (const n of all) n.read = true;
    }
    save();
    const remaining = s.notifications.get(userId) || [];
    return { ok: true, result: { unread: remaining.filter((n) => !n.read).length, count: remaining.length } };
  });

  // ── Related questions sidebar ───────────────────────────────────────
  registerLensAction("answers", "related", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const qs = list(s, actor(ctx));
    const q = qs.find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    const probeVec = questionVector(q);
    const tagSet = new Set(q.tags);
    const related = qs
      .filter((x) => x.id !== q.id)
      .map((x) => {
        const sharedTags = x.tags.filter((t) => tagSet.has(t)).length;
        const sim = cosineSim(probeVec, questionVector(x));
        return { x, score: sim + sharedTags * 0.15, sharedTags };
      })
      .filter((r) => r.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((r) => ({
        id: r.x.id, title: r.x.title, votes: r.x.votes, answerCount: r.x.answers.length,
        hasAccepted: !!r.x.acceptedAnswerId, sharedTags: r.sharedTags,
        relevance: Math.round(r.score * 1000) / 1000,
      }));
    return { ok: true, result: { related, count: related.length } };
  });

  // ── Flags / close-votes / moderation queue ──────────────────────────
  const FLAG_REASONS = ["spam", "rude or abusive", "low quality", "not an answer", "needs improvement"];
  const CLOSE_REASONS = ["duplicate", "needs detail or clarity", "opinion-based", "off-topic", "too broad"];
  const CLOSE_VOTE_THRESHOLD = 3;

  registerLensAction("answers", "flag", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    if (!hasPrivilege(s, userId, "flag")) return { ok: false, error: "need 25 reputation to flag posts" };
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    const reason = FLAG_REASONS.includes(params.reason) ? params.reason : FLAG_REASONS[0];
    let target = q, targetType = "question";
    if (params.answerId) {
      target = q.answers.find((x) => x.id === params.answerId);
      if (!target) return { ok: false, error: "answer not found" };
      targetType = "answer";
    }
    if (!Array.isArray(target.flags)) target.flags = [];
    if (target.flags.some((f) => f.flaggedBy === userId && f.status === "pending")) {
      return { ok: false, error: "you already have a pending flag on this post" };
    }
    const flag = {
      id: aId("flag"), reason, note: clean(params.note, 280), flaggedBy: userId,
      targetType, status: "pending", createdAt: aNow(),
    };
    target.flags.push(flag);
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { flag, flagReasons: FLAG_REASONS } };
  });

  registerLensAction("answers", "close-vote", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    if (!hasPrivilege(s, userId, "close_vote")) return { ok: false, error: "need 500 reputation to cast close votes" };
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    if (q.closed) return { ok: false, error: "question is already closed" };
    const reason = CLOSE_REASONS.includes(params.reason) ? params.reason : CLOSE_REASONS[0];
    if (!Array.isArray(q.closeVotes)) q.closeVotes = [];
    const existing = q.closeVotes.findIndex((v) => v.voterId === userId);
    if (existing >= 0) {
      q.closeVotes.splice(existing, 1); // toggle off
    } else {
      q.closeVotes.push({ voterId: userId, reason, votedAt: aNow() });
    }
    let closed = false;
    if (q.closeVotes.length >= CLOSE_VOTE_THRESHOLD) {
      q.closed = true;
      q.closeReason = q.closeVotes[0].reason;
      closed = true;
    }
    q.updatedAt = aNow();
    save();
    return {
      ok: true,
      result: {
        questionId: q.id, closeVotes: q.closeVotes.length, threshold: CLOSE_VOTE_THRESHOLD,
        closed, closeReason: q.closeReason, closeReasons: CLOSE_REASONS,
      },
    };
  });

  registerLensAction("answers", "reopen", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    if (q.authorId !== userId && !hasPrivilege(s, userId, "close_vote")) {
      return { ok: false, error: "need 500 reputation to reopen another author's question" };
    }
    q.closed = false;
    q.closeReason = null;
    q.closeVotes = [];
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { questionId: q.id, closed: false } };
  });

  registerLensAction("answers", "mod-queue", (ctx, _a, _params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    if (!hasPrivilege(s, userId, "moderate")) return { ok: false, error: "need 1000 reputation to access the moderation queue" };
    const items = [];
    for (const q of list(s, userId)) {
      for (const f of (q.flags || [])) {
        if (f.status === "pending") {
          items.push({ ...f, questionId: q.id, questionTitle: q.title, answerId: null, excerpt: q.body.slice(0, 140) });
        }
      }
      for (const a of q.answers) {
        for (const f of (a.flags || [])) {
          if (f.status === "pending") {
            items.push({ ...f, questionId: q.id, questionTitle: q.title, answerId: a.id, excerpt: a.body.slice(0, 140) });
          }
        }
      }
      if (q.closeVotes && q.closeVotes.length > 0 && !q.closed) {
        items.push({
          id: `cv_${q.id}`, kind: "close-vote-pending", questionId: q.id, questionTitle: q.title,
          answerId: null, status: "pending", reason: q.closeVotes[0].reason,
          closeVotes: q.closeVotes.length, threshold: CLOSE_VOTE_THRESHOLD, createdAt: q.updatedAt,
        });
      }
    }
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { ok: true, result: { queue: items, count: items.length } };
  });

  registerLensAction("answers", "mod-resolve", (ctx, _a, params = {}) => {
    const s = getAnswersState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    if (!hasPrivilege(s, userId, "moderate")) return { ok: false, error: "need 1000 reputation to resolve flags" };
    const q = list(s, userId).find((x) => x.id === params.questionId);
    if (!q) return { ok: false, error: "question not found" };
    let target = q;
    if (params.answerId) {
      target = q.answers.find((x) => x.id === params.answerId);
      if (!target) return { ok: false, error: "answer not found" };
    }
    const flag = (target.flags || []).find((f) => f.id === params.flagId);
    if (!flag) return { ok: false, error: "flag not found" };
    const decision = params.decision === "declined" ? "declined" : "actioned";
    flag.status = decision;
    flag.resolvedBy = userId;
    flag.resolvedAt = aNow();
    if (decision === "actioned" && flag.flaggedBy && flag.flaggedBy !== userId) {
      addRep(s, flag.flaggedBy, 2); // helpful-flag reward
      pushNotification(s, flag.flaggedBy, {
        kind: "flag-resolved", questionId: q.id, title: q.title,
        message: `Your flag on "${q.title}" was actioned (+2 rep)`,
      });
    }
    q.updatedAt = aNow();
    save();
    return { ok: true, result: { flagId: flag.id, status: flag.status, decision } };
  });
}
