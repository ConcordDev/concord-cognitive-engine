/**
 * Write-through cache for STATE._social.
 *
 * Lens map (phase 2):
 *   /lenses/social  home. Feed tab, composer, saved, profile, notifications
 *                   read STATE._social (this cache, backed by the tables in
 *                   migration 482).
 *   /lenses/feed    For You / Following / Explore already call
 *                   /api/social/feed/*, which reads the same store. Its
 *                   Profile panel is the Social profile.
 *   /messages       REST /api/social/dm on the same DM tables.
 *   Social Messages sub-tab uses the lens DM macros, which delegate to
 *                   the same sendMessage / getConversations / getMessages.
 *   /lenses/message Slack-style channels stay per-user. kind "dm" and
 *                   "group_dm" use one shared thread with a participant check.
 *   /lenses/forum   long-form communities. Out of this store.
 *   /lenses/chat    AI assistant. Out of scope.
 */

const queued = new WeakSet();

function dbOf(STATE) {
  const db = STATE?.db;
  if (!db || typeof db.prepare !== "function") return null;
  return db;
}

function tableReady(db) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='social_post_records'").get();
  } catch {
    return false;
  }
}

export function scheduleSocialFlush(STATE) {
  if (!STATE || STATE.__socialHydrating || queued.has(STATE)) return;
  queued.add(STATE);
  queueMicrotask(() => {
    queued.delete(STATE);
    try { flushSocialStore(STATE); } catch { /* table missing or locked */ }
  });
}

function postPayload(post) {
  const reactions = [];
  if (post.reactions instanceof Map) {
    for (const [type, users] of post.reactions) {
      reactions.push({ type, users: users instanceof Set ? [...users] : [] });
    }
  }
  return {
    id: post.id,
    userId: post.userId,
    content: post.content || post.body || "",
    body: post.body || post.content || "",
    title: post.title || "",
    mediaType: post.mediaType || (post.media?.length ? post.media[0].kind : "text"),
    mediaUrl: post.mediaUrl || post.media?.[0]?.url || null,
    media: Array.isArray(post.media) ? post.media : [],
    tags: post.tags || [],
    hashtags: post.hashtags || [],
    mentionedUsers: post.mentionedUsers || [],
    comments: Array.isArray(post.comments) ? post.comments : [],
    shares: Array.isArray(post.shares) ? post.shares : [],
    bookmarks: post.bookmarks instanceof Set ? [...post.bookmarks] : [],
    reactions,
    pollOptions: Array.isArray(post.pollOptions)
      ? post.pollOptions.map((o) => ({ text: o.text, votes: o.votes instanceof Set ? [...o.votes] : [] }))
      : null,
    poll: post.poll || null,
    quoteOf: post.quoteOf || null,
    lensReplies: Array.isArray(post.lensReplies) ? post.lensReplies : [],
    lensReactions: post.lensReactions instanceof Map ? [...post.lensReactions.entries()] : [],
    lensReposts: post.lensReposts instanceof Set ? [...post.lensReposts] : [],
    privacy: post.privacy || "public",
    federationVisibility: post.federationVisibility || "local",
    createdAt: post.createdAt,
    expiresAt: post.expiresAt || null,
    isPinned: !!post.isPinned,
    username: post.username || null,
    displayName: post.displayName || null,
    viewCount: post.viewCount || 0,
    watchTimeMs: post.watchTimeMs || 0,
    editHistory: Array.isArray(post.editHistory) ? post.editHistory : [],
    editedAt: post.editedAt || null,
    replyAudience: post.replyAudience || "everyone",
    threadParentId: post.threadParentId || null,
    groupId: post.groupId || null,
    sensitive: post.sensitive === true,
    listing: post.listing && typeof post.listing === "object" ? post.listing : null,
  };
}

