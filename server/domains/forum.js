// server/domains/forum.js
export default function registerForumActions(registerLensAction) {
  registerLensAction("forum", "threadAnalysis", (ctx, artifact, _params) => {
    const posts = artifact.data?.posts || [];
    if (posts.length === 0) return { ok: true, result: { message: "Add thread posts to analyze discussion." } };
    const authors = {};
    for (const p of posts) { const a = p.author || "anonymous"; authors[a] = (authors[a] || 0) + 1; }
    const avgLength = Math.round(posts.reduce((s, p) => s + ((p.content || "").length), 0) / posts.length);
    const topContributors = Object.entries(authors).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { ok: true, result: { totalPosts: posts.length, uniqueAuthors: Object.keys(authors).length, avgPostLength: avgLength, topContributors: topContributors.map(([name, count]) => ({ name, posts: count })), health: posts.length > 5 && Object.keys(authors).length > 2 ? "active-discussion" : posts.length > 0 ? "needs-engagement" : "empty" } };
  });
  registerLensAction("forum", "moderationQueue", (ctx, artifact, _params) => {
    const reports = artifact.data?.reports || [];
    const pending = reports.filter(r => r.status === "pending" || !r.status);
    const byReason = {};
    for (const r of pending) { const reason = r.reason || "other"; byReason[reason] = (byReason[reason] || 0) + 1; }
    return { ok: true, result: { totalReports: reports.length, pending: pending.length, resolved: reports.filter(r => r.status === "resolved").length, byReason, oldestPending: pending.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())[0]?.date || null, urgency: pending.length > 10 ? "high" : pending.length > 3 ? "medium" : "low" } };
  });
  registerLensAction("forum", "communityHealth", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const activeUsers = parseInt(data.activeUsers) || 0;
    const totalUsers = parseInt(data.totalUsers) || 1;
    const postsThisWeek = parseInt(data.postsThisWeek) || 0;
    const postsLastWeek = parseInt(data.postsLastWeek) || 1;
    const growth = ((postsThisWeek - postsLastWeek) / postsLastWeek) * 100;
    const activityRate = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;
    return { ok: true, result: { activeUsers, totalUsers, activityRate, postsThisWeek, growthRate: Math.round(growth), health: activityRate > 30 ? "thriving" : activityRate > 10 ? "healthy" : activityRate > 3 ? "declining" : "dormant", recommendations: activityRate < 10 ? ["Post conversation starters", "Highlight top contributors", "Send weekly digest"] : ["Maintain engagement momentum"] } };
  });
  registerLensAction("forum", "topicClustering", (ctx, artifact, _params) => {
    const threads = artifact.data?.threads || [];
    if (threads.length === 0) return { ok: true, result: { message: "Add threads to cluster by topic." } };
    const tagCounts = {};
    for (const t of threads) { for (const tag of (t.tags || [])) { tagCounts[tag] = (tagCounts[tag] || 0) + 1; } }
    const clusters = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ topic: tag, threads: count, share: Math.round((count / threads.length) * 100) }));
    return { ok: true, result: { totalThreads: threads.length, clusters: clusters.slice(0, 10), topTopic: clusters[0]?.topic || "general", uncategorized: threads.filter(t => !t.tags || t.tags.length === 0).length } };
  });

  // ─── Discourse + Reddit 2026 parity — community forum ───────────────
  // Categories + tags, topics with replies, voting, a moderation flag
  // queue, a trust-tier reputation system and search.

  function getFmState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.forumLens) STATE.forumLens = {};
    const s = STATE.forumLens;
    for (const k of ["categories", "topics", "posts", "flags"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveFmState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const fmId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fmNow = () => new Date().toISOString();
  const fmAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fmListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const fmNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const fmClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const fmScore = (voters) => Object.values(voters || {}).reduce((a, v) => a + v, 0);

  // ── Categories ──────────────────────────────────────────────────────
  registerLensAction("forum", "category-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = fmClean(params.name, 80);
    if (!name) return { ok: false, error: "category name required" };
    const category = {
      id: fmId("cat"), name,
      description: fmClean(params.description, 400) || null,
      color: fmClean(params.color, 16) || "sky",
      createdAt: fmNow(),
    };
    fmListB(s.categories, fmAid(ctx)).push(category);
    saveFmState();
    return { ok: true, result: { category } };
  });

  registerLensAction("forum", "category-list", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topics = s.topics.get(userId) || [];
    const categories = (s.categories.get(userId) || []).map((c) => ({
      ...c,
      topicCount: topics.filter((t) => t.categoryId === c.id).length,
    }));
    return { ok: true, result: { categories, count: categories.length } };
  });

  registerLensAction("forum", "category-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.categories.get(userId) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "category not found" };
    arr.splice(i, 1);
    // orphan topics keep existing but lose the category link
    for (const t of s.topics.get(userId) || []) {
      if (t.categoryId === params.id) t.categoryId = null;
    }
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Topics ──────────────────────────────────────────────────────────
  registerLensAction("forum", "topic-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const title = fmClean(params.title, 200);
    if (!title) return { ok: false, error: "topic title required" };
    let categoryId = params.categoryId ? String(params.categoryId) : null;
    if (categoryId && !(s.categories.get(userId) || []).some((c) => c.id === categoryId)) categoryId = null;
    const topic = {
      id: fmId("top"), categoryId, title,
      body: fmClean(params.body, 8000) || "",
      tags: Array.isArray(params.tags)
        ? [...new Set(params.tags.map((t) => fmClean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 8) : [],
      author: fmClean(params.author, 60) || "Me",
      pinned: false, locked: false,
      voters: {}, score: 0,
      createdAt: fmNow(), updatedAt: fmNow(),
    };
    fmListB(s.topics, userId).push(topic);
    saveFmState();
    return { ok: true, result: { topic } };
  });

  registerLensAction("forum", "topic-list", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const posts = s.posts.get(userId) || [];
    let topics = (s.topics.get(userId) || []).map((t) => ({
      ...t,
      replyCount: posts.filter((p) => p.topicId === t.id).length,
    }));
    if (params.categoryId) topics = topics.filter((t) => t.categoryId === String(params.categoryId));
    if (params.tag) topics = topics.filter((t) => t.tags.includes(String(params.tag).toLowerCase()));
    const sort = ["latest", "top", "new"].includes(String(params.sort)) ? String(params.sort) : "latest";
    topics.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "top") return b.score - a.score;
      if (sort === "new") return b.createdAt.localeCompare(a.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return { ok: true, result: { topics, count: topics.length, sort } };
  });

  registerLensAction("forum", "topic-get", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topic = (s.topics.get(userId) || []).find((t) => t.id === params.id);
    if (!topic) return { ok: false, error: "topic not found" };
    const posts = (s.posts.get(userId) || [])
      .filter((p) => p.topicId === topic.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, result: { topic, posts, replyCount: posts.length } };
  });

  registerLensAction("forum", "topic-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.topics.get(userId) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "topic not found" };
    arr.splice(i, 1);
    s.posts.set(userId, (s.posts.get(userId) || []).filter((p) => p.topicId !== params.id));
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("forum", "topic-pin", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const topic = (s.topics.get(fmAid(ctx)) || []).find((t) => t.id === params.id);
    if (!topic) return { ok: false, error: "topic not found" };
    topic.pinned = params.pinned !== false;
    saveFmState();
    return { ok: true, result: { id: topic.id, pinned: topic.pinned } };
  });

  registerLensAction("forum", "topic-lock", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const topic = (s.topics.get(fmAid(ctx)) || []).find((t) => t.id === params.id);
    if (!topic) return { ok: false, error: "topic not found" };
    topic.locked = params.locked !== false;
    saveFmState();
    return { ok: true, result: { id: topic.id, locked: topic.locked } };
  });

  // ── Posts / replies ─────────────────────────────────────────────────
  registerLensAction("forum", "post-reply", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topic = (s.topics.get(userId) || []).find((t) => t.id === params.topicId);
    if (!topic) return { ok: false, error: "topic not found" };
    if (topic.locked) return { ok: false, error: "topic is locked" };
    const body = fmClean(params.body, 8000);
    if (!body) return { ok: false, error: "reply body required" };
    const post = {
      id: fmId("pst"), topicId: topic.id, body,
      author: fmClean(params.author, 60) || "Me",
      voters: {}, score: 0,
      createdAt: fmNow(),
    };
    fmListB(s.posts, userId).push(post);
    topic.updatedAt = fmNow();
    saveFmState();
    return { ok: true, result: { post } };
  });

  registerLensAction("forum", "post-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.posts.get(fmAid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "post not found" };
    arr.splice(i, 1);
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Voting ──────────────────────────────────────────────────────────
  registerLensAction("forum", "vote", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const targetType = params.targetType === "post" ? "post" : "topic";
    const bucket = targetType === "post" ? s.posts.get(userId) : s.topics.get(userId);
    const item = (bucket || []).find((x) => x.id === params.targetId);
    if (!item) return { ok: false, error: `${targetType} not found` };
    const dir = Math.sign(fmNum(params.direction));
    if (!item.voters) item.voters = {};
    if (dir === 0) delete item.voters[userId];
    else item.voters[userId] = dir;
    item.score = fmScore(item.voters);
    saveFmState();
    return { ok: true, result: { targetType, targetId: item.id, score: item.score } };
  });

  // ── Tags ────────────────────────────────────────────────────────────
  registerLensAction("forum", "tag-list", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const counts = {};
    for (const t of s.topics.get(fmAid(ctx)) || []) {
      for (const tag of t.tags) counts[tag] = (counts[tag] || 0) + 1;
    }
    const tags = Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    return { ok: true, result: { tags, count: tags.length } };
  });

  // ── Moderation ──────────────────────────────────────────────────────
  registerLensAction("forum", "flag-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const targetType = params.targetType === "post" ? "post" : "topic";
    const flag = {
      id: fmId("flg"), targetType,
      targetId: fmClean(params.targetId, 60),
      reason: ["spam", "off_topic", "inappropriate", "harassment", "other"].includes(String(params.reason))
        ? String(params.reason) : "other",
      note: fmClean(params.note, 300) || null,
      status: "pending", action: null,
      createdAt: fmNow(),
    };
    if (!flag.targetId) return { ok: false, error: "targetId required" };
    fmListB(s.flags, fmAid(ctx)).push(flag);
    saveFmState();
    return { ok: true, result: { flag } };
  });

  registerLensAction("forum", "flag-queue", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = s.flags.get(fmAid(ctx)) || [];
    const pending = all.filter((f) => f.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const byReason = {};
    for (const f of pending) byReason[f.reason] = (byReason[f.reason] || 0) + 1;
    return {
      ok: true,
      result: { pending, pendingCount: pending.length, resolvedCount: all.filter((f) => f.status === "resolved").length, byReason },
    };
  });

  registerLensAction("forum", "flag-resolve", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const flag = (s.flags.get(fmAid(ctx)) || []).find((f) => f.id === params.id);
    if (!flag) return { ok: false, error: "flag not found" };
    flag.status = "resolved";
    flag.action = ["dismissed", "content_removed", "warned"].includes(String(params.action))
      ? String(params.action) : "dismissed";
    saveFmState();
    return { ok: true, result: { id: flag.id, status: flag.status, action: flag.action } };
  });

  // ── Reputation / trust tier ─────────────────────────────────────────
  registerLensAction("forum", "user-reputation", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topics = s.topics.get(userId) || [];
    const posts = s.posts.get(userId) || [];
    const contributions = topics.length + posts.length;
    const karma = topics.reduce((a, t) => a + (t.score || 0), 0)
      + posts.reduce((a, p) => a + (p.score || 0), 0);
    let tier = "new";
    if (contributions >= 150 && karma >= 150) tier = "leader";
    else if (contributions >= 50 && karma >= 50) tier = "regular";
    else if (contributions >= 20 && karma >= 10) tier = "member";
    else if (contributions >= 5) tier = "basic";
    return {
      ok: true,
      result: { tier, contributions, topics: topics.length, replies: posts.length, karma },
    };
  });

  // ── Search ──────────────────────────────────────────────────────────
  registerLensAction("forum", "forum-search", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = fmClean(params.query, 120).toLowerCase();
    if (!q) return { ok: false, error: "search query required" };
    const userId = fmAid(ctx);
    const topics = (s.topics.get(userId) || []).filter(
      (t) => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)
        || t.tags.some((tag) => tag.includes(q)));
    const topicIds = new Set(topics.map((t) => t.id));
    const posts = (s.posts.get(userId) || []).filter((p) => p.body.toLowerCase().includes(q));
    // surface topics that have a matching reply too
    for (const p of posts) topicIds.add(p.topicId);
    return {
      ok: true,
      result: {
        topics: topics.slice(0, 40),
        matchingReplies: posts.length,
        topicHits: topicIds.size,
        query: q,
      },
    };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("forum", "forum-dashboard", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topics = s.topics.get(userId) || [];
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    return {
      ok: true,
      result: {
        categories: (s.categories.get(userId) || []).length,
        topics: topics.length,
        replies: (s.posts.get(userId) || []).length,
        topicsThisWeek: topics.filter((t) => t.createdAt >= week).length,
        pendingFlags: (s.flags.get(userId) || []).filter((f) => f.status === "pending").length,
      },
    };
  });
}
