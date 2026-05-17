/**
 * Concord — Social / Distribution Layer
 *
 * Public DTU profiles, follow system, public feeds,
 * cited-by counters, trending DTUs, discovery loops.
 */


// ── Realtime emit hookup (Phase 11, Item 4) ─────────────────────────────
//
// createNotification is invoked from inside this module (from
// addReaction / addComment / sharePost / sendMessage etc.) — there's
// no server.js call frame to attach a socket emit to.  setSocialEmitter
// is called from server.js once at boot to thread the emitToUser
// helper in.  When the emitter is set, every notification that's
// generated also fires a `social:notification` event to the
// recipient's user-scoped socket room so toasts show up in real time
// instead of waiting on the 60s notification-bell poll.

let _socialEmitter = null;
export function setSocialEmitter(fn) { _socialEmitter = typeof fn === "function" ? fn : null; }
function _fireNotificationSocket(userId, notification) {
  if (!_socialEmitter || !userId) return;
  try { _socialEmitter(userId, "social:notification", { notification }); }
  catch (_e) { /* never crash the substrate over a socket fanout */ }
}

// ── Social State ─────────────────────────────────────────────────────────

function getSocialState(STATE) {
  if (!STATE._social) {
    STATE._social = {
      profiles: new Map(),       // userId → profile object
      follows: new Map(),        // userId → Set<followedUserId>
      followers: new Map(),      // userId → Set<followerUserId>
      publicDtus: new Set(),     // dtuIds that are marked public
      citedBy: new Map(),        // dtuId → Set<citingDtuId>
      feedCache: new Map(),      // userId → cached feed entries
      trending: [],              // trending DTU snapshots
      trendingComputedAt: 0,

      // New social structures
      posts: new Map(),          // postId → post object
      messages: new Map(),       // conversationId → array of messages
      notifications: new Map(),  // userId → array of notifications
      groups: new Map(),         // groupId → group object
      streaks: new Map(),        // userId → { current, longest, lastPostDate }
      scheduledPosts: new Map(), // postId → { postData, scheduledAt, userId }
      postListings: new Map(),   // postId → Set<listingId>
      postClicks: new Map(),     // postId → click count
      postEarnings: new Map(),   // postId → earnings amount

      metrics: {
        totalProfiles: 0,
        totalFollows: 0,
        publicDtuCount: 0,
        feedRequests: 0,
        trendingComputations: 0,
      },
    };
  }
  // Ensure new fields exist on older state objects
  const s = STATE._social;
  if (!s.posts) s.posts = new Map();
  if (!s.messages) s.messages = new Map();
  if (!s.notifications) s.notifications = new Map();
  if (!s.groups) s.groups = new Map();
  if (!s.streaks) s.streaks = new Map();
  if (!s.scheduledPosts) s.scheduledPosts = new Map();
  if (!s.postListings) s.postListings = new Map();
  if (!s.postClicks) s.postClicks = new Map();
  if (!s.postEarnings) s.postEarnings = new Map();
  return STATE._social;
}

let _postIdCounter = 0;
function nextId(prefix) { return `${prefix}_${Date.now()}_${++_postIdCounter}`; }

// ── Profiles ─────────────────────────────────────────────────────────────

/**
 * Create or update a public profile for a user.
 */
export function upsertProfile(STATE, userId, profileData) {
  const social = getSocialState(STATE);

  const existing = social.profiles.get(userId);
  const profile = {
    userId,
    displayName: profileData.displayName || existing?.displayName || userId,
    bio: profileData.bio || existing?.bio || "",
    avatar: profileData.avatar || existing?.avatar || "",
    isPublic: profileData.isPublic !== undefined ? profileData.isPublic : (existing?.isPublic ?? true),
    specialization: profileData.specialization || existing?.specialization || [],
    website: profileData.website || existing?.website || "",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Computed stats (updated on reads)
    stats: existing?.stats || {
      dtuCount: 0,
      publicDtuCount: 0,
      citationCount: 0,
      followerCount: 0,
      followingCount: 0,
    },
  };

  const isNew = !existing;
  social.profiles.set(userId, profile);
  if (isNew) social.metrics.totalProfiles++;

  return { ok: true, profile, isNew };
}

export function getProfile(STATE, userId) {
  const social = getSocialState(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, error: "Profile not found" };

  // Recompute stats
  profile.stats.followerCount = (social.followers.get(userId) || new Set()).size;
  profile.stats.followingCount = (social.follows.get(userId) || new Set()).size;

  // Count public DTUs by this user
  let dtuCount = 0;
  let publicDtuCount = 0;
  let citationCount = 0;

  if (STATE.dtus) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.author === userId || dtu.meta?.authorId === userId) {
        dtuCount++;
        if (social.publicDtus.has(dtu.id)) publicDtuCount++;
      }
    }
  }

  // Count citations
  for (const [dtuId, citers] of social.citedBy) {
    const dtu = STATE.dtus?.get(dtuId);
    if (dtu && (dtu.author === userId || dtu.meta?.authorId === userId)) {
      citationCount += citers.size;
    }
  }

  profile.stats.dtuCount = dtuCount;
  profile.stats.publicDtuCount = publicDtuCount;
  profile.stats.citationCount = citationCount;

  return { ok: true, profile };
}

export function listProfiles(STATE, options = {}) {
  const social = getSocialState(STATE);
  let profiles = Array.from(social.profiles.values());

  // Only public profiles
  if (options.publicOnly !== false) {
    profiles = profiles.filter(p => p.isPublic);
  }

  // Sort options
  const sortBy = options.sortBy || "citationCount";
  profiles.sort((a, b) => {
    if (sortBy === "citationCount") return (b.stats?.citationCount || 0) - (a.stats?.citationCount || 0);
    if (sortBy === "followerCount") return (b.stats?.followerCount || 0) - (a.stats?.followerCount || 0);
    if (sortBy === "dtuCount") return (b.stats?.dtuCount || 0) - (a.stats?.dtuCount || 0);
    return 0;
  });

  const limit = options.limit || 50;
  return { ok: true, profiles: profiles.slice(0, limit), total: profiles.length };
}

// ── Follow System ────────────────────────────────────────────────────────

/**
 * Follow a user. Simple bidirectional index.
 */
