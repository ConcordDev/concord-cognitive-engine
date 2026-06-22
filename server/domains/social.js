// server/domains/social.js
// Domain actions for the social lens — the engagement-loop substrate the
// REST routes never covered: threaded replies, reactions/reposts, DM
// inbox + threads, hashtag pages, post-detail permalinks, media
// attachments, mute/block/report moderation, live streams, and
// polls / quote-posts.
//
// All state is per-user, persisted in globalThis._concordSTATE Maps.
// Shadows Instagram / X core engagement features.

import { screenLocalSync } from "../lib/content-safety/index.js";
import { resolveUserDisplay } from "../lib/friend-presence.js";

export default function registerSocialActions(registerLensAction) {
  // ─── shared state helpers ───────────────────────────────────────────
  function getSocialState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.socialLens) STATE.socialLens = {};
    const s = STATE.socialLens;
    if (!(s.posts instanceof Map)) s.posts = new Map();           // postId -> post
    if (!(s.replies instanceof Map)) s.replies = new Map();       // postId -> Array<reply>
    if (!(s.reactions instanceof Map)) s.reactions = new Map();   // postId -> Map(userId -> reaction)
    if (!(s.reposts instanceof Map)) s.reposts = new Map();       // postId -> Set<userId>
    if (!(s.dms instanceof Map)) s.dms = new Map();               // threadKey -> { participants, messages }
    if (!(s.moderation instanceof Map)) s.moderation = new Map(); // userId -> { muted:Set, blocked:Set }
    if (!(s.reports instanceof Map)) s.reports = new Map();       // reportId -> report
    if (!(s.streams instanceof Map)) s.streams = new Map();       // streamId -> stream
    if (!(s.streamViewers instanceof Map)) s.streamViewers = new Map(); // streamId -> Set<userId>
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const sid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = () => new Date().toISOString();
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const clip = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

  // Extract #hashtags from arbitrary text, lowercased + deduped.
  function extractHashtags(text) {
    const out = new Set();
    const re = /#([A-Za-z0-9_]{1,40})/g;
    let m;
    while ((m = re.exec(String(text || ""))) !== null) out.add(m[1].toLowerCase());
    return [...out];
  }
  // Stable thread key for a DM pair (order-independent).
  const dmKey = (a, b) => [String(a), String(b)].sort().join("::");

  function modBucket(s, userId) {
    if (!s.moderation.has(userId)) {
      s.moderation.set(userId, { muted: new Set(), blocked: new Set() });
    }
    const b = s.moderation.get(userId);
    if (!(b.muted instanceof Set)) b.muted = new Set(b.muted || []);
    if (!(b.blocked instanceof Set)) b.blocked = new Set(b.blocked || []);
    return b;
  }

  // Hydrate one post into a wire-shape object with engagement counts and
  // the viewer's own reaction/repost state attached.
  function hydratePost(s, postId, viewerId) {
    const post = s.posts.get(postId);
    if (!post) return null;
    const reactMap = s.reactions.get(postId) || new Map();
    const reactionCounts = {};
    for (const r of reactMap.values()) reactionCounts[r] = (reactionCounts[r] || 0) + 1;
    const repostSet = s.reposts.get(postId) || new Set();
    const replyList = s.replies.get(postId) || [];
    return {
      ...post,
      replyCount: replyList.length,
      reactionCounts,
      reactionTotal: reactMap.size,
      repostCount: repostSet.size,
      viewerReaction: viewerId ? (reactMap.get(viewerId) || null) : null,
      viewerReposted: viewerId ? repostSet.has(viewerId) : false,
    };
  }

  const REACTION_KINDS = ["like", "love", "celebrate", "insightful", "laugh", "sad"];

  // ── 0. createPost — feed substrate the engagement macros operate on ──
  // Supports plain posts, polls, quote-posts and media attachments so the
  // backlog items have a real persistence target (no REST dependency).
  registerLensAction("social", "createPost", (ctx, _a, params = {}) => {
  try {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const body = clip(params.body, 2000);
    // #3 — screen the post at the publish boundary (sync local checks for the
    // public tier). Blocks policy-violating content; allows the rest.
    if (body) {
      const screen = screenLocalSync(body, { targetScope: "published" });
      if (!screen.allowed) return { ok: false, error: "post_blocked", reason: screen.reason, flags: screen.flags };
    }
    const poll = params.poll && Array.isArray(params.poll.options)
      ? {
          question: clip(params.poll.question, 200),
          options: params.poll.options
            .map((o) => clip(o, 80))
            .filter(Boolean)
            .slice(0, 6)
            .map((label, i) => ({ id: `opt_${i}`, label, votes: 0 })),
          voters: {},
          closesAt: params.poll.closesAt || null,
        }
      : null;
    if (poll && poll.options.length < 2) return { ok: false, error: "poll needs at least 2 options" };
    // media attachments — list of { kind:'image'|'video', url, alt }
    const media = Array.isArray(params.media)
      ? params.media
          .filter((m) => m && (m.kind === "image" || m.kind === "video") && m.url)
          .slice(0, 4)
          .map((m) => ({ kind: m.kind, url: clip(m.url, 1000), alt: clip(m.alt, 200) }))
      : [];
    const quoteOf = params.quoteOf && s.posts.has(String(params.quoteOf))
      ? String(params.quoteOf) : null;
    if (!body && media.length === 0 && !poll && !quoteOf) {
      return { ok: false, error: "post needs a body, media, a poll, or a quoted post" };
    }
    const post = {
      id: sid("post"),
      userId,
      username: clip(params.username, 60) || userId,
      body,
      media,
      poll,
      quoteOf,
      hashtags: extractHashtags(body),
      createdAt: now(),
    };
    s.posts.set(post.id, post);
    save();
    return { ok: true, result: { post: hydratePost(s, post.id, userId) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("social", "feed", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const viewerId = actor(ctx);
    const mod = modBucket(s, viewerId);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 40));
    const items = [...s.posts.values()]
      .filter((p) => !mod.blocked.has(p.userId) && !mod.muted.has(p.userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((p) => hydratePost(s, p.id, viewerId));
    return { ok: true, result: { posts: items, count: items.length } };
  });

  // ── 1. Threaded replies / comment trees ─────────────────────────────
  registerLensAction("social", "addReply", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = String(params.postId || "");
    if (!s.posts.has(postId)) return { ok: false, error: "post not found" };
    const body = clip(params.body, 1000);
    if (!body) return { ok: false, error: "reply body required" };
    const parentId = params.parentId ? String(params.parentId) : null;
    const list = s.replies.get(postId) || [];
    if (parentId && !list.some((r) => r.id === parentId)) {
      return { ok: false, error: "parent reply not found" };
    }
    const userId = actor(ctx);
    const reply = {
      id: sid("reply"),
      postId,
      parentId,
      userId,
      username: clip(params.username, 60) || userId,
      body,
      createdAt: now(),
    };
    list.push(reply);
    s.replies.set(postId, list);
    save();
    return { ok: true, result: { reply } };
  });

  registerLensAction("social", "replyTree", (_ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = String(params.postId || "");
    if (!s.posts.has(postId)) return { ok: false, error: "post not found" };
    const flat = (s.replies.get(postId) || []).slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const byId = new Map(flat.map((r) => [r.id, { ...r, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    return { ok: true, result: { tree: roots, total: flat.length } };
  });

  // ── 2. Likes / reactions / repost actions ───────────────────────────
  registerLensAction("social", "react", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = String(params.postId || "");
    if (!s.posts.has(postId)) return { ok: false, error: "post not found" };
    const kind = String(params.reaction || "like").toLowerCase();
    if (!REACTION_KINDS.includes(kind)) return { ok: false, error: "unknown reaction kind" };
    const userId = actor(ctx);
    if (!s.reactions.has(postId)) s.reactions.set(postId, new Map());
    const map = s.reactions.get(postId);
    let viewerReaction;
    if (map.get(userId) === kind) {
      map.delete(userId); // toggle off
      viewerReaction = null;
    } else {
      map.set(userId, kind);
      viewerReaction = kind;
    }
    save();
    return { ok: true, result: { postId, viewerReaction, reactionTotal: map.size } };
  });

  registerLensAction("social", "repost", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = String(params.postId || "");
    if (!s.posts.has(postId)) return { ok: false, error: "post not found" };
    const userId = actor(ctx);
    if (!s.reposts.has(postId)) s.reposts.set(postId, new Set());
    const set = s.reposts.get(postId);
    let viewerReposted;
    if (set.has(userId)) { set.delete(userId); viewerReposted = false; }
    else { set.add(userId); viewerReposted = true; }
    save();
    return { ok: true, result: { postId, viewerReposted, repostCount: set.size } };
  });

  registerLensAction("social", "reactionKinds", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { kinds: REACTION_KINDS } };
  });

  // ── 3. Full DM inbox + conversation view ────────────────────────────
  registerLensAction("social", "sendMessage", (ctx, _a, params = {}) => {
  try {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const from = actor(ctx);
    const to = String(params.to || "");
    if (!to) return { ok: false, error: "recipient required" };
    if (to === from) return { ok: false, error: "cannot message yourself" };
    const body = clip(params.body, 2000);
    if (!body) return { ok: false, error: "message body required" };
    // recipient's block list gates delivery
    const recipMod = modBucket(s, to);
    if (recipMod.blocked.has(from)) return { ok: false, error: "you are blocked by this user" };
    const key = dmKey(from, to);
    if (!s.dms.has(key)) {
      s.dms.set(key, { key, participants: [from, to].sort(), messages: [], readBy: {} });
    }
    const thread = s.dms.get(key);
    const message = {
      id: sid("dm"),
      from,
      body,
      createdAt: now(),
    };
    thread.messages.push(message);
    thread.readBy[from] = thread.messages.length; // sender has read all
    save();
    return { ok: true, result: { threadKey: key, message } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("social", "inbox", (ctx, _a, _params = {}) => {
  try {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const threads = [];
    for (const t of s.dms.values()) {
      if (!t.participants.includes(me)) continue;
      const other = t.participants.find((p) => p !== me) || me;
      const last = t.messages[t.messages.length - 1] || null;
      const readIdx = t.readBy[me] || 0;
      threads.push({
        threadKey: t.key,
        with: other,
        lastMessage: last,
        messageCount: t.messages.length,
        unread: Math.max(0, t.messages.length - readIdx),
      });
    }
    threads.sort((a, b) => {
      const at = a.lastMessage?.createdAt || "";
      const bt = b.lastMessage?.createdAt || "";
      return bt.localeCompare(at);
    });
    // Resolve the other participant's display name per thread (additive — old
    // consumers ignore the new `withName` field). resolveUserDisplay is sync.
    try {
      const display = resolveUserDisplay(ctx?.db, [...new Set(threads.map((t) => t.with))]);
      for (const t of threads) t.withName = display[t.with]?.displayName || t.with;
    } catch { /* names are best-effort */ }
    const totalUnread = threads.reduce((n, t) => n + t.unread, 0);
    return { ok: true, result: { threads, count: threads.length, totalUnread } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("social", "conversation", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    let key = params.threadKey ? String(params.threadKey) : null;
    if (!key && params.with) key = dmKey(me, String(params.with));
    if (!key) return { ok: false, error: "threadKey or with required" };
    const thread = s.dms.get(key);
    if (!thread) return { ok: true, result: { threadKey: key, messages: [], with: params.with || null } };
    if (!thread.participants.includes(me)) return { ok: false, error: "not a participant" };
    // mark as read for the viewer
    thread.readBy[me] = thread.messages.length;
    save();
    const other = thread.participants.find((p) => p !== me) || me;
    // Resolve display names for the header + per message (additive fields).
    // resolveUserDisplay is synchronous — keep this handler sync.
    let withName = other;
    let msgs = thread.messages;
    try {
      const display = resolveUserDisplay(ctx?.db, [...new Set([me, other, ...thread.messages.map((m) => m.from)])]);
      withName = display[other]?.displayName || other;
      msgs = thread.messages.map((m) => ({ ...m, fromName: display[m.from]?.displayName || m.from }));
    } catch { /* names are best-effort */ }
    return {
      ok: true,
      result: { threadKey: key, with: other, withName, messages: msgs, count: msgs.length },
    };
  });

  // ── 4. Hashtag / topic pages ────────────────────────────────────────
  registerLensAction("social", "hashtagFeed", (ctx, _a, params = {}) => {
  try {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tag = String(params.tag || "").replace(/^#/, "").toLowerCase();
    if (!tag) return { ok: false, error: "tag required" };
    const viewerId = actor(ctx);
    const mod = modBucket(s, viewerId);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 40));
    const posts = [...s.posts.values()]
      .filter((p) => p.hashtags.includes(tag) && !mod.blocked.has(p.userId) && !mod.muted.has(p.userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((p) => hydratePost(s, p.id, viewerId));
    const contributors = new Set(posts.map((p) => p.userId)).size;
    return { ok: true, result: { tag, posts, count: posts.length, contributors } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("social", "trendingHashtags", (_ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const limit = Math.min(50, Math.max(1, parseInt(params.limit, 10) || 12));
    const counts = new Map();
    for (const p of s.posts.values()) {
      for (const t of p.hashtags) {
        const e = counts.get(t) || { tag: t, posts: 0 };
        e.posts++;
        counts.set(t, e);
      }
    }
    const trending = [...counts.values()]
      .sort((a, b) => b.posts - a.posts)
      .slice(0, limit);
    return { ok: true, result: { trending, count: trending.length } };
  });

  // ── 5. Post detail view with permalink + share ──────────────────────
  registerLensAction("social", "postDetail", (ctx, _a, params = {}) => {
  try {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = String(params.postId || "");
    if (!s.posts.has(postId)) return { ok: false, error: "post not found" };
    const viewerId = actor(ctx);
    const post = hydratePost(s, postId, viewerId);
    const flat = (s.replies.get(postId) || []).slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const byId = new Map(flat.map((r) => [r.id, { ...r, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
      else roots.push(node);
    }
    const quoted = post.quoteOf ? hydratePost(s, post.quoteOf, viewerId) : null;
    return {
      ok: true,
      result: {
        post,
        quoted,
        replyTree: roots,
        permalink: `/lenses/social/post/${postId}`,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("social", "shareTargets", (_ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = String(params.postId || "");
    if (!s.posts.has(postId)) return { ok: false, error: "post not found" };
    const permalink = `/lenses/social/post/${postId}`;
    return {
      ok: true,
      result: {
        postId,
        permalink,
        targets: [
          { id: "copy", label: "Copy link", value: permalink },
          { id: "dm", label: "Send via DM", value: postId },
          { id: "quote", label: "Quote post", value: postId },
          { id: "repost", label: "Repost", value: postId },
        ],
      },
    };
  });

  // ── 6. Media attachment helper — register/validate an attachment ────
  // The client uploads the binary elsewhere; this validates the descriptor
  // and returns the canonical attachment object the composer attaches.
  registerLensAction("social", "registerMedia", (_ctx, _a, params = {}) => {
    const kind = String(params.kind || "");
    if (kind !== "image" && kind !== "video") {
      return { ok: false, error: "kind must be 'image' or 'video'" };
    }
    const url = clip(params.url, 1000);
    if (!url) return { ok: false, error: "url required" };
    const isHttp = /^https?:\/\//i.test(url);
    const isData = /^data:(image|video)\//i.test(url);
    if (!isHttp && !isData) return { ok: false, error: "url must be http(s) or a data URI" };
    return {
      ok: true,
      result: {
        attachment: {
          kind,
          url,
          alt: clip(params.alt, 200),
          mime: clip(params.mime, 80) || (kind === "image" ? "image/*" : "video/*"),
        },
      },
    };
  });

  // ── 7. Mute / block / report moderation ─────────────────────────────
  registerLensAction("social", "mute", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const target = String(params.userId || "");
    if (!target || target === me) return { ok: false, error: "invalid target" };
    const b = modBucket(s, me);
    const muted = params.muted != null ? !!params.muted : !b.muted.has(target);
    if (muted) b.muted.add(target); else b.muted.delete(target);
    save();
    return { ok: true, result: { userId: target, muted } };
  });

  registerLensAction("social", "block", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const target = String(params.userId || "");
    if (!target || target === me) return { ok: false, error: "invalid target" };
    const b = modBucket(s, me);
    const blocked = params.blocked != null ? !!params.blocked : !b.blocked.has(target);
    if (blocked) b.blocked.add(target); else b.blocked.delete(target);
    save();
    return { ok: true, result: { userId: target, blocked } };
  });

  registerLensAction("social", "report", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const reasons = ["spam", "harassment", "misinformation", "hate", "violence", "other"];
    const reason = String(params.reason || "other").toLowerCase();
    if (!reasons.includes(reason)) return { ok: false, error: "unknown reason" };
    const targetKind = params.postId ? "post" : "user";
    const targetId = String(params.postId || params.userId || "");
    if (!targetId) return { ok: false, error: "postId or userId required" };
    if (targetKind === "post" && !s.posts.has(targetId)) return { ok: false, error: "post not found" };
    const report = {
      id: sid("report"),
      reporterId: me,
      targetKind,
      targetId,
      reason,
      detail: clip(params.detail, 500),
      status: "open",
      createdAt: now(),
    };
    s.reports.set(report.id, report);
    save();
    return { ok: true, result: { report } };
  });

  registerLensAction("social", "moderationStatus", (ctx, _a, _params = {}) => {
  try {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const b = modBucket(s, me);
    const myReports = [...s.reports.values()]
      .filter((r) => r.reporterId === me)
      .sort((a, b2) => b2.createdAt.localeCompare(a.createdAt));
    return {
      ok: true,
      result: {
        muted: [...b.muted],
        blocked: [...b.blocked],
        reports: myReports,
        reportCount: myReports.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 8. Live video / streaming beyond audio Spaces ───────────────────
  registerLensAction("social", "startStream", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const title = clip(params.title, 140);
    if (!title) return { ok: false, error: "stream title required" };
    // one live stream per host
    for (const st of s.streams.values()) {
      if (st.hostId === me && st.status === "live") return { ok: false, error: "you already have a live stream" };
    }
    const stream = {
      id: sid("stream"),
      hostId: me,
      hostName: clip(params.hostName, 60) || me,
      title,
      kind: ["camera", "screen", "world"].includes(String(params.kind)) ? String(params.kind) : "camera",
      status: "live",
      startedAt: now(),
      endedAt: null,
      peakViewers: 0,
      chat: [],
    };
    s.streams.set(stream.id, stream);
    s.streamViewers.set(stream.id, new Set());
    save();
    return { ok: true, result: { stream } };
  });

  registerLensAction("social", "liveStreams", (_ctx, _a, _params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const streams = [...s.streams.values()]
      .filter((st) => st.status === "live")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((st) => ({
        id: st.id, hostId: st.hostId, hostName: st.hostName, title: st.title,
        kind: st.kind, startedAt: st.startedAt,
        viewers: (s.streamViewers.get(st.id) || new Set()).size,
        peakViewers: st.peakViewers,
      }));
    return { ok: true, result: { streams, count: streams.length } };
  });

  registerLensAction("social", "joinStream", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const stream = s.streams.get(String(params.streamId || ""));
    if (!stream || stream.status !== "live") return { ok: false, error: "stream not live" };
    const me = actor(ctx);
    if (!s.streamViewers.has(stream.id)) s.streamViewers.set(stream.id, new Set());
    const viewers = s.streamViewers.get(stream.id);
    viewers.add(me);
    stream.peakViewers = Math.max(stream.peakViewers, viewers.size);
    save();
    return {
      ok: true,
      result: { streamId: stream.id, title: stream.title, hostName: stream.hostName, viewers: viewers.size },
    };
  });

  registerLensAction("social", "streamChat", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const stream = s.streams.get(String(params.streamId || ""));
    if (!stream || stream.status !== "live") return { ok: false, error: "stream not live" };
    const body = clip(params.body, 280);
    if (!body) return { ok: false, error: "chat body required" };
    const me = actor(ctx);
    const entry = { id: sid("sc"), userId: me, username: clip(params.username, 60) || me, body, at: now() };
    stream.chat.push(entry);
    if (stream.chat.length > 200) stream.chat = stream.chat.slice(-200);
    save();
    return { ok: true, result: { streamId: stream.id, entry, chat: stream.chat.slice(-50) } };
  });

  registerLensAction("social", "endStream", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const stream = s.streams.get(String(params.streamId || ""));
    if (!stream) return { ok: false, error: "stream not found" };
    const me = actor(ctx);
    if (stream.hostId !== me) return { ok: false, error: "only the host can end a stream" };
    if (stream.status === "ended") return { ok: true, result: { streamId: stream.id, status: "ended" } };
    stream.status = "ended";
    stream.endedAt = now();
    const startMs = Date.parse(stream.startedAt);
    const durationSeconds = Math.max(0, Math.round((Date.parse(stream.endedAt) - startMs) / 1000));
    s.streamViewers.set(stream.id, new Set());
    save();
    return {
      ok: true,
      result: { streamId: stream.id, status: "ended", durationSeconds, peakViewers: stream.peakViewers },
    };
  });

  // ── 9. Polls and quote-posts ────────────────────────────────────────
  registerLensAction("social", "votePoll", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const post = s.posts.get(String(params.postId || ""));
    if (!post) return { ok: false, error: "post not found" };
    if (!post.poll) return { ok: false, error: "post has no poll" };
    if (post.poll.closesAt && Date.parse(post.poll.closesAt) <= Date.now()) {
      return { ok: false, error: "poll is closed" };
    }
    const optId = String(params.optionId || "");
    const opt = post.poll.options.find((o) => o.id === optId);
    if (!opt) return { ok: false, error: "unknown poll option" };
    const me = actor(ctx);
    const prior = post.poll.voters[me];
    if (prior === optId) return { ok: false, error: "you already voted for that option" };
    if (prior) {
      const old = post.poll.options.find((o) => o.id === prior);
      if (old) old.votes = Math.max(0, old.votes - 1);
    }
    opt.votes++;
    post.poll.voters[me] = optId;
    save();
    const totalVotes = post.poll.options.reduce((n, o) => n + o.votes, 0);
    return {
      ok: true,
      result: {
        postId: post.id,
        viewerChoice: optId,
        totalVotes,
        options: post.poll.options.map((o) => ({
          id: o.id, label: o.label, votes: o.votes,
          pct: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0,
        })),
      },
    };
  });

  registerLensAction("social", "pollResults", (ctx, _a, params = {}) => {
  try {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const post = s.posts.get(String(params.postId || ""));
    if (!post) return { ok: false, error: "post not found" };
    if (!post.poll) return { ok: false, error: "post has no poll" };
    const me = actor(ctx);
    const totalVotes = post.poll.options.reduce((n, o) => n + o.votes, 0);
    const closed = !!post.poll.closesAt && Date.parse(post.poll.closesAt) <= Date.now();
    return {
      ok: true,
      result: {
        postId: post.id,
        question: post.poll.question,
        closed,
        closesAt: post.poll.closesAt,
        totalVotes,
        viewerChoice: post.poll.voters[me] || null,
        options: post.poll.options.map((o) => ({
          id: o.id, label: o.label, votes: o.votes,
          pct: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0,
        })),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
