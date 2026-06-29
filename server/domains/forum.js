// server/domains/forum.js
export default function registerForumActions(registerLensAction) {
  // ── Field-alignment + fail-closed helpers for the analytical surface ──
  // THE DEAD-SURFACE CONTRACT (board pattern): these four calculators read
  // forum-WIDE arrays/metrics (posts / reports / threads / activity counts).
  // The /lenses/forum page persists each post as a lens artifact whose .data
  // is a SINGLE post — it has no `posts`/`reports`/`threads` arrays — so the
  // inline "Community Analytics" buttons (handleForumAction) used to render
  // only the empty "Add thread posts…" message in production while shape-only
  // tests passed. FIX: the page now DERIVES the arrays/metrics from live forum
  // state and passes them as the run-action `params` (3rd handler arg), and
  // each handler reads `params.X ?? artifact.data?.X`. The ForumActionPanel
  // single-wrap `{artifact:{data:{posts}}}` path (dispatch-peeled to the plain
  // object) lands the same fields on `artifact.data`.
  const fmArr = (...vals) => { for (const v of vals) { if (Array.isArray(v)) return v; } return []; };
  // Fail-closed integer coercion: Infinity / NaN / "Infinity" / 1e999 / "" all
  // collapse to the fallback; never returns a non-finite number.
  const fmInt = (v, d = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.trunc(n) : d;
  };
  const fmTime = (v) => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; };

  registerLensAction("forum", "threadAnalysis", (ctx, artifact, params = {}) => {
    const posts = fmArr(params.posts, artifact?.data?.posts);
    if (posts.length === 0) return { ok: true, result: { message: "Add thread posts to analyze discussion." } };
    const authors = {};
    for (const p of posts) { const a = (p && p.author) || "anonymous"; authors[a] = (authors[a] || 0) + 1; }
    const totalLen = posts.reduce((s, p) => s + String((p && p.content) || "").length, 0);
    const avgLength = posts.length > 0 ? Math.round(totalLen / posts.length) : 0;
    const topContributors = Object.entries(authors).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { ok: true, result: { totalPosts: posts.length, uniqueAuthors: Object.keys(authors).length, avgPostLength: avgLength, topContributors: topContributors.map(([name, count]) => ({ name, posts: count })), health: posts.length > 5 && Object.keys(authors).length > 2 ? "active-discussion" : posts.length > 0 ? "needs-engagement" : "empty" } };
  });
  registerLensAction("forum", "moderationQueue", (ctx, artifact, params = {}) => {
    const reports = fmArr(params.reports, artifact?.data?.reports);
    const pending = reports.filter(r => r && (r.status === "pending" || !r.status));
    const byReason = {};
    for (const r of pending) { const reason = r.reason || "other"; byReason[reason] = (byReason[reason] || 0) + 1; }
    return { ok: true, result: { totalReports: reports.length, pending: pending.length, resolved: reports.filter(r => r && r.status === "resolved").length, byReason, oldestPending: pending.slice().sort((a, b) => fmTime(a.date) - fmTime(b.date))[0]?.date || null, urgency: pending.length > 10 ? "high" : pending.length > 3 ? "medium" : "low" } };
  });
  registerLensAction("forum", "communityHealth", (ctx, artifact, params = {}) => {
    const data = artifact?.data || {};
    // Fail CLOSED on a present-but-poisoned numeric (NaN/Infinity AND the finite
    // poisons 1e308 / -1) — a clamp would have laundered them into a fabricated
    // "ok:true" health score.
    for (const _k of ["activeUsers", "totalUsers", "postsThisWeek", "postsLastWeek"]) {
      const _raw = params[_k] ?? data[_k];
      if (_raw !== undefined && _raw !== null && _raw !== "") { const n = Number(_raw); if (!Number.isFinite(n) || n < 0 || n > 1e12) return { ok: false, error: `invalid_${_k}` }; }
    }
    const activeUsers = Math.max(0, fmInt(params.activeUsers ?? data.activeUsers, 0));
    const totalUsers = Math.max(1, fmInt(params.totalUsers ?? data.totalUsers, 1));
    const postsThisWeek = Math.max(0, fmInt(params.postsThisWeek ?? data.postsThisWeek, 0));
    const postsLastWeek = Math.max(1, fmInt(params.postsLastWeek ?? data.postsLastWeek, 1));
    const growthRaw = ((postsThisWeek - postsLastWeek) / postsLastWeek) * 100;
    const growth = Number.isFinite(growthRaw) ? Math.round(growthRaw) : 0;
    const activityRate = Math.round((activeUsers / totalUsers) * 100);
    return { ok: true, result: { activeUsers, totalUsers, activityRate: Number.isFinite(activityRate) ? activityRate : 0, postsThisWeek, growthRate: growth, health: activityRate > 30 ? "thriving" : activityRate > 10 ? "healthy" : activityRate > 3 ? "declining" : "dormant", recommendations: activityRate < 10 ? ["Post conversation starters", "Highlight top contributors", "Send weekly digest"] : ["Maintain engagement momentum"] } };
  });
  registerLensAction("forum", "topicClustering", (ctx, artifact, params = {}) => {
    const threads = fmArr(params.threads, artifact?.data?.threads);
    if (threads.length === 0) return { ok: true, result: { message: "Add threads to cluster by topic." } };
    const tagCounts = {};
    for (const t of threads) { for (const tag of ((t && t.tags) || [])) { tagCounts[tag] = (tagCounts[tag] || 0) + 1; } }
    const clusters = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ topic: tag, threads: count, share: Math.round((count / threads.length) * 100) }));
    return { ok: true, result: { totalThreads: threads.length, clusters: clusters.slice(0, 10), topTopic: clusters[0]?.topic || "general", uncategorized: threads.filter(t => !t || !t.tags || t.tags.length === 0).length } };
  });

  // ─── Discourse + Reddit 2026 parity — community forum ───────────────
  // Categories + tags, topics with replies, voting, a moderation flag
  // queue, a trust-tier reputation system and search.

  function getFmState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.forumLens) STATE.forumLens = {};
    const s = STATE.forumLens;
    for (const k of [
      "categories", "topics", "posts", "flags",
      "subforums", "subscriptions", "notifications", "saves",
    ]) {
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
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const title = fmClean(params.title, 200);
    if (!title) return { ok: false, error: "topic title required" };
    let categoryId = params.categoryId ? String(params.categoryId) : null;
    if (categoryId && !(s.categories.get(userId) || []).some((c) => c.id === categoryId)) categoryId = null;
    const images = Array.isArray(params.images)
      ? params.images.map((u) => fmClean(u, 2000)).filter(Boolean).slice(0, 8) : [];
    const topic = {
      id: fmId("top"), categoryId,
      subforumId: params.subforumId ? String(params.subforumId) : null,
      title,
      body: fmClean(params.body, 8000) || "",
      format: params.format === "markdown" ? "markdown" : "plain",
      images,
      tags: Array.isArray(params.tags)
        ? [...new Set(params.tags.map((t) => fmClean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 8) : [],
      author: fmClean(params.author, 60) || "Me",
      pinned: false, locked: false,
      voters: {}, score: 0, awards: [],
      createdAt: fmNow(), updatedAt: fmNow(),
    };
    fmListB(s.topics, userId).push(topic);
    saveFmState();
    return { ok: true, result: { topic } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
    if (params.subforumId) topics = topics.filter((t) => t.subforumId === String(params.subforumId));
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
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topic = (s.topics.get(userId) || []).find((t) => t.id === params.id);
    if (!topic) return { ok: false, error: "topic not found" };
    const posts = (s.posts.get(userId) || [])
      .filter((p) => p.topicId === topic.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // Build a nested comment tree from parentId links.
    const byParent = new Map();
    for (const p of posts) {
      const key = p.parentId || "_root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(p);
    }
    const buildTree = (parentKey, depth) => {
      if (depth > 12) return [];
      return (byParent.get(parentKey) || []).map((p) => ({
        ...p,
        depth,
        replies: buildTree(p.id, depth + 1),
      }));
    };
    const tree = buildTree("_root", 0);
    const subscribed = (s.subscriptions.get(userId) || []).some((x) => x.topicId === topic.id);
    return { ok: true, result: { topic, posts, tree, replyCount: posts.length, subscribed } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topic = (s.topics.get(userId) || []).find((t) => t.id === params.topicId);
    if (!topic) return { ok: false, error: "topic not found" };
    if (topic.locked) return { ok: false, error: "topic is locked" };
    const body = fmClean(params.body, 8000);
    if (!body) return { ok: false, error: "reply body required" };
    let parentId = params.parentId ? String(params.parentId) : null;
    const existing = s.posts.get(userId) || [];
    if (parentId) {
      const parent = existing.find((p) => p.id === parentId);
      if (!parent || parent.topicId !== topic.id) parentId = null;
    }
    const images = Array.isArray(params.images)
      ? params.images.map((u) => fmClean(u, 2000)).filter(Boolean).slice(0, 8) : [];
    const post = {
      id: fmId("pst"), topicId: topic.id, parentId, body,
      format: params.format === "markdown" ? "markdown" : "plain",
      images,
      author: fmClean(params.author, 60) || "Me",
      voters: {}, score: 0, awards: [],
      createdAt: fmNow(),
    };
    fmListB(s.posts, userId).push(post);
    topic.updatedAt = fmNow();
    // notify thread subscribers (other than the replier)
    for (const sub of s.subscriptions.get(userId) || []) {
      if (sub.topicId === topic.id) {
        fmListB(s.notifications, userId).push({
          id: fmId("ntf"), kind: "reply",
          topicId: topic.id, topicTitle: topic.title,
          postId: post.id, message: `New reply in "${topic.title}"`,
          read: false, createdAt: fmNow(),
        });
        break;
      }
    }
    saveFmState();
    return { ok: true, result: { post } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
        subforums: (s.subforums.get(userId) || []).length,
        subscriptions: (s.subscriptions.get(userId) || []).length,
        unreadNotifications: (s.notifications.get(userId) || []).filter((n) => !n.read).length,
        savedPosts: (s.saves.get(userId) || []).length,
      },
    };
  });

  // ── Subforums / user-created communities ────────────────────────────
  // Per-community rules + mod teams (item: User-created communities).
  registerLensAction("forum", "subforum-create", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const name = fmClean(params.name, 60);
    if (!name) return { ok: false, error: "subforum name required" };
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
      || `sf-${Date.now().toString(36)}`;
    const existing = s.subforums.get(userId) || [];
    if (existing.some((f) => f.slug === slug)) return { ok: false, error: "subforum already exists" };
    const subforum = {
      id: fmId("sf"), slug, name,
      description: fmClean(params.description, 600) || null,
      icon: fmClean(params.icon, 8) || "💬",
      rules: Array.isArray(params.rules)
        ? params.rules.map((r) => fmClean(r, 200)).filter(Boolean).slice(0, 12) : [],
      moderators: [fmClean(params.author, 60) || "Me"],
      createdAt: fmNow(),
    };
    fmListB(s.subforums, userId).push(subforum);
    saveFmState();
    return { ok: true, result: { subforum } };
  });

  registerLensAction("forum", "subforum-list", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topics = s.topics.get(userId) || [];
    const subforums = (s.subforums.get(userId) || []).map((f) => ({
      ...f,
      topicCount: topics.filter((t) => t.subforumId === f.id).length,
      memberCount: 1 + (f.moderators ? f.moderators.length - 1 : 0),
    }));
    return { ok: true, result: { subforums, count: subforums.length } };
  });

  registerLensAction("forum", "subforum-update-rules", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sf = (s.subforums.get(fmAid(ctx)) || []).find((f) => f.id === params.id);
    if (!sf) return { ok: false, error: "subforum not found" };
    if (Array.isArray(params.rules)) {
      sf.rules = params.rules.map((r) => fmClean(r, 200)).filter(Boolean).slice(0, 12);
    }
    if (params.description !== undefined) sf.description = fmClean(params.description, 600) || null;
    saveFmState();
    return { ok: true, result: { id: sf.id, rules: sf.rules, description: sf.description } };
  });

  registerLensAction("forum", "subforum-add-mod", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sf = (s.subforums.get(fmAid(ctx)) || []).find((f) => f.id === params.id);
    if (!sf) return { ok: false, error: "subforum not found" };
    const mod = fmClean(params.moderator, 60);
    if (!mod) return { ok: false, error: "moderator name required" };
    if (!Array.isArray(sf.moderators)) sf.moderators = [];
    if (!sf.moderators.includes(mod)) sf.moderators.push(mod);
    saveFmState();
    return { ok: true, result: { id: sf.id, moderators: sf.moderators } };
  });

  registerLensAction("forum", "subforum-delete", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const arr = s.subforums.get(userId) || [];
    const i = arr.findIndex((f) => f.id === params.id);
    if (i < 0) return { ok: false, error: "subforum not found" };
    arr.splice(i, 1);
    for (const t of s.topics.get(userId) || []) {
      if (t.subforumId === params.id) t.subforumId = null;
    }
    saveFmState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Thread subscriptions + notifications ────────────────────────────
  registerLensAction("forum", "thread-subscribe", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topic = (s.topics.get(userId) || []).find((t) => t.id === params.topicId);
    if (!topic) return { ok: false, error: "topic not found" };
    const subs = fmListB(s.subscriptions, userId);
    const idx = subs.findIndex((x) => x.topicId === topic.id);
    let subscribed;
    if (idx >= 0) { subs.splice(idx, 1); subscribed = false; }
    else { subs.push({ topicId: topic.id, topicTitle: topic.title, createdAt: fmNow() }); subscribed = true; }
    saveFmState();
    return { ok: true, result: { topicId: topic.id, subscribed } };
  });

  registerLensAction("forum", "subscription-list", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topics = s.topics.get(userId) || [];
    const subs = (s.subscriptions.get(userId) || [])
      .map((x) => {
        const t = topics.find((tp) => tp.id === x.topicId);
        return { ...x, exists: !!t, locked: t ? t.locked : false };
      })
      .filter((x) => x.exists);
    return { ok: true, result: { subscriptions: subs, count: subs.length } };
  });

  registerLensAction("forum", "notification-list", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const all = (s.notifications.get(userId) || [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      ok: true,
      result: {
        notifications: all.slice(0, 60),
        count: all.length,
        unread: all.filter((n) => !n.read).length,
      },
    };
  });

  registerLensAction("forum", "notification-read", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const all = s.notifications.get(userId) || [];
    if (params.id) {
      const n = all.find((x) => x.id === params.id);
      if (!n) return { ok: false, error: "notification not found" };
      n.read = true;
    } else {
      for (const n of all) n.read = true;
    }
    saveFmState();
    return { ok: true, result: { unread: all.filter((n) => !n.read).length } };
  });

  // ── Awards / badges ─────────────────────────────────────────────────
  const FM_AWARDS = {
    helpful: { name: "Helpful", icon: "🙌", weight: 5 },
    insightful: { name: "Insightful", icon: "💡", weight: 8 },
    gold: { name: "Gold", icon: "🏆", weight: 15 },
    welcoming: { name: "Welcoming", icon: "🤝", weight: 4 },
    breakthrough: { name: "Breakthrough", icon: "🚀", weight: 12 },
  };
  registerLensAction("forum", "award-catalog", (_ctx, _a, _params = {}) => ({
    ok: true,
    result: {
      awards: Object.entries(FM_AWARDS).map(([id, a]) => ({ id, ...a })),
    },
  }));

  registerLensAction("forum", "award-give", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const kind = String(params.kind || "");
    if (!FM_AWARDS[kind]) return { ok: false, error: "unknown award kind" };
    const targetType = params.targetType === "post" ? "post" : "topic";
    const bucket = targetType === "post" ? s.posts.get(userId) : s.topics.get(userId);
    const item = (bucket || []).find((x) => x.id === params.targetId);
    if (!item) return { ok: false, error: `${targetType} not found` };
    if (!Array.isArray(item.awards)) item.awards = [];
    const def = FM_AWARDS[kind];
    item.awards.push({
      id: fmId("awd"), kind, icon: def.icon, name: def.name,
      by: fmClean(params.author, 60) || "Me", createdAt: fmNow(),
    });
    saveFmState();
    return { ok: true, result: { targetType, targetId: item.id, awards: item.awards } };
  });

  // ── Saved posts + post history + profile pages ──────────────────────
  registerLensAction("forum", "save-toggle", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const targetType = params.targetType === "post" ? "post" : "topic";
    const bucket = targetType === "post" ? s.posts.get(userId) : s.topics.get(userId);
    const item = (bucket || []).find((x) => x.id === params.targetId);
    if (!item) return { ok: false, error: `${targetType} not found` };
    const saves = fmListB(s.saves, userId);
    const idx = saves.findIndex((x) => x.targetId === item.id && x.targetType === targetType);
    let saved;
    if (idx >= 0) { saves.splice(idx, 1); saved = false; }
    else { saves.push({ targetType, targetId: item.id, createdAt: fmNow() }); saved = true; }
    saveFmState();
    return { ok: true, result: { targetType, targetId: item.id, saved } };
  });

  registerLensAction("forum", "saved-list", (ctx, _a, _params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topics = s.topics.get(userId) || [];
    const posts = s.posts.get(userId) || [];
    const items = (s.saves.get(userId) || []).map((sv) => {
      if (sv.targetType === "topic") {
        const t = topics.find((x) => x.id === sv.targetId);
        return t ? { ...sv, title: t.title, score: t.score, snippet: t.body.slice(0, 160) } : null;
      }
      const p = posts.find((x) => x.id === sv.targetId);
      if (!p) return null;
      const t = topics.find((x) => x.id === p.topicId);
      return { ...sv, title: t ? t.title : "reply", score: p.score, snippet: p.body.slice(0, 160) };
    }).filter(Boolean);
    return { ok: true, result: { saved: items, count: items.length } };
  });

  registerLensAction("forum", "post-history", (ctx, _a, params = {}) => {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const author = params.author ? fmClean(params.author, 60) : null;
    const topics = (s.topics.get(userId) || [])
      .filter((t) => !author || t.author === author)
      .map((t) => ({ type: "topic", id: t.id, title: t.title, score: t.score, at: t.createdAt }));
    const posts = (s.posts.get(userId) || [])
      .filter((p) => !author || p.author === author)
      .map((p) => {
        const t = (s.topics.get(userId) || []).find((x) => x.id === p.topicId);
        return {
          type: "reply", id: p.id, topicId: p.topicId,
          title: t ? t.title : "reply", snippet: p.body.slice(0, 120),
          score: p.score, at: p.createdAt,
        };
      });
    const history = [...topics, ...posts].sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { history, count: history.length } };
  });

  registerLensAction("forum", "user-profile", (ctx, _a, params = {}) => {
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const author = params.author ? fmClean(params.author, 60) : null;
    const allTopics = s.topics.get(userId) || [];
    const allPosts = s.posts.get(userId) || [];
    const topics = allTopics.filter((t) => !author || t.author === author);
    const posts = allPosts.filter((p) => !author || p.author === author);
    const karma = topics.reduce((a, t) => a + (t.score || 0), 0)
      + posts.reduce((a, p) => a + (p.score || 0), 0);
    const awardsEarned = [
      ...topics.flatMap((t) => t.awards || []),
      ...posts.flatMap((p) => p.awards || []),
    ];
    const awardCounts = {};
    for (const a of awardsEarned) awardCounts[a.kind] = (awardCounts[a.kind] || 0) + 1;
    const dates = [...topics, ...posts].map((x) => x.createdAt).sort();
    return {
      ok: true,
      result: {
        author: author || "Me",
        topics: topics.length,
        replies: posts.length,
        karma,
        awardsEarned: awardsEarned.length,
        awardBreakdown: awardCounts,
        joinedAt: dates[0] || null,
        lastActiveAt: dates[dates.length - 1] || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Trending / personalized hot ranking across categories ───────────
  // Reddit-style hot score: log-weighted votes + age decay, blended
  // with a personalization boost from the viewer's tag affinity.
  registerLensAction("forum", "trending", (ctx, _a, params = {}) => {
  try {
    const s = getFmState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = fmAid(ctx);
    const topics = s.topics.get(userId) || [];
    if (topics.length === 0) {
      return { ok: true, result: { trending: [], count: 0, affinityTags: [] } };
    }
    const posts = s.posts.get(userId) || [];
    const now = Date.now();
    // Tag affinity: tags on topics the viewer authored or replied in.
    const myTopicIds = new Set(posts.map((p) => p.topicId));
    const affinity = {};
    for (const t of topics) {
      const mine = t.author === "Me" || myTopicIds.has(t.id);
      if (!mine) continue;
      for (const tag of t.tags || []) affinity[tag] = (affinity[tag] || 0) + 1;
    }
    const affinityTags = Object.entries(affinity)
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, n]) => ({ tag, weight: n }));
    const personalize = params.personalize !== false;
    const ranked = topics.map((t) => {
      // Fail-closed: a corrupt createdAt → getTime() NaN → Math.max(0.01,NaN)
      // is NaN (Math.max propagates NaN), which would poison hotScore. Guard
      // the timestamp to a finite value first so age is always finite.
      const created = new Date(t.createdAt).getTime();
      const ageRaw = (now - (Number.isFinite(created) ? created : now)) / 3600000;
      const ageHours = Math.max(0.01, Number.isFinite(ageRaw) ? ageRaw : 0.01);
      const replyCount = posts.filter((p) => p.topicId === t.id).length;
      const order = Math.log10(Math.max(1, Math.abs(t.score) + replyCount * 2 + 1));
      const sign = t.score >= 0 ? 1 : -1;
      // Reddit hot: order minus age penalty (12h half-cycle equivalent).
      let hot = sign * order - ageHours / 12;
      const affBoost = personalize
        ? (t.tags || []).reduce((a, tag) => a + (affinity[tag] || 0), 0) * 0.15 : 0;
      hot += affBoost;
      return {
        id: t.id, title: t.title, categoryId: t.categoryId,
        subforumId: t.subforumId || null, tags: t.tags || [],
        score: t.score, replyCount,
        hotScore: Math.round(hot * 1000) / 1000,
        personalBoost: Math.round(affBoost * 1000) / 1000,
        createdAt: t.createdAt,
      };
    }).sort((a, b) => b.hotScore - a.hotScore);
    const limit = Math.min(50, Math.max(1, fmNum(params.limit, 20)));
    return {
      ok: true,
      result: {
        trending: ranked.slice(0, limit),
        count: ranked.length,
        affinityTags,
        personalized: personalize,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