export function followUser(STATE, followerId, followedId) {
  const social = getSocialState(STATE);
  if (followerId === followedId) return { ok: false, error: "Cannot follow yourself" };

  // Check followed user exists
  if (!social.profiles.has(followedId)) {
    return { ok: false, error: "User not found" };
  }

  if (!social.follows.has(followerId)) social.follows.set(followerId, new Set());
  if (!social.followers.has(followedId)) social.followers.set(followedId, new Set());

  const alreadyFollowing = social.follows.get(followerId).has(followedId);
  social.follows.get(followerId).add(followedId);
  social.followers.get(followedId).add(followerId);

  if (!alreadyFollowing) social.metrics.totalFollows++;

  // Invalidate feed cache for follower
  social.feedCache.delete(followerId);

  return { ok: true, followerId, followedId, isNew: !alreadyFollowing };
}

export function unfollowUser(STATE, followerId, followedId) {
  const social = getSocialState(STATE);

  const followSet = social.follows.get(followerId);
  const followerSet = social.followers.get(followedId);
  if (!followSet?.has(followedId)) return { ok: false, error: "Not following this user" };

  followSet.delete(followedId);
  followerSet?.delete(followerId);
  social.metrics.totalFollows = Math.max(0, social.metrics.totalFollows - 1);

  // Invalidate feed cache
  social.feedCache.delete(followerId);

  return { ok: true, followerId, followedId };
}

export function getFollowers(STATE, userId, limit = 50) {
  const social = getSocialState(STATE);
  const followerSet = social.followers.get(userId) || new Set();
  const followers = Array.from(followerSet).slice(0, limit).map(id => {
    const profile = social.profiles.get(id);
    return { userId: id, displayName: profile?.displayName || id };
  });
  return { ok: true, userId, followers, total: followerSet.size };
}

export function getFollowing(STATE, userId, limit = 50) {
  const social = getSocialState(STATE);
  const followSet = social.follows.get(userId) || new Set();
  const following = Array.from(followSet).slice(0, limit).map(id => {
    const profile = social.profiles.get(id);
    return { userId: id, displayName: profile?.displayName || id };
  });
  return { ok: true, userId, following, total: followSet.size };
}

// ── Public DTU Index ─────────────────────────────────────────────────────

/**
 * Mark a DTU as public (visible in feeds and search).
 */
export function publishDtu(STATE, dtuId, _userId) {
  const social = getSocialState(STATE);

  // Verify ownership
  const dtu = STATE.dtus?.get(dtuId);
  if (!dtu) return { ok: false, error: "DTU not found" };

  social.publicDtus.add(dtuId);
  social.metrics.publicDtuCount = social.publicDtus.size;

  return { ok: true, dtuId, isPublic: true };
}

export function unpublishDtu(STATE, dtuId) {
  const social = getSocialState(STATE);
  social.publicDtus.delete(dtuId);
  social.metrics.publicDtuCount = social.publicDtus.size;
  return { ok: true, dtuId, isPublic: false };
}

// ── Cited-By Tracking ────────────────────────────────────────────────────

/**
 * Record that dtuB cites dtuA. Updates cited-by counters.
 */
export function recordCitation(STATE, citedDtuId, citingDtuId) {
  const social = getSocialState(STATE);
  if (citedDtuId === citingDtuId) return { ok: false, error: "Self-citation" };

  if (!social.citedBy.has(citedDtuId)) social.citedBy.set(citedDtuId, new Set());
  social.citedBy.get(citedDtuId).add(citingDtuId);

  return { ok: true, citedDtuId, citingDtuId, totalCitations: social.citedBy.get(citedDtuId).size };
}

export function getCitedBy(STATE, dtuId, limit = 50) {
  const social = getSocialState(STATE);
  const citers = social.citedBy.get(dtuId) || new Set();
  const citing = Array.from(citers).slice(0, limit).map(id => {
    const dtu = STATE.dtus?.get(id);
    return { dtuId: id, title: dtu?.title || dtu?.human?.title || id };
  });
  return { ok: true, dtuId, citedBy: citing, total: citers.size };
}

// ── Feed System ──────────────────────────────────────────────────────────

/**
 * Get personalized feed for a user (DTUs from people they follow).
 */
export function getFeed(STATE, userId, options = {}) {
  const social = getSocialState(STATE);
  social.metrics.feedRequests++;

  const followSet = social.follows.get(userId) || new Set();
  const feedItems = [];

  // Collect recent public DTUs from followed users
  if (STATE.dtus) {
    for (const dtu of STATE.dtus.values()) {
      const authorId = dtu.author || dtu.meta?.authorId;
      if (!followSet.has(authorId)) continue;
      if (!social.publicDtus.has(dtu.id)) continue;

      feedItems.push({
        dtuId: dtu.id,
        title: dtu.title || dtu.human?.title || "Untitled",
        authorId,
        authorName: social.profiles.get(authorId)?.displayName || authorId,
        tags: (dtu.tags || []).slice(0, 5),
        tier: dtu.tier || "regular",
        createdAt: dtu.createdAt || dtu.meta?.createdAt,
        citationCount: (social.citedBy.get(dtu.id) || new Set()).size,
      });
    }
  }

  // Sort by recency
  feedItems.sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  const limit = options.limit || 30;
  const offset = options.offset || 0;

  return {
    ok: true,
    feed: feedItems.slice(offset, offset + limit),
    total: feedItems.length,
    followingCount: followSet.size,
  };
}

// ── Trending DTUs ────────────────────────────────────────────────────────

/**
 * Compute trending DTUs based on citation count, recency, and engagement.
 */
