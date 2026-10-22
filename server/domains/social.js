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
import { lookupUserIdentity } from "../lib/user-identity.js";
import logger from "../logger.js";
import { topicLabel } from "../lib/trending-topics.js";
import {
  isBlocked,
  recipientResolvable,
  canonicalSocial,
  sendMessage as layerSendMessage,
  getConversations,
  getMessages,
  markMessagesRead,
  createNotification,
} from "../emergent/social-layer.js";
import { scheduleSocialFlush } from "../lib/social-persist.js";
import { submitReport } from "../lib/content-moderation.js";
import { assertSocialRate, duplicatePost, linkHeavyNewAccount, textHitsKeywordMute } from "../lib/social-safety.js";

export default function registerSocialActions(registerLensAction) {
  // ─── shared state helpers ───────────────────────────────────────────
  // JSON.stringify(new Set(["id"])) is "{}". A snapshot written before nested
  // Sets were enveloped comes back as a plain object. `new Set(obj)` throws
  // "object is not iterable". Arrays and Set envelopes still restore; a plain
  // object has no remaining members (they were erased on that write).
  function asSet(value) {
    if (value instanceof Set) return value;
    if (Array.isArray(value)) return new Set(value);
    if (value && typeof value === "object" && value.__type === "Set" && Array.isArray(value.values)) {
      return new Set(value.values);
    }
    return new Set();
  }
  function asMap(value) {
    if (value instanceof Map) return value;
    if (value && typeof value === "object" && value.__type === "Map" && Array.isArray(value.entries)) {
      try { return new Map(value.entries); } catch { return new Map(); }
    }
    if (Array.isArray(value)) {
      const m = new Map();
      for (const entry of value) {
        if (Array.isArray(entry) && entry.length >= 2) m.set(entry[0], entry[1]);
      }
      return m;
    }
    if (value && typeof value === "object") return new Map(Object.entries(value));
    return new Map();
  }
  function getSocialState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.socialLens || typeof STATE.socialLens !== "object") STATE.socialLens = {};
    const s = STATE.socialLens;
    s.posts = asMap(s.posts);                 // postId -> post
    s.replies = asMap(s.replies);             // postId -> Array<reply>
    s.reactions = asMap(s.reactions);         // postId -> Map(userId -> reaction)
    s.reposts = asMap(s.reposts);             // postId -> Set<userId>
    s.dms = asMap(s.dms);                     // threadKey -> { participants, messages }
    s.moderation = asMap(s.moderation);       // userId -> { muted:Set, blocked:Set }
    s.reports = asMap(s.reports);             // reportId -> report
    s.streams = asMap(s.streams);             // streamId -> stream
    s.streamViewers = asMap(s.streamViewers); // streamId -> Set<userId>
    // Nested collections are not always Map/Set after a snapshot load.
    // Repair in place so a later react/repost/mute does not throw, and so
    // the next save writes real collections instead of another `{}`.
    for (const [postId, reactions] of s.reactions) {
      const map = asMap(reactions);
      if (map !== reactions) s.reactions.set(postId, map);
    }
    for (const [postId, reposts] of s.reposts) {
      const set = asSet(reposts);
      if (set !== reposts) s.reposts.set(postId, set);
    }
    for (const [streamId, viewers] of s.streamViewers) {
      const set = asSet(viewers);
      if (set !== viewers) s.streamViewers.set(streamId, set);
    }
    for (const bucket of s.moderation.values()) {
      if (!bucket || typeof bucket !== "object" || bucket instanceof Set || bucket instanceof Map) continue;
      bucket.muted = asSet(bucket.muted);
      bucket.blocked = asSet(bucket.blocked);
    }
    // One post map. Lens posts created before this alias are copied once,
    // ids preserved. Replies, reactions and reposts live on the post so the
    // SQLite snapshot and the Feed tab see the same object.
    const layer = canonicalSocial(STATE);
    if (!s.__postsAliased) {
      for (const [id, post] of [...s.posts.entries()]) {
        if (post && !layer.posts.has(id)) layer.posts.set(id, post);
      }
      s.__postsAliased = true;
    }
    s.posts = layer.posts;
    for (const post of s.posts.values()) {
      if (!post || typeof post !== "object") continue;
      if (!post.content && post.body) post.content = post.body;
      if (!post.body && post.content) post.body = post.content;
      if (!Array.isArray(post.hashtags)) post.hashtags = [];
      if (!Array.isArray(post.comments)) post.comments = [];
      if (!Array.isArray(post.shares)) post.shares = [];
      if (!(post.bookmarks instanceof Set)) post.bookmarks = new Set();
      if (!(post.reactions instanceof Map)) post.reactions = new Map();
      if (!post.privacy) post.privacy = "public";
      if (!(post.lensReactions instanceof Map)) {
        const prior = s.reactions.get(post.id);
        post.lensReactions = prior instanceof Map ? prior : new Map();
      }
      s.reactions.set(post.id, post.lensReactions);
      if (!(post.lensReposts instanceof Set)) {
        post.lensReposts = asSet(s.reposts.get(post.id));
      }
      s.reposts.set(post.id, post.lensReposts);
      if (!Array.isArray(post.lensReplies)) {
        const prior = s.replies.get(post.id);
        post.lensReplies = Array.isArray(prior) ? prior : [];
      }
      s.replies.set(post.id, post.lensReplies);
    }
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    scheduleSocialFlush(globalThis._concordSTATE);
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
  function modBucket(s, userId) {
    if (!(s.moderation instanceof Map)) s.moderation = asMap(s.moderation);
    if (!s.moderation.has(userId)) {
      s.moderation.set(userId, { muted: new Set(), blocked: new Set() });
    }
    const b = s.moderation.get(userId);
    if (!b || typeof b !== "object") {
      const fresh = { muted: new Set(), blocked: new Set() };
      s.moderation.set(userId, fresh);
      return fresh;
    }
    b.muted = asSet(b.muted);
    b.blocked = asSet(b.blocked);
    return b;
  }

  function authorIdentity(ctx, userId, clientUsername, clientDisplay) {
    const idn = lookupUserIdentity(ctx?.db || globalThis._concordSTATE?.db, userId);
    const client = clip(clientUsername, 60);
    const clientOk = client && client !== userId ? client : "";
    const dbHandle = idn.username && idn.username !== userId ? idn.username : "";
    const username = clientOk || dbHandle || userId;
    const named = clientDisplay && clientDisplay !== userId ? clientDisplay : "";
    const dbName = idn.displayName && idn.displayName !== userId ? idn.displayName : "";
    const displayName = named || dbName || clientOk || dbHandle || null;
    return { username, displayName };
  }

  function persistSocialRow(ctx, post) {
    const db = ctx?.db || globalThis._concordSTATE?.db;
    if (!db || typeof db.prepare !== "function" || !post?.id) return;
    try {
      const created = Number.isFinite(Date.parse(post.createdAt))
        ? Math.floor(Date.parse(post.createdAt) / 1000)
        : Math.floor(Date.now() / 1000);
      db.prepare(
        `INSERT OR REPLACE INTO social_posts (id, user_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(post.id, post.userId, post.userId, post.body || "", created);
    } catch { /* social_posts may be absent on a minimal DB */ }
  }

  // Hydrate one post into a wire-shape object with engagement counts and
  // the viewer's own reaction/repost state attached. A stored user id is
  // replaced with the account's display name and @username when the users
  // table has them.
  function hydratePost(s, postId, viewerId, ctx) {
    const post = s.posts.get(postId);
    if (!post) return null;
    const reactMap = asMap(s.reactions.get(postId));
    const reactionCounts = {};
    for (const r of reactMap.values()) {
      if (typeof r !== "string" || !r) continue;
      reactionCounts[r] = (reactionCounts[r] || 0) + 1;
    }
    const repostSet = asSet(s.reposts.get(postId));
    const replyRaw = s.replies.get(postId);
    const replyList = Array.isArray(replyRaw) ? replyRaw : [];
    const who = authorIdentity(ctx, post.userId, post.username, post.displayName);
    const viewer = canonicalSocial(globalThis._concordSTATE).profiles.get(viewerId);
    const hideMedia = post.sensitive === true && viewerId !== post.userId && viewer?.showSensitive !== true;
    return {
      ...post,
      media: hideMedia ? [] : post.media,
      mediaUrl: hideMedia ? null : post.mediaUrl,
      sensitiveHidden: hideMedia,
      username: who.username,
      displayName: who.displayName,
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
    const profile = canonicalSocial(globalThis._concordSTATE).profiles.get(userId);
    const postLimit = assertSocialRate(profile, userId, "post");
    if (!postLimit.ok) return { ok: false, status: postLimit.status, error: postLimit.error };
    if (duplicatePost(s.posts, userId, body)) return { ok: false, status: 409, error: "duplicate post" };
    if (linkHeavyNewAccount(profile, body)) return { ok: false, status: 403, error: "new accounts cannot post that many links" };
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
    if (Array.isArray(params.media) && params.media.some((m) => typeof m?.url === "string" && /^data:/i.test(m.url))) {
      return { ok: false, error: "data URIs are not accepted; upload the file first" };
    }
    const media = Array.isArray(params.media)
      ? params.media
          .filter((m) => m && (m.kind === "image" || m.kind === "video" || m.kind === "audio") && m.url)
          .slice(0, 4)
          .map((m) => ({ kind: m.kind, url: clip(m.url, 1000), alt: clip(m.alt, 200), caption: clip(m.caption, 200) }))
      : [];
    const quoteOf = params.quoteOf && s.posts.has(String(params.quoteOf))
      ? String(params.quoteOf) : null;
    if (!body && media.length === 0 && !poll && !quoteOf) {
      return { ok: false, error: "post needs a body, media, a poll, or a quoted post" };
    }
    const who = authorIdentity(ctx, userId, params.username, params.displayName);
    const post = {
      id: sid("post"),
      userId,
      username: who.username,
      displayName: who.displayName,
      body,
      media,
      poll,
      quoteOf,
      hashtags: extractHashtags(body),
      content: body,
      comments: [],
      shares: [],
      bookmarks: new Set(),
      reactions: new Map(),
      privacy: "public",
      sensitive: params.sensitive === true,
      lensReplies: [],
      lensReactions: new Map(),
      lensReposts: new Set(),
      createdAt: now(),
    };
    s.posts.set(post.id, post);
    persistSocialRow(ctx, post);
    save();
    return { ok: true, result: { post: hydratePost(s, post.id, userId, ctx) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("social", "feed", (ctx, _a, params = {}) => {
    try {
      const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const viewerId = actor(ctx);
      const mod = modBucket(s, viewerId);
      const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 40));
      const viewerProfile = canonicalSocial(globalThis._concordSTATE).profiles.get(viewerId);
      const items = [...s.posts.values()]
        .filter((p) => p && !mod.blocked.has(p.userId) && !mod.muted.has(p.userId))
        .filter((p) => p.userId === viewerId || !textHitsKeywordMute(viewerProfile, `${p.content || ""} ${p.body || ""} ${(p.hashtags || []).join(" ")}`))
        .sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")))
        .slice(0, limit)
        .map((p) => hydratePost(s, p.id, viewerId, ctx))
        .filter(Boolean);
      return { ok: true, result: { posts: items, count: items.length } };
    } catch (e) {
      const message = String(e?.message || e);
      try { logger.error("social", "social.feed failed", { error: message, stack: e?.stack }); }
      catch { /* logging must not mask the failure */ }
      return { ok: false, error: message };
    }
  });

  registerLensAction("social", "deletePost", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const postId = String(params.postId || "");
    const post = s.posts.get(postId);
    if (!post) return { ok: false, error: "post not found" };
    if (post.userId !== userId) return { ok: false, error: "only the author can delete this post" };
    s.posts.delete(postId);
    s.replies.delete(postId);
    s.reactions.delete(postId);
    s.reposts.delete(postId);
    const db = ctx?.db || globalThis._concordSTATE?.db;
    if (db && typeof db.prepare === "function") {
      try {
        db.prepare("DELETE FROM social_posts WHERE id = ? AND (user_id = ? OR author_id = ?)").run(postId, userId, userId);
      } catch { /* table may be absent */ }
    }
    save();
    return { ok: true, result: { id: postId, deleted: true } };
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
    const replyLimit = assertSocialRate(canonicalSocial(globalThis._concordSTATE).profiles.get(userId), userId, "comment");
    if (!replyLimit.ok) return { ok: false, status: replyLimit.status, error: replyLimit.error };
    const who = authorIdentity(ctx, userId, params.username, params.displayName);
    const reply = {
      id: sid("reply"),
      postId,
      parentId,
      userId,
      username: who.username,
      displayName: who.displayName,
      body,
      createdAt: now(),
    };
    list.push(reply);
    s.replies.set(postId, list);
    const host = s.posts.get(postId);
    if (host) {
      if (!Array.isArray(host.comments)) host.comments = [];
      host.comments.push({
        id: reply.id,
        userId,
        content: body,
        parentCommentId: parentId,
        mentionedUsers: [],
        createdAt: reply.createdAt,
        replies: [],
      });
    }
    save();
    return { ok: true, result: { reply } };
  });

  registerLensAction("social", "replyTree", (ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = String(params.postId || "");
    if (!s.posts.has(postId)) return { ok: false, error: "post not found" };
    const flat = (s.replies.get(postId) || []).slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => {
        const who = authorIdentity(ctx, r.userId, r.username, r.displayName);
        return { ...r, username: who.username, displayName: who.displayName };
      });
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
    else {
      set.add(userId);
      viewerReposted = true;
      const post = s.posts.get(postId);
      if (post && post.userId !== userId) {
        createNotification(globalThis._concordSTATE, {
          userId: post.userId, type: "repost", fromUserId: userId, postId, content: `${userId} reposted your post`,
        });
      }
    }
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
    const STATE = globalThis._concordSTATE;
    if (isBlocked(STATE, from, to)) return { ok: false, error: "you are blocked by this user" };
    if (!ctx?.internal && !recipientResolvable(STATE, to, ctx?.db || STATE?.db)) {
      return { ok: false, error: "recipient not found" };
    }
    const sent = layerSendMessage(STATE, { fromUserId: from, toUserId: to, content: body });
    if (!sent.ok) return { ok: false, error: sent.error || "blocked", status: sent.status };
    const message = {
      id: sent.message.id,
      from: sent.message.fromUserId,
      body: sent.message.content,
      createdAt: sent.message.createdAt,
    };
    save();
    return { ok: true, result: { threadKey: sent.message.conversationId, message } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("social", "inbox", (ctx, _a, _params = {}) => {
  try {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const STATE = globalThis._concordSTATE;
    const listed = getConversations(STATE, me);
    const threads = (listed.conversations || []).map((c) => ({
      threadKey: c.conversationId,
      with: c.otherUserId,
      lastMessage: c.lastMessage
        ? { from: c.lastMessage.fromUserId, body: c.lastMessage.content, createdAt: c.lastMessage.createdAt }
        : null,
      messageCount: c.messageCount || 0,
      unread: c.unreadCount || 0,
    }));
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
    const STATE = globalThis._concordSTATE;
    let key = params.threadKey ? String(params.threadKey) : null;
    if (key && key.includes("::")) {
      const [a, b] = key.split("::");
      key = [a, b].sort().join(":");
    }
    if (!key && params.with) key = [me, String(params.with)].sort().join(":");
    if (!key) return { ok: false, error: "threadKey or with required" };
    const parts = key.split(":");
    if (parts.length !== 2 || !parts.includes(me)) return { ok: false, error: "not a participant" };
    const read = markMessagesRead(STATE, { userId: me, conversationId: key });
    if (!read.ok && read.error === "not a participant") return { ok: false, error: "not a participant" };
    if (!read.ok) return { ok: true, result: { threadKey: key, messages: [], with: params.with || null } };
    const loaded = getMessages(STATE, key, { userId: me, limit: 200 });
    if (!loaded.ok) return { ok: false, error: loaded.error || "not a participant" };
    const other = key.split(":").find((id) => id !== me) || params.with || me;
    let withName = other;
    let msgs = [...(loaded.messages || [])].reverse().map((m) => ({
      id: m.id, from: m.fromUserId, body: m.content, createdAt: m.createdAt,
      recalled: !!m.recalled, readBy: Array.isArray(m.readBy) ? m.readBy : [],
    }));
    try {
      const display = resolveUserDisplay(ctx?.db, [...new Set([me, other, ...msgs.map((m) => m.from)])]);
      withName = display[other]?.displayName || other;
      msgs = msgs.map((m) => ({ ...m, fromName: display[m.from]?.displayName || m.from }));
    } catch { /* names are best-effort */ }
    save();
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
    const viewerProfile = canonicalSocial(globalThis._concordSTATE).profiles.get(viewerId);
    const posts = [...s.posts.values()]
      .filter((p) => Array.isArray(p?.hashtags) && p.hashtags.includes(tag) && !mod.blocked.has(p.userId) && !mod.muted.has(p.userId))
      .filter((p) => p.userId === viewerId || !textHitsKeywordMute(viewerProfile, `${p.content || ""} ${p.body || ""} ${(p.hashtags || []).join(" ")}`))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((p) => hydratePost(s, p.id, viewerId, ctx));
    const contributors = new Set(posts.map((p) => p.userId)).size;
    return { ok: true, result: { tag, posts, count: posts.length, contributors } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("social", "trendingHashtags", (_ctx, _a, params = {}) => {
    const s = getSocialState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const limit = Math.min(50, Math.max(1, parseInt(params.limit, 10) || 12));
    const counts = new Map();
    for (const p of s.posts.values()) {
      const tags = Array.isArray(p?.hashtags) ? p.hashtags : [];
      for (const t of tags) {
        const label = topicLabel(t);
        if (!label) continue;
        const e = counts.get(label) || { tag: label, posts: 0 };
        e.posts++;
        counts.set(label, e);
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
    const post = hydratePost(s, postId, viewerId, ctx);
    const flat = (s.replies.get(postId) || []).slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => {
        const who = authorIdentity(ctx, r.userId, r.username, r.displayName);
        return { ...r, username: who.username, displayName: who.displayName };
      });
    const byId = new Map(flat.map((r) => [r.id, { ...r, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
      else roots.push(node);
    }
    const quoted = post.quoteOf ? hydratePost(s, post.quoteOf, viewerId, ctx) : null;
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
    if (kind !== "image" && kind !== "video" && kind !== "audio") {
      return { ok: false, error: "kind must be 'image', 'video', or 'audio'" };
    }
    if (typeof params.url === "string" && /^data:/i.test(params.url)) {
      return { ok: false, error: "data URIs are not accepted; upload the file first" };
    }
    const url = clip(params.url, 1000);
    if (!url) return { ok: false, error: "url required" };
    const isHttp = /^https?:\/\//i.test(url);
    const isArtifact = url.startsWith("/api/artifact/");
    if (!isHttp && !isArtifact) return { ok: false, error: "url must be an http(s) or /api/artifact/ URL" };
    return {
      ok: true,
      result: {
        attachment: {
          kind,
          url,
          alt: clip(params.alt, 200),
          caption: clip(params.caption, 200),
          mime: clip(params.mime, 80) || (kind === "image" ? "image/*" : kind === "audio" ? "audio/*" : "video/*"),
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
    const category = reason === "hate" ? "hate_speech" : reason;
    let moderation = null;
    try {
      const STATE = globalThis._concordSTATE;
      if (STATE) {
        moderation = submitReport(STATE, {
          reporterId: me,
          contentId: targetId,
          contentType: targetKind === "post" ? "post" : "profile",
          category,
          reason: clip(params.detail, 500) || `social report: ${reason}`,
        });
      }
    } catch (err) {
      moderation = { ok: false, error: String(err?.message || err) };
    }
    return { ok: true, result: { report, moderation } };
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