function postFromPayload(raw) {
  const post = { ...raw };
  post.reactions = new Map((raw.reactions || []).map((r) => [r.type, new Set(r.users || [])]));
  post.bookmarks = new Set(raw.bookmarks || []);
  post.comments = Array.isArray(raw.comments) ? raw.comments : [];
  post.shares = Array.isArray(raw.shares) ? raw.shares : [];
  post.lensReplies = Array.isArray(raw.lensReplies) ? raw.lensReplies : [];
  post.lensReactions = new Map(raw.lensReactions || []);
  post.lensReposts = new Set(raw.lensReposts || []);
  if (Array.isArray(post.pollOptions)) {
    post.pollOptions = post.pollOptions.map((o) => ({ text: o.text, votes: new Set(o.votes || []) }));
  }
  return post;
}

export function flushSocialStore(STATE) {
  const db = dbOf(STATE);
  const social = STATE?._social;
  if (!db || !social || !tableReady(db) || STATE.__socialHydrating) return false;

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM social_profiles").run();
    const profileStmt = db.prepare(
      `INSERT INTO social_profiles (user_id, display_name, bio, avatar_url, website, is_public, payload_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const profile of social.profiles.values()) {
      profileStmt.run(
        profile.userId,
        profile.displayName || "",
        profile.bio || "",
        profile.avatar || "",
        profile.website || "",
        profile.isPublic === false ? 0 : 1,
        JSON.stringify(profile),
        profile.updatedAt || new Date().toISOString(),
      );
    }

    db.prepare("DELETE FROM social_follows").run();
    const followStmt = db.prepare("INSERT INTO social_follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)");
    for (const [followerId, set] of social.follows) {
      if (!(set instanceof Set)) continue;
      for (const followedId of set) followStmt.run(followerId, followedId, new Date().toISOString());
    }

    db.prepare("DELETE FROM social_post_records").run();
    db.prepare("DELETE FROM social_replies").run();
    db.prepare("DELETE FROM social_reactions").run();
    db.prepare("DELETE FROM social_bookmarks").run();
    const postStmt = db.prepare(
      `INSERT INTO social_post_records (id, user_id, content, privacy, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const replyStmt = db.prepare(
      "INSERT INTO social_replies (id, post_id, parent_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const reactStmt = db.prepare(
      "INSERT INTO social_reactions (post_id, user_id, kind, source) VALUES (?, ?, ?, 'lens')",
    );
    const bookmarkStmt = db.prepare("INSERT INTO social_bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)");
    let legacy = null;
    try {
      legacy = db.prepare(
        `INSERT OR REPLACE INTO social_posts (id, user_id, author_id, content, created_at, payload_json, privacy) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
    } catch { legacy = null; }

    for (const post of social.posts.values()) {
      if (!post?.id) continue;
      const payload = postPayload(post);
      const json = JSON.stringify(payload);
      postStmt.run(post.id, post.userId || null, payload.content, payload.privacy, payload.createdAt || null, json);
      const createdSec = Number.isFinite(Date.parse(payload.createdAt))
        ? Math.floor(Date.parse(payload.createdAt) / 1000)
        : Math.floor(Date.now() / 1000);
      if (legacy) {
        try { legacy.run(post.id, post.userId || null, post.userId || null, payload.content, createdSec, json, payload.privacy); }
        catch { /* older social_posts shape */ }
      }
      for (const reply of payload.lensReplies) {
        if (!reply?.id) continue;
        replyStmt.run(reply.id, post.id, reply.parentId || null, reply.userId || null, reply.body || "", reply.createdAt || null);
      }
      for (const [userId, kind] of payload.lensReactions) {
        reactStmt.run(post.id, userId, String(kind));
      }
      for (const userId of payload.bookmarks) bookmarkStmt.run(userId, post.id, payload.createdAt || null);
    }

    db.prepare("DELETE FROM social_dm_threads").run();
    db.prepare("DELETE FROM social_dm_messages").run();
    const threadStmt = db.prepare("INSERT INTO social_dm_threads (id, participant_a, participant_b, updated_at) VALUES (?, ?, ?, ?)");
    const msgStmt = db.prepare(
      `INSERT INTO social_dm_messages (id, thread_id, from_user_id, to_user_id, body, created_at, read_by_json, recalled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [threadId, msgs] of social.messages) {
      if (!Array.isArray(msgs) || msgs.length === 0) continue;
      const parts = String(threadId).split(":");
      threadStmt.run(threadId, parts[0] || "", parts[1] || "", msgs[msgs.length - 1].createdAt || null);
      for (const m of msgs) {
        msgStmt.run(
          m.id,
          threadId,
          m.fromUserId || null,
          m.toUserId || null,
          m.content || "",
          m.createdAt || null,
          JSON.stringify({
            readBy: m.readBy instanceof Set ? [...m.readBy] : [],
            seenBy: m.seenBy instanceof Set ? [...m.seenBy] : [],
            hiddenFor: m.hiddenFor instanceof Set ? [...m.hiddenFor] : [],
            requestStatus: m.requestStatus || null,
          }),
          m.recalled ? 1 : 0,
        );
      }
    }

    db.prepare("DELETE FROM social_notifications").run();
    const notifStmt = db.prepare(
      `INSERT INTO social_notifications (id, user_id, type, from_user_id, post_id, content, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [userId, list] of social.notifications) {
      if (!Array.isArray(list)) continue;
      for (const n of list) {
        if (!n?.id) continue;
        notifStmt.run(n.id, userId, n.type || "", n.fromUserId || null, n.postId || null, n.content || "", n.read ? 1 : 0, n.createdAt || null);
      }
    }

    db.prepare("DELETE FROM social_blocks").run();
    db.prepare("DELETE FROM social_mutes").run();
    const blockStmt = db.prepare("INSERT INTO social_blocks (user_id, blocked_id) VALUES (?, ?)");
    const muteStmt = db.prepare("INSERT INTO social_mutes (user_id, muted_id) VALUES (?, ?)");
    const mod = STATE.socialLens?.moderation;
    if (mod instanceof Map) {
      for (const [userId, bucket] of mod) {
        const blocked = bucket?.blocked instanceof Set ? bucket.blocked : new Set();
        const muted = bucket?.muted instanceof Set ? bucket.muted : new Set();
        for (const id of blocked) blockStmt.run(userId, id);
        for (const id of muted) muteStmt.run(userId, id);
      }
    }

    db.prepare("DELETE FROM social_reports").run();
    const reportStmt = db.prepare(
      "INSERT INTO social_reports (id, reporter_id, target_type, target_id, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const reports = STATE.socialLens?.reports;
    if (reports instanceof Map) {
      for (const report of reports.values()) {
        if (!report?.id) continue;
        reportStmt.run(report.id, report.userId || null, report.targetType || "post", report.postId || report.targetId || null, report.reason || "", JSON.stringify(report), report.createdAt || null);
      }
    }

    const draftTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='social_drafts'").get();
    if (draftTable && social.drafts instanceof Map) {
      db.prepare("DELETE FROM social_drafts").run();
      const draftStmt = db.prepare("INSERT INTO social_drafts (id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
      for (const draft of social.drafts.values()) {
        if (!draft?.id) continue;
        draftStmt.run(draft.id, draft.userId, draft.content || "", draft.createdAt || null, draft.updatedAt || null);
      }
    }
  });
  tx();
  return true;
}

export function ensureSocialHydrated(STATE) {
  if (!STATE || STATE.__socialDbHydrated || STATE.__socialHydrating) return;
  const social = STATE._social;
  const db = dbOf(STATE);
  STATE.__socialDbHydrated = true;
  if (!social || !db || !tableReady(db)) return;
  const hasMemory = social.posts.size || social.profiles.size || social.messages.size || social.notifications.size || social.follows.size;
  if (hasMemory) return;

  STATE.__socialHydrating = true;
  try {
    for (const row of db.prepare("SELECT payload_json FROM social_profiles").all()) {
      if (!row.payload_json) continue;
      const profile = JSON.parse(row.payload_json);
      if (profile?.userId) social.profiles.set(profile.userId, profile);
    }
    for (const row of db.prepare("SELECT follower_id, followed_id FROM social_follows").all()) {
      if (!social.follows.has(row.follower_id)) social.follows.set(row.follower_id, new Set());
      if (!social.followers.has(row.followed_id)) social.followers.set(row.followed_id, new Set());
      social.follows.get(row.follower_id).add(row.followed_id);
      social.followers.get(row.followed_id).add(row.follower_id);
    }
    for (const row of db.prepare("SELECT payload_json FROM social_post_records").all()) {
      if (!row.payload_json) continue;
      const post = postFromPayload(JSON.parse(row.payload_json));
      if (post?.id) social.posts.set(post.id, post);
    }
    const byThread = new Map();
    for (const row of db.prepare("SELECT * FROM social_dm_messages ORDER BY created_at ASC").all()) {
      if (!byThread.has(row.thread_id)) byThread.set(row.thread_id, []);
      let readBy = [];
      let seenBy = [];
      let hiddenFor = [];
      try {
        const parsed = JSON.parse(row.read_by_json || "[]");
        if (Array.isArray(parsed)) { readBy = parsed; seenBy = parsed; }
        else {
          readBy = parsed.readBy || [];
          seenBy = parsed.seenBy || readBy;
          hiddenFor = parsed.hiddenFor || [];
          row._requestStatus = parsed.requestStatus || null;
        }
      } catch { readBy = []; seenBy = []; hiddenFor = []; }
      byThread.get(row.thread_id).push({
        id: row.id,
        conversationId: row.thread_id,
        fromUserId: row.from_user_id,
        toUserId: row.to_user_id,
        content: row.body || "",
        mediaUrl: null,
        createdAt: row.created_at,
        readBy: new Set(readBy),
        seenBy: new Set(seenBy),
        hiddenFor: new Set(hiddenFor),
        requestStatus: row._requestStatus || null,
        recalled: !!row.recalled,
      });
    }
    for (const [id, msgs] of byThread) social.messages.set(id, msgs);

    for (const row of db.prepare("SELECT * FROM social_notifications ORDER BY created_at DESC").all()) {
      if (!social.notifications.has(row.user_id)) social.notifications.set(row.user_id, []);
      social.notifications.get(row.user_id).push({
        id: row.id,
        userId: row.user_id,
        type: row.type,
        fromUserId: row.from_user_id,
        postId: row.post_id,
        content: row.content || "",
        read: !!row.read,
        createdAt: row.created_at,
      });
    }

    const draftTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='social_drafts'").get();
    if (draftTable) {
      if (!(social.drafts instanceof Map)) social.drafts = new Map();
      for (const row of db.prepare("SELECT * FROM social_drafts").all()) {
        social.drafts.set(row.id, {
          id: row.id,
          userId: row.user_id,
          content: row.content || "",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }
    }

    if (!STATE.socialLens) STATE.socialLens = {};
    if (!(STATE.socialLens.moderation instanceof Map)) STATE.socialLens.moderation = new Map();
    for (const row of db.prepare("SELECT user_id, blocked_id FROM social_blocks").all()) {
      if (!STATE.socialLens.moderation.has(row.user_id)) {
        STATE.socialLens.moderation.set(row.user_id, { muted: new Set(), blocked: new Set() });
      }
      STATE.socialLens.moderation.get(row.user_id).blocked.add(row.blocked_id);
    }
    for (const row of db.prepare("SELECT user_id, muted_id FROM social_mutes").all()) {
      if (!STATE.socialLens.moderation.has(row.user_id)) {
        STATE.socialLens.moderation.set(row.user_id, { muted: new Set(), blocked: new Set() });
      }
      const bucket = STATE.socialLens.moderation.get(row.user_id);
      if (!(bucket.muted instanceof Set)) bucket.muted = new Set();
      bucket.muted.add(row.muted_id);
    }
  } catch {
    /* a half-migrated database leaves the memory cache empty */
  } finally {
    STATE.__socialHydrating = false;
  }
}

/** Test helper. The next getSocialState call reads the tables again. */
export function forgetSocialMemory(STATE) {
  if (!STATE) return;
  delete STATE._social;
  STATE.__socialDbHydrated = false;
}