export function computeTrending(STATE, limit = 20) {
  const social = getSocialState(STATE);
  const now = Date.now();

  // Only recompute every 5 minutes
  if (now - social.trendingComputedAt < 300000 && social.trending.length > 0) {
    return { ok: true, trending: social.trending, cached: true };
  }

  const candidates = [];

  for (const dtuId of social.publicDtus) {
    const dtu = STATE.dtus?.get(dtuId);
    if (!dtu) continue;

    const citations = (social.citedBy.get(dtuId) || new Set()).size;
    const age = (now - new Date(dtu.createdAt || 0).getTime()) / (86400000); // days
    const recencyBoost = Math.max(0, 1 - age * 0.05); // decays over 20 days
    const score = citations * 2 + recencyBoost * 10;

    candidates.push({
      dtuId,
      title: dtu.title || dtu.human?.title || "Untitled",
      authorId: dtu.author || dtu.meta?.authorId,
      authorName: social.profiles.get(dtu.author || dtu.meta?.authorId)?.displayName || "Unknown",
      tags: (dtu.tags || []).slice(0, 5),
      citationCount: citations,
      score: Math.round(score * 100) / 100,
      createdAt: dtu.createdAt,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  social.trending = candidates.slice(0, limit);
  social.trendingComputedAt = now;
  social.metrics.trendingComputations++;

  return { ok: true, trending: social.trending, cached: false };
}

// ── Discovery ────────────────────────────────────────────────────────────

/**
 * searchUsersByPrefix — type-ahead lookup for @mention autocomplete.
 *
 * Phase 11 (Item 3): supports the MentionAutocomplete dropdown in
 * QuickPostComposer and CommentThread.  Ranks by:
 *   1. people the viewer follows
 *   2. people who follow the viewer
 *   3. everyone else (public profiles only), ordered by citation count
 *
 * Returns canonical shape so the round-trip to the post's
 * `mentionedUsers` array doesn't lose any identity info.
 *
 * @param {Object} STATE
 * @param {string} prefix    typed prefix (without @)
 * @param {string} viewerId  the caller's userId (for follow-ranking)
 * @param {number} limit
 * @returns {{ ok: true, results: Array<{ userId, username, displayName, avatar, isFollowing, isFollower }> }}
 */
export function searchUsersByPrefix(STATE, prefix, viewerId, limit = 10) {
  const social = getSocialState(STATE);
  const q = String(prefix || "").trim().toLowerCase();
  if (!q) return { ok: true, results: [] };

  const following = social.follows.get(viewerId) || new Set();
  const followers = new Set();
  for (const [otherId, theirFollows] of social.follows) {
    if (otherId !== viewerId && theirFollows.has(viewerId)) followers.add(otherId);
  }

  const matches = [];
  for (const [id, profile] of social.profiles) {
    if (id === viewerId) continue;
    if (!profile.isPublic) continue;
    const dn = String(profile.displayName || "").toLowerCase();
    // Username is the userId tail for now (auth-system users carry it
    // separately; we fall back to displayName + id prefix-match).
    const idLower = String(id).toLowerCase();
    if (!dn.startsWith(q) && !idLower.startsWith(q) && !dn.includes(q)) continue;

    const isFollowing = following.has(id);
    const isFollower = followers.has(id);
    let rankScore = 0;
    if (isFollowing) rankScore += 100;
    if (isFollower) rankScore += 50;
    rankScore += Math.min(50, profile.stats?.citationCount || 0);
    // prefix matches outrank substring matches
    if (dn.startsWith(q) || idLower.startsWith(q)) rankScore += 25;

    matches.push({
      userId: id,
      username: profile.displayName || id,
      displayName: profile.displayName || id,
      avatar: profile.avatar || null,
      isFollowing,
      isFollower,
      _rank: rankScore,
    });
  }

  matches.sort((a, b) => b._rank - a._rank);
  const trimmed = matches.slice(0, limit).map(({ _rank, ...rest }) => rest);
  return { ok: true, results: trimmed };
}

/**
 * Discover users to follow based on shared interests (tags, domains).
 */
export function discoverUsers(STATE, userId, limit = 10) {
  const social = getSocialState(STATE);
  const myFollows = social.follows.get(userId) || new Set();

  // Find users who share tags with the current user's DTUs
  const myTags = new Set();
  if (STATE.dtus) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.author === userId || dtu.meta?.authorId === userId) {
        for (const tag of (dtu.tags || [])) myTags.add(tag);
      }
    }
  }

  const candidates = [];
  for (const [id, profile] of social.profiles) {
    if (id === userId || myFollows.has(id)) continue;
    if (!profile.isPublic) continue;

    // Score by tag overlap
    const userTags = new Set(profile.specialization || []);
    let overlap = 0;
    for (const tag of myTags) if (userTags.has(tag)) overlap++;
    const score = overlap + (profile.stats?.citationCount || 0) * 0.01;

    if (score > 0) {
      candidates.push({ userId: id, profile, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return {
    ok: true,
    suggestions: candidates.slice(0, limit).map(c => ({
      userId: c.userId,
      displayName: c.profile.displayName,
      bio: c.profile.bio,
      followerCount: c.profile.stats?.followerCount || 0,
      citationCount: c.profile.stats?.citationCount || 0,
      matchScore: c.score,
    })),
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────

export function getSocialMetrics(STATE) {
  const social = getSocialState(STATE);
  return { ok: true, ...social.metrics };
}

// ── Posts ────────────────────────────────────────────────────────────────

export function createPost(STATE, { userId, content, title, mediaType, mediaUrl, tags, mentionedUsers, pollOptions, isStory, expiresAt, taggedProducts, linkedDTUs, federationVisibility }) {
  const social = getSocialState(STATE);
  if (!userId) return { ok: false, error: "userId required" };
  if (!content && !mediaUrl) return { ok: false, error: "content or mediaUrl required" };

  const id = nextId("post");
  const now = new Date().toISOString();
  // Phase 11 (Item 12) — federation visibility lives on the post.
  // Defaults to 'local'. Server-side fanout to the federation outbox
  // only happens when visibility !== 'local' AND the federation
  // dispatcher is wired (CONCORD_ACTIVITYPUB=true).
  const visibility = ['local', 'followers', 'public'].includes(federationVisibility) ? federationVisibility : 'local';
  const post = {
    id,
    userId,
    content: content || "",
    title: title || "",
    mediaType: mediaType || "text",
    mediaUrl: mediaUrl || null,
    tags: tags || [],
    mentionedUsers: mentionedUsers || [],
    taggedProducts: taggedProducts || [],
    linkedDTUs: linkedDTUs || [],
    reactions: new Map(),
    comments: [],
    shares: [],
    bookmarks: new Set(),
    viewCount: 0,
    watchTimeMs: 0,
    createdAt: now,
    expiresAt: isStory ? (expiresAt || new Date(Date.now() + 86400000).toISOString()) : (expiresAt || null),
    isPinned: false,
    pollOptions: pollOptions ? pollOptions.map(o => ({ text: typeof o === "string" ? o : o.text, votes: new Set() })) : null,
    threadParentId: null,
    threadPosition: 0,
    groupId: null,
    federationVisibility: visibility,
    apActivityId: visibility !== 'local' ? `concord:post:${id}` : null,
  };

  social.posts.set(id, post);

  // Create mention notifications
  if (post.mentionedUsers.length) {
    for (const mentioned of post.mentionedUsers) {
      createNotification(STATE, { userId: mentioned, type: "mention", fromUserId: userId, postId: id, content: `${userId} mentioned you in a post` });
    }
  }

  // Federation outbox fanout (best-effort). Caller in server.js sets
  // _federationDispatcher with (post) → enqueue rows. Wrapped in
  // try/catch so an outbox-write failure never breaks createPost.
  if (visibility !== 'local' && typeof _federationDispatcher === 'function') {
    try { _federationDispatcher(post); }
    catch (_e) { /* substrate stays consistent */ }
  }

  // Update streak
  updateStreak(STATE, userId);

  return { ok: true, post: serializePost(post) };
}

// Phase 11 (Item 12) — federation dispatcher hook. server.js wires
// this once at boot to fan visibility-non-local posts into the
// federation_outbox table via federation-outbox.js#enqueueOutbound.
let _federationDispatcher = null;
export function setFederationDispatcher(fn) {
  _federationDispatcher = typeof fn === 'function' ? fn : null;
}

function serializePost(post) {
  const reactions = {};
  if (post.reactions) {
    for (const [type, users] of post.reactions) {
      reactions[type] = users.size;
    }
  }
  return {
    id: post.id,
    userId: post.userId,
    content: post.content,
    title: post.title,
    mediaType: post.mediaType,
    mediaUrl: post.mediaUrl,
    tags: post.tags,
    mentionedUsers: post.mentionedUsers,
    taggedProducts: post.taggedProducts || [],
    linkedDTUs: post.linkedDTUs || [],
    reactions,
    commentCount: post.comments.length,
    shareCount: post.shares.length,
    bookmarkCount: post.bookmarks.size,
    viewCount: post.viewCount,
    watchTimeMs: post.watchTimeMs,
    createdAt: post.createdAt,
    expiresAt: post.expiresAt,
    isPinned: post.isPinned,
    pollOptions: post.pollOptions ? post.pollOptions.map(o => ({ text: o.text, voteCount: o.votes.size })) : null,
    threadParentId: post.threadParentId,
    threadPosition: post.threadPosition,
    groupId: post.groupId,
    federationVisibility: post.federationVisibility || 'local',
    apActivityId: post.apActivityId || null,
  };
}

export function getPost(STATE, postId) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  return { ok: true, post: serializePost(post) };
}

export function deletePost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  if (post.userId !== userId) return { ok: false, error: "Only owner can delete" };
  social.posts.delete(postId);
  return { ok: true, postId };
}

export function getUserPosts(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  const posts = [];
  for (const post of social.posts.values()) {
    if (post.userId === userId) posts.push(post);
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: posts.slice(offset, offset + limit).map(serializePost), total: posts.length };
}

// ── Reactions ────────────────────────────────────────────────────────────

const VALID_REACTIONS = new Set(["like", "fire", "heart", "mind-blown", "useful", "disagree"]);

export function addReaction(STATE, { userId, postId, type }) {
  const social = getSocialState(STATE);
  if (!VALID_REACTIONS.has(type)) return { ok: false, error: "Invalid reaction type" };
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  if (!post.reactions.has(type)) post.reactions.set(type, new Set());
  const set = post.reactions.get(type);
  const toggled = set.has(userId);
  if (toggled) {
    set.delete(userId);
  } else {
    set.add(userId);
    if (post.userId !== userId) {
      createNotification(STATE, { userId: post.userId, type: "like", fromUserId: userId, postId, content: `${userId} reacted ${type} to your post` });
    }
  }
  return { ok: true, postId, type, added: !toggled };
}

export function getReactions(STATE, postId, currentUserId) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  const reactions = {};
  for (const [type, users] of post.reactions) {
    reactions[type] = { count: users.size, userReacted: currentUserId ? users.has(currentUserId) : false };
  }
  return { ok: true, postId, reactions };
}

// ── Comments ─────────────────────────────────────────────────────────────

export function addComment(STATE, { userId, postId, content, parentCommentId, mentionedUsers }) {
  const social = getSocialState(STATE);
  if (!content) return { ok: false, error: "content required" };
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  const comment = {
    id: nextId("cmt"),
    userId,
    content,
    parentCommentId: parentCommentId || null,
    mentionedUsers: Array.isArray(mentionedUsers) ? mentionedUsers.filter(Boolean) : [],
    createdAt: new Date().toISOString(),
    replies: [],
  };

  if (parentCommentId) {
    const parent = post.comments.find(c => c.id === parentCommentId);
    if (parent) parent.replies.push(comment);
    else post.comments.push(comment);
  } else {
    post.comments.push(comment);
  }

  if (post.userId !== userId) {
    createNotification(STATE, { userId: post.userId, type: "comment", fromUserId: userId, postId, content: `${userId} commented on your post` });
  }

  // Phase 11 (Item 3) — mention notifications on comment.
  for (const mentioned of comment.mentionedUsers) {
    if (mentioned === userId || mentioned === post.userId) continue;
    createNotification(STATE, { userId: mentioned, type: "mention", fromUserId: userId, postId, content: `${userId} mentioned you in a comment` });
  }

  return { ok: true, comment: { id: comment.id, userId: comment.userId, content: comment.content, parentCommentId: comment.parentCommentId, mentionedUsers: comment.mentionedUsers, createdAt: comment.createdAt } };
}

export function deleteComment(STATE, { userId, postId, commentId }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  function removeFrom(arr) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === commentId) {
        if (arr[i].userId !== userId && post.userId !== userId) return false;
        arr.splice(i, 1);
        return true;
      }
      if (arr[i].replies && removeFrom(arr[i].replies)) return true;
    }
    return false;
  }

  if (!removeFrom(post.comments)) return { ok: false, error: "Comment not found or not authorized" };
  return { ok: true, commentId };
}

