// server/domains/feed.js
//
// Analytics macros (engagementScore, contentCalendar, audienceInsights,
// hashtagAnalysis) plus the 2026 X/Threads feature-parity backlog:
//   - Algorithmic ranked "For You" (rank-for-you / record-interaction)
//   - Quote-posts / threaded reply trees with collapse (thread-*)
//   - Lists / curated timelines (list-*)
//   - Polls in the composer + live results (poll-*)
//   - Bookmark folders + saved-search alerts (folder-*, saved-search-*)
//   - Live audio rooms / Spaces (space-*)
//   - Content controls — mute words / sensitive-media filter / block (controls-*)
//
// All parity state is per-user, persisted in globalThis._concordSTATE.feedLens.

export default function registerFeedActions(registerLensAction) {
  // ── Per-user parity state ──────────────────────────────────────────────
  function getFeedState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.feedLens) {
      STATE.feedLens = {
        interactions: new Map(), // userId -> Map<authorId, { likes, replies, reposts, views, lastAt }>
        threads:      new Map(), // userId -> Map<nodeId, { id, parentId, kind, body, quotedId?, collapsed, createdAt }>
        lists:        new Map(), // userId -> Map<listId, { id, name, description, members:[], pinned, createdAt }>
        polls:        new Map(), // userId -> Map<pollId, { id, question, options:[{id,label,votes:[userId]}], closesAt, createdAt }>
        folders:      new Map(), // userId -> Map<folderId, { id, name, items:[postId], createdAt }>
        savedSearches:new Map(), // userId -> Map<searchId, { id, query, alert, lastChecked, createdAt }>
        spaces:       new Map(), // userId -> Map<spaceId, { id, title, hostId, speakers:[], listeners:[], status, createdAt }>
        controls:     new Map(), // userId -> { mutedWords:[], blockedUsers:[], sensitiveMedia:'blur'|'show'|'hide' }
      };
    }
    return STATE.feedLens;
  }
  function saveFeedState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function feedActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextFeedId(p) {
    return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function nowIso() { return new Date().toISOString(); }

  // ════════════════════════════════════════════════════════════════════════
  // ANALYTICS (pre-existing — unchanged behaviour)
  // ════════════════════════════════════════════════════════════════════════

  registerLensAction("feed", "engagementScore", (ctx, artifact, _params) => {
    const posts = artifact.data?.posts || [];
    if (posts.length === 0) return { ok: true, result: { message: "Add posts with engagement data to analyze." } };
    const scored = posts.map(p => {
      const likes = parseInt(p.likes) || 0; const comments = parseInt(p.comments) || 0; const shares = parseInt(p.shares) || 0; const views = parseInt(p.views) || 1;
      const engagementRate = views > 0 ? ((likes + comments * 2 + shares * 3) / views) * 100 : 0;
      return { title: p.title || p.id, likes, comments, shares, views, engagementRate: Math.round(engagementRate * 100) / 100, performance: engagementRate > 5 ? "viral" : engagementRate > 2 ? "above-average" : engagementRate > 0.5 ? "average" : "low" };
    }).sort((a, b) => b.engagementRate - a.engagementRate);
    return { ok: true, result: { posts: scored.slice(0, 10), totalPosts: posts.length, avgEngagement: Math.round(scored.reduce((s, p) => s + p.engagementRate, 0) / scored.length * 100) / 100, topPost: scored[0]?.title, totalReach: scored.reduce((s, p) => s + p.views, 0) } };
  });

  registerLensAction("feed", "contentCalendar", (ctx, artifact, _params) => {
    const schedule = artifact.data?.schedule || [];
    const frequency = artifact.data?.postsPerWeek || 5;
    const now = new Date();
    const upcoming = Array.from({ length: 14 }, (_, i) => { const d = new Date(now.getTime() + i * 86400000); const existing = schedule.find(s => s.date === d.toISOString().split("T")[0]); return { date: d.toISOString().split("T")[0], day: d.toLocaleDateString("en-US", { weekday: "short" }), planned: !!existing, content: existing?.content || null, type: existing?.type || null }; });
    const planned = upcoming.filter(u => u.planned).length;
    return { ok: true, result: { upcoming, planedPosts: planned, targetPosts: frequency * 2, coveragePercent: Math.round((planned / (frequency * 2)) * 100), gaps: upcoming.filter(u => !u.planned).map(u => u.date) } };
  });

  registerLensAction("feed", "audienceInsights", (ctx, artifact, _params) => {
    const followers = artifact.data?.followers || [];
    const demographics = {};
    for (const f of followers) { const d = f.demographic || f.ageGroup || "unknown"; demographics[d] = (demographics[d] || 0) + 1; }
    const peakHours = artifact.data?.peakHours || [9, 12, 18, 20];
    return { ok: true, result: { totalFollowers: followers.length, demographics: Object.entries(demographics).map(([k, v]) => ({ group: k, count: v, percent: Math.round((v / Math.max(followers.length, 1)) * 100) })), peakEngagementHours: peakHours.map(h => `${h}:00`), bestPostingTimes: peakHours.slice(0, 2).map(h => `${h}:00`) } };
  });

  registerLensAction("feed", "hashtagAnalysis", (ctx, artifact, _params) => {
    const posts = artifact.data?.posts || [];
    const tagCounts = {};
    const tagEngagement = {};
    for (const p of posts) {
      const eng = (parseInt(p.likes) || 0) + (parseInt(p.comments) || 0) * 2 + (parseInt(p.shares) || 0) * 3;
      for (const tag of (p.tags || p.hashtags || [])) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        tagEngagement[tag] = (tagEngagement[tag] || 0) + eng;
      }
    }
    const ranked = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, uses: count, engagement: Math.round((tagEngagement[tag] / count) * 100) / 100 }));
    return { ok: true, result: { totalUniqueTags: ranked.length, topTags: ranked.slice(0, 10), postsAnalyzed: posts.length, recommendation: ranked.length > 0 ? `Your top-performing tag is #${ranked[0]?.tag}` : "Start using hashtags to improve discoverability" } };
  });

  // ════════════════════════════════════════════════════════════════════════
  // 1. ALGORITHMIC RANKED "FOR YOU"  [M]
  //    A real (transparent, explainable) recommendation model: it learns a
  //    per-author affinity from the user's own interactions, then re-ranks a
  //    candidate post set by affinity + recency + base engagement.
  // ════════════════════════════════════════════════════════════════════════

  registerLensAction("feed", "record-interaction", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const authorId = String(params.authorId || "").trim();
    if (!authorId) return { ok: false, error: "authorId required" };
    const kind = String(params.kind || "view");
    if (!["view", "like", "reply", "repost", "bookmark"].includes(kind)) {
      return { ok: false, error: "kind must be view|like|reply|repost|bookmark" };
    }
    if (!s.interactions.has(userId)) s.interactions.set(userId, new Map());
    const map = s.interactions.get(userId);
    const rec = map.get(authorId) || { likes: 0, replies: 0, reposts: 0, views: 0, bookmarks: 0, lastAt: null };
    if (kind === "view") rec.views += 1;
    else if (kind === "like") rec.likes += 1;
    else if (kind === "reply") rec.replies += 1;
    else if (kind === "repost") rec.reposts += 1;
    else if (kind === "bookmark") rec.bookmarks += 1;
    rec.lastAt = nowIso();
    map.set(authorId, rec);
    saveFeedState();
    return { ok: true, result: { authorId, kind, affinity: affinityScore(rec) } };
  });

  // Weighted affinity: stronger signals (reply/repost/bookmark) outweigh views.
  function affinityScore(rec) {
    if (!rec) return 0;
    const raw = (rec.views || 0) * 0.1
      + (rec.likes || 0) * 1.0
      + (rec.replies || 0) * 3.0
      + (rec.reposts || 0) * 4.0
      + (rec.bookmarks || 0) * 2.5;
    return Math.round(raw * 100) / 100;
  }

  registerLensAction("feed", "rank-for-you", (ctx, _artifact, params = {}) => {
  try {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const candidates = Array.isArray(params.candidates) ? params.candidates : [];
    if (candidates.length === 0) {
      return { ok: true, result: { ranked: [], modelTrained: !!s.interactions.get(userId), message: "No candidate posts to rank." } };
    }
    const affinityMap = s.interactions.get(userId) || new Map();
    const controls = s.controls.get(userId) || { mutedWords: [], blockedUsers: [] };
    const now = Date.now();
    const ranked = candidates
      .filter(p => !(controls.blockedUsers || []).includes(String(p.authorId || "")))
      .filter(p => {
        const text = String(p.content || "").toLowerCase();
        return !(controls.mutedWords || []).some(w => w && text.includes(String(w).toLowerCase()));
      })
      .map(p => {
        const authorId = String(p.authorId || "");
        const rec = affinityMap.get(authorId);
        const affinity = affinityScore(rec);
        // recency decay — half-life ~12h
        const ageMs = p.createdAt ? Math.max(0, now - new Date(p.createdAt).getTime()) : 0;
        const recency = Math.pow(0.5, ageMs / (12 * 3600000));
        // base engagement signal, log-dampened so a viral post does not crush affinity
        const eng = (parseInt(p.likes) || 0) + (parseInt(p.comments) || 0) * 2 + (parseInt(p.reposts) || 0) * 3;
        const engagement = Math.log10(eng + 1);
        const score = Math.round((affinity * 2.0 + recency * 3.0 + engagement * 1.5) * 1000) / 1000;
        const reasons = [];
        if (affinity > 0) reasons.push(`you engage with @${authorId}`);
        if (recency > 0.6) reasons.push("recent");
        if (engagement > 1) reasons.push("popular");
        return { id: p.id, authorId, score, affinity, recency: Math.round(recency * 1000) / 1000, engagement: Math.round(engagement * 1000) / 1000, reasons };
      })
      .sort((a, b) => b.score - a.score);
    return {
      ok: true,
      result: {
        ranked,
        modelTrained: affinityMap.size > 0,
        signalsLearned: affinityMap.size,
        topReason: ranked[0]?.reasons?.[0] || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("feed", "affinity-summary", (ctx, _artifact, _params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.interactions.get(userId) || new Map();
    const authors = Array.from(map.entries())
      .map(([authorId, rec]) => ({ authorId, affinity: affinityScore(rec), ...rec }))
      .sort((a, b) => b.affinity - a.affinity);
    return { ok: true, result: { authors, total: authors.length } };
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. QUOTE-POST / THREADED REPLY TREES WITH COLLAPSE  [S]
  // ════════════════════════════════════════════════════════════════════════

  registerLensAction("feed", "thread-add", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const body = String(params.body || "").trim();
    if (!body) return { ok: false, error: "body required" };
    if (body.length > 4000) return { ok: false, error: "body too long" };
    const kind = params.quotedId ? "quote" : (params.parentId ? "reply" : "post");
    if (!s.threads.has(userId)) s.threads.set(userId, new Map());
    const map = s.threads.get(userId);
    const parentId = params.parentId ? String(params.parentId) : null;
    if (parentId && !map.has(parentId)) return { ok: false, error: "parent node not found" };
    const node = {
      id: nextFeedId("tn"),
      parentId,
      kind,
      body,
      quotedId: params.quotedId ? String(params.quotedId) : null,
      quotedAuthor: params.quotedAuthor ? String(params.quotedAuthor) : null,
      quotedBody: params.quotedBody ? String(params.quotedBody).slice(0, 280) : null,
      author: userId,
      collapsed: false,
      createdAt: nowIso(),
    };
    map.set(node.id, node);
    saveFeedState();
    return { ok: true, result: { node } };
  });

  registerLensAction("feed", "thread-tree", (ctx, _artifact, params = {}) => {
  try {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.threads.get(userId) || new Map();
    const all = Array.from(map.values());
    const rootId = params.rootId ? String(params.rootId) : null;
    // build child index
    const childrenOf = {};
    for (const n of all) {
      const key = n.parentId || "__root__";
      (childrenOf[key] = childrenOf[key] || []).push(n);
    }
    function build(node) {
      const kids = (childrenOf[node.id] || []).sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return {
        ...node,
        replyCount: countDescendants(node.id),
        children: node.collapsed ? [] : kids.map(build),
      };
    }
    function countDescendants(id) {
      const kids = childrenOf[id] || [];
      return kids.reduce((sum, k) => sum + 1 + countDescendants(k.id), 0);
    }
    let roots;
    if (rootId) {
      const r = map.get(rootId);
      roots = r ? [build(r)] : [];
    } else {
      roots = (childrenOf.__root__ || [])
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(build);
    }
    return { ok: true, result: { tree: roots, totalNodes: all.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("feed", "thread-collapse", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.threads.get(userId) || new Map();
    const node = map.get(String(params.nodeId || ""));
    if (!node) return { ok: false, error: "node not found" };
    node.collapsed = params.collapsed !== undefined ? !!params.collapsed : !node.collapsed;
    saveFeedState();
    return { ok: true, result: { nodeId: node.id, collapsed: node.collapsed } };
  });

  registerLensAction("feed", "thread-delete", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.threads.get(userId) || new Map();
    const targetId = String(params.nodeId || "");
    if (!map.has(targetId)) return { ok: false, error: "node not found" };
    // cascade delete descendants
    const toDelete = new Set([targetId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of map.values()) {
        if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
          toDelete.add(n.id); changed = true;
        }
      }
    }
    for (const id of toDelete) map.delete(id);
    saveFeedState();
    return { ok: true, result: { deleted: toDelete.size } };
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. LISTS / CURATED TIMELINES  [M]
  // ════════════════════════════════════════════════════════════════════════

  registerLensAction("feed", "list-create", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 80) return { ok: false, error: "name too long" };
    if (!s.lists.has(userId)) s.lists.set(userId, new Map());
    const map = s.lists.get(userId);
    const list = {
      id: nextFeedId("lst"),
      name,
      description: String(params.description || "").slice(0, 280),
      members: Array.isArray(params.members) ? params.members.map(String).slice(0, 500) : [],
      pinned: false,
      createdAt: nowIso(),
    };
    map.set(list.id, list);
    saveFeedState();
    return { ok: true, result: { list } };
  });

  registerLensAction("feed", "list-all", (ctx, _artifact, _params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.lists.get(userId) || new Map();
    const lists = Array.from(map.values())
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { lists } };
  });

  registerLensAction("feed", "list-update-members", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.lists.get(userId) || new Map();
    const list = map.get(String(params.listId || ""));
    if (!list) return { ok: false, error: "list not found" };
    const member = String(params.member || "").trim();
    const op = String(params.op || "add");
    if (member) {
      if (op === "add" && !list.members.includes(member)) list.members.push(member);
      else if (op === "remove") list.members = list.members.filter(m => m !== member);
    }
    if (params.pinned !== undefined) list.pinned = !!params.pinned;
    saveFeedState();
    return { ok: true, result: { list } };
  });

  registerLensAction("feed", "list-feed", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.lists.get(userId) || new Map();
    const list = map.get(String(params.listId || ""));
    if (!list) return { ok: false, error: "list not found" };
    const candidates = Array.isArray(params.candidates) ? params.candidates : [];
    const memberSet = new Set(list.members);
    const posts = candidates
      .filter(p => memberSet.has(String(p.authorId || "")))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return { ok: true, result: { listId: list.id, listName: list.name, posts, memberCount: list.members.length } };
  });

  registerLensAction("feed", "list-delete", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.lists.get(userId) || new Map();
    if (!map.delete(String(params.listId || ""))) return { ok: false, error: "list not found" };
    saveFeedState();
    return { ok: true, result: { deleted: true } };
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. POLLS IN THE COMPOSER + LIVE RESULTS  [M]
  // ════════════════════════════════════════════════════════════════════════

  registerLensAction("feed", "poll-create", (ctx, _artifact, params = {}) => {
  try {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const question = String(params.question || "").trim();
    if (!question) return { ok: false, error: "question required" };
    if (question.length > 280) return { ok: false, error: "question too long" };
    const rawOptions = Array.isArray(params.options) ? params.options : [];
    const options = rawOptions.map(o => String(o || "").trim()).filter(Boolean).slice(0, 4);
    if (options.length < 2) return { ok: false, error: "at least 2 options required" };
    const durationMin = Math.min(Math.max(parseInt(params.durationMinutes) || 1440, 5), 10080);
    if (!s.polls.has(userId)) s.polls.set(userId, new Map());
    const map = s.polls.get(userId);
    const poll = {
      id: nextFeedId("poll"),
      question,
      options: options.map((label, i) => ({ id: `opt${i}`, label, votes: [] })),
      ownerId: userId,
      closesAt: new Date(Date.now() + durationMin * 60000).toISOString(),
      createdAt: nowIso(),
    };
    map.set(poll.id, poll);
    saveFeedState();
    return { ok: true, result: { poll: pollView(poll, userId) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  function findPoll(s, pollId) {
    for (const map of s.polls.values()) {
      if (map.has(pollId)) return map.get(pollId);
    }
    return null;
  }
  function pollView(poll, viewerId) {
    const total = poll.options.reduce((sum, o) => sum + o.votes.length, 0);
    const closed = new Date(poll.closesAt).getTime() < Date.now();
    let myVote = null;
    const options = poll.options.map(o => {
      if (o.votes.includes(viewerId)) myVote = o.id;
      return {
        id: o.id,
        label: o.label,
        votes: o.votes.length,
        percent: total > 0 ? Math.round((o.votes.length / total) * 1000) / 10 : 0,
      };
    });
    return { id: poll.id, question: poll.question, options, totalVotes: total, closesAt: poll.closesAt, closed, myVote };
  }

  registerLensAction("feed", "poll-vote", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const poll = findPoll(s, String(params.pollId || ""));
    if (!poll) return { ok: false, error: "poll not found" };
    if (new Date(poll.closesAt).getTime() < Date.now()) return { ok: false, error: "poll closed" };
    const optId = String(params.optionId || "");
    const target = poll.options.find(o => o.id === optId);
    if (!target) return { ok: false, error: "option not found" };
    // one vote per user — remove any prior vote first
    for (const o of poll.options) o.votes = o.votes.filter(v => v !== userId);
    target.votes.push(userId);
    saveFeedState();
    return { ok: true, result: { poll: pollView(poll, userId) } };
  });

  registerLensAction("feed", "poll-results", (ctx, _artifact, params = {}) => {
  try {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const poll = findPoll(s, String(params.pollId || ""));
    if (!poll) return { ok: false, error: "poll not found" };
    return { ok: true, result: { poll: pollView(poll, userId) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("feed", "poll-list", (ctx, _artifact, _params = {}) => {
  try {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.polls.get(userId) || new Map();
    const polls = Array.from(map.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(p => pollView(p, userId));
    return { ok: true, result: { polls } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════════
  // 5. BOOKMARK FOLDERS + SAVED-SEARCH ALERTS  [S]
  // ════════════════════════════════════════════════════════════════════════

  registerLensAction("feed", "folder-create", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 80) return { ok: false, error: "name too long" };
    if (!s.folders.has(userId)) s.folders.set(userId, new Map());
    const map = s.folders.get(userId);
    const folder = { id: nextFeedId("fld"), name, items: [], createdAt: nowIso() };
    map.set(folder.id, folder);
    saveFeedState();
    return { ok: true, result: { folder } };
  });

  registerLensAction("feed", "folder-list", (ctx, _artifact, _params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.folders.get(userId) || new Map();
    const folders = Array.from(map.values())
      .map(f => ({ ...f, itemCount: f.items.length }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { folders } };
  });

  registerLensAction("feed", "folder-add-item", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.folders.get(userId) || new Map();
    const folder = map.get(String(params.folderId || ""));
    if (!folder) return { ok: false, error: "folder not found" };
    const postId = String(params.postId || "").trim();
    if (!postId) return { ok: false, error: "postId required" };
    const op = String(params.op || "add");
    if (op === "add" && !folder.items.includes(postId)) folder.items.push(postId);
    else if (op === "remove") folder.items = folder.items.filter(i => i !== postId);
    saveFeedState();
    return { ok: true, result: { folder: { ...folder, itemCount: folder.items.length } } };
  });

  registerLensAction("feed", "folder-delete", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.folders.get(userId) || new Map();
    if (!map.delete(String(params.folderId || ""))) return { ok: false, error: "folder not found" };
    saveFeedState();
    return { ok: true, result: { deleted: true } };
  });

  registerLensAction("feed", "saved-search-create", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length > 200) return { ok: false, error: "query too long" };
    if (!s.savedSearches.has(userId)) s.savedSearches.set(userId, new Map());
    const map = s.savedSearches.get(userId);
    const search = {
      id: nextFeedId("ss"),
      query,
      alert: params.alert !== false,
      lastChecked: nowIso(),
      createdAt: nowIso(),
    };
    map.set(search.id, search);
    saveFeedState();
    return { ok: true, result: { search } };
  });

  registerLensAction("feed", "saved-search-list", (ctx, _artifact, _params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.savedSearches.get(userId) || new Map();
    const searches = Array.from(map.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { searches } };
  });

  // Run a saved search against a candidate post set — returns matches and,
  // for alert-enabled searches, the count of posts newer than lastChecked.
  registerLensAction("feed", "saved-search-run", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.savedSearches.get(userId) || new Map();
    const search = map.get(String(params.searchId || ""));
    if (!search) return { ok: false, error: "search not found" };
    const candidates = Array.isArray(params.candidates) ? params.candidates : [];
    const terms = search.query.toLowerCase().split(/\s+/).filter(Boolean);
    const since = new Date(search.lastChecked).getTime();
    const matches = candidates.filter(p => {
      const hay = `${p.content || ""} ${(p.tags || []).join(" ")} ${p.authorId || ""}`.toLowerCase();
      return terms.every(t => hay.includes(t));
    }).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    const newCount = matches.filter(p => new Date(p.createdAt || 0).getTime() > since).length;
    if (params.markChecked !== false) search.lastChecked = nowIso();
    saveFeedState();
    return { ok: true, result: { searchId: search.id, query: search.query, matches, total: matches.length, newSinceLastCheck: newCount, alert: search.alert } };
  });

  registerLensAction("feed", "saved-search-delete", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const map = s.savedSearches.get(userId) || new Map();
    if (!map.delete(String(params.searchId || ""))) return { ok: false, error: "search not found" };
    saveFeedState();
    return { ok: true, result: { deleted: true } };
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. LIVE AUDIO ROOMS / SPACES  [M]
  // ════════════════════════════════════════════════════════════════════════

  registerLensAction("feed", "space-create", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (title.length > 140) return { ok: false, error: "title too long" };
    if (!s.spaces.has(userId)) s.spaces.set(userId, new Map());
    const map = s.spaces.get(userId);
    const space = {
      id: nextFeedId("spc"),
      title,
      topic: String(params.topic || "").slice(0, 280),
      hostId: userId,
      speakers: [userId],
      listeners: [],
      status: "live",
      createdAt: nowIso(),
      endedAt: null,
    };
    map.set(space.id, space);
    saveFeedState();
    return { ok: true, result: { space: spaceView(space) } };
  });

  function spaceView(sp) {
    return {
      id: sp.id, title: sp.title, topic: sp.topic, hostId: sp.hostId,
      speakers: sp.speakers, listeners: sp.listeners,
      speakerCount: sp.speakers.length, listenerCount: sp.listeners.length,
      status: sp.status, createdAt: sp.createdAt, endedAt: sp.endedAt,
    };
  }
  function findSpace(s, spaceId) {
    for (const map of s.spaces.values()) {
      if (map.has(spaceId)) return map.get(spaceId);
    }
    return null;
  }

  registerLensAction("feed", "space-list", (ctx, _artifact, _params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const all = [];
    for (const map of s.spaces.values()) {
      for (const sp of map.values()) all.push(spaceView(sp));
    }
    all.sort((a, b) => {
      if (a.status !== b.status) return a.status === "live" ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return { ok: true, result: { spaces: all, liveCount: all.filter(x => x.status === "live").length } };
  });

  registerLensAction("feed", "space-join", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const space = findSpace(s, String(params.spaceId || ""));
    if (!space) return { ok: false, error: "space not found" };
    if (space.status !== "live") return { ok: false, error: "space has ended" };
    const role = params.role === "speaker" ? "speaker" : "listener";
    space.speakers = space.speakers.filter(u => u !== userId);
    space.listeners = space.listeners.filter(u => u !== userId);
    if (role === "speaker") space.speakers.push(userId);
    else space.listeners.push(userId);
    saveFeedState();
    return { ok: true, result: { space: spaceView(space), role } };
  });

  registerLensAction("feed", "space-leave", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const space = findSpace(s, String(params.spaceId || ""));
    if (!space) return { ok: false, error: "space not found" };
    space.speakers = space.speakers.filter(u => u !== userId);
    space.listeners = space.listeners.filter(u => u !== userId);
    saveFeedState();
    return { ok: true, result: { space: spaceView(space) } };
  });

  registerLensAction("feed", "space-end", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = feedActor(ctx);
    const space = findSpace(s, String(params.spaceId || ""));
    if (!space) return { ok: false, error: "space not found" };
    if (space.hostId !== userId) return { ok: false, error: "only the host can end the space" };
    space.status = "ended";
    space.endedAt = nowIso();
    saveFeedState();
    return { ok: true, result: { space: spaceView(space) } };
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. CONTENT CONTROLS — MUTE WORDS / SENSITIVE-MEDIA / BLOCK  [S]
  // ════════════════════════════════════════════════════════════════════════

  function getControls(s, userId) {
    if (!s.controls.has(userId)) {
      s.controls.set(userId, { mutedWords: [], blockedUsers: [], sensitiveMedia: "blur" });
    }
    return s.controls.get(userId);
  }

  registerLensAction("feed", "controls-get", (ctx, _artifact, _params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { controls: getControls(s, feedActor(ctx)) } };
  });

  registerLensAction("feed", "controls-mute-word", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const c = getControls(s, feedActor(ctx));
    const word = String(params.word || "").trim().toLowerCase();
    if (!word) return { ok: false, error: "word required" };
    if (word.length > 60) return { ok: false, error: "word too long" };
    const op = String(params.op || "add");
    if (op === "add" && !c.mutedWords.includes(word)) c.mutedWords.push(word);
    else if (op === "remove") c.mutedWords = c.mutedWords.filter(w => w !== word);
    saveFeedState();
    return { ok: true, result: { controls: c } };
  });

  registerLensAction("feed", "controls-block-user", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const c = getControls(s, feedActor(ctx));
    const target = String(params.userId || "").trim();
    if (!target) return { ok: false, error: "userId required" };
    const op = String(params.op || "add");
    if (op === "add" && !c.blockedUsers.includes(target)) c.blockedUsers.push(target);
    else if (op === "remove") c.blockedUsers = c.blockedUsers.filter(u => u !== target);
    saveFeedState();
    return { ok: true, result: { controls: c } };
  });

  registerLensAction("feed", "controls-sensitive-media", (ctx, _artifact, params = {}) => {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const c = getControls(s, feedActor(ctx));
    const mode = String(params.mode || "");
    if (!["blur", "show", "hide"].includes(mode)) {
      return { ok: false, error: "mode must be blur|show|hide" };
    }
    c.sensitiveMedia = mode;
    saveFeedState();
    return { ok: true, result: { controls: c } };
  });

  // Apply the active content controls to a candidate post set — pure filter,
  // returns the kept posts plus what each control removed/flagged.
  registerLensAction("feed", "controls-apply", (ctx, _artifact, params = {}) => {
  try {
    const s = getFeedState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const c = getControls(s, feedActor(ctx));
    const candidates = Array.isArray(params.candidates) ? params.candidates : [];
    let mutedCount = 0, blockedCount = 0, flaggedCount = 0;
    const kept = [];
    for (const p of candidates) {
      if (c.blockedUsers.includes(String(p.authorId || ""))) { blockedCount++; continue; }
      const text = String(p.content || "").toLowerCase();
      if (c.mutedWords.some(w => w && text.includes(w))) { mutedCount++; continue; }
      const sensitive = !!p.sensitive;
      if (sensitive) {
        if (c.sensitiveMedia === "hide") { flaggedCount++; continue; }
        flaggedCount++;
        kept.push({ ...p, mediaTreatment: c.sensitiveMedia });
      } else {
        kept.push(p);
      }
    }
    return {
      ok: true,
      result: {
        posts: kept,
        removed: { muted: mutedCount, blocked: blockedCount },
        sensitiveFlagged: flaggedCount,
        sensitiveMode: c.sensitiveMedia,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