export function getComments(STATE, postId, { limit = 50 } = {}) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  function serializeComment(c) {
    return { id: c.id, userId: c.userId, content: c.content, parentCommentId: c.parentCommentId, createdAt: c.createdAt, replies: (c.replies || []).map(serializeComment) };
  }
  return { ok: true, comments: post.comments.slice(0, limit).map(serializeComment), total: post.comments.length };
}

// ── Shares ───────────────────────────────────────────────────────────────

export function sharePost(STATE, { userId, postId, commentary }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  const share = { userId, commentary: commentary || "", timestamp: new Date().toISOString() };
  post.shares.push(share);

  if (post.userId !== userId) {
    createNotification(STATE, { userId: post.userId, type: "share", fromUserId: userId, postId, content: `${userId} shared your post` });
  }
  return { ok: true, share };
}

export function getShares(STATE, postId) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  return { ok: true, shares: post.shares, total: post.shares.length };
}

// ── Bookmarks ────────────────────────────────────────────────────────────

export function bookmarkPost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  const toggled = post.bookmarks.has(userId);
  if (toggled) post.bookmarks.delete(userId);
  else post.bookmarks.add(userId);
  return { ok: true, postId, bookmarked: !toggled };
}

export function getUserBookmarks(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  const bookmarked = [];
  for (const post of social.posts.values()) {
    if (post.bookmarks.has(userId)) bookmarked.push(post);
  }
  bookmarked.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: bookmarked.slice(offset, offset + limit).map(serializePost), total: bookmarked.length };
}

// ── Feed Algorithm ───────────────────────────────────────────────────────

function getEngagementScore(post) {
  let reactionCount = 0;
  for (const users of post.reactions.values()) reactionCount += users.size;
  return reactionCount * 3 + post.comments.length * 5 + post.shares.length * 8 + post.bookmarks.size * 4 + post.viewCount * 0.1;
}

function getRecencyBoost(createdAt) {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  return Math.max(0.1, 1 - ageHours / 168); // decays over 7 days
}

export function getForYouFeed(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  social.metrics.feedRequests++;

  // Collect interest tags from followed users' profiles
  const followSet = social.follows.get(userId) || new Set();
  const interestTags = new Set();
  for (const fid of followSet) {
    const profile = social.profiles.get(fid);
    if (profile?.specialization) for (const t of profile.specialization) interestTags.add(t);
  }

  const now = Date.now();
  const scored = [];
  for (const post of social.posts.values()) {
    if (post.expiresAt && new Date(post.expiresAt).getTime() < now) continue;
    const engagement = getEngagementScore(post);
    const recency = getRecencyBoost(post.createdAt);
    let interestOverlap = 1;
    if (interestTags.size > 0 && post.tags.length > 0) {
      let overlap = 0;
      for (const t of post.tags) if (interestTags.has(t)) overlap++;
      interestOverlap = 1 + overlap;
    }
    scored.push({ post, score: engagement * recency * interestOverlap });
  }

  scored.sort((a, b) => b.score - a.score);
  return { ok: true, posts: scored.slice(offset, offset + limit).map(s => ({ ...serializePost(s.post), score: Math.round(s.score * 100) / 100 })), total: scored.length };
}

export function getFollowingFeed(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  social.metrics.feedRequests++;
  const followSet = social.follows.get(userId) || new Set();
  const now = Date.now();
  const posts = [];
  for (const post of social.posts.values()) {
    if (!followSet.has(post.userId)) continue;
    if (post.expiresAt && new Date(post.expiresAt).getTime() < now) continue;
    posts.push(post);
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: posts.slice(offset, offset + limit).map(serializePost), total: posts.length };
}

export function getExploreFeed(STATE, { limit = 30, offset = 0, topic } = {}) {
  const social = getSocialState(STATE);
  social.metrics.feedRequests++;
  const now = Date.now();
  const scored = [];
  for (const post of social.posts.values()) {
    if (post.expiresAt && new Date(post.expiresAt).getTime() < now) continue;
    if (topic && !post.tags.includes(topic)) continue;
    scored.push({ post, score: getEngagementScore(post) * getRecencyBoost(post.createdAt) });
  }
  scored.sort((a, b) => b.score - a.score);
  return { ok: true, posts: scored.slice(offset, offset + limit).map(s => ({ ...serializePost(s.post), score: Math.round(s.score * 100) / 100 })), total: scored.length };
}

// ── DMs ──────────────────────────────────────────────────────────────────

function getConversationId(a, b) {
  return [a, b].sort().join(":");
}

export function sendMessage(STATE, { fromUserId, toUserId, content, mediaUrl }) {
  const social = getSocialState(STATE);
  if (!fromUserId || !toUserId) return { ok: false, error: "fromUserId and toUserId required" };
  if (!content && !mediaUrl) return { ok: false, error: "content or mediaUrl required" };

  const convId = getConversationId(fromUserId, toUserId);
  if (!social.messages.has(convId)) social.messages.set(convId, []);

  const msg = {
    id: nextId("msg"),
    conversationId: convId,
    fromUserId,
    toUserId,
    content: content || "",
    mediaUrl: mediaUrl || null,
    createdAt: new Date().toISOString(),
    readBy: new Set([fromUserId]),
  };

  social.messages.get(convId).push(msg);
  createNotification(STATE, { userId: toUserId, type: "dm", fromUserId, content: `New message from ${fromUserId}` });

  return { ok: true, message: { id: msg.id, conversationId: msg.conversationId, fromUserId: msg.fromUserId, toUserId: msg.toUserId, content: msg.content, mediaUrl: msg.mediaUrl, createdAt: msg.createdAt } };
}

export function getConversations(STATE, userId) {
  const social = getSocialState(STATE);
  const convos = [];
  for (const [convId, msgs] of social.messages) {
    if (!convId.includes(userId)) continue;
    const lastMsg = msgs[msgs.length - 1];
    let unreadCount = 0;
    for (const m of msgs) {
      if (!m.readBy.has(userId)) unreadCount++;
    }
    const otherUser = convId.split(":").find(id => id !== userId) || userId;
    convos.push({
      conversationId: convId,
      otherUserId: otherUser,
      lastMessage: { content: lastMsg.content, fromUserId: lastMsg.fromUserId, createdAt: lastMsg.createdAt },
      unreadCount,
      messageCount: msgs.length,
    });
  }
  convos.sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime());
  return { ok: true, conversations: convos };
}

export function getMessages(STATE, conversationId, { limit = 50, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  const msgs = social.messages.get(conversationId);
  if (!msgs) return { ok: true, messages: [], total: 0 };

  const sorted = [...msgs].reverse(); // newest first
  return {
    ok: true,
    messages: sorted.slice(offset, offset + limit).map(m => ({
      id: m.id, conversationId: m.conversationId, fromUserId: m.fromUserId, toUserId: m.toUserId,
      content: m.content, mediaUrl: m.mediaUrl, createdAt: m.createdAt,
    })),
    total: msgs.length,
  };
}

export function markMessagesRead(STATE, { userId, conversationId }) {
  const social = getSocialState(STATE);
  const msgs = social.messages.get(conversationId);
  if (!msgs) return { ok: false, error: "Conversation not found" };
  let marked = 0;
  for (const m of msgs) {
    if (!m.readBy.has(userId)) { m.readBy.add(userId); marked++; }
  }
  return { ok: true, conversationId, markedRead: marked };
}

// Recall (delete) a DM the caller sent, within a short window. Used by
// frontend panels to surface a "you can take this back" affordance after
// a send. Recipient-side notification stays — only the message body is
// wiped (replaced with a tombstone marker) so the read receipt is honest.
export function recallMessage(STATE, { messageId, userId, windowSeconds = 120 }) {
  if (!messageId || !userId) return { ok: false, error: "messageId and userId required" };
  const social = getSocialState(STATE);
  for (const [convId, msgs] of social.messages) {
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) continue;
    const msg = msgs[idx];
    if (msg.fromUserId !== userId) return { ok: false, error: "only the sender can recall a message" };
    const ageSec = (Date.now() - new Date(msg.createdAt).getTime()) / 1000;
    if (ageSec >= windowSeconds) return { ok: false, error: `recall window (${windowSeconds}s) elapsed` };
    msg.content = "";
    msg.mediaUrl = null;
    msg.recalled = true;
    msg.recalledAt = new Date().toISOString();
    return { ok: true, messageId, conversationId: convId, recalledAt: msg.recalledAt };
  }
  return { ok: false, error: "message not found" };
}

// ── Notifications ────────────────────────────────────────────────────────

export function createNotification(STATE, { userId, type, fromUserId, postId, content }) {
  const social = getSocialState(STATE);
  if (!social.notifications.has(userId)) social.notifications.set(userId, []);

  const notif = {
    id: nextId("notif"),
    userId,
    type: type || "general",
    fromUserId: fromUserId || null,
    postId: postId || null,
    content: content || "",
    read: false,
    createdAt: new Date().toISOString(),
  };

  social.notifications.get(userId).unshift(notif); // newest first
  // Keep max 500 per user
  const arr = social.notifications.get(userId);
  if (arr.length > 500) arr.length = 500;

  _fireNotificationSocket(userId, notif);

  return { ok: true, notification: notif };
}

export function getNotifications(STATE, userId, { limit = 30, offset = 0, unreadOnly = false } = {}) {
  const social = getSocialState(STATE);
  let notifs = social.notifications.get(userId) || [];
  if (unreadOnly) notifs = notifs.filter(n => !n.read);
  return { ok: true, notifications: notifs.slice(offset, offset + limit), total: notifs.length };
}

export function markNotificationRead(STATE, { userId, notificationId }) {
  const social = getSocialState(STATE);
  const notifs = social.notifications.get(userId);
  if (!notifs) return { ok: false, error: "No notifications" };
  const notif = notifs.find(n => n.id === notificationId);
  if (!notif) return { ok: false, error: "Notification not found" };
  notif.read = true;
  return { ok: true, notificationId };
}

export function markAllNotificationsRead(STATE, userId) {
  const social = getSocialState(STATE);
  const notifs = social.notifications.get(userId) || [];
  let count = 0;
  for (const n of notifs) { if (!n.read) { n.read = true; count++; } }
  return { ok: true, markedRead: count };
}

export function getUnreadCount(STATE, userId) {
  const social = getSocialState(STATE);
  const notifs = social.notifications.get(userId) || [];
  const count = notifs.filter(n => !n.read).length;
  return { ok: true, userId, unreadCount: count };
}

export function deleteNotification(STATE, { userId, notificationId }) {
  const social = getSocialState(STATE);
  const notifs = social.notifications.get(userId);
  if (!notifs) return { ok: false, error: "No notifications" };
  const idx = notifs.findIndex(n => n.id === notificationId);
  if (idx === -1) return { ok: false, error: "Notification not found" };
  notifs.splice(idx, 1);
  return { ok: true, notificationId };
}

// ── Stories ──────────────────────────────────────────────────────────────

export function getActiveStories(STATE, userId) {
  const social = getSocialState(STATE);
  const followSet = social.follows.get(userId) || new Set();
  const now = Date.now();
  const stories = [];

  for (const post of social.posts.values()) {
    if (!post.expiresAt) continue;
    if (new Date(post.expiresAt).getTime() < now) continue;
    if (!followSet.has(post.userId) && post.userId !== userId) continue;
    stories.push(serializePost(post));
  }

  stories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, stories };
}

export function viewStory(STATE, { userId, storyId }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(storyId);
  if (!post) return { ok: false, error: "Story not found" };
  post.viewCount++;
  return { ok: true, storyId, viewCount: post.viewCount };
}

// ── Polls ────────────────────────────────────────────────────────────────

export function votePoll(STATE, { userId, postId, optionIndex }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  if (!post.pollOptions) return { ok: false, error: "Post has no poll" };
  if (optionIndex < 0 || optionIndex >= post.pollOptions.length) return { ok: false, error: "Invalid option index" };

  // Remove previous vote
  for (const opt of post.pollOptions) opt.votes.delete(userId);
  post.pollOptions[optionIndex].votes.add(userId);

  return { ok: true, postId, optionIndex };
}

export function getPollResults(STATE, postId) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  if (!post.pollOptions) return { ok: false, error: "Post has no poll" };

  let totalVotes = 0;
  const options = post.pollOptions.map(o => { totalVotes += o.votes.size; return { text: o.text, votes: o.votes.size }; });
  return { ok: true, postId, options, totalVotes };
}

// ── Hashtags / Topics ────────────────────────────────────────────────────

export function getTrendingTopics(STATE, { limit = 20 } = {}) {
  const social = getSocialState(STATE);
  const tagCounts = new Map();
  const cutoff = Date.now() - 7 * 86400000; // last 7 days

  for (const post of social.posts.values()) {
    if (new Date(post.createdAt).getTime() < cutoff) continue;
    for (const tag of post.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const sorted = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return { ok: true, topics: sorted.map(([topic, count]) => ({ topic, count })) };
}

export function getPostsByTopic(STATE, topic, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  const now = Date.now();
  const posts = [];
  for (const post of social.posts.values()) {
    if (post.expiresAt && new Date(post.expiresAt).getTime() < now) continue;
    if (post.tags.includes(topic)) posts.push(post);
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: posts.slice(offset, offset + limit).map(serializePost), total: posts.length };
}

// ── Groups / Communities ─────────────────────────────────────────────────

export function createGroup(STATE, { userId, name, description, rules, tags }) {
  const social = getSocialState(STATE);
  if (!userId || !name) return { ok: false, error: "userId and name required" };

  const id = nextId("grp");
  const group = {
    id,
    name,
    description: description || "",
    rules: rules || "",
    tags: tags || [],
    ownerId: userId,
    members: new Set([userId]),
    postIds: [],
    createdAt: new Date().toISOString(),
  };

  social.groups.set(id, group);
  return { ok: true, group: serializeGroup(group) };
}

function serializeGroup(g) {
  return { id: g.id, name: g.name, description: g.description, rules: g.rules, tags: g.tags, ownerId: g.ownerId, memberCount: g.members.size, postCount: g.postIds.length, createdAt: g.createdAt };
}

export function joinGroup(STATE, { userId, groupId }) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };
  group.members.add(userId);
  return { ok: true, groupId, userId };
}

export function leaveGroup(STATE, { userId, groupId }) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };
  if (group.ownerId === userId) return { ok: false, error: "Owner cannot leave group" };
  group.members.delete(userId);
  return { ok: true, groupId, userId };
}

export function getGroupFeed(STATE, groupId, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };

  const posts = [];
  for (const pid of group.postIds) {
    const post = social.posts.get(pid);
    if (post) posts.push(post);
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: posts.slice(offset, offset + limit).map(serializePost), total: posts.length };
}

export function postToGroup(STATE, { userId, groupId, postId }) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };
  if (!group.members.has(userId)) return { ok: false, error: "Must be a member to post" };
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  if (!group.postIds.includes(postId)) group.postIds.push(postId);
  post.groupId = groupId;
  return { ok: true, groupId, postId };
}

export function listGroups(STATE, { limit = 50, search } = {}) {
  const social = getSocialState(STATE);
  let groups = Array.from(social.groups.values());
  if (search) {
    const q = search.toLowerCase();
    groups = groups.filter(g => g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q) || g.tags.some(t => t.toLowerCase().includes(q)));
  }
  groups.sort((a, b) => b.members.size - a.members.size);
  return { ok: true, groups: groups.slice(0, limit).map(serializeGroup), total: groups.length };
}

export function getGroupMembers(STATE, groupId) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };

  const members = Array.from(group.members).map(id => {
    const profile = social.profiles.get(id);
    return { userId: id, displayName: profile?.displayName || id, isOwner: id === group.ownerId };
  });
  return { ok: true, members, total: members.length };
}

// ── Creator Analytics ────────────────────────────────────────────────────

export function getCreatorAnalytics(STATE, userId) {
  const social = getSocialState(STATE);
  let totalReach = 0;
  let totalEngagement = 0;
  let totalPosts = 0;
  const contentBreakdown = {};
  const reactionBreakdown = {};
  const postScores = [];
  const postingHours = new Array(24).fill(0);

  for (const post of social.posts.values()) {
    if (post.userId !== userId) continue;
    totalPosts++;
    totalReach += post.viewCount;

    const engagement = getEngagementScore(post);
    totalEngagement += engagement;

    contentBreakdown[post.mediaType] = (contentBreakdown[post.mediaType] || 0) + 1;
    for (const [type, users] of post.reactions) {
      reactionBreakdown[type] = (reactionBreakdown[type] || 0) + users.size;
    }

    postScores.push({ postId: post.id, title: post.title, engagement });
    const hour = new Date(post.createdAt).getHours();
    postingHours[hour]++;
  }

  postScores.sort((a, b) => b.engagement - a.engagement);
  const bestHours = postingHours.map((count, hour) => ({ hour, count })).sort((a, b) => b.count - a.count).slice(0, 3);

  // Follower growth (approximate: count followers whose profile was created in last 30d)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const followerSet = social.followers.get(userId) || new Set();
  let recentFollowers = 0;
  for (const fid of followerSet) {
    const p = social.profiles.get(fid);
    if (p && p.createdAt >= thirtyDaysAgo) recentFollowers++;
  }

  return {
    ok: true,
    totalReach,
    engagementRate: totalPosts > 0 ? Math.round((totalEngagement / Math.max(totalReach, 1)) * 10000) / 100 : 0,
    followerGrowth: recentFollowers,
    totalFollowers: followerSet.size,
    topPosts: postScores.slice(0, 10),
    bestPostingHours: bestHours,
    contentBreakdown,
    reactionBreakdown,
    totalPosts,
  };
}

export function getPostAnalytics(STATE, postId) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  let reactionCount = 0;
  const reactionBreakdown = {};
  for (const [type, users] of post.reactions) {
    reactionBreakdown[type] = users.size;
    reactionCount += users.size;
  }

  return {
    ok: true,
    postId,
    views: post.viewCount,
    reactions: reactionCount,
    reactionBreakdown,
    comments: post.comments.length,
    shares: post.shares.length,
    bookmarks: post.bookmarks.size,
    watchTimeMs: post.watchTimeMs,
    reachEstimate: post.viewCount + post.shares.length * 10,
  };
}

// ── Streaks ──────────────────────────────────────────────────────────────

export function updateStreak(STATE, userId) {
  const social = getSocialState(STATE);
  const today = new Date().toISOString().slice(0, 10);
  let streak = social.streaks.get(userId);

  if (!streak) {
    streak = { current: 1, longest: 1, lastPostDate: today };
    social.streaks.set(userId, streak);
    return { ok: true, ...streak };
  }

  if (streak.lastPostDate === today) return { ok: true, ...streak };

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (streak.lastPostDate === yesterday) {
    streak.current++;
  } else {
    streak.current = 1;
  }

  if (streak.current > streak.longest) streak.longest = streak.current;
  streak.lastPostDate = today;

  return { ok: true, ...streak };
}

export function getStreak(STATE, userId) {
  const social = getSocialState(STATE);
  const streak = social.streaks.get(userId) || { current: 0, longest: 0, lastPostDate: null };
  return { ok: true, userId, ...streak };
}

// ── Social Commerce ──────────────────────────────────────────────────────

export function tagListing(STATE, { postId, listingId }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  if (!social.postListings.has(postId)) social.postListings.set(postId, new Set());
  social.postListings.get(postId).add(listingId);
  return { ok: true, postId, listingId };
}

export function getPostSales(STATE, postId) {
  const social = getSocialState(STATE);
  const clicks = social.postClicks.get(postId) || 0;
  const listings = social.postListings.get(postId);
  return { ok: true, postId, clicks, linkedListings: listings ? Array.from(listings) : [] };
}

export function getPostEarnings(STATE, postId) {
  const social = getSocialState(STATE);
  const earnings = social.postEarnings.get(postId) || 0;
  return { ok: true, postId, earnings };
}

// ── Pin Posts ────────────────────────────────────────────────────────────

export function pinPost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  if (post.userId !== userId) return { ok: false, error: "Only owner can pin" };

  // Count currently pinned
  let pinnedCount = 0;
  for (const p of social.posts.values()) {
    if (p.userId === userId && p.isPinned) pinnedCount++;
  }
  if (pinnedCount >= 3 && !post.isPinned) return { ok: false, error: "Maximum 3 pinned posts" };

  post.isPinned = true;
  return { ok: true, postId };
}

export function unpinPost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  if (post.userId !== userId) return { ok: false, error: "Only owner can unpin" };
  post.isPinned = false;
  return { ok: true, postId };
}

export function getPinnedPosts(STATE, userId) {
  const social = getSocialState(STATE);
  const pinned = [];
  for (const post of social.posts.values()) {
    if (post.userId === userId && post.isPinned) pinned.push(serializePost(post));
  }
  return { ok: true, posts: pinned };
}

// ── Watch Time ───────────────────────────────────────────────────────────

export function recordWatchTime(STATE, { userId, postId, durationMs }) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };
  post.watchTimeMs += (durationMs || 0);
  post.viewCount++;
  return { ok: true, postId, watchTimeMs: post.watchTimeMs, viewCount: post.viewCount };
}

// ── Scheduled Posts ──────────────────────────────────────────────────────

export function schedulePost(STATE, { userId, postData, scheduledAt }) {
  const social = getSocialState(STATE);
  if (!scheduledAt) return { ok: false, error: "scheduledAt required" };
  const id = nextId("sched");
  social.scheduledPosts.set(id, { id, userId, postData: postData || {}, scheduledAt, createdAt: new Date().toISOString() });
  return { ok: true, scheduledPostId: id, scheduledAt };
}

export function getScheduledPosts(STATE, userId) {
  const social = getSocialState(STATE);
  const posts = [];
  for (const sp of social.scheduledPosts.values()) {
    if (sp.userId === userId) posts.push({ id: sp.id, postData: sp.postData, scheduledAt: sp.scheduledAt, createdAt: sp.createdAt });
  }
  posts.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  return { ok: true, scheduledPosts: posts };
}

export function cancelScheduledPost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const sp = social.scheduledPosts.get(postId);
  if (!sp) return { ok: false, error: "Scheduled post not found" };
  if (sp.userId !== userId) return { ok: false, error: "Only owner can cancel" };
  social.scheduledPosts.delete(postId);
  return { ok: true, postId };
}

export function processScheduledPosts(STATE) {
  const social = getSocialState(STATE);
  const now = Date.now();
  const published = [];

  for (const [id, sp] of social.scheduledPosts) {
    if (new Date(sp.scheduledAt).getTime() <= now) {
      const result = createPost(STATE, { userId: sp.userId, ...sp.postData });
      if (result.ok) published.push(result.post.id);
      social.scheduledPosts.delete(id);
    }
  }

  return { ok: true, published, count: published.length };
}

// ── Trending Engine (velocity-based) ────────────────────────────────────

function getTrendingScore(post) {
  let reactionCount = 0;
  for (const users of post.reactions.values()) reactionCount += users.size;
  const likes = reactionCount;
  const comments = post.comments.length;
  const saves = post.bookmarks.size;
  const shares = post.shares.length;
  const raw = likes * 3 + comments * 5 + saves * 4 + shares * 8;
  const hoursOld = (Date.now() - new Date(post.createdAt).getTime()) / 3600000;
  const recencyBoost = 1 / (hoursOld + 1);
  return raw * recencyBoost;
}

export function getTrendingContent(STATE, { limit = 20, hours = 24 } = {}) {
  const social = getSocialState(STATE);
  const cutoff = Date.now() - hours * 3600000;
  const scored = [];

  for (const post of social.posts.values()) {
    if (new Date(post.createdAt).getTime() < cutoff) continue;
    if (post.expiresAt && new Date(post.expiresAt).getTime() < Date.now()) continue;
    scored.push({ post: serializePost(post), score: getTrendingScore(post) });
  }

  scored.sort((a, b) => b.score - a.score);
  return { ok: true, content: scored.slice(0, limit).map(s => ({ ...s.post, trendScore: Math.round(s.score * 100) / 100 })) };
}

export function getTrendingCreators(STATE, { limit = 20, days = 7 } = {}) {
  const social = getSocialState(STATE);
  const cutoff = Date.now() - days * 86400000;
  const creatorStats = new Map();

  for (const post of social.posts.values()) {
    if (new Date(post.createdAt).getTime() < cutoff) continue;
    const uid = post.userId;
    if (!creatorStats.has(uid)) {
      creatorStats.set(uid, { userId: uid, engagementTotal: 0, postCount: 0, followerGrowth: 0 });
    }
    const cs = creatorStats.get(uid);
    cs.engagementTotal += getTrendingScore(post);
    cs.postCount++;
  }

  // Estimate follower growth: followers whose profile was created recently
  for (const [uid, cs] of creatorStats) {
    const followerSet = social.followers.get(uid) || new Set();
    cs.followerCount = followerSet.size;
    let recentFollowers = 0;
    for (const fid of followerSet) {
      const p = social.profiles.get(fid);
      if (p && new Date(p.createdAt).getTime() > cutoff) recentFollowers++;
    }
    cs.followerGrowth = recentFollowers;
  }

  const scored = Array.from(creatorStats.values()).map(cs => ({
    ...cs,
    displayName: social.profiles.get(cs.userId)?.displayName || cs.userId,
    score: cs.engagementTotal + cs.followerGrowth * 10,
  }));

  scored.sort((a, b) => b.score - a.score);
  return { ok: true, creators: scored.slice(0, limit) };
}

export function getTrendingDomains(STATE, { limit = 10 } = {}) {
  const social = getSocialState(STATE);
  const cutoff = Date.now() - 24 * 3600000;
  const domainScores = new Map();

  for (const post of social.posts.values()) {
    if (new Date(post.createdAt).getTime() < cutoff) continue;
    const score = getTrendingScore(post);
    for (const tag of (post.tags || [])) {
      domainScores.set(tag, (domainScores.get(tag) || 0) + score);
    }
  }

  const sorted = Array.from(domainScores.entries())
    .map(([domain, score]) => ({ domain, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // For each domain, grab top 3 posts
  const result = sorted.map(d => {
    const domainPosts = [];
    for (const post of social.posts.values()) {
      if (new Date(post.createdAt).getTime() < cutoff) continue;
      if ((post.tags || []).includes(d.domain)) {
        domainPosts.push({ post: serializePost(post), score: getTrendingScore(post) });
      }
    }
    domainPosts.sort((a, b) => b.score - a.score);
    return { ...d, topPosts: domainPosts.slice(0, 3).map(p => p.post) };
  });

  return { ok: true, domains: result };
}
